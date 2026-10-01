import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';

/**
 * Cron interval (daqiqada) → cron expression.
 * 1..59 → har N daqiqada (har soatda)
 * 60 → har soat boshida
 * 120 → har 2 soat boshida (0:00, 2:00, ...)
 * Aks holda 60 ga teng deb hisoblanadi.
 */
function intervalToCron(minutes: number): string {
  const m = Math.max(1, Math.floor(minutes));
  if (m < 60) return `0 */${m} 7-23 * * *`;
  if (m === 60) return `0 0 7-23 * * *`;
  const hours = Math.floor(m / 60);
  return `0 0 7-23/${hours} * * *`;
}

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

// FIX (A5): ishonchsiz CRM ma'lumotidan BigInt — THROW qilmaydi (bitta noto'g'ri maydon
// tufayli butun to'lov upsert'dan tushib qolmasin).
function toBigId(v: any): bigint | null {
  if (v == null) return null;
  const s = String(v).replace(/[^\d-]/g, '');
  if (!s || s === '-') return null;
  try { return BigInt(s); } catch { return null; }
}
function toBigAmount(v: any): bigint {
  const n = Number(String(v ?? 0).replace(/[\s,]/g, ''));
  return isFinite(n) ? BigInt(Math.round(n)) : BigInt(0);
}

function getRu(obj: any, fallback = ''): string {
  if (!obj) return fallback;
  if (typeof obj === 'string') return obj;
  const val = obj.value;
  if (typeof val === 'object' && val) return val.ru || val.uz || val.en || fallback;
  return fallback;
}

/**
 * CRM sanasini parse qilish — Tashkent vaqti deb hisoblanadi.
 * Date-only field uchun (datePaid @db.Date): UTC noon ga set qilamiz —
 *   bu Postgres @db.Date ga to'g'ri date saqlanadi (TZ shift yo'q).
 * Datetime uchun (crm_created_at va h.k.): "+05:00" suffix qo'shamiz.
 */
