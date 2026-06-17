import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyService } from '../api-key.service';
import { API_SCOPES_KEY } from '../decorators/api-scopes.decorator';
import { ApiScope } from '../api-scopes';

/**
 * Public /api/v1/* endpoint'lar uchun guard.
 *   1. X-API-Key + X-API-Secret header'larini o'qiydi
 *   2. ApiKeyService bilan validatsiya qiladi
 *   3. Endpoint'da @RequireApiScopes(...) bo'lsa scope'larni tekshiradi
 *   4. req.apiKey ga validatsiya o'tgan kalit ob'ektini biriktiradi
 */
@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeyService,
  ) {}

  private extractIp(req: any): string | undefined {
    // X-Forwarded-For (proxy/nginx) yoki socket'dan
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
      return fwd.split(',')[0].trim();
    }
    return req.ip || req.socket?.remoteAddress || undefined;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const keyId = (req.headers['x-api-key'] as string) || '';
    const secret = (req.headers['x-api-secret'] as string) || '';
    const ip = this.extractIp(req);

    const apiKey = await this.keys.validateCredentials(keyId.trim(), secret.trim(), ip);
    req.apiKey = apiKey;
    req.apiKeyIp = ip;

    // Scope tekshiruv
    const required = this.reflector.getAllAndOverride<ApiScope[]>(API_SCOPES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]) || [];
    if (required.length > 0) {
      const has = required.some((s) => apiKey.scopes.includes(s));
      if (!has) {
        throw new ForbiddenException(
          `Bu endpoint uchun scope kerak: ${required.join(' yoki ')}. ` +
          `Sizning kalitingizda: ${apiKey.scopes.join(', ') || '—'}`,
        );
      }
    }

    return true;
  }
}
