import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  /**
   * Ruxsatlar faqat foydalanuvchiga biriktirilgan Role'dan olinadi.
   * Hech qanday hardcode yo'q — roli bo'lmasa, ruxsatlar ham bo'lmaydi.
   */
  private resolvePermissions(user: { roleRef: { permissions: string[] } | null }): string[] {
    return user.roleRef?.permissions ?? [];
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.adminUser.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { roleRef: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException("Email yoki parol noto'g'ri");
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Email yoki parol noto'g'ri");
    }
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const token = await this.jwt.signAsync(payload);
    const permissions = this.resolvePermissions(user);
    return {
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        roleId: user.roleId,
        roleLabel: user.roleRef?.label,
        permissions,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      include: { roleRef: true },
    });
    if (!user) throw new UnauthorizedException();
    const permissions = this.resolvePermissions(user);
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      roleId: user.roleId,
      roleLabel: user.roleRef?.label,
      permissions,
      lastLoginAt: user.lastLoginAt,
    };
  }
}
