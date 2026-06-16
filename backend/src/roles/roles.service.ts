import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_TREE, SYSTEM_ROLES } from '../auth/permissions';

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly log = new Logger(RolesService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * App boot — SYSTEM_ROLES (SUPERADMIN, ADMIN, ACCOUNTANT, VIEWER) ni DB bilan
   * sinxronlash. Kod'ga qo'shilgan yangi permissions avtomatik mavjud rolga
   * qo'shiladi. Admin qo'lda qo'shgan ruxsatlar HECH QACHON o'chirilmaydi —
   * faqat yetishmagan default'lar qo'shiladi (union).
   *
   * SUPERADMIN istisno: har doim ALL_PERMISSIONS — bosh admin barcha
   * ruxsatlarga ega bo'lishi shart (yangi feature qo'shilgach ham).
   */
  async onModuleInit() {
    try {
      for (const sysRole of SYSTEM_ROLES) {
        const existing = await this.prisma.role.findUnique({ where: { name: sysRole.name } });
        const defaultPerms = sysRole.permissions as string[];

        if (!existing) {
          await this.prisma.role.create({
            data: {
              name: sysRole.name,
              label: sysRole.label,
              description: sysRole.description,
              permissions: defaultPerms,
              isSystem: true,
            },
          });
          this.log.log(`System rol yaratildi: ${sysRole.name} (${defaultPerms.length} ruxsat)`);
          continue;
        }

        // SUPERADMIN — har doim hamma ruxsat
        const targetPerms = sysRole.name === 'SUPERADMIN'
          ? (ALL_PERMISSIONS as string[])
          : Array.from(new Set([...(existing.permissions || []), ...defaultPerms]));

        // Faqat o'zgargan bo'lsa update qilamiz
        const existingSet = new Set(existing.permissions || []);
        const targetSet = new Set(targetPerms);
        const added = targetPerms.filter((p) => !existingSet.has(p));
        const changed = added.length > 0 || targetSet.size !== existingSet.size;
        if (changed) {
          await this.prisma.role.update({
            where: { id: existing.id },
            data: { permissions: targetPerms, isSystem: true },
          });
          this.log.log(`System rol yangilandi: ${sysRole.name} — +${added.length} yangi ruxsat (${added.join(', ') || '—'})`);
        }
      }
    } catch (e: any) {
      // Bootstrap xatosi app'ni to'xtatmasin (masalan migration hali ishlamagan)
      this.log.warn(`System rollarni sinxronlashda xato: ${e?.message}`);
    }
  }

  /** Mavjud permissions ro'yxati (UI uchun) — yangi ierarxik tree + eski groups (backward compat) */
  permissionsCatalog() {
    return { ok: true, all: ALL_PERMISSIONS, groups: PERMISSION_GROUPS, tree: PERMISSION_TREE };
  }

  async list() {
    const items = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { users: true } } },
    });
    return { ok: true, items };
  }

  async get(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: {
        users: { select: { id: true, email: true, fullName: true, isActive: true } },
      },
    });
    if (!role) throw new NotFoundException('Rol topilmadi');
    return role;
  }

  private validatePerms(perms: string[]) {
    const invalid = perms.filter((p) => !ALL_PERMISSIONS.includes(p as any));
    if (invalid.length) {
      throw new BadRequestException(`Noma'lum permission: ${invalid.join(', ')}`);
    }
  }

  async create(dto: CreateRoleDto) {
    this.validatePerms(dto.permissions);
    const exists = await this.prisma.role.findUnique({ where: { name: dto.name } });
    if (exists) throw new ConflictException('Bu nomli rol mavjud');
    const role = await this.prisma.role.create({
      data: {
        name: dto.name.toUpperCase(),
        label: dto.label,
        description: dto.description,
        permissions: dto.permissions,
        isSystem: false,
      },
    });
    return { ok: true, role };
  }

  async update(id: string, dto: UpdateRoleDto) {
    const exists = await this.prisma.role.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Rol topilmadi');
    // Har qanday rolning ruxsatlari tahrirlanishi mumkin — tizim roli ham.
    // Faqat o'chirib bo'lmaydi (remove() da tekshiriladi).
    if (dto.permissions) this.validatePerms(dto.permissions);
    const role = await this.prisma.role.update({
      where: { id },
      data: {
        label: dto.label ?? undefined,
        description: dto.description ?? undefined,
        permissions: dto.permissions ?? undefined,
      },
    });
    return { ok: true, role };
  }

  async remove(id: string) {
    const exists = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!exists) throw new NotFoundException('Rol topilmadi');
    // Yagona himoya: rolga foydalanuvchi bog'langan bo'lsa o'chirib bo'lmaydi
    // (admin o'zini tizimdan qulflab qo'ymasligi uchun). isSystem cheklovi yo'q.
    if (exists._count.users > 0) {
      throw new BadRequestException(`Bu rolga ${exists._count.users} foydalanuvchi bog'langan — avval ularni boshqa rolga o'tkazing`);
    }
    await this.prisma.role.delete({ where: { id } });
    return { ok: true };
  }
}
