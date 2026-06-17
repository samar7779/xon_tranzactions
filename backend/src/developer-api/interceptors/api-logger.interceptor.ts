import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap, catchError, throwError } from 'rxjs';
import { ApiKeyService } from '../api-key.service';

/**
 * Har bir /api/v1/* so'rovni ApiRequestLog'ga yozadi va ApiKey.lastUsedAt'ni
 * yangilaydi. So'rov muvaffaqiyatli yoki xato bo'lishidan qat'i nazar log
 * yozilishini ta'minlaydi.
 */
@Injectable()
export class ApiLoggerInterceptor implements NestInterceptor {
  constructor(private readonly keys: ApiKeyService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const start = Date.now();

    const writeLog = (statusCode: number, errorMessage?: string, payload?: any) => {
      // ApiKey ID — guard'dan keyin biriktirilgan bo'lishi kerak (req.apiKey)
      const apiKeyId = req.apiKey?.id ?? null;
      const ip = req.apiKeyIp || req.ip;
      const ua = req.headers['user-agent'];
      const durationMs = Date.now() - start;

      // Sezgir ma'lumotlarni tozalash (api secret query'da bo'lmasligi kerak,
      // lekin har ehtimol)
      const query = { ...(req.query || {}) };
      delete query.secret;
      delete query.api_secret;
      delete query.password;

      let responseSize: number | undefined;
      try {
        if (payload != null) {
          const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
          responseSize = Buffer.byteLength(s, 'utf8');
        }
      } catch { /* ignore */ }

      void this.keys.writeLog({
        apiKeyId,
        method: req.method,
        path: req.originalUrl?.split('?')[0] || req.url || '',
        query: Object.keys(query).length ? query : undefined,
        statusCode,
        durationMs,
        ip,
        userAgent: typeof ua === 'string' ? ua : undefined,
        responseSize,
        errorMessage,
      });

      // lastUsedAt yangilash (faqat apiKey topilgan bo'lsa)
      if (apiKeyId) {
        void this.keys.touchLastUsed(apiKeyId, ip);
      }
    };

    return next.handle().pipe(
      tap((payload) => writeLog(res.statusCode || 200, undefined, payload)),
      catchError((err) => {
        const status = err?.status || err?.statusCode || 500;
        writeLog(status, err?.message?.slice(0, 500));
        return throwError(() => err);
      }),
    );
  }
}
