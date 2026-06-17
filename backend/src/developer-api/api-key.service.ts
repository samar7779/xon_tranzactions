import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { ALL_API_SCOPES, ApiScope } from './api-scopes';

/**
 * API Key formati:
 *   keyId  = "xk_live_" + 32 hex (public)
 *   secret = "xs_live_" + 48 hex (faqat yaratishda bir marta ko'rsatiladi)
 *   secretHash = SHA-256(secret)
 *
 * Foydalanuvchi har so'rovda ikki header yuboradi:
 *   X-API-Key: xk_live_xxxxxxxxxx
 *   X-API-Secret: xs_live_xxxxxxxxxx
 */
export interface ValidatedApiKey {
  id: string;
  keyId: string;
  name: string;
  scopes: string[];
  description: string | null;
  expiresAt: Date | null;
  allowedIps: string[];
}

@Injectable()
export class ApiKeyService {
  private readonly log = new Logger(ApiKeyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── HELPERS ─────────────────────────────────────────────────────

  private generateKeyId(): string {
    return 'xk_live_' + randomBytes(16).toString('hex');
  }

  private generateSecret(): string {
    return 'xs_live_' + randomBytes(24).toString('hex');
  }

  private hashSecret(secret: string): string {
    return createHash('sha256').update(secret, 'utf8').digest('hex');
  }

  private validateScopes(scopes: string[]): void {
    const invalid = scopes.filter((s) => !ALL_API_SCOPES.includes(s as ApiScope));
    if (invalid.length) {
      throw new BadRequestException(`Noma'lum API scope: ${invalid.join(', ')}`);
    }
  }

  // ─── ADMIN: CRUD ─────────────────────────────────────────────────

  async list() {
    const items = await this.prisma.apiKey.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true, keyId: true, secretPreview: true, name: true, description: true,
        scopes: true, expiresAt: true, isActive: true, allowedIps: true,
        createdByEmail: true, createdAt: true, updatedAt: true,
        lastUsedAt: true, lastUsedIp: true, totalRequests: true,
        revokedAt: true, revokedReason: true,
      },
    });
    return { ok: true, items };
  }

  async get(id: string) {
    const key = await this.prisma.apiKey.findUnique({
      where: { id },
      select: {
        id: true, keyId: true, secretPreview: true, name: true, description: true,
        scopes: true, expiresAt: true, isActive: true, allowedIps: true,
        createdByEmail: true, createdAt: true, updatedAt: true,
        lastUsedAt: true, lastUsedIp: true, totalRequests: true,
        revokedAt: true, revokedReason: true,
      },
    });
    if (!key) throw new NotFoundException('API kalit topilmadi');
    return { ok: true, key };
  }

  async create(dto: {
    name: string;
    description?: string;
    scopes: string[];
    expiresAt?: string | null;          // ISO yoki YYYY-MM-DD; null = cheksiz
    allowedIps?: string[];               // bo'sh = barcha IP
    createdById?: string;
    createdByEmail?: string;
  }) {
    if (!dto.name?.trim()) throw new BadRequestException('Nom kerak');
    this.validateScopes(dto.scopes || []);

    let expiresAt: Date | null = null;
    if (dto.expiresAt) {
      const d = new Date(dto.expiresAt);
      if (isNaN(d.getTime())) throw new BadRequestException(`Noto'g'ri sana: ${dto.expiresAt}`);
      expiresAt = d;
    }

    const keyId = this.generateKeyId();
    const secret = this.generateSecret();
    const secretHash = this.hashSecret(secret);
    const secretPreview = secret.slice(-4); // oxirgi 4 belgi

    const key = await this.prisma.apiKey.create({
      data: {
        keyId,
        secretHash,
        secretPreview,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        scopes: dto.scopes || [],
        expiresAt,
        allowedIps: dto.allowedIps || [],
        createdById: dto.createdById,
        createdByEmail: dto.createdByEmail,
      },
    });

    // SECRET FAQAT SHU YERDA QAYTARILADI — keyin hech qachon ko'rsatilmaydi
    return {
      ok: true,
      key: {
        id: key.id,
        keyId: key.keyId,
        secret,                          // <-- bir marta, qaytarib bo'lmaydi
        name: key.name,
        scopes: key.scopes,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
      },
      message: 'API kalit yaratildi. Secret hozir ko\'rsatilmoqda — keyin hech qachon ko\'rinmaydi. ' +
        'Saqlab oling!',
    };
  }

  async update(id: string, dto: {
    name?: string;
    description?: string | null;
    scopes?: string[];
    expiresAt?: string | null;
    allowedIps?: string[];
    isActive?: boolean;
  }) {
    const exists = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('API kalit topilmadi');
    if (dto.scopes) this.validateScopes(dto.scopes);

    const data: any = {};
    if (dto.name !== undefined) {
      if (!dto.name?.trim()) throw new BadRequestException('Nom bo\'sh bo\'lmasligi kerak');
      data.name = dto.name.trim();
    }
    if (dto.description !== undefined) data.description = dto.description?.trim() || null;
    if (dto.scopes !== undefined) data.scopes = dto.scopes;
    if (dto.expiresAt !== undefined) {
      if (dto.expiresAt === null) {
        data.expiresAt = null;
      } else {
        const d = new Date(dto.expiresAt);
        if (isNaN(d.getTime())) throw new BadRequestException(`Noto'g'ri sana: ${dto.expiresAt}`);
        data.expiresAt = d;
      }
    }
    if (dto.allowedIps !== undefined) data.allowedIps = dto.allowedIps;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const key = await this.prisma.apiKey.update({ where: { id }, data });
    return { ok: true, key };
  }

  async revoke(id: string, reason?: string) {
    const exists = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('API kalit topilmadi');
    await this.prisma.apiKey.update({
      where: { id },
      data: {
        isActive: false,
        revokedAt: new Date(),
        revokedReason: reason || 'Admin tomonidan bekor qilindi',
      },
    });
    return { ok: true };
  }

  async remove(id: string) {
    const exists = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('API kalit topilmadi');
    // Logs ham yo'qoladi (onDelete: SetNull bo'lsa qoladi). Hozir SetNull,
    // ya'ni log saqlanib qoladi, faqat apiKey ulanish uziladi.
    await this.prisma.apiKey.delete({ where: { id } });
    return { ok: true };
  }

  // ─── PUBLIC: AUTH ────────────────────────────────────────────────

  /**
   * X-API-Key + X-API-Secret kombinatsiyasini tekshiradi.
   * Muvaffaqiyatli bo'lsa ValidatedApiKey qaytaradi, aks holda exception.
   */
  async validateCredentials(keyId: string, secret: string, ip?: string): Promise<ValidatedApiKey> {
    if (!keyId || !secret) {
      throw new UnauthorizedException('API kaliti yoki secret yetishmayapti');
    }
    if (!keyId.startsWith('xk_') || !secret.startsWith('xs_')) {
      throw new UnauthorizedException('Noto\'g\'ri kalit formati');
    }

    const key = await this.prisma.apiKey.findUnique({ where: { keyId } });
    if (!key) {
      throw new UnauthorizedException('API kalit topilmadi yoki noto\'g\'ri');
    }
    if (!key.isActive) {
      throw new UnauthorizedException('API kalit faol emas (bekor qilingan)');
    }
    if (key.expiresAt && key.expiresAt < new Date()) {
      throw new UnauthorizedException('API kalit muddati o\'tgan');
    }

    // Constant-time secret comparison (timing attack himoyasi)
    const providedHash = this.hashSecret(secret);
    const expected = Buffer.from(key.secretHash, 'hex');
    const provided = Buffer.from(providedHash, 'hex');
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new UnauthorizedException('Noto\'g\'ri secret');
    }

    // IP whitelist (bo'sh ro'yxat = barcha IP'larga ruxsat)
    if (key.allowedIps.length > 0 && ip && !key.allowedIps.includes(ip)) {
      throw new UnauthorizedException(`IP ruxsat etilmagan: ${ip}`);
    }

    return {
      id: key.id,
      keyId: key.keyId,
      name: key.name,
      description: key.description,
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      allowedIps: key.allowedIps,
    };
  }

  /**
   * So'rovdan keyin lastUsedAt/lastUsedIp/totalRequests'ni yangilash.
   * Fire-and-forget — exception tashlamaydi.
   */
  async touchLastUsed(id: string, ip?: string): Promise<void> {
    try {
      await this.prisma.apiKey.update({
        where: { id },
        data: {
          lastUsedAt: new Date(),
          lastUsedIp: ip || null,
          totalRequests: { increment: 1 },
        },
      });
    } catch {
      /* ignore */
    }
  }

  // ─── LOGS & STATS ────────────────────────────────────────────────

  async listLogs(opts: {
    apiKeyId?: string;
    statusCode?: number;
    method?: string;
    page?: number;
    perPage?: number;
  }) {
    const page = Math.max(1, opts.page || 1);
    const perPage = Math.min(200, Math.max(10, opts.perPage || 50));
    const where: any = {};
    if (opts.apiKeyId) where.apiKeyId = opts.apiKeyId;
    if (opts.statusCode) where.statusCode = opts.statusCode;
    if (opts.method) where.method = opts.method.toUpperCase();

    const [total, items] = await Promise.all([
      this.prisma.apiRequestLog.count({ where }),
      this.prisma.apiRequestLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { apiKey: { select: { id: true, name: true, keyId: true } } },
      }),
    ]);
    return { ok: true, total, page, perPage, items };
  }

  async stats(apiKeyId?: string) {
    const where: any = {};
    if (apiKeyId) where.apiKeyId = apiKeyId;

    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [total, h24, d7, byStatus, byPath, byIp] = await Promise.all([
      this.prisma.apiRequestLog.count({ where }),
      this.prisma.apiRequestLog.count({ where: { ...where, createdAt: { gte: last24h } } }),
      this.prisma.apiRequestLog.count({ where: { ...where, createdAt: { gte: last7d } } }),
      this.prisma.apiRequestLog.groupBy({
        by: ['statusCode'],
        where,
        _count: true,
        orderBy: { statusCode: 'asc' },
      }),
      this.prisma.apiRequestLog.groupBy({
        by: ['path'],
        where,
        _count: true,
        orderBy: { _count: { path: 'desc' } },
        take: 10,
      }),
      this.prisma.apiRequestLog.groupBy({
        by: ['ip'],
        where: { ...where, ip: { not: null } },
        _count: true,
        orderBy: { _count: { ip: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      ok: true,
      total,
      last24h: h24,
      last7d: d7,
      byStatus: byStatus.map((r) => ({ status: r.statusCode, count: r._count })),
      topPaths: byPath.map((r) => ({ path: r.path, count: r._count })),
      topIps: byIp.map((r) => ({ ip: r.ip, count: r._count })),
    };
  }

  // ─── LOG WRITE (interceptor uchun) ───────────────────────────────

  async writeLog(data: {
    apiKeyId: string | null;
    method: string;
    path: string;
    query?: any;
    statusCode: number;
    durationMs: number;
    ip?: string;
    userAgent?: string;
    responseSize?: number;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.prisma.apiRequestLog.create({
        data: {
          apiKeyId: data.apiKeyId,
          method: data.method.toUpperCase(),
          path: data.path.slice(0, 255),
          query: data.query ?? undefined,
          statusCode: data.statusCode,
          durationMs: data.durationMs,
          ip: data.ip || null,
          userAgent: data.userAgent?.slice(0, 512) || null,
          responseSize: data.responseSize ?? null,
          errorMessage: data.errorMessage?.slice(0, 512) || null,
        },
      });
    } catch (e: any) {
      this.log.warn(`ApiRequestLog yozishda xato: ${e?.message}`);
    }
  }
}
