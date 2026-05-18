import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
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
              crmId: p.id ? BigInt(p.id) : null,
              crmUuid: p.uuid || null,
              orderId: p.order_id ? BigInt(p.order_id) : null,
              contract: p.contract || null,
              amount: BigInt(p.amount || 0),
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
