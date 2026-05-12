import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtPayload } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_SECRET', 'change-me'),
    });
  }

  async validate(payload: JwtPayload) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      include: { roleRef: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }
    // Permissions ni Role'dan olamiz, yoki enum default
    let permissions: string[] = [];
    if (user.roleRef) {
      permissions = user.roleRef.permissions;
    } else if (user.role === 'SUPERADMIN') {
      permissions = ['*']; // PermissionsGuard SUPERADMIN'ga avtomatik o'tkazadi
    }
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      roleId: user.roleId,
      fullName: user.fullName,
      permissions,
    };
  }
}