function parseDateOnly(s: string | null | undefined): Date | null {
  if (!s) return null;
  const datePart = String(s).slice(0, 10); // "2026-05-18"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  // UTC 12:00 — TZ shift bo'lmasin uchun (Postgres @db.Date kun bo'yicha saqlaydi)
  const d = new Date(`${datePart}T12:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (!t) return null;
  // Faqat date — UTC noon bilan
  if (t.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return new Date(`${t}T12:00:00Z`);
  }
  // Datetime — agar TZ yo'q bo'lsa, Tashkent +05:00 deb qabul qilamiz
  if (!/[+-]\d{2}:?\d{2}$|Z$/.test(t)) {
    const iso = t.replace(' ', 'T');
    return new Date(iso + '+05:00');
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}

// Eski nom (boshqa joylarda ishlatilsa)
function parseDate(s: string | null | undefined): Date | null {
  return parseDateOnly(s);
}

@Injectable()
export class XonpayService implements OnModuleInit {
  private readonly log = new Logger(XonpayService.name);

  /**
   * Server qayta ishga tushgan paytda — DB'dagi orphan 'running' sync log larini
   * 'failed' deb belgilaymiz (chunki haqiqatda jarayon yo'q endi).
   */
  async onModuleInit() {
    try {
      const orphans = await this.prisma.xonpaySyncLog.updateMany({
        where: { status: 'running' },
        data: {
          status: 'failed',
          errorMessage: 'Server restart — orphan running entry',
          finishedAt: new Date(),
        },
      });
      if (orphans.count > 0) {
        this.log.warn(`xonpay orphan running entries: ${orphans.count} ta 'failed' deb belgilandi`);
      }
    } catch (e: any) {
      this.log.error(`xonpay onModuleInit cleanup xato: ${e?.message}`);
    }

    // Cron holatini va intervalni DB dan yuklaymiz
    try {
      const enabledSetting = await this.prisma.setting.findUnique({ where: { key: 'xonpay.cron.enabled' } });
      if (enabledSetting?.value === 'false') {
        this.cronEnabled = false;
        this.log.log('xonpay cron holati DB dan: OCHIRILGAN');
      }
      const intervalSetting = await this.prisma.setting.findUnique({ where: { key: 'xonpay.cron.intervalMinutes' } });
      if (intervalSetting?.value) {
        const n = parseInt(intervalSetting.value, 10);
        if (Number.isFinite(n) && n >= 1 && n <= 1440) {
          this.cronIntervalMinutes = n;
          this.log.log(`xonpay cron interval DB dan: ${n} daqiqa`);
        }
      }
    } catch (e: any) {
      this.log.warn(`cron sozlamalarini yuklash xato: ${e?.message}`);
    }

    // Cron job'ni yaratamiz/qaytadan ro'yxatga olamiz
    this.registerCronJob();
  }

  /** Cron job'ni joriy interval bo'yicha yaratadi (eski bo'lsa o'chirib qayta) */
  private registerCronJob() {
    try {
      this.scheduler.deleteCronJob(XonpayService.CRON_NAME);
    } catch { /* ilk marta — yo'q */ }
    const cronExpr = intervalToCron(this.cronIntervalMinutes);
    const job = new CronJob(
      cronExpr,
      () => this.cronAutoSync(),
      null,
      true,
      'Asia/Tashkent',
    );
    this.scheduler.addCronJob(XonpayService.CRON_NAME, job as any);
    this.log.log(`xonpay cron ro'yxatga olindi: "${cronExpr}" (${this.cronIntervalMinutes} daqiqa)`);
  }

  // ── Sync state ──
  private syncRunning = false;
  private syncCancelRequested = false;
  private syncStartedAt: Date | null = null;
  private syncFinishedAt: Date | null = null;
  private syncProgress: { page: number; lastPage: number; fetched: number; xonpay: number; inserted: number; updated: number; matched: number; errors: number } | null = null;
  private syncLastError: string | null = null;
  // Joriy aktiv sync uchun log id — per-log cancel da ishlatamiz
  private currentSyncLogId: string | null = null;

  // Cleanup orphans state (background job)
  private cleanupRunning = false;
  private cleanupStartedAt: Date | null = null;
  private cleanupFinishedAt: Date | null = null;
  private cleanupProgress: { phase: string; pages: number; crmCount: number; dbCount: number; orphanCount: number; deleted: number } | null = null;
  private cleanupLastError: string | null = null;
  private cleanupOrphanSamples: Array<{ externalId: string; contract: string | null; datePaid: string | null }> = [];

  // ── Match state ──
  private matchRunning = false;
  private matchProgress: { done: number; total: number; matched: number } | null = null;

  // ── Cron state (auto-sync) ──
  private cronEnabled = true;
  private lastCronRunAt: Date | null = null;
  private lastCronFinishedAt: Date | null = null;
  private lastCronSkipReason: string | null = null;
  private lastCronResult: { inserted: number; updated: number; matched: number; errors: number } | null = null;

  // Cron interval (daqiqada) — DB Setting dan yuklanadi (default: 60 = har soat)
  private cronIntervalMinutes = 60;

  constructor(
    private prisma: PrismaService,
    private crm: CrmService,
    private scheduler: SchedulerRegistry,
  ) {}

  private static readonly CRON_NAME = 'xonpay-auto-sync';

  /**
   * Avtomatik sync. Endi @Cron decorator emas — SchedulerRegistry orqali
   * dinamik ro'yxatga olinadi, shu sababli frontdan interval o'zgartirilishi mumkin.
   */
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

  /** Cron intervalini o'zgartirish (1..1440 daqiqa). DB ga saqlanadi + job qayta ro'yxatga olinadi */
  async setCronInterval(minutes: number): Promise<{ ok: true; minutes: number; cronExpr: string }> {
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) {
      throw new Error('Interval 1 dan 1440 daqiqagacha bo\'lishi kerak');
    }
    this.cronIntervalMinutes = Math.floor(minutes);
    await this.prisma.setting.upsert({
      where: { key: 'xonpay.cron.intervalMinutes' },
      create: { key: 'xonpay.cron.intervalMinutes', value: String(this.cronIntervalMinutes) },
      update: { value: String(this.cronIntervalMinutes) },
    });
    this.registerCronJob();
    return {
      ok: true,
      minutes: this.cronIntervalMinutes,
      cronExpr: intervalToCron(this.cronIntervalMinutes),
    };
  }

  /** Cron'ni o'chirish/yoqish — Setting jadvalga saqlanadi (restart paytida ham saqlanadi) */
  async setCronEnabled(enabled: boolean): Promise<void> {
    this.cronEnabled = enabled;
    try {
      await this.prisma.setting.upsert({
        where: { key: 'xonpay.cron.enabled' },
        create: { key: 'xonpay.cron.enabled', value: enabled ? 'true' : 'false' },
        update: { value: enabled ? 'true' : 'false' },
      });
      this.log.log(`xonpay cron: ${enabled ? 'YOQILDI' : 'OCHIRILDI'}`);
    } catch (e: any) {
      this.log.warn(`cron holati saqlash xato: ${e?.message}`);
    }
  }

  getCronInfo() {
    const m = this.cronIntervalMinutes;
    const human = m < 60
      ? `Har ${m} daqiqada`
      : m === 60
        ? 'Har soat boshida'
        : `Har ${Math.floor(m / 60)} soatda`;
    return {
      enabled: this.cronEnabled,
      intervalMinutes: m,
      cronExpr: intervalToCron(m),
      schedule: `${human} (07:00–23:00, Asia/Tashkent)`,
      lastRunAt: this.lastCronRunAt?.toISOString() || null,
      lastFinishedAt: this.lastCronFinishedAt?.toISOString() || null,
      lastSkipReason: this.lastCronSkipReason,
      lastResult: this.lastCronResult,
    };
  }

  // ════════════════════════════════════════════════════
  //  SYNC (CRM → DB)
  // ════════════════════════════════════════════════════

  startSync(opts?: { limit?: number; trigger?: 'manual' | 'cron'; actorId?: string; actorEmail?: string; actorName?: string; noSkip?: boolean }): { ok: true; started: boolean; message: string } {
    if (this.syncRunning) {
      const mins = this.syncStartedAt ? Math.floor((Date.now() - this.syncStartedAt.getTime()) / 60000) : 0;
      const p = this.syncProgress;
      return {
        ok: true,
        started: false,
        message: `Sync allaqachon ishlamoqda${p ? ` (page ${p.page}/${p.lastPage}, xonpay: ${p.xonpay})` : ''} — ${mins} daqiqadan beri.`,
      };
    }
    // ATOMIC LOCK — boshqa sync (cron yoki qo'lda) parallel boshlanmasin
    this.syncRunning = true;
    this.syncStartedAt = new Date();
    this.runSyncInBackground(opts).catch((e) => {
      this.log.error(`xonpay sync xato: ${e?.message}`);
      this.syncRunning = false; // xato bo'lsa lock'ni darrov ochish
    });
    return { ok: true, started: true, message: "XonPay sync fonda boshlandi." };
  }

  /**
   * Sync log id bo'yicha bekor qilish — running entry'ni 'cancelled' deb belgilaydi.
   * Agar shu entry hozir haqiqatdan ishlayotgan sync bo'lsa, in-memory cancel ham chaqiriladi.
   */
  async cancelSyncById(logId: string): Promise<{ ok: true; cancelled: boolean; message: string }> {
    const entry = await this.prisma.xonpaySyncLog.findUnique({ where: { id: logId } });
    if (!entry) {
      return { ok: true, cancelled: false, message: 'Topilmadi' };
    }
    if (entry.status !== 'running') {
      return { ok: true, cancelled: false, message: `Bu entry hozir ${entry.status} — bekor qilib bo'lmaydi` };
    }

    // Agar bu joriy haqiqiy sync bo'lsa — in-memory cancel ham chaqiramiz
    let activeStopped = false;
    if (this.syncRunning && this.currentSyncLogId === logId) {
      this.syncCancelRequested = true;
      activeStopped = true;
    }

    // DB entry'ni darrov 'cancelled' deb belgilaymiz (orphan bo'lsa ham)
    await this.prisma.xonpaySyncLog.update({
      where: { id: logId },
      data: {
        status: 'cancelled',
        finishedAt: new Date(),
        errorMessage: activeStopped
          ? "Foydalanuvchi bekor qildi (active sync)"
          : "Foydalanuvchi bekor qildi (orphan/stale entry)",
      },
    });

    return {
      ok: true,
      cancelled: true,
      message: activeStopped
        ? "Sync to'xtatildi (joriy batch tugagandan keyin)"
        : "Stale entry 'cancelled' deb belgilandi",
    };
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

  private async runSyncInBackground(opts?: { limit?: number; trigger?: 'manual' | 'cron'; actorId?: string; actorEmail?: string; actorName?: string; noSkip?: boolean }): Promise<void> {
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
          actorName: opts?.actorName || null,
          status: 'running',
        },
      });
      logId = logRow.id;
      this.currentSyncLogId = logId;
    } catch (e: any) {
      this.log.warn(`sync log yaratish xato: ${e?.message}`);
    }

    let finalStatus: 'success' | 'failed' | 'cancelled' = 'success';

    // 100% matched kunlarni topamiz — bu kunlar uchun upsert+match qilmaymiz (skip)
    // noSkip=true bo'lsa — hamma kun qayta tekshiriladi (sana fix uchun)
    const skipDates = new Set<string>();
    if (opts?.noSkip) {
      this.log.log(`xonpay sync: noSkip=true — barcha kunlar qayta tekshiriladi`);
    } else
    try {
      const grouped = await this.prisma.xonpayTransaction.groupBy({
        by: ['datePaid', 'isMatched'],
        _count: true,
      });
      const byDay = new Map<string, { total: number; matched: number }>();
      for (const g of grouped) {
        const d = g.datePaid?.toISOString().slice(0, 10);
        if (!d) continue;
        const row = byDay.get(d) || { total: 0, matched: 0 };
        row.total += g._count;
        if (g.isMatched) row.matched += g._count;
        byDay.set(d, row);
      }
      for (const [d, r] of byDay) {
        // Faqat bugundan oldingi to'liq tugagan kunlar (bugun hali davom etishi mumkin)
        const today = new Date().toISOString().slice(0, 10);
        if (r.total > 0 && r.matched === r.total && d < today) {
          skipDates.add(d);
        }
      }
      this.log.log(`xonpay sync: ${skipDates.size} ta kun 100% matched — skip qilinadi`);
    } catch (e: any) {
      this.log.warn(`skipDates hisoblashda xato: ${e?.message}`);
    }

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
        const apiLastPage = Number(raw?.last_page) || 0;
        const apiTotal = Number(raw?.total) || 0;

        // Debug log — birinchi sahifada response strukturasi
        if (page === 1) {
          this.log.log(`xonpay DEBUG page 1: items=${items.length} apiLastPage=${apiLastPage} apiTotal=${apiTotal} rawKeys=${Object.keys(raw || {}).join(',')}`);
        }

        // last_page MA'NOSIZ ekan (API noto'g'ri qaytaradi server tomondan) — items.length asoslanamiz
        // Maximum: 200 sahifa (1M record) — safety
        const estimatedLastPage = apiTotal > 0 ? Math.ceil(apiTotal / LIMIT) : (items.length < LIMIT ? page : page + 1);

        this.syncProgress.page = page;
        this.syncProgress.lastPage = Math.max(this.syncProgress.lastPage, estimatedLastPage);
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
        let pageSkipped = 0;
        for (const p of xonpayItems) {
          try {
            const externalId = String(p.external_id || '').trim();
            if (!externalId) continue;

            // 100% matched kun — skip
            const dpStr = (p.date_paid || '').slice(0, 10);
            if (dpStr && skipDates.has(dpStr)) {
              pageSkipped++;
              continue;
            }

            const xonpayUuid = extractUuid(p.purpose);
            const data = {
              externalId,
              xonpayUuid,
              crmId: toBigId(p.id),
              crmUuid: p.uuid || null,
              orderId: toBigId(p.order_id),
              contract: p.contract || null,
              amount: toBigAmount(p.amount),
              datePaid: parseDateOnly(p.date_paid),
              type: getRu(p.type) || null,
              category: getRu(p.category) || null,
              status: getRu(p.status) || null,
              purpose: p.purpose || null,
              fullName: p.full_name || null,
              objectName: p.object_name || null,
              isProblematic: !!p.is_problematic,
              isReceivedFromBank: !!p.is_received_from_bank,
              crmCreatedAt: parseDateTime(p.created_at),
              crmUpdatedAt: parseDateTime(p.updated_at),
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

        this.log.log(`xonpay page ${page}/${estimatedLastPage}: ${items.length} keldi, ${xonpayItems.length} xonpay${pageSkipped > 0 ? `, ${pageSkipped} skip (100% matched kun)` : ''}`);

        // Tugatish: sahifa to'liq emas (items < LIMIT) yoki 200 sahifadan o'tdi (safety)
        if (items.length < LIMIT) {
          this.log.log(`xonpay page ${page}: partial page (${items.length}<${LIMIT}), tugadi`);
          break;
        }
        if (page >= 200) {
          this.log.warn(`xonpay safety break: 200 sahifa yetildi`);
          break;
        }
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
      this.currentSyncLogId = null;
      this.log.log(`xonpay sync yakunlandi (${finalStatus}): ${JSON.stringify(this.syncProgress)}`);

      // Log yakunlash
      if (logId) {
        try {
          const startedAt = this.syncStartedAt!;
          // Agar entry allaqachon 'cancelled' deb belgilangan bo'lsa (cancelById tomonidan) — uni tegmaymiz
          const cur = await this.prisma.xonpaySyncLog.findUnique({ where: { id: logId }, select: { status: true } });
          if (cur?.status === 'cancelled') {
            // Allaqachon cancel qilingan — faqat metric'larni yangilash (status'ni o'zgartirmaslik)
            await this.prisma.xonpaySyncLog.update({
              where: { id: logId },
              data: {
                pages: this.syncProgress?.page || 0,
                fetched: this.syncProgress?.fetched || 0,
                xonpay: this.syncProgress?.xonpay || 0,
                inserted: this.syncProgress?.inserted || 0,
                updated: this.syncProgress?.updated || 0,
                matched: this.syncProgress?.matched || 0,
                errors: this.syncProgress?.errors || 0,
                finishedAt: this.syncFinishedAt,
                durationMs: this.syncFinishedAt.getTime() - startedAt.getTime(),
              },
            });
            return;
          }
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

  /**
   * Hammasini tozalash — TRUNCATE xonpay_transactions.
   * Re-sync uchun mavjud bo'lsa ham bog'lanmagan deleteMany ham bor.
   * Match links Transaction'da SetNull bilan tushadi (bank tx tegmaydi).
   * Tezroq variant: scan/orphan emas, hammasini olib qaytadan sync.
   */
  async truncateAll(): Promise<{ ok: true; deleted: number }> {
    const before = await this.prisma.xonpayTransaction.count();
    // TRUNCATE — eng tez (constraint'lar bilan)
    try {
      await this.prisma.$executeRawUnsafe(`TRUNCATE TABLE xonpay_transactions CASCADE`);
      this.log.log(`truncateAll: ${before} ta row TRUNCATE qilindi`);
      return { ok: true, deleted: before };
    } catch (e: any) {
      // TRUNCATE muvaffaqiyatsiz bo'lsa, deleteMany bilan urinish
      this.log.warn(`TRUNCATE xato, deleteMany ishlatamiz: ${e?.message}`);
      const r = await this.prisma.xonpayTransaction.deleteMany({});
      return { ok: true, deleted: r.count };
    }
  }

  /**
   * Orphan tozalashni fonda boshlash. Avval boshlasin → status poll qilinsin.
   */
  startCleanupOrphans(dryRun = true): { ok: true; started: boolean; message: string } {
    if (this.cleanupRunning) {
      return { ok: true, started: false, message: 'Cleanup allaqachon ishlamoqda' };
    }
    this.cleanupRunning = true;
    this.cleanupStartedAt = new Date();
    this.cleanupFinishedAt = null;
    this.cleanupLastError = null;
    this.cleanupProgress = { phase: 'starting', pages: 0, crmCount: 0, dbCount: 0, orphanCount: 0, deleted: 0 };
    this.cleanupOrphanSamples = [];

    this.runCleanupInBackground(dryRun).catch((e) => {
      this.log.error(`cleanup orphans xato: ${e?.message}`);
      this.cleanupLastError = e?.message || String(e);
      this.cleanupRunning = false;
    });

    return { ok: true, started: true, message: `Cleanup fonda boshlandi (${dryRun ? 'dry-run' : 'O\'CHIRADI'})` };
  }

  getCleanupStatus() {
    return {
      running: this.cleanupRunning,
      startedAt: this.cleanupStartedAt?.toISOString() || null,
      finishedAt: this.cleanupFinishedAt?.toISOString() || null,
      progress: this.cleanupProgress,
      lastError: this.cleanupLastError,
      orphanSamples: this.cleanupOrphanSamples,
    };
  }

  private async runCleanupInBackground(dryRun: boolean): Promise<void> {
    try {
      // 1) CRM dan barcha XonPay external_id larni jamlaymiz
      this.cleanupProgress!.phase = 'fetching CRM';
      const crmIds = new Set<string>();
      let page = 1;
      while (page <= 200) {
        const r = await this.crm.getPaymentHistory(page, 5000);
        if (!r.ok) break;
        const raw: any = r.data?.data ?? r.data;
        const items: any[] = raw?.data ?? (Array.isArray(raw) ? raw : []);
        if (items.length === 0) break;
        for (const p of items) {
          const m = p.payment_method;
          const mStr = typeof m === 'string' ? m : getRu(m, '');
          if (!/xon\s*pay/i.test(mStr)) continue;
          const id = String(p.external_id || '').trim();
          if (id) crmIds.add(id);
        }
        this.cleanupProgress!.pages = page;
        this.cleanupProgress!.crmCount = crmIds.size;
        if (items.length < 5000) break;
        page++;
      }
      this.log.log(`cleanupOrphans: CRM da ${crmIds.size} ta XonPay external_id topildi`);

      // 2) Bizning DB dan barcha external_id larni olamiz
      this.cleanupProgress!.phase = 'fetching DB';
      const dbRows = await this.prisma.xonpayTransaction.findMany({
        select: { externalId: true, contract: true, datePaid: true },
      });
      this.cleanupProgress!.dbCount = dbRows.length;
      this.log.log(`cleanupOrphans: bizning DB da ${dbRows.length} ta XonPay row`);

      // 3) Orphan'lar
      this.cleanupProgress!.phase = 'finding orphans';
      const orphans = dbRows.filter((r) => !crmIds.has(r.externalId));
      this.cleanupProgress!.orphanCount = orphans.length;
      this.cleanupOrphanSamples = orphans.slice(0, 50).map((o) => ({
        externalId: o.externalId,
        contract: o.contract,
        datePaid: o.datePaid?.toISOString().slice(0, 10) || null,
      }));

      // 4) O'chirish
      if (!dryRun && orphans.length > 0) {
        this.cleanupProgress!.phase = 'deleting';
        let deleted = 0;
        for (let i = 0; i < orphans.length; i += 500) {
          const chunk = orphans.slice(i, i + 500).map((o) => o.externalId);
          const r = await this.prisma.xonpayTransaction.deleteMany({
            where: { externalId: { in: chunk } },
          });
          deleted += r.count;
          this.cleanupProgress!.deleted = deleted;
        }
        this.log.log(`cleanupOrphans: ${deleted} ta orphan o'chirildi`);
      }
      this.cleanupProgress!.phase = 'done';
    } catch (e: any) {
      this.cleanupLastError = e?.message || String(e);
      this.cleanupProgress!.phase = 'error';
      this.log.error(`cleanup xato: ${this.cleanupLastError}`);
    } finally {
      this.cleanupRunning = false;
      this.cleanupFinishedAt = new Date();
    }
  }

  /**
   * Mavjud ma'lumotlarni 1 kunga oldinga shift qilish — TZ bug fix uchun.
   * Eski parseDate'da datePaid UTC bo'lganidan keyin 1 kun kam yozilgan edi.
   * Bu metod barcha datePaid'ga +1 kun qo'shadi.
   * FAQAT BIR MARTA chaqirib, keyin endpoint'ni o'chirib qoyish kerak!
   */
  async fixDateShift(): Promise<{ ok: true; updated: number }> {
    const result = await this.prisma.$executeRawUnsafe(
      `UPDATE xonpay_transactions SET date_paid = date_paid + INTERVAL '1 day' WHERE date_paid IS NOT NULL`,
    );
    return { ok: true, updated: Number(result) };
  }

  /** Sync tarixi — filterlar bilan */
  async getSyncHistory(opts: {
    limit?: number;
    q?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  } = {}) {
    const safeLimit = Math.min(Math.max(opts.limit || 50, 1), 500);
    const where: any = {};
    if (opts.status && opts.status !== 'all') {
      where.status = opts.status;
    }
    if (opts.dateFrom || opts.dateTo) {
      where.startedAt = {};
      if (opts.dateFrom) where.startedAt.gte = new Date(`${opts.dateFrom}T00:00:00+05:00`);
      if (opts.dateTo)   where.startedAt.lte = new Date(`${opts.dateTo}T23:59:59.999+05:00`);
    }
    if (opts.q && opts.q.trim()) {
      const q = opts.q.trim();
      where.OR = [
        { actorEmail: { contains: q, mode: 'insensitive' } },
        { actorName:  { contains: q, mode: 'insensitive' } },
      ];
    }
    const items = await this.prisma.xonpaySyncLog.findMany({
      where,
      orderBy: { startedAt: 'desc' as Prisma.SortOrder },
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
      orderBy: { txnDate: 'desc' as Prisma.SortOrder },
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

  /**
   * DUBLIKAT (initsiatsiya yozuvi) larni belgilaydi.
   *
   * CRM bitta XonPay to'lovini ikki marta yozadi:
   *   1) mijoz to'lovni boshlaganda — external_id = UUID, purpose bo'sh;
   *   2) pul bankdan kelganda — external_id = bank kompozit ID, purpose bor.
   * Ikkinchisi UUID orqali moslashadi, birinchisi esa hech qachon moslashmaydi
   * (unda qidiradigan UUID yo'q) va "topilmagan" hisobini ikki karra shishiradi.
   *
   * Juftlik belgisi — `crm_created_at` + shartnoma + summa AYNAN mos kelishi,
   * ustiga struktura sharti: initsiatsiya yozuvining ID si UUID ko'rinishida,
   * haqiqiy yozuvniki esa UUID EMAS. Bu ikkisi birga noto'g'ri belgilash
   * ehtimolini deyarli nolga tushiradi (bir soniyada bir xil summali ikkita
   * alohida to'lov bo'lsa ham, ikkalasining ID si UUID bo'lardi).
   */
  async markDuplicates(): Promise<{ ok: true; marked: number }> {
    const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
    const marked = await this.prisma.$executeRawUnsafe(
      `
      UPDATE xonpay_transactions a
         SET is_duplicate = true,
             duplicate_of = b.external_id
        FROM xonpay_transactions b
       WHERE a.is_matched = false
         AND a.is_duplicate = false
         AND (a.purpose IS NULL OR a.purpose = '')
         AND a.external_id ~ $1
         AND a.crm_created_at IS NOT NULL
         AND b.is_matched = true
         AND b.external_id !~ $1
         AND b.crm_created_at = a.crm_created_at
         AND b.amount = a.amount
         AND b.contract IS NOT DISTINCT FROM a.contract
      `,
      UUID_RE,
    );
    this.log.log(`xonpay markDuplicates: ${marked} ta initsiatsiya yozuvi dublikat deb belgilandi`);
    return { ok: true, marked };
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

      // Moslashtirishdan keyin — juftligi topilgan initsiatsiya yozuvlarini
      // dublikat deb belgilaymiz, aks holda ular "topilmagan" hisobini shishiradi.
      await this.markDuplicates().catch((e: any) =>
        this.log.warn(`markDuplicates xato: ${e?.message}`),
      );
    } finally {
      this.matchRunning = false;
    }
  }

  // ════════════════════════════════════════════════════
  //  LIST / STATS
  // ════════════════════════════════════════════════════

  /**
   * List va Excel eksport uchun umumiy filtr.
   * `received` — XonPay'ning o'z belgisi (is_received_from_bank): pul bankdan
   * kelganmi. Topilmaganlarning ko'pchiligi aslida hali kelmagan to'lovlar,
   * shuning uchun ularni ajratib olish kerak bo'ladi.
   */
  private buildListWhere(opts: {
    dateFrom?: string;
    dateTo?: string;
    matched?: 'all' | 'matched' | 'unmatched';
    received?: 'all' | 'yes' | 'no';
    duplicate?: 'hide' | 'only' | 'all';
    olderThanDays?: number;
    q?: string;
    contract?: string;
  }): any {
    const where: any = {};
    // Dublikat (initsiatsiya yozuvi) — standart holda YASHIRILADI, chunki u
    // haqiqiy to'lov emas, o'sha to'lovning ikkinchi nusxasi.
    if (opts.duplicate === 'only') where.isDuplicate = true;
    else if (opts.duplicate !== 'all') where.isDuplicate = false;
    if (opts.dateFrom || opts.dateTo) {
      where.datePaid = {};
      if (opts.dateFrom) where.datePaid.gte = new Date(opts.dateFrom);
      if (opts.dateTo) where.datePaid.lte = new Date(opts.dateTo);
    }
    // Kechikish — "N kundan eski" to'lovlar.
    // Karta to'lovi bankka 1-2 kunda o'tadi, shuning uchun bugungi va kechagi
    // to'lovlarning "topilmagan" bo'lishi NORMAL — puli hali yo'lda. Ularni
    // chiqarib tashlasak, ro'yxatda faqat haqiqiy muammolar qoladi.
    const kun = Number(opts.olderThanDays);
    if (Number.isFinite(kun) && kun > 0) {
      const t = new Date(Date.now() + 5 * 3_600_000); // Toshkent kuni
      t.setUTCDate(t.getUTCDate() - kun);
      const kesim = new Date(`${t.toISOString().slice(0, 10)}T23:59:59.999Z`);
      where.datePaid = where.datePaid || {};
      if (!where.datePaid.lte || kesim < where.datePaid.lte) where.datePaid.lte = kesim;
    }

    if (opts.matched === 'matched') where.isMatched = true;
    if (opts.matched === 'unmatched') where.isMatched = false;
    if (opts.received === 'yes') where.isReceivedFromBank = true;
    if (opts.received === 'no') where.isReceivedFromBank = false;
    if (opts.contract) where.contract = opts.contract;
    if (opts.q) {
      where.OR = [
        { contract: { contains: opts.q, mode: 'insensitive' } },
        { fullName: { contains: opts.q, mode: 'insensitive' } },
        { xonpayUuid: { contains: opts.q, mode: 'insensitive' } },
        { externalId: { contains: opts.q } },
      ];
    }
    return where;
  }

  async list(opts: {
    page?: number;
    perPage?: number;
    dateFrom?: string;
    dateTo?: string;
    matched?: 'all' | 'matched' | 'unmatched';
    received?: 'all' | 'yes' | 'no';
    duplicate?: 'hide' | 'only' | 'all';
    olderThanDays?: number;
    q?: string;
    contract?: string;
  }) {
    const page = opts.page || 1;
    const perPage = Math.min(opts.perPage || 50, 500);
    const where = this.buildListWhere(opts);

    const [total, items] = await Promise.all([
      this.prisma.xonpayTransaction.count({ where }),
      this.prisma.xonpayTransaction.findMany({
        where,
        orderBy: [
          { datePaid: 'desc' as Prisma.SortOrder },
          { syncedAt: 'desc' as Prisma.SortOrder },
        ],
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

  /**
   * Ro'yxatni Excel (.xlsx) qilib beradi — paneldagi filtrlar bilan bir xil.
   * Sahifalash yo'q: filtrga tushgan HAMMA qator faylga kiradi (chegara MAX_ROWS).
   */
  async exportXlsx(opts: {
    dateFrom?: string;
    dateTo?: string;
    matched?: 'all' | 'matched' | 'unmatched';
    received?: 'all' | 'yes' | 'no';
    duplicate?: 'hide' | 'only' | 'all';
    olderThanDays?: number;
    q?: string;
    contract?: string;
  }): Promise<{ buffer: Buffer; filename: string; count: number }> {
    const MAX_ROWS = 100_000;
    const where = this.buildListWhere(opts);

    const rows = await this.prisma.xonpayTransaction.findMany({
      where,
      orderBy: [
        { datePaid: 'desc' as Prisma.SortOrder },
        { amount: 'desc' as Prisma.SortOrder },
      ],
      take: MAX_ROWS,
      include: {
        matchedTx: { select: { externalId: true, txnDate: true, amount: true } },
      },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('XonPay');

    const HEAD: Array<{ h: string; w: number }> = [
      { h: "To'lov sanasi", w: 13 },
      { h: 'Shartnoma', w: 16 },
      { h: 'Mijoz', w: 32 },
      { h: 'Obyekt', w: 22 },
      { h: 'Summa', w: 16 },
      { h: 'Turi', w: 18 },
      { h: 'Kategoriya', w: 18 },
      { h: 'Status', w: 14 },
      { h: 'Topilgan', w: 11 },
      { h: 'Bankdan kelgan', w: 15 },
      { h: 'Muammoli', w: 10 },
      { h: 'Topilgan tx sanasi', w: 16 },
      { h: 'Topilgan tx summasi', w: 17 },
      { h: 'XonPay UUID', w: 38 },
      { h: 'External ID', w: 30 },
      { h: 'CRM ID', w: 12 },
      { h: 'Order ID', w: 12 },
      { h: 'Izoh', w: 50 },
      { h: 'Dublikat', w: 10 },
    ];
    ws.columns = HEAD.map((c) => ({ width: c.w }));

    const headRow = ws.getRow(1);
    HEAD.forEach((c, i) => {
      const cell = headRow.getCell(i + 1);
      cell.value = c.h;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    headRow.height = 30;
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    const MONEY = '#,##0';
    const ha = (b: boolean) => (b ? 'ha' : "yo'q");
    let r = 2;
    for (const x of rows) {
      const row = ws.getRow(r++);
      row.getCell(1).value = x.datePaid ? x.datePaid.toISOString().slice(0, 10) : null;
      row.getCell(2).value = x.contract;
      row.getCell(3).value = x.fullName;
      row.getCell(4).value = x.objectName;
      row.getCell(5).value = Number(x.amount);
      row.getCell(5).numFmt = MONEY;
      row.getCell(6).value = x.type;
      row.getCell(7).value = x.category;
      row.getCell(8).value = x.status;
      row.getCell(9).value = ha(x.isMatched);
      row.getCell(10).value = ha(x.isReceivedFromBank);
      row.getCell(11).value = ha(x.isProblematic);
      row.getCell(12).value = x.matchedTx?.txnDate ? x.matchedTx.txnDate.toISOString().slice(0, 10) : null;
      if (x.matchedTx?.amount != null) {
        row.getCell(13).value = Number(x.matchedTx.amount);
        row.getCell(13).numFmt = MONEY;
      }
      row.getCell(14).value = x.xonpayUuid;
      row.getCell(15).value = x.externalId;
      row.getCell(16).value = x.crmId != null ? x.crmId.toString() : null;
      row.getCell(17).value = x.orderId != null ? x.orderId.toString() : null;
      row.getCell(18).value = x.purpose;
      row.getCell(19).value = ha(x.isDuplicate);
    }

    // Jami qatori
    if (rows.length) {
      const total = ws.getRow(r);
      total.getCell(4).value = 'JAMI';
      total.getCell(4).font = { bold: true, size: 10 };
      total.getCell(5).value = rows.reduce((s, x) => s + Number(x.amount), 0);
      total.getCell(5).numFmt = MONEY;
      total.getCell(5).font = { bold: true, size: 10 };
      total.getCell(3).value = `${rows.length} ta to'lov`;
      total.getCell(3).font = { bold: true, size: 10 };
    }

    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: HEAD.length } };

    const raw = await wb.xlsx.writeBuffer();
    const buffer: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);

    const qism =
      opts.matched === 'unmatched' ? 'topilmagan'
      : opts.matched === 'matched' ? 'topilgan'
      : 'hammasi';
    const bank =
      opts.received === 'yes' ? '_bankdan'
      : opts.received === 'no' ? '_bankdan-emas'
      : '';
    const davr = `${opts.dateFrom || 'boshidan'}_${opts.dateTo || 'oxirigacha'}`;
    const filename = `xonpay_${qism}${bank}_${davr}.xlsx`;

    return { buffer, filename, count: rows.length };
  }

  /** Kunlik statistika: kuniga jami / topilgan / qolgan */
  async dailyStats(opts: { dateFrom?: string; dateTo?: string }) {
    const where: any = {};
    if (opts.dateFrom || opts.dateTo) {
      where.datePaid = {};
      if (opts.dateFrom) where.datePaid.gte = new Date(opts.dateFrom);
      if (opts.dateTo) where.datePaid.lte = new Date(opts.dateTo);
    }
    // groupBy datePaid + isMatched + isDuplicate.
    // Dublikat = CRM ning initsiatsiya yozuvi, haqiqiy to'lov emas — u na jamiga,
    // na "qolgan"ga qo'shiladi, alohida ko'rsatiladi.
    const grouped = await this.prisma.xonpayTransaction.groupBy({
      by: ['datePaid', 'isMatched', 'isDuplicate'],
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
        duplicateCount: 0,
        duplicateAmount: 0n,
      };
      if (g.isDuplicate) {
        // Initsiatsiya nusxasi — jamiga ham, qolganga ham kirmaydi
        row.duplicateCount += g._count;
        row.duplicateAmount += g._sum.amount || 0n;
      } else {
        row.totalCount += g._count;
        row.totalAmount += g._sum.amount || 0n;
        if (g.isMatched) {
          row.matchedCount += g._count;
          row.matchedAmount += g._sum.amount || 0n;
        } else {
          row.missingCount += g._count;
          row.missingAmount += g._sum.amount || 0n;
        }
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
        duplicateCount: r.duplicateCount,
        duplicateAmount: r.duplicateAmount.toString(),
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
        duplicateCount: acc.duplicateCount + r.duplicateCount,
        duplicateAmount: acc.duplicateAmount + BigInt(r.duplicateAmount),
      }),
      {
        totalCount: 0, totalAmount: 0n, matchedCount: 0, matchedAmount: 0n,
        missingCount: 0, missingAmount: 0n, duplicateCount: 0, duplicateAmount: 0n,
      },
    );

    return {
      ok: true,
      summary: {
        ...summary,
        totalAmount: summary.totalAmount.toString(),
        matchedAmount: summary.matchedAmount.toString(),
        missingAmount: summary.missingAmount.toString(),
        duplicateAmount: summary.duplicateAmount.toString(),
      },
      days,
    };
  }
}
