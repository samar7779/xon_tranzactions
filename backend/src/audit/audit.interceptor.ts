import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { AuditService } from './audit.service';
import { describeRoute } from './audit.routes';

// Faqat o'zgartiruvchi so'rovlar yoziladi (GET shovqinini tashlaymiz).
const LOG_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
// Shovqinli / audit kerak bo'lmagan yo'llar (health, deploy, auditning o'zi).
const SKIP = ['/_deploy', '/audit', '/auth/refresh'];

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const method: string = req.method;
    const url: string = String(req.originalUrl || req.url || '').split('?')[0];

    const skip = SKIP.some((p) => url.startsWith(p) || url.startsWith('/api' + p));
    if (!LOG_METHODS.has(method) || skip) return next.handle();

    const started = Date.now();
    const ipRaw = req.headers?.['x-forwarded-for'];
    const ip = (Array.isArray(ipRaw) ? ipRaw[0] : String(ipRaw || '').split(',')[0]).trim()
      || req.ip || req.socket?.remoteAddress || null;

    const write = (statusCode: number, success: boolean, errMsg?: string) => {
      // Audit HECH QACHON so'rovni buzmasin — hamma narsa try/catch ichida.
      try {
        const user = req.user || {};
        const { module, action } = describeRoute(method, url);
        const params = req.params && Object.keys(req.params).length ? req.params : undefined;
        this.audit.record({
          userId: user.id ?? null,
          userEmail: user.email ?? null,
          userName: user.fullName ?? null,
          action, module, method, path: url, ip,
          statusCode, durationMs: Date.now() - started, success,
          meta: (params || errMsg) ? { params, error: errMsg } : undefined,
        });
      } catch { /* audit muhim emas — so'rov davom etadi */ }
    };

    return next.handle().pipe(
      tap(() => {
        const res = context.switchToHttp().getResponse();
        write(res?.statusCode ?? 200, true);
      }),
      catchError((err) => {
        write(err?.status ?? err?.statusCode ?? 500, false, String(err?.message || '').slice(0, 200));
        return throwError(() => err);
      }),
    );
  }
}
