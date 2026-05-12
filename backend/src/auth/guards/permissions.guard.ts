import { CanActivate, ExecutionContext, Injectable, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

/**
 * `@RequirePermissions(...)` dekoratori bilan ishlatiladi.
 * Foydalanuvchi req.user.permissions ichida kamida bittasi mos kelsa — ruxsat.
 *
 * Jwt strategy req.user.permissions ni Role tablesidan yuklaydi.
 * SUPERADMIN enum'iga ega bo'lganlarga avtomatik barcha ruxsat (backwards compat).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = ctx.switchToHttp().getRequest();
    if (!user) throw new ForbiddenException('Tizimga kirilmagan');

    // SUPERADMIN enum'iga ega bo'lganlarga avtomatik ruxsat
    if (user.role === 'SUPERADMIN') return true;

    const userPerms: string[] = user.permissions || [];
    const ok = required.some((p) => userPerms.includes(p));
    if (!ok) throw new ForbiddenException(`Bu amal uchun ruxsat yo'q: ${required.join(', ')}`);
    return true;
  }
}
