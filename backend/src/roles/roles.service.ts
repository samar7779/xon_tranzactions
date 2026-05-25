import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, PERMISSION_TREE } from '../auth/permissions';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

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
