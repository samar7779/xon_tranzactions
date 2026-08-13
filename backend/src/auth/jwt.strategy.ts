import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtPayload } from './auth.service';
import { ALL_PERMISSIONS } from './permissions';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService, private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    // Telegram Mini App mehmoni — AdminUser yo'q, ruxsat cheklangan (faqat Tekshirish).
    if (payload?.tgGuest) {
      return {
        id: payload.sub,
        isTelegramGuest: true,
        fullName: payload.name || 'Telegram',
        permissions: ['chekorder:view', 'chekorder:manage'],
      };
    }
    const user = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      include: { roleRef: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException();
    }
    // Ruxsatlar biriktirilgan Role'dan olinadi. SUPERADMIN — HAR DOIM hamma ruxsat
    // (yangi feature qo'shilгач DB sinxron kechiksa ham bosh admin qulflanmasin).
    const permissions: string[] = user.roleRef?.name === 'SUPERADMIN'
      ? (ALL_PERMISSIONS as string[])
      : (user.roleRef?.permissions ?? []);
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
