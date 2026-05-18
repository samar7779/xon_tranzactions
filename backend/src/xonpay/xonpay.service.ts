import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';

/**
 * Biling moduli — XonSaroy CRM dan XonPay to'lovlarini sync qiladi va
 * Kapitalbank tx description'idagi UUID bilan moslashtiradi.
 *
 * Reconciliation strategiyasi:
 *   1) CRM payment_method='Xon Pay' to'lovlarini sync
 *   2) Har bir to'lov purpose'idan UUID extract: XONPAY:(UUID)
 *   3) Transaction.description ichida UUID qidirish — topilsa link
 */

const XONPAY_UUID_RE = /XONPAY[:\s]*\(?([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\)?/i;

function extractUuid(purpose: string | null | undefined): string | null {
  if (!purpose) return null;
  const m = purpose.match(XONPAY_UUID_RE);
  return m ? m[1].toUpperCase() : null;
}

function getRu(obj: any, fallback = ''): string {
  if (!obj) return fallback;
  if (typeof obj === 'string') return obj;
  const val = obj.value;
  if (typeof val === 'object' && val) return val.ru || val.uz || val.en || fallback;
  return fallback;
}

function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.length >= 10 ? s : s + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
}

@Injectable()
export class XonpayService {
  private readonly log = new Logger(XonpayService.name);

  // ── Sync state ──
  private syncRunning = false;
  private syncCancelRequested = false;
  private syncStartedAt: Date | null = null;
  private syncFinishedAt: Date | null = null;
  private syncProgress: { page: number; lastPage: number; fetched: number; xonpay: number; inserted: number; updated: number; matched: number; errors: number } | null = null;
  private syncLastError: string | null = null;

  // ── Match state ──
  private matchRunning = false;
  private matchProgress: { done: number; total: number; matched: number } | null = null;

  // ── Cron state (auto-sync) ──
  private lastCronRunAt: Date | null = null;
  private lastCronFinishedAt: Date | null = null;
  private lastCronSkipReason: string | null = null;
  private lastCronResult: { inserted: number; updated: number; matched: number; errors: number } | null = null;

  constructor(private prisma: PrismaService, private crm: CrmService) {}

  /**
   * Avtomatik sync — 07:00 dan 23:00 gacha har soat boshida.
   * Telegram'ga xabar yubormaydi. Boshqa sync ishlayotgan bo'lsa skip qiladi
   * (boshqa progresslarga xalaqit qilmaslik uchun).
   */
  @Cron('0 0 7-23 * * *', { name: 'xonpay-auto-sync', timeZone: 'Asia/Tashkent' })
  async cronAutoSync() {
    if (!this.cronEnabled) {
      this.lastCronSkipReason = 'Cron o\'chirilgan';
      return;
    }
    if (this.syncRunning) {
      this.lastCronSkipReason = "Avvalgi sync hali ishlamoqda (skip)";
      this.log.log('xonpay cron skip: sync already running');
      return;
    }
    this.lastCronRunAt = new Date();
    this.lastCronSkipReason = null;
    this.log.log('xonpay cron: avto-sync boshlanmoqda');

    try {
      // Background sync — trigger='cron' bilan, log jadvalga ham yoziladi
      await this.runSyncInBackground({ limit: 5000, trigger: 'cron' });
      this.lastCronFinishedAt = new Date();
      if (this.syncProgress) {
        this.lastCronResult = {
          inserted: this.syncProgress.inserted,
          updated: this.syncProgress.updated,
          matched: this.syncProgress.matched,
          errors: this.syncProgress.errors,
        };
      }
      this.log.log(`xonpay cron: yakunlandi ${JSON.stringify(this.lastCronResult)}`);
    } catch (e: any) {
      this.log.error(`xonpay cron xato: ${e?.message}`);
    }
  }

  /** Cron'ni o'chirish/yoqish (kelajakda admin UI uchun) */
  setCronEnabled(enabled: boolean) {
    this.cronEnabled = enabled;
  }

  getCronInfo() {
    return {
      enabled: this.cronEnabled,
      schedule: '07:00–23:00, har soat boshida (Asia/Tashkent)',
      lastRunAt: this.lastCronRunAt?.toISOString() || null,
      lastFinishedAt: this.lastCronFinishedAt?.toISOString() || null,
      lastSkipReason: this.lastCronSkipReason,
      lastResult: this.lastCronResult,
    };
  }

  // ════════════════════════════════════════════════════
  //  SYNC (CRM → DB)
  // ════════════════════════════════════════════════════

  startSync(opts?: { limit?: number; trigger?: 'manual' | 'cron'; actorId?: string; actorEmail?: string }): { ok: true; started: boolean; message: string } {
    if (this.syncRunning) {
      const mins = this.syncStartedAt ? Math.floor((Date.now() - this.syncStartedAt.getTime()) / 60000) : 0;
      const p = this.syncProgress;
      return {
        ok: true,
        started: false,
        message: `Sync allaqachon ishlamoqda${p ? ` (page ${p.page}/${p.lastPage}, xonpay: ${p.xonpay})` : ''} — ${mins} daqiqadan beri.`,
      };
    }
    this.runSyncInBackground(opts).catch((e) => this.log.error(`xonpay sync xato: ${e?.message}`));
    return { ok: true, started: true, message: "XonPay sync fonda boshlandi." };
  }

  cancelSync(): { ok: true; cancelled: boolean } {
    if (!this.syncRunning) return { ok: true, cancelled: false };
    this.syncCancelRequested = true;
    return { ok: true, cancelled: true };
  }

  getSyncStatus() {
    return {
      running: this.syncRunning,
      cancelRequested: this.syncCancelRequested,
      startedAt: this.syncStartedAt?.toISOString() || null,
      finishedAt: this.syncFinishedAt?.toISOString() || null,
      progress: this.syncProgress,
      lastError: this.syncLastError,
    };
  }

  private async runSyncInBackground(opts?: { limit?: number; trigger?: 'manual' | 'cron'; actorId?: string; actorEmail?: string }): Promise<void> {
    this.syncRunning = true;
    this.syncCancelRequested = false;
    this.syncStartedAt = new Date();
    this.syncFinishedAt = null;
    this.syncLastError = null;
    this.syncProgress = { page: 0, lastPage: 0, fetched: 0, xonpay: 0, inserted: 0, updated: 0, matched: 0, errors: 0 };

    const LIMIT = opts?.limit || 5000;
    const trigger = opts?.trigger || 'manual';
    let page = 1;

    // Log yozish boshlanishi
    let logId: string | null = null;
    try {
      const logRow = await this.prisma.xonpaySyncLog.create({
        data: {
          trigger,
          actorId: opts?.actorId || null,
          actorEmail: opts?.actorEmail || null,
          status: 'running',
        },
      });
      logId = logRow.id;
    } catch (e: any) {
      this.log.warn(`sync log yaratish xato: ${e?.message}`);
    }

    let finalStatus: 'success' | 'failed' | 'cancelled' = 'success';
    try {
      while (true) {
        if (this.syncCancelRequested) {
          this.log.log(`xonpay sync bekor qilindi (page ${page})`);
          break;
        }

        const r = await this.crm.getPaymentHistory(page, LIMIT);
        if (!r.ok) {
          this.syncProgress.errors++;
          this.syncLastError = (r as any).error || `Page ${page} fetch xato`;
          this.log.warn(`xonpay page ${page} fetch xato: ${this.syncLastError}`);
          break;
        }

        const raw: any = r.data?.data ?? r.data;
        const items: any[] = raw?.data ?? (Array.isArray(raw) ? raw : []);
        const lastPage = raw?.last_page ?? page;

        this.syncProgress.page = page;
        this.syncProgress.lastPage = lastPage;
        this.syncProgress.fetched += items.length;

        if (items.length === 0) {
          this.log.log(`xonpay page ${page}: bo'sh, tugadi`);
          break;
        }

        // Faqat Xon Pay
        const xonpayItems = items.filter((p) => {
          const m = p.payment_method;
          const mStr = typeof m === 'string' ? m : getRu(m, '');
          return /xon\s*pay/i.test(mStr);
        });
        this.syncProgress.xonpay += xonpayItems.length;

        // Bulk upsert (har biri alohida — Postgres limit'lardan ehtiyot bo'lib)
        for (const p of xonpayItems) {
          try {
            const externalId = String(p.external_id || '').trim();
            if (!externalId) continue;

            const xonpayUuid = extractUuid(p.purpose);
            const data = {
              externalId,
              xonpayUuid,
              crmId: p.id ? BigInt(p.id) : null,
              crmUuid: p.uuid || null,
              orderId: p.order_id ? BigInt(p.order_id) : null,
              contract: p.contract || null,
              amount: BigInt(p.amount || 0),
              datePaid: parseDate(p.date_paid),
              type: getRu(p.type) || null,
              category: getRu(p.category) || null,
              status: getRu(p.status) || null,
              purpose: p.purpose || null,
              fullName: p.full_name || null,
              objectName: p.object_name || null,
              isProblematic: !!p.is_problematic,
              isReceivedFromBank: !!p.is_received_from_bank,
              crmCreatedAt: parseDate(p.created_at),
              crmUpdatedAt: parseDate(p.updated_at),
            };

            const existing = await this.prisma.xonpayTransaction.findUnique({ where: { externalId } });
            if (existing) {
              await this.prisma.xonpayTransaction.update({ where: { externalId }, data });
              this.syncProgress.updated++;
            } else {
              await this.prisma.xonpayTransaction.create({ data });
              this.syncProgress.inserted++;
            }

            // Inline match: shu sahifa to'lovlarini birdaniga match qilamiz
            if (xonpayUuid) {
              const matched = await this.tryMatchOne(externalId, xonpayUuid);
              if (matched) this.syncProgress.matched++;
            }
          } catch (e: any) {
            this.syncProgress.errors++;
            this.log.warn(`xonpay upsert xato (${p.external_id}): ${e?.message}`);
          }
        }

        this.log.log(`xonpay page ${page}/${lastPage}: ${items.length} keldi, ${xonpayItems.length} xonpay`);

        if (page >= lastPage) break;
        page++;
      }
    } catch (e: any) {
      this.syncLastError = e?.message || String(e);
      this.log.error(`xonpay sync umumiy xato: ${this.syncLastError}`);
      finalStatus = 'failed';
    } finally {
      if (this.syncCancelRequested) finalStatus = 'cancelled';
      this.syncRunning = false;
      this.syncCancelRequested = false;
      this.syncFinishedAt = new Date();
      this.log.log(`xonpay sync yakunlandi (${finalStatus}): ${JSON.stringify(this.syncProgress)}`);

      // Log yakunlash
      if (logId) {
        try {
          const startedAt = this.syncStartedAt!;
          await this.prisma.xonpaySyncLog.update({
            where: { id: logId },
            data: {
              status: finalStatus,
              pages: this.syncProgress?.page || 0,
              fetched: this.syncProgress?.fetched || 0,
              xonpay: this.syncProgress?.xonpay || 0,
              inserted: this.syncProgress?.inserted || 0,
              updated: this.syncProgress?.updated || 0,
              matched: this.syncProgress?.matched || 0,
              errors: this.syncProgress?.errors || 0,
              errorMessage: this.syncLastError,
              finishedAt: this.syncFinishedAt,
              durationMs: this.syncFinishedAt.getTime() - startedAt.getTime(),
            },
          });
        } catch (e: any) {
          this.log.warn(`sync log update xato: ${e?.message}`);
        }
      }
    }
  }

  /** Sync tarixi — manual va cron — barchasi (default oxirgi 50) */
  async getSyncHistory(limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 500);
    const items = await this.prisma.xonpaySyncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: safeLimit,
    });
    return { ok: true, items };
  }

  // ════════════════════════════════════════════════════
  //  MATCHING (UUID → bank Transaction)
  // ════════════════════════════════════════════════════

  /** Bita to'lovni match'lash — UUID bo'yicha Transaction qidirib link qiladi */
  async tryMatchOne(externalId: string, xonpayUuid?: string | null): Promise<boolean> {
    const xp = await this.prisma.xonpayTransaction.findUnique({ where: { externalId } });
    if (!xp) return false;
    const uuid = xonpayUuid || xp.xonpayUuid || extractUuid(xp.purpose);
    if (!uuid) {
      await this.prisma.xonpayTransaction.update({
        where: { externalId },
        data: { lastCheckedAt: new Date() },
      });
      return false;
    }

    // Transaction.description ichida UUID qidiramiz (case-insensitive)
    const tx = await this.prisma.transaction.findFirst({
      where: { description: { contains: uuid, mode: 'insensitive' } },
      select: { id: true, externalId: true, amount: true, txnDate: true },
      orderBy: { txnDate: 'desc' },
    });

    if (!tx) {
      await this.prisma.xonpayTransaction.update({
        where: { externalId },
        data: { isMatched: false, lastCheckedAt: new Date() },
      });
      return false;
    }

    await this.prisma.xonpayTransaction.update({
      where: { externalId },
      data: {
        matchedTxId: tx.id,
        matchedExternalId: tx.externalId,
        matchedAmount: BigInt(Math.round(Number(tx.amount))),
        matchedDate: tx.txnDate,
        isMatched: true,
        matchedAt: new Date(),
        lastCheckedAt: new Date(),
        xonpayUuid: uuid,
      },
    });
    return true;
  }

  /** Bita externalId uchun majburiy recheck (API) */
  async recheckOne(externalId: string): Promise<{ ok: true; matched: boolean }> {
    const ok = await this.tryMatchOne(externalId);
    return { ok: true, matched: ok };
  }

  /** Bulk recheck — barcha unmatched (yoki barchasi) — fonda */
  startMatchAll(opts?: { onlyUnmatched?: boolean }): { ok: true; started: boolean; message: string } {
    if (this.matchRunning) {
      const p = this.matchProgress;
      return {
        ok: true,
        started: false,
        message: `Match ishlamoqda${p ? ` (${p.done}/${p.total}, matched: ${p.matched})` : ''}`,
      };
    }
    this.runMatchInBackground(opts).catch((e) => this.log.error(`xonpay match xato: ${e?.message}`));
    return { ok: true, started: true, message: 'Match fonda boshlandi.' };
  }

  getMatchStatus() {
    return { running: this.matchRunning, progress: this.matchProgress };
  }

  private async runMatchInBackground(opts?: { onlyUnmatched?: boolean }): Promise<void> {
    this.matchRunning = true;
    this.matchProgress = { done: 0, total: 0, matched: 0 };
    try {
      const where = opts?.onlyUnmatched !== false ? { isMatched: false } : {};
      const ids = await this.prisma.xonpayTransaction.findMany({
        where,
        select: { externalId: true, xonpayUuid: true, purpose: true },
      });
      this.matchProgress.total = ids.length;

      for (const xp of ids) {
        try {
          const uuid = xp.xonpayUuid || extractUuid(xp.purpose);
          const ok = await this.tryMatchOne(xp.externalId, uuid);
          if (ok) this.matchProgress.matched++;
        } catch (e: any) {
          this.log.warn(`match xato (${xp.externalId}): ${e?.message}`);
        }
        this.matchProgress.done++;
      }
    } finally {
      this.matchRunning = false;
    }
  }

  // ════════════════════════════════════════════════════
  //  LIST / STATS
  // ════════════════════════════════════════════════════

  async list(opts: {
    page?: number;
    perPage?: number;
    dateFrom?: string;
    dateTo?: string;
    matched?: 'all' | 'matched' | 'unmatched';
    q?: string;
    contract?: string;
  }) {
    const page = opts.page || 1;
    const perPage = Math.min(opts.perPage || 50, 500);
    const where: any = {};
    if (opts.dateFrom || opts.dateTo) {
      where.datePaid = {};
      if (opts.dateFrom) where.datePaid.gte = new Date(opts.dateFrom);
      if (opts.dateTo) where.datePaid.lte = new Date(opts.dateTo);
    }
    if (opts.matched === 'matched') where.isMatched = true;
    if (opts.matched === 'unmatched') where.isMatched = false;
    if (opts.contract) where.contract = opts.contract;
    if (opts.q) {
      where.OR = [
        { contract: { contains: opts.q, mode: 'insensitive' } },
        { fullName: { contains: opts.q, mode: 'insensitive' } },
        { xonpayUuid: { contains: opts.q, mode: 'insensitive' } },
        { externalId: { contains: opts.q } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.xonpayTransaction.count({ where }),
      this.prisma.xonpayTransaction.findMany({
        where,
        orderBy: [{ datePaid: 'desc' }, { syncedAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          matchedTx: {
            select: { id: true, externalId: true, txnDate: true, amount: true, description: true },
          },
        },
      }),
    ]);

    return {
      ok: true,
      total,
      page,
      perPage,
      items: items.map((x) => ({
        ...x,
        amount: x.amount.toString(),
        matchedAmount: x.matchedAmount?.toString() || null,
        crmId: x.crmId?.toString() || null,
        orderId: x.orderId?.toString() || null,
        matchedTx: x.matchedTx ? { ...x.matchedTx, amount: x.matchedTx.amount.toString() } : null,
      })),
    };
  }

  /** Kunlik statistika: kuniga jami / topilgan / qolgan */
  async dailyStats(opts: { dateFrom?: string; dateTo?: string }) {
    const where: any = {};
    if (opts.dateFrom || opts.dateTo) {
      where.datePaid = {};
      if (opts.dateFrom) where.datePaid.gte = new Date(opts.dateFrom);
      if (opts.dateTo) where.datePaid.lte = new Date(opts.dateTo);
    }
    // groupBy datePaid + isMatched
    const grouped = await this.prisma.xonpayTransaction.groupBy({
      by: ['datePaid', 'isMatched'],
      where,
      _count: true,
      _sum: { amount: true, matchedAmount: true },
    });

    // Yig'amiz: kun -> { totalCount, totalAmount, matchedCount, matchedAmount, missingCount, missingAmount }
    const byDay = new Map<string, any>();
    for (const g of grouped) {
      const dateKey = g.datePaid?.toISOString().slice(0, 10) || 'unknown';
      const row = byDay.get(dateKey) || {
        date: dateKey,
        totalCount: 0,
        totalAmount: 0n,
        matchedCount: 0,
        matchedAmount: 0n,
        missingCount: 0,
        missingAmount: 0n,
      };
      row.totalCount += g._count;
      row.totalAmount += g._sum.amount || 0n;
      if (g.isMatched) {
        row.matchedCount += g._count;
        row.matchedAmount += g._sum.amount || 0n;
      } else {
        row.missingCount += g._count;
        row.missingAmount += g._sum.amount || 0n;
      }
      byDay.set(dateKey, row);
    }

    const days = Array.from(byDay.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((r) => ({
        date: r.date,
        totalCount: r.totalCount,
        totalAmount: r.totalAmount.toString(),
        matchedCount: r.matchedCount,
        matchedAmount: r.matchedAmount.toString(),
        missingCount: r.missingCount,
        missingAmount: r.missingAmount.toString(),
      }));

    // Umumiy
    const summary = days.reduce(
      (acc, r) => ({
        totalCount: acc.totalCount + r.totalCount,
        totalAmount: acc.totalAmount + BigInt(r.totalAmount),
        matchedCount: acc.matchedCount + r.matchedCount,
        matchedAmount: acc.matchedAmount + BigInt(r.matchedAmount),
        missingCount: acc.missingCount + r.missingCount,
        missingAmount: acc.missingAmount + BigInt(r.missingAmount),
      }),
      { totalCount: 0, totalAmount: 0n, matchedCount: 0, matchedAmount: 0n, missingCount: 0, missingAmount: 0n },
    );

    return {
      ok: true,
      summary: {
        ...summary,
        totalAmount: summary.totalAmount.toString(),
        matchedAmount: summary.matchedAmount.toString(),
        missingAmount: summary.missingAmount.toString(),
      },
      days,
    };
  }
}
