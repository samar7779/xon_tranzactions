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
    // Ruxsatlar faqat biriktirilgan Role'dan olinadi — hardcode yo'q.
    // Roli yo'q foydalanuvchida hech qanday ruxsat bo'lmaydi.
    const permissions: string[] = user.roleRef?.permissions ?? [];
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
