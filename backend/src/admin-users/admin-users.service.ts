import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateAdminDto, UpdateAdminDto } from './dto/create-admin.dto';

@Injectable()
export class AdminUsersService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.adminUser.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        roleRef: { select: { id: true, name: true, label: true } },
      },
    });
    return {
      ok: true,
      items: items.map(({ passwordHash, ...rest }) => rest),
    };
  }

  async create(dto: CreateAdminDto) {
    const email = dto.email.toLowerCase();
    const exists = await this.prisma.adminUser.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Bu email allaqachon mavjud');
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Yangi roleId yoki eski enum role qabul qilamiz
    let roleId = dto.roleId;
    let enumRole = dto.role || 'ADMIN';
    if (roleId) {
      const role = await this.prisma.role.findUnique({ where: { id: roleId } });
      if (!role) throw new NotFoundException('Rol topilmadi');
      // Enum'ni roleName ga moslashtiramiz (legacy bilan ishlashi uchun)
      enumRole = ['SUPERADMIN', 'ADMIN', 'VIEWER'].includes(role.name) ? (role.name as any) : 'ADMIN';
    }

    const user = await this.prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName,
        role: enumRole as any,
        roleId,
      },
      include: { roleRef: { select: { id: true, name: true, label: true } } },
    });
    const { passwordHash: _, ...safe } = user;
    return { ok: true, user: safe };
  }

  async update(id: string, dto: UpdateAdminDto) {
    const exists = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Admin topilmadi');
    const data: any = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    if (dto.roleId !== undefined) {
      if (dto.roleId === null || dto.roleId === '') {
        data.roleId = null;
      } else {
        const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
        if (!role) throw new NotFoundException('Rol topilmadi');
        data.roleId = role.id;
        if (['SUPERADMIN', 'ADMIN', 'VIEWER'].includes(role.name)) {
          data.role = role.name;
        }
      }
    }
    const user = await this.prisma.adminUser.update({
      where: { id }, data,
      include: { roleRef: { select: { id: true, name: true, label: true } } },
    });
    const { passwordHash: _, ...safe } = user;
    return { ok: true, user: safe };
  }

  async remove(id: string) {
    const exists = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Admin topilmadi');
    await this.prisma.adminUser.delete({ where: { id } });
    return { ok: true };
  }
}
