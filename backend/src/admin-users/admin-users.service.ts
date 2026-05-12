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
      select: {
        id: true, email: true, fullName: true, role: true,
        isActive: true, lastLoginAt: true, createdAt: true,
      },
    });
    return { ok: true, items };
  }

  async create(dto: CreateAdminDto) {
    const email = dto.email.toLowerCase();
    const exists = await this.prisma.adminUser.findUnique({ where: { email } });
    if (exists) throw new ConflictException('Bu email allaqachon mavjud');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.adminUser.create({
      data: {
        email,
        passwordHash,
        fullName: dto.fullName,
        role: dto.role || 'ADMIN',
      },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    });
    return { ok: true, user };
  }

  async update(id: string, dto: UpdateAdminDto) {
    const exists = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Admin topilmadi');
    const data: any = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.prisma.adminUser.update({
      where: { id }, data,
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    });
    return { ok: true, user };
  }

  async remove(id: string) {
    const exists = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Admin topilmadi');
    await this.prisma.adminUser.delete({ where: { id } });
    return { ok: true };
  }
}
