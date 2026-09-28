import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

/**
 * agent-bridge himoyasi — JWT/rol YO'Q, o'rniga uchta shart (hammasi bajarilishi SHART):
 *   (a) `x-agent-bridge-key` header == env AGENT_BRIDGE_KEY (timingSafeEqual). Kalit bo'sh
 *       yoki 32 belgidan qisqa bo'lsa HAMMA so'rov 403 — kalit sozlanmaguncha ko'prik yopiq.
 *   (b) so'rov nginx orqali kelmagan: X-Forwarded-For / X-Real-IP / Forwarded / X-Forwarded-*
 *       headerlaridan BIRORTASI bo'lsa ham 403 (nginx /api/ location ularni qo'yadi).
 *   (c) socket manzili loopback (127.0.0.1, ::1, ::ffff:127.0.0.1). `req.ip` EMAS —
 *       main.ts `trust proxy` tufayli req.ip XFF'dan olinadi va soxtalashtirilishi mumkin.
 * Barcha rad etish sabablari uchun javob BIR XIL (`403 Forbidden`) — sabab faqat server log'ida.
 */

export const AGENT_BRIDGE_KEY_ENV = 'AGENT_BRIDGE_KEY';
export const AGENT_BRIDGE_HEADER = 'x-agent-bridge-key';
export const MIN_KEY_LEN = 32;
// nginx /api/ location X-Real-IP, X-Forwarded-For, X-Forwarded-Proto qo'yadi.
export const PROXY_HEADERS = ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-forwarded-proto', 'x-forwarded-host'];
export const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

// Audit interceptor req.user'dan o'qiydi → actor: agent-bridge (AuditLog.userId FK'siz, null bo'ladi).
export const AGENT_BRIDGE_ACTOR = Object.freeze({
  id: null as string | null,
  email: 'agent-bridge',
  fullName: 'agent-bridge',
  role: 'AGENT_BRIDGE',
  permissions: [] as string[],
});

/** Env'dagi kalit ko'prikni ochishga yaroqlimi (bo'sh emas, >= 32 belgi). */
export function isKeyConfigured(raw: unknown): boolean {
  return String(raw ?? '').trim().length >= MIN_KEY_LEN;
}

/** Uzunlikni ham sizdirmaydi: ikkala tomon SHA-256 (32 bayt) → timingSafeEqual. */
export function safeKeyEqual(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

@Injectable()
export class AgentBridgeGuard implements CanActivate {
  private readonly log = new Logger('AgentBridgeGuard');
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') throw new ForbiddenException('Forbidden');
    const req = ctx.switchToHttp().getRequest();
    const reason = this.rejectReason(req);
    if (reason) {
      // Kalit qiymati HECH QACHON log'ga yozilmaydi (faqat sabab + yo'l + socket manzili).
      const path = String(req?.originalUrl || req?.url || '').split('?')[0].replace(/[^\x20-\x7e]/g, '?').slice(0, 200);
      this.log.warn(`rad etildi: ${reason} · ${req?.method} ${path} · ra=${req?.socket?.remoteAddress}`);
      throw new ForbiddenException('Forbidden'); // barcha sabab uchun BIR XIL javob (oracle yo'q)
    }
    req.user = { ...AGENT_BRIDGE_ACTOR, permissions: [] };
    return true;
  }

  /** null = ruxsat; aks holda ichki sabab (faqat log uchun). Tartib muhim. */
  rejectReason(req: any): string | null {
    const expected = String(this.config.get<string>(AGENT_BRIDGE_KEY_ENV) ?? '').trim();
    if (!isKeyConfigured(expected)) return 'key-not-configured';                   // (a) kalit sozlanmaguncha yopiq
    const h = req?.headers || {};
    for (const name of PROXY_HEADERS) if (h[name] !== undefined) return `proxy-header:${name}`; // (b) bo'sh qiymat ham rad
    const ra = req?.socket?.remoteAddress;                                          // (c) req.ip EMAS (trust proxy)
    if (!ra || !LOOPBACK.has(ra)) return 'not-loopback';
    const given = h[AGENT_BRIDGE_HEADER];
    if (typeof given !== 'string' || given.length === 0) return 'no-key';          // massiv (takroriy header) ham rad
    if (!safeKeyEqual(given, expected)) return 'bad-key';
    return null;
  }
}
