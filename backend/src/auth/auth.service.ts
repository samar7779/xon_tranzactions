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

  private async resolvePermissions(user: { role: string; roleRef: { permissions: string[] } | null }): Promise<string[]> {
    // Yangi RBAC: Role table'dan permissions[]
    if (user.roleRef) return user.roleRef.permissions;
    // Backwards compat: enum'ga qarab default permissions
    if (user.role === 'SUPERADMIN') {
      return [
        'dashboard:view','transactions:view',
        'accounts:view','accounts:manage',
        'credentials:view','credentials:manage','credentials:test',
        'banks:view','banks:manage',
        'sync:view','sync:run',
        'users:view','users:manage',
        'roles:view','roles:manage',
        'system:deploy',
      ];
    }
    if (user.role === 'ADMIN') {
      return [
        'dashboard:view','transactions:view',
        'accounts:view','accounts:manage',
        'credentials:view','credentials:manage','credentials:test',
        'banks:view','banks:manage',
        'sync:view','sync:run',
      ];
    }
    return ['dashboard:view','transactions:view','accounts:view','credentials:view','banks:view','sync:view'];
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
    const permissions = await this.resolvePermissions(user);
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
    const permissions = await this.resolvePermissions(user);
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
