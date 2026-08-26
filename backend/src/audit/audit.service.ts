import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

export interface AuditEntry {
  userId?: string | null;
  userEmail?: string | null;
  userName?: string | null;
  action: string;
  module: string;
  method: string;
  path: string;
  ip?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  success?: boolean;
  meta?: any;
}

// Uzbekiston vaqt zonasi (+5) — "faol kun"ni to'g'ri sanash uchun.
const TZ_OFFSET_MS = 5 * 60 * 60 * 1000;

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);
  constructor(private prisma: PrismaService) {}

  /** Fire-and-forget — so'rov yo'lini bloklamaydi va HECH QACHON crash qilmaydi. */
  record(e: AuditEntry): void {
    this.prisma.auditLog
      .create({
        data: {
          userId: e.userId ?? null,
          userEmail: e.userEmail ? String(e.userEmail).slice(0, 190) : null,
          userName: e.userName ? String(e.userName).slice(0, 190) : null,
          action: (e.action || 'amal').slice(0, 190),
          module: (e.module || 'other').slice(0, 64),
          method: (e.method || '').slice(0, 10),
          path: (e.path || '').slice(0, 400),
          ip: e.ip ? String(e.ip).slice(0, 64) : null,
          statusCode: e.statusCode ?? null,
          durationMs: e.durationMs ?? null,
          success: e.success ?? true,
          meta: e.meta ?? undefined,
        },
      })
      .catch((err) => this.log.warn(`audit yozishda xato: ${err?.message}`));
  }

  async recentForUser(userId: string, limit = 30) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
  }

  /** Profil statistikasi: jami amallar, faol kunlar (distinct sana, +5), so'nggi amal. */
  async statsForUser(userId: string): Promise<{ totalActions: number; activeDays: number; lastActionAt: Date | null }> {
    const [total, rows] = await Promise.all([
      this.prisma.auditLog.count({ where: { userId } }),
      this.prisma.auditLog.findMany({
        where: { userId },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 3000,
      }),
    ]);
    const days = new Set(
      rows.map((r) => new Date(r.createdAt.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10)),
    );
    return { totalActions: total, activeDays: days.size, lastActionAt: rows[0]?.createdAt ?? null };
  }
}
