import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';
import { KbDoc1CItem } from '../integrations/kapitalbank/types';
import { PaymentsService } from '../payments/payments.service';
import { CategorizationService } from '../categorization/categorization.service';
import { SettingsService } from './settings.service';
import { TxnDirection, TxnStatus, TxnType, Prisma } from '@prisma/client';
import { format, parse, subDays } from 'date-fns';

// Bank javobining ma'lum (mapped) fieldlari — Python kodingiz bilan moslangan.
// Bu set'da bo'lmagan har qanday field rawExtra JSON'iga tushadi.
const KNOWN_FIELDS = new Set([
  'time', 'input_date', 'input_time', 'client_id', 'num', 'branch',
  'general_id', 'b2_id', 'uniq', 'ddate', 'vdate', 'stime',
  'mfo_dt', 'acc_dt', 'name_dt', 'inn_dt',
  'mfo_ct', 'acc_ct', 'name_ct', 'inn_ct',
  'purpose', 'purp_code', 'amount', 'dtype', 'state', 'dir',
  'err', 'err_msg', 'anor',
]);

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);
  private readonly daysBack: number;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
    private payments: PaymentsService,
    private categorization: CategorizationService,
    private settings: SettingsService,
    config: ConfigService,
  ) {
    // Default 10 kun (oldindan 1 kun edi) — bank tomonida o'chirilgan yoki
    // o'zgartirilgan tranzaksiyalarni aniqlash uchun har sync oxirgi 10 kunni
    // qayta tekshiradi (re-verify).
    this.daysBack = Number(config.get<string>('TXN_SYNC_DAYS_BACK', '10'));
  }

  /**
   * Boot paytida — TransactionChangeLog'dagi status-only noise yozuvlarini
   * o'chiramiz. Faqat status o'zgargan (boshqa hech narsa) va yangi status
   * CANCELLED emas — bu bank tahriri emas, ichki state fluktuatsiyasi.
   * Eski detection ularni xato logladi; endi log qilinmaydi, eski noise tozalanadi.
   */
  async onModuleInit() {
    try {
      const candidates = await this.prisma.transactionChangeLog.findMany({
        where: { changeType: 'EDITED', fieldsChanged: { equals: ['status'] } },
        select: { id: true, oldData: true },
      });
      const toDelete = candidates
        .filter((c) => {
          const od = c.oldData as any;
          const newStatus = od?.status?.new;
          // CANCELLED bo'lmagan har qanday status o'zgarishi — noise
          return newStatus !== 'CANCELLED';
        })
        .map((c) => c.id);
      if (toDelete.length > 0) {
        const r = await this.prisma.transactionChangeLog.deleteMany({
          where: { id: { in: toDelete } },
        });
        this.logger.log(`Boot cleanup: ${r.count} ta status noise yozuv o'chirildi (PENDING↔COMPLETED)`);
      }
    } catch (e: any) {
      // Bootstrap xatosi app'ni to'xtatmasin
      this.logger.warn(`Change-log noise tozalashda xato: ${e?.message}`);
    }
  }

  /**
   * "dd.MM.yyyy" → Date. Noto'g'ri bo'lsa null.
   */
  private parseDdate(s: string): Date | null {
    const d = parse(s, 'dd.MM.yyyy', new Date());
    return isNaN(d.getTime()) ? null : d;
  }

  /**
   * dateList'dan syncMinDate'dan oldingilarni olib tashlaydi.
   * Qaytaradi: { kept: kept dates, clampedCount: nechta o'tkazib yuborilgan }
   */
  private clampDatesAgainstMin(dateList: string[], syncMinDate: Date | null): {
    kept: string[];
    clampedCount: number;
  } {
    if (!syncMinDate) return { kept: dateList, clampedCount: 0 };
    const minTime = syncMinDate.getTime();
    const kept: string[] = [];
    let clampedCount = 0;
    for (const ds of dateList) {
      const d = this.parseDdate(ds);
      if (d && d.getTime() <= minTime) {
        clampedCount++;
      } else {
        kept.push(ds);
      }
    }
    return { kept, clampedCount };
  }

  /**
   * Composite tranzaksiya ID — Python kodi formatiga to'liq mos:
   *   [IP_]{general_id}_{num}_{ddate}_{acc_ct}_{acc_dt}_{amount}_{sign}
   * sign = '+' agar bizning hisob acc_dt bo'lsa (chiqim), aks holda '-'
   *
   * Bank prefiksi (oldida): Ipak Yo'li tranzaksiyalari IP_ bilan boshlanadi
   *   — Kapitalbank ID'lari bilan ajratish uchun (ba'zan bir xil ko'rinishda kelishi mumkin)
   */
  /**
   * DEBUG: Bank API'dan bitta hisob uchun sanaga oid raw tranzaksiyalarni oladi
   * (DB ga saqlanmaydi). Foydalanuvchi vipiska'dagi qatorlar bank javobida
   * mavjudligini tekshirishi mumkin.
   *
   * Filter sifatida searchNums (document numbers) berilsa, faqat shu nums'larga
   * tegishli qatorlar qaytariladi (qulay solishtiruv uchun).
   */
  async debugFetchRaw(opts: {
    accountId: string;
    dates: string[];           // dd.MM.yyyy formatda
    searchNums?: string[];      // ixtiyoriy — faqat shu document nums'lar
  }): Promise<{
    ok: boolean;
    account: { id: string; accountNo: string; branch: string; ownerName: string | null };
    bank: { code: string; name: string };
    dates: string[];
    items: Array<{
      ddate: string;
      num: string;
      general_id: string;
      b2_id: string | null;
      acc_ct: string;
      acc_dt: string;
      amount: number;
      direction: 'IN' | 'OUT';
      compositeId: string;
      sender: { name: string; inn: string };
      receiver: { name: string; inn: string };
      details: string;
      rawAll: any;
    }>;
    totals: { fetched: number; matched: number };
    errors: string[];
  }> {
    const acc = await this.prisma.bankAccount.findUnique({
      where: { id: opts.accountId },
      include: { bank: true },
    });
    if (!acc) throw new Error("Hisob topilmadi");

    // Bank credential — shu hisob qaysi credential bilan sync qilinadi?
    const cred = await this.prisma.bankCredential.findFirst({
      where: { bankId: acc.bankId, isActive: true },
      include: { bank: true },
    });
    if (!cred) throw new Error(`Bank credential topilmadi (${acc.bank.name})`);
    // Yuqoridagi findFirst-da `include: { bank }` ishlamasligi mumkin (eski Prisma),
    // shuning uchun bank ma'lumotini alohida olamiz fallback uchun
    const bank = (cred as any).bank || acc.bank;

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;
    const numsSet = opts.searchNums && opts.searchNums.length > 0
      ? new Set(opts.searchNums.map((n) => n.trim()))
      : null;

    const allItems: any[] = [];
    const errors: string[] = [];
    let fetched = 0;

    for (const dateStr of opts.dates) {
      try {
        const result = await this.kb.getDoc1C({
          baseUrl: bank.apiBaseUrl!,
          login,
          password,
          branch: acc.branch,
          account: acc.accountNo,
          date: dateStr,
          useProxy: cred.useProxy === true,
        });
        const items = result?.content || [];
        fetched += items.length;
        for (const it of items) {
          // Yo'nalish: acc_dt === bizning account → IN (kirim), aks holda OUT
          const direction: 'IN' | 'OUT' = it.acc_dt === acc.accountNo ? 'IN' : 'OUT';
          const compositeId = this.makeCompositeId(it, acc.accountNo, bank.code);
          const num = String(it.num || '');
          if (numsSet && !numsSet.has(num)) continue;
          allItems.push({
            ddate: it.ddate,
            num,
            general_id: it.general_id || '',
            b2_id: it.b2_id || null,
            acc_ct: it.acc_ct || '',
            acc_dt: it.acc_dt || '',
            amount: Number(it.amount || 0),
            direction,
            compositeId,
            sender: {
              name: String((it as any).debit_name || (it as any).acc_dt_name || ''),
              inn: String((it as any).debit_inn || (it as any).acc_dt_inn || ''),
            },
            receiver: {
              name: String((it as any).credit_name || (it as any).acc_ct_name || ''),
              inn: String((it as any).credit_inn || (it as any).acc_ct_inn || ''),
            },
            details: String((it as any).details || (it as any).naznach || ''),
            rawAll: it,
          });
        }
      } catch (e: any) {
        errors.push(`${dateStr}: ${e?.message?.slice(0, 200) || 'unknown error'}`);
      }
    }

    return {
      ok: true,
      account: { id: acc.id, accountNo: acc.accountNo, branch: acc.branch, ownerName: acc.ownerName },
      bank: { code: bank.code, name: bank.name },
      dates: opts.dates,
      items: allItems,
      totals: { fetched, matched: allItems.length },
      errors,
    };
  }

  /** Public — sverka fixMissing flow ham composite id'ni ishlatadi */
  makeCompositeId(item: KbDoc1CItem, ourAccount: string, bankCode?: string): string {
    const sign = item.acc_dt === ourAccount ? '+' : '-';
    const prefix = bankCode === 'IPAK_YULI' ? 'IP_' : '';
    return prefix + [
      item.general_id || 'no_general_id',
      String(item.num || 'no_num'),
      item.ddate || 'no_date',
      item.acc_ct || 'no_acc_ct',
      item.acc_dt || 'no_acc_dt',
      item.amount != null ? String(item.amount) : 'no_amount',
      sign,
    ].join('_');
  }

  /** Bank javobida bizga noma'lum fieldlar — rawExtra'ga */
  private extractRawExtra(item: any): Prisma.InputJsonValue | null {
    const extra: Record<string, any> = {};
    for (const [k, v] of Object.entries(item)) {
      if (!KNOWN_FIELDS.has(k)) extra[k] = v;
    }
    return Object.keys(extra).length > 0 ? extra : null;
  }

  /**
   * Cron har 5 daqiqada (default) — barcha faol credentiallar bo'yicha sync.
   * Eski stuck sid'larni ham tozalaydi (#60101 oldini oladi).
   */
  // Cron har daqiqada ishlaydi — lekin har bank o'z intervaliga qarab sync qilinadi
  // (Bank.syncIntervalMinutes). force=true bo'lsa intervalga qaramay hammasi sync qilinadi.
  @Cron(process.env.TXN_SYNC_CRON || '* * * * *')
  async tick(force = false) {
    // Muddati o'tgan sid'larni tozalash
    await this.prisma.bankCredential.updateMany({
      where: { sid: { not: null }, sidExpiresAt: { lt: new Date() } },
      data: { sid: null, sidExpiresAt: null },
    });

    const creds = await this.prisma.bankCredential.findMany({
      where: { isActive: true, bank: { apiKind: { in: ['KAPITALBANK_V3', 'IPAK_YOLI_V1'] }, isActive: true } },
      include: { bank: true, accounts: { where: { syncEnabled: true } } },
    });
    if (creds.length === 0) {
      this.logger.debug('Faol bank credential yo\'q — sync o\'tkazib yuborildi');
      return;
    }

    const now = Date.now();
    for (const c of creds) {
      const intervalMin = c.bank.syncIntervalMinutes ?? 5;
      // intervalMin === 0 → bank uchun avtomatik sync o'chirilgan (force bo'lsa baribir sync qilamiz)
      if (!force && intervalMin === 0) continue;
      const intervalMs = Math.max(1, intervalMin) * 60_000;
      for (const acc of c.accounts) {
        // Bank intervaliga qarab — vaqti kelmagan hisobni o'tkazib yuboramiz
        if (!force && acc.lastSyncedAt) {
          const elapsed = now - new Date(acc.lastSyncedAt).getTime();
          if (elapsed < intervalMs) continue;
        }
        try {
          await this.syncAccount(c.id, acc.id);
        } catch (e: any) {
          const errMsg = e?.message?.slice(0, 150) || 'Noma\'lum xato';
          this.logger.warn(`Sync xato (acc ${acc.accountNo}): ${errMsg}`);
        }
      }
    }
  }

  /**
   * Avtomatik bulk-sync rejasini har daqiqada tekshiradi. Settings'dagi
   * bulkSync.enabled/intervalDays/timeOfDay/daysBack qiymatlariga qarab
   * vaqti kelganda backfill (scope='all') ishga tushiradi.
   *
   * Bir kun ichida bir martadan ko'p ishga tushmasligi uchun lastRunAt
   * sanasi current Tashkent kuniga teng bo'lsa skip qilinadi.
   */
  @Cron('* * * * *')
  async bulkScheduleTick(): Promise<void> {
    let schedule: Awaited<ReturnType<typeof this.settings.getBulkSyncSchedule>>;
    try {
      schedule = await this.settings.getBulkSyncSchedule();
    } catch {
      return;
    }
    if (!schedule.enabled) return;
    if (!schedule.timeOfDay) return;
    const [hStr, mStr] = schedule.timeOfDay.split(':');
    const targetH = Number(hStr);
    const targetM = Number(mStr);
    if (!Number.isFinite(targetH) || !Number.isFinite(targetM)) return;

    // Hozirgi Tashkent vaqti (UTC+5)
    const nowMs = Date.now();
    const tash = new Date(nowMs + 5 * 60 * 60 * 1000);
    const tashH = tash.getUTCHours();
    const tashM = tash.getUTCMinutes();
    const tashDay = tash.toISOString().slice(0, 10);    // YYYY-MM-DD (Tashkent)
    const tashMinutes = tashH * 60 + tashM;
    const targetMinutes = targetH * 60 + targetM;

    // Vaqt o'tib bo'lganmi (timeOfDay yoki undan keyin)
    if (tashMinutes < targetMinutes) return;

    // Bugun allaqachon ishga tushganmi
    const lastRunIso = schedule.lastRunAt;
    if (lastRunIso) {
      const lastRunDay = new Date(new Date(lastRunIso).getTime() + 5 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      if (lastRunDay === tashDay) return;
      // Interval kunlari yetdimi
      const daysSince = Math.floor(
        (Date.parse(tashDay) - Date.parse(lastRunDay)) / 86_400_000,
      );
      if (daysSince < schedule.intervalDays) return;
    }

    // Hisoblar va sanalarni tayyorlaymiz
    const daysBack = schedule.daysBack ?? Math.max(2, schedule.intervalDays + 1);
    const todayD = new Date(`${tashDay}T00:00:00Z`);
    const fromD = new Date(todayD.getTime() - (daysBack - 1) * 86_400_000);
    const dateFromStr = fromD.toISOString().slice(0, 10);
    const dateToStr = tashDay;

    try {
      const { accounts, dates } = await this.resolveBackfillTargets({
        scope: 'all',
        dateFrom: dateFromStr,
        dateTo: dateToStr,
      });
      if (accounts.length === 0 || dates.length === 0) {
        this.logger.warn(`Bulk schedule: nishon yo'q (accounts=${accounts.length}, days=${dates.length})`);
        return;
      }
      await this.settings.setBulkSyncLastRunAt(new Date(nowMs).toISOString());
      this.logger.log(
        `Bulk schedule ishga tushdi — ${accounts.length} hisob · ${dates.length} kun ` +
        `(${dateFromStr} → ${dateToStr}, interval=${schedule.intervalDays}d, vaqt=${schedule.timeOfDay})`,
      );
      // Fonda — uzoq davom etadi, blok qilmaymiz
      this.runBackfill(accounts, dates).catch((e) => {
        this.logger.error(`Bulk schedule backfill xato: ${e?.message || e}`);
      });
    } catch (e: any) {
      this.logger.error(`Bulk schedule tick xato: ${e?.message || e}`);
    }
  }

  /**
   * Backfill uchun maqsadli hisoblar + sanalar ro'yxatini hisoblaydi.
   * scope: 'all' (barcha sync yoqilgan), 'bank' (bitta bank), 'account' (bitta hisob).
   */
  async resolveBackfillTargets(opts: {
    scope: 'all' | 'bank' | 'account';
    bankId?: string;
    accountId?: string;
    dateFrom: string;
    dateTo: string;
  }): Promise<{
    accounts: { id: string; credentialId: string }[];
    dates: string[];
    syncMinDate: Date | null;
    originalFromCount: number;
    clampedCount: number;
  }> {
    let accounts: { id: string; credentialId: string }[] = [];
    if (opts.scope === 'account' && opts.accountId) {
      // Bitta hisob — foydalanuvchi aniq tanlagan, syncEnabled tekshirilmaydi
      const a = await this.prisma.bankAccount.findUnique({
        where: { id: opts.accountId },
        select: { id: true, credentialId: true },
      });
      if (a) accounts = [a];
    } else if (opts.scope === 'bank' && opts.bankId) {
      // Bank bo'yicha — faqat sync yoqilgan hisoblar
      accounts = await this.prisma.bankAccount.findMany({
        where: { bankId: opts.bankId, syncEnabled: true },
        select: { id: true, credentialId: true },
      });
    } else {
      // Barcha hisob — faqat sync yoqilganlari (o'chirilganlar tashlab ketiladi)
      accounts = await this.prisma.bankAccount.findMany({
        where: { syncEnabled: true },
        select: { id: true, credentialId: true },
      });
    }

    const from = new Date(opts.dateFrom);
    const to = new Date(opts.dateTo);
    const rawDates: string[] = [];
    for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) {
      rawDates.push(format(new Date(t), 'dd.MM.yyyy'));
    }
    // syncMinDate dan oldingilarni olib tashlash (Setting'dan)
    const syncMinDate = await this.settings.getSyncMinDate();
    const { kept, clampedCount } = this.clampDatesAgainstMin(rawDates, syncMinDate);
    return {
      accounts,
      dates: kept,
      syncMinDate,
      originalFromCount: rawDates.length,
      clampedCount,
    };
  }

  /**
   * Backfill — eski tarixni bazaga yozish. Fonda chaqiriladi (uzoq davom etadi).
   * Har hisob uchun alohida SyncLog yoziladi (source'da "· backfill" bo'ladi) —
   * frontend shu loglarni kuzatib jarayonni ko'rsatadi.
   */
  async runBackfill(accounts: { id: string; credentialId: string }[], dates: string[]) {
    if (accounts.length === 0 || dates.length === 0) return;
    this.logger.log(`Backfill boshlandi: ${accounts.length} hisob × ${dates.length} kun`);
    for (const acc of accounts) {
      try {
        await this.syncAccount(acc.credentialId, acc.id, { dates });
      } catch (e: any) {
        this.logger.warn(`Backfill xato (${acc.id}): ${e?.message?.slice(0, 150)}`);
      }
    }
    this.logger.log(`Backfill tugadi: ${accounts.length} hisob × ${dates.length} kun`);
  }

  /**
   * Bitta hisob bo'yicha sync (manual yoki cron'dan chaqiriladi).
   * opts.dates berilsa — o'sha sanalar bo'yicha backfill qilinadi (qoldiq yangilanmaydi).
   */
  async syncAccount(credentialId: string, accountId: string, opts?: { dates?: string[] }) {
    const cred = await this.prisma.bankCredential.findUnique({
      where: { id: credentialId },
      include: { bank: true },
    });
    if (!cred) throw new Error('Credential topilmadi');
    const acc = await this.prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new Error('Hisob topilmadi');
    if (cred.bank.apiKind !== 'KAPITALBANK_V3' && cred.bank.apiKind !== 'IPAK_YOLI_V1') {
      throw new Error("Hozircha faqat Kapitalbank va Ipak Yo'li qo'llab-quvvatlanadi");
    }

    const isBackfill = !!opts?.dates?.length;
    // Sana ro'yxati — backfill bo'lsa berilgan sanalar, aks holda oxirgi daysBack kun
    const rawDates: string[] = isBackfill
      ? opts!.dates!
      : Array.from({ length: Math.max(1, this.daysBack) }, (_, i) =>
          format(subDays(new Date(), i), 'dd.MM.yyyy'),
        );
    // syncMinDate'dan oldingi sanalarni olib tashlaymiz (himoya)
    const syncMinDate = await this.settings.getSyncMinDate();
    const { kept: dateList } = this.clampDatesAgainstMin(rawDates, syncMinDate);
    if (dateList.length === 0) {
      // Hamma sanalar syncMinDate'dan oldin — sync qilish kerak emas
      this.logger.warn(`Sync skip (${acc.accountNo}): barcha sanalar syncMinDate dan oldin`);
      return { ok: true, fetched: 0, saved: 0, errors: 0, skipped: true };
    }

    // Source'da hisob raqami ko'rsatiladi — qaysi hisobda xato bo'lganini aniqlash uchun
    const log = await this.prisma.syncLog.create({
      data: {
        source: `${acc.accountNo}${acc.ownerName ? ' · ' + acc.ownerName : ''}${
          isBackfill ? ` · backfill ${dateList[0]}–${dateList[dateList.length - 1]}` : ''
        }`.slice(0, 255),
        accountId: acc.id,
        status: 'RUNNING',
      },
    });
    const t0 = Date.now();
    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;

    let fetched = 0;
    let saved = 0;
    let errors = 0;
    let errorMessage: string | null = null;

    let latestSaldoOut: number | null = null;
    // Re-verify uchun barcha kunlarda kelgan bank itemlarini yig'amiz
    const allFetchedItems: KbDoc1CItem[] = [];
    const fetchedDayStarts: Date[] = []; // muvaffaqiyatli fetch qilingan kunlar (xato bo'lmaganlar)
    try {
      for (let i = 0; i < dateList.length; i++) {
        const dateStr = dateList[i];
        let dayItems: KbDoc1CItem[] = [];
        let daySaldoOut: number | null = null;
        try {
          const result = await this.kb.getDoc1C({
            baseUrl: cred.bank.apiBaseUrl!,
            login,
            password,
            branch: acc.branch,
            account: acc.accountNo,
            date: dateStr,
            // sid o'tkazib yubormaymiz — har so'rovda yangi Basic Auth (#60101 'Session expired' xatosini oldini oladi)
            useProxy: cred.useProxy === true,
          });
          dayItems = result?.content || [];
          daySaldoOut = result?.saldo_out ?? null;
        } catch (e: any) {
          errors++;
          this.logger.warn(`getDoc1C xato (${dateStr}): ${e?.message?.slice(0, 200)}`);
          continue;
        }
        fetched += dayItems.length;
        allFetchedItems.push(...dayItems);
        // Bu kunni 'muvaffaqiyatli olingan' deb belgilaymiz — change detection
        // faqat shu kunlardagi DB yozuvlarni tekshiradi (xato bo'lmagan)
        const parsedDay = this.parseDdate(dateStr);
        if (parsedDay) fetchedDayStarts.push(parsedDay);
        // i=0 (bugungi kun) saldo_out — eng oxirgi qoldiq (backfill'da qoldiqqa tegmaymiz)
        if (!isBackfill && i === 0 && daySaldoOut != null) {
          latestSaldoOut = Number(daySaldoOut);
        }
        for (const item of dayItems) {
          try {
            const ok = await this.upsertOne(item, acc.id, acc.accountNo, cred.bankId, cred.bank.code);
            if (ok) saved++;
          } catch (e: any) {
            errors++;
            this.logger.warn(`Upsert xato (${item.b2_id || item.general_id}): ${e?.message?.slice(0, 200)}`);
          }
        }
      }

      // ── CHANGE DETECTION (re-verify) ──
      // Backfill emas va kamida bitta kun muvaffaqiyatli olingan bo'lsa, mavjud
      // DB yozuvlarni bank javobi bilan solishtirib o'chirilgan / o'zgartirilgan
      // tranzaksiyalarni aniqlaymiz.
      if (!isBackfill && fetchedDayStarts.length > 0) {
        try {
          const changeStats = await this.detectChanges({
            account: acc,
            bankCode: cred.bank.code,
            fetchedItems: allFetchedItems,
            fetchedDays: fetchedDayStarts,
            actor: 'sync',
          });
          if (changeStats.deleted > 0 || changeStats.edited > 0) {
            this.logger.log(
              `Change detection (${acc.accountNo}): ${changeStats.deleted} ta o'chirilgan, ${changeStats.edited} ta o'zgartirilgan`,
            );
          }
        } catch (e: any) {
          this.logger.warn(`Change detection xato (${acc.accountNo}): ${e?.message?.slice(0, 200)}`);
        }
      }

      // Qoldiqni ham yangilash: GetDoc1C dan saldo_out — faqat oddiy sync'da (backfill'da emas)
      let balanceSom: Prisma.Decimal | undefined;
      if (!isBackfill) {
        if (latestSaldoOut != null) {
          balanceSom = new Prisma.Decimal(latestSaldoOut / 100);
        }
        // GetAcc1C ni faqat saldo_out bo'lmasa va xato bo'lsa ham sync to'xtamasin
        if (balanceSom === undefined) {
          try {
            const accInfo = await this.kb.getAcc1C({
              baseUrl: cred.bank.apiBaseUrl!,
              login,
              password,
              branch: acc.branch,
              account: acc.accountNo,
              useProxy: cred.useProxy === true,
            });
            const found = (accInfo || []).find((a: any) => a.account === acc.accountNo);
            if (found && found.s_out != null) {
              balanceSom = new Prisma.Decimal(Number(found.s_out) / 100);
            }
          } catch (e: any) {
            this.logger.warn(`GetAcc1C qoldiq olishda xato (jiddiy emas): ${e?.message}`);
          }
        }
      }

      // Backfill lastSyncedAt'ga tegmaydi (cron intervali buzilmasin)
      const accUpdate: Prisma.BankAccountUpdateInput = {};
      if (!isBackfill) accUpdate.lastSyncedAt = new Date();
      if (balanceSom !== undefined) accUpdate.balance = balanceSom;
      if (Object.keys(accUpdate).length > 0) {
        await this.prisma.bankAccount.update({ where: { id: acc.id }, data: accUpdate });
      }
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: errors > 0 ? 'PARTIAL' : 'SUCCESS',
          fetched, saved, errors,
          finishedAt: new Date(),
          durationMs: Date.now() - t0,
        },
      });
      this.logger.log(`✓ ${acc.branch}/${acc.accountNo}: ${fetched} olindi, ${saved} saqlandi`);
    } catch (e: any) {
      errorMessage = e?.message?.slice(0, 500) || 'Noma\'lum xato';
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          fetched, saved, errors,
          errorMessage,
          finishedAt: new Date(),
          durationMs: Date.now() - t0,
        },
      });
      this.logger.error(`✗ Sync xato ${acc.branch}/${acc.accountNo}: ${errorMessage}`);
      throw e;
    }
    return { ok: true, fetched, saved, errors };
  }

  /**
   * KapitalBank doc → bizning Transaction modeli.
   * externalId = composite (Python kodi formati):
   *   {general_id}_{num}_{ddate}_{acc_ct}_{acc_dt}_{amount}_{sign}
   *
   * Barcha 29 field saqlanadi (alohida column'lar) + bilmagan fieldlar rawExtra JSON'ga.
   * Hech qanday ma'lumot yo'qolmaydi.
   */
  /**
   * Public: bitta KB tranzaksiya item'ini DB ga insert qiladi (mavjud bo'lsa skip).
   * Sync flow ham, sverka "Qo'shish" tugmasi ham ishlatadi.
   */
  async upsertOne(
    item: KbDoc1CItem,
    accountId: string,
    accountNo: string,
    bankId: string,
    bankCode?: string,
  ): Promise<boolean> {
    if (!item.general_id && !item.b2_id) return false;

    const externalId = this.makeCompositeId(item, accountNo, bankCode);

    // Sanalar (oldindan — dedup ichida ham kerak)
    const txnDate = this.parseKbDate(item.ddate) || new Date();
    const valueDate = this.parseKbDate(item.vdate);
    const inputAt = this.parseKbDateTime(item.input_date, item.input_time);

    // Mavjudligini tekshirish — FAQAT shu account doirasida
    // 1) Standard dedup: externalId/b2_id/general_id/bankB2Id
    // 2) DATE-SHIFT: shu general_id bilan ±15 kun atrofida yozuv bormi
    const shiftWindowMs = 15 * 24 * 60 * 60 * 1000;
    const dateFrom = new Date(txnDate.getTime() - shiftWindowMs);
    const dateTo = new Date(txnDate.getTime() + shiftWindowMs);
    const existing = await this.prisma.transaction.findFirst({
      where: {
        accountId,
        OR: [
          { externalId },
          { externalId: item.b2_id || undefined },
          { externalId: item.general_id || undefined },
          { bankB2Id: item.b2_id || undefined },
          // DATE-SHIFT — shu general_id bor composite ±15 kun atrofida
          ...(item.general_id ? [{
            AND: [
              { externalId: { contains: `_${item.general_id}_` } },
              { txnDate: { gte: dateFrom, lte: dateTo } },
            ],
          }] : []),
        ],
      },
    });

    if (existing) {
      // ── DATE-SHIFT UPDATE ──
      // Mavjud yozuvning sanasi yoki externalId yangi keladigan'dan farq qilsa,
      // bu bank tomonida sanani ko'chirish hodisasi (proвotka o'zgargan).
      // Eski yozuvni yangi sana + composite bilan UPDATE qilamiz.
      const existingDateMs = existing.txnDate.getTime();
      const newDateMs = txnDate.getTime();
      const dateChanged = existingDateMs !== newDateMs;
      const externalIdChanged = existing.externalId !== externalId;
      if (dateChanged || externalIdChanged) {
        try {
          await this.prisma.transaction.update({
            where: { id: existing.id },
            data: {
              externalId,            // yangi composite
              txnDate,               // yangi sana
              valueDate,
              syncedAt: new Date(),
              ...(item.b2_id ? { bankB2Id: item.b2_id } : {}),
            },
          });
          this.logger.log(
            `Date-shift: tx ${existing.id} yangilandi — ` +
            `sana ${existing.txnDate.toISOString().slice(0, 10)} → ${txnDate.toISOString().slice(0, 10)}, ` +
            `composite ID yangi`,
          );
        } catch (e: any) {
          this.logger.warn(`Date-shift update xato (${existing.id}): ${e?.message}`);
        }
      }
      return false; // yangi yozuv yaratilmaydi
    }

    // Yo'nalish: bank dir maydoni ba'zan noto'g'ri kelganligi tufayli, acc_ct/acc_dt'dan aniqlaymiz
    //   acc_ct = kreditlanadigan hisob (kim oladi)  → bizning hisob bo'lsa KIRIM
    //   acc_dt = debetlanadigan hisob (kim beradi)  → bizning hisob bo'lsa CHIQIM
    // Fallback (acc_ct/acc_dt yo'q bo'lsa) → eski PDF §9.7 logikasi
    let direction: TxnDirection;
    if (item.acc_ct === accountNo) direction = 'IN';
    else if (item.acc_dt === accountNo) direction = 'OUT';
    else direction = item.dir === 2 ? 'IN' : 'OUT'; // fallback

    // Holat: PDF §9.1 (1 introduced, 2 approved, 3 proved, 6 deleted, 16 deferred)
    const status: TxnStatus =
      item.state === 3 ? 'COMPLETED'
        : item.state === 6 ? 'CANCELLED'
        : item.state === 16 ? 'PENDING'
        : 'COMPLETED';

    const type: TxnType = this.guessType(item.purp_code, item.dtype);
    const amountSom = new Prisma.Decimal((item.amount ?? 0) / 100);

    const rawExtra = this.extractRawExtra(item);

    const created = await this.prisma.transaction.create({
      data: {
        externalId,
        type,
        status,
        direction,
        amount: amountSom,
        currency: 'UZS',

        // Yuboruvchi
        fromMfo: item.mfo_dt,
        fromAccount: item.acc_dt,
        fromName: item.name_dt,
        fromInn: item.inn_dt,

        // Qabul qiluvchi
        toMfo: item.mfo_ct,
        toAccount: item.acc_ct,
        toName: item.name_ct,
        toInn: item.inn_ct,

        // Tafsilot
        description: item.purpose,
        reference: item.uniq || null,
        purposeCode: item.purp_code,
        docNumber: item.num,
        docType: item.dtype,

        // Bank ID'lari (alohida column)
        bankGeneralId: item.general_id,
        bankB2Id: item.b2_id,

        // Bank ichki
        bankClientId: item.client_id != null ? String(item.client_id) : null,
        bankBranch: item.branch,

        // Vaqtlar (qo'shimcha)
        valueDate,
        operationTime: item.time,
        settlementTime: item.stime,
        inputAt,

        // Anor va xato
        isAnor: item.anor === 1,
        bankErrCode: item.err,
        bankErrMsg: item.err_msg,

        // Raw va ekstra
        metadata: item as any,
        rawExtra: rawExtra as any,

        // Bog'lanish
        bankId,
        accountId,
        txnDate,
      },
    });

    // Billing avto-match: faqat kirim tranzaksiya uchun, INN orqali mijoz qidirib
    if (direction === 'IN' && item.inn_dt) {
      try {
        const r = await this.payments.autoMatch(created.id);
        if (r.ok) {
          this.logger.log(`💰 Auto-match: ${item.inn_dt} → ${(r as any).customer?.name}`);
        }
      } catch (e: any) {
        this.logger.warn(`Auto-match xato (${created.id}): ${e?.message}`);
      }
    }

    // Avto-kategoriyalash — yangi tranzaksiyaga qoidalarni qo'llaymiz
    // (sync ni sekinlashtirmaslik uchun fire-and-forget)
    this.categorization
      .categorizeOne(created.id, { actor: 'sync' })
      .catch((e: any) => this.logger.warn(`Avto-kategoriyalash xato (${created.id}): ${e?.message}`));

    return true;
  }

  /** "dd.MM.yyyy" → Date */
  private parseKbDate(s?: string): Date | null {
    if (!s) return null;
    try {
      return parse(s, 'dd.MM.yyyy', new Date());
    } catch {
      return null;
    }
  }

  /** "dd.MM.yyyy" + "HH:mm:ss" → Date */
  private parseKbDateTime(d?: string, t?: string): Date | null {
    if (!d) return null;
    try {
      const dateStr = t ? `${d} ${t}` : d;
      const fmt = t ? 'dd.MM.yyyy HH:mm:ss' : 'dd.MM.yyyy';
      return parse(dateStr, fmt, new Date());
    } catch {
      return null;
    }
  }

  /**
   * Bank javobi (fetchedItems) bilan DB'dagi mavjud tranzaksiyalarni solishtirib
   * o'chirilgan / o'zgartirilgan yozuvlarni aniqlaydi.
   *
   * - DELETED: DB'da bor, lekin bank fetchedItems'da yo'q (general_id bo'yicha)
   *   → DB'dan o'chiradi va ChangeLog'ga yozadi
   * - EDITED: ikkalasi ham bor, lekin status/amount/direction/description farq qiladi
   *   → DB'da yangilaydi va ChangeLog'ga yozadi
   *
   * Faqat fetchedDays oraligida'i DB yozuvlarni tekshiradi (xato bilan
   * olinmagan kunlarda o'chirish noto'g'ri bo'lar edi).
   */
  async detectChanges(opts: {
    account: { id: string; accountNo: string };
    bankCode?: string;
    fetchedItems: KbDoc1CItem[];
    fetchedDays: Date[];          // muvaffaqiyatli olingan kunlarning Date list'i
    actor: string;                // 'sync' | 'manual:<email>'
  }): Promise<{ deleted: number; edited: number }> {
    const { account, bankCode, fetchedItems, fetchedDays, actor } = opts;
    if (fetchedDays.length === 0) return { deleted: 0, edited: 0 };

    // Tekshirish oralig'i (eng erta va eng kech kun)
    const sortedDays = [...fetchedDays].sort((a, b) => a.getTime() - b.getTime());
    const minDay = new Date(sortedDays[0]); minDay.setHours(0, 0, 0, 0);
    const maxDay = new Date(sortedDays[sortedDays.length - 1]); maxDay.setHours(23, 59, 59, 999);

    // Bank javobini general_id va b2_id bo'yicha index qilamiz
    const bankByGeneralId = new Map<string, KbDoc1CItem>();
    const bankByB2Id = new Map<string, KbDoc1CItem>();
    for (const it of fetchedItems) {
      if (it.general_id) bankByGeneralId.set(String(it.general_id), it);
      if (it.b2_id) bankByB2Id.set(String(it.b2_id), it);
    }

    // DB'dagi shu account uchun fetchedDays oraligidagi tranzaksiyalar
    // category — CLIENT (Клиент/Физ.Л/Юр.Л) tekshiruvi uchun, OplataKv cascade'da kerak
    const dbTxs = await this.prisma.transaction.findMany({
      where: {
        accountId: account.id,
        txnDate: { gte: minDay, lte: maxDay },
        source: 'SYNC',  // faqat sync orqali kelgan yozuvlar (Import/Manual emas)
      },
      include: {
        category: { select: { code: true, name: true } },
      },
    });

    let deletedCount = 0;
    let editedCount = 0;

    for (const tx of dbTxs) {
      // Bank javobida general_id yoki b2_id orqali topish
      const ext = tx.externalId;
      // Composite ID'dan general_id'ni ajratib olish (format: {gen_id}_{num}_{ddate}_..._{sign})
      const extParts = ext.replace(/^IP_/, '').split('_');
      const possibleGenId = extParts[0] && extParts[0] !== 'no_general_id' ? extParts[0] : null;

      let bankItem: KbDoc1CItem | null = null;
      if (possibleGenId && bankByGeneralId.has(possibleGenId)) {
        bankItem = bankByGeneralId.get(possibleGenId)!;
      } else if (tx.bankB2Id && bankByB2Id.has(tx.bankB2Id)) {
        bankItem = bankByB2Id.get(tx.bankB2Id)!;
      }

      if (!bankItem) {
        // DELETED — bank ro'yxatida yo'q
        try {
          // Snapshot saqlaymiz, keyin tranzaksiyani o'chiramiz
          await this.prisma.transactionChangeLog.create({
            data: {
              txId: tx.id,
              externalId: tx.externalId,
              accountId: tx.accountId,
              changeType: 'DELETED',
              fieldsChanged: ['*'],
              oldData: tx as any,
              newData: null as any,
              txnDate: tx.txnDate,
              amount: tx.amount,
              direction: tx.direction,
              contractNumber: tx.contractNumber,
              bankNameSnap: tx.importBankNameText,
              accountNoSnap: account.accountNo,
              detectedBy: actor,
              note: `Bank ro'yxatida yo'q (${minDay.toISOString().slice(0, 10)} → ${maxDay.toISOString().slice(0, 10)} oralig'i tekshirildi)`,
            },
          });
          // OplatyKv cascade — CLIENT (Клиент/Физ.Л/Юр.Л) bo'lsa, OplatyKv'dan ham o'chiramiz
          if (this.isClientTx(tx)) {
            await this.cascadeOplataKvDelete(tx.externalId, tx.id, actor);
          }
          await this.prisma.transaction.delete({ where: { id: tx.id } });
          deletedCount++;
        } catch (e: any) {
          this.logger.warn(`Change-DELETED yozishda xato (${tx.id}): ${e?.message}`);
        }
        continue;
      }

      // EDITED — solishtirish
      const newAmountSom = new Prisma.Decimal((bankItem.amount ?? 0) / 100);
      const oldAmountSom = tx.amount;
      let newDirection: TxnDirection = tx.direction;
      if (bankItem.acc_ct === account.accountNo) newDirection = 'IN';
      else if (bankItem.acc_dt === account.accountNo) newDirection = 'OUT';
      const newStatus: TxnStatus =
        bankItem.state === 3 ? 'COMPLETED'
          : bankItem.state === 6 ? 'CANCELLED'
          : bankItem.state === 16 ? 'PENDING'
          : 'COMPLETED';
      const newDescription = (bankItem as any).naznach || (bankItem as any).details || tx.description;

      const fieldsChanged: string[] = [];
      const changes: Record<string, { old: any; new: any }> = {};
      if (!oldAmountSom.equals(newAmountSom)) {
        fieldsChanged.push('amount');
        changes.amount = { old: oldAmountSom.toString(), new: newAmountSom.toString() };
      }
      // Status: faqat → CANCELLED bo'lganda "bank tahriri" hisoblanadi.
      //   * → CANCELLED — bank rad qildi yoki qaytarib oldi, LOG
      //   PENDING ↔ COMPLETED — banklar (ayniqsa IPak Yo'li) bir kun ichida
      //     state'ni o'zgartirib turishi mumkin (ichki qayta ishlash, race),
      //     bu bank tahriri emas — SKIP (DB silent yangilanadi)
      if (tx.status !== newStatus && newStatus === 'CANCELLED') {
        fieldsChanged.push('status');
        changes.status = { old: tx.status, new: newStatus };
      }
      if (tx.direction !== newDirection) {
        fieldsChanged.push('direction');
        changes.direction = { old: tx.direction, new: newDirection };
      }
      if (newDescription && tx.description !== newDescription) {
        fieldsChanged.push('description');
        changes.description = { old: tx.description, new: newDescription };
      }

      // Hech qanday log-worthy o'zgarish bo'lmasa — DBni yangilab continue qilamiz
      // (PENDING→COMPLETED faqat status, lekin uni baribir DBda yangilash kerak — silent)
      if (fieldsChanged.length === 0) {
        if (tx.status !== newStatus) {
          // Silent status update (PENDING → COMPLETED)
          try {
            await this.prisma.transaction.update({
              where: { id: tx.id },
              data: { status: newStatus, syncedAt: new Date() },
            });
          } catch (e: any) {
            this.logger.warn(`Silent status update xato (${tx.id}): ${e?.message}`);
          }
        }
        continue;
      }

      try {
        await this.prisma.transactionChangeLog.create({
          data: {
            txId: tx.id,
            externalId: tx.externalId,
            accountId: tx.accountId,
            changeType: 'EDITED',
            fieldsChanged,
            oldData: changes as any,
            newData: {
              amount: newAmountSom.toString(),
              status: newStatus,
              direction: newDirection,
              description: newDescription,
            } as any,
            txnDate: tx.txnDate,
            amount: newAmountSom,
            direction: newDirection,
            contractNumber: tx.contractNumber,
            bankNameSnap: tx.importBankNameText,
            accountNoSnap: account.accountNo,
            detectedBy: actor,
            note: `Maydonlar o'zgarganligi aniqlandi: ${fieldsChanged.join(', ')}`,
          },
        });
        await this.prisma.transaction.update({
          where: { id: tx.id },
          data: {
            amount: newAmountSom,
            status: newStatus,
            direction: newDirection,
            description: newDescription,
            syncedAt: new Date(),
          },
        });
        // OplatyKv cascade — CLIENT bo'lsa va summa/yo'nalish o'zgargan bo'lsa
        if (this.isClientTx(tx) && (changes.amount || changes.direction)) {
          await this.cascadeOplataKvEdit(tx.externalId, tx.id, {
            newAmount: newAmountSom,
            newDirection,
            oldAmount: oldAmountSom,
            oldDirection: tx.direction,
            actor,
          });
        }
        editedCount++;
      } catch (e: any) {
        this.logger.warn(`Change-EDITED yozishda xato (${tx.id}): ${e?.message}`);
      }
    }

    return { deleted: deletedCount, edited: editedCount };
  }

  /**
   * Tranzaksiya CLIENT (Клиент/Физ.Л/Юр.Л) kategoriyasiga tegishlimi?
   * categorization.service.ts'dagi syncContractChangeToOplataKv bilan
   * sinxron ishlaydi — bir xil pattern.
   */
  private isClientTx(tx: any): boolean {
    const cat = tx?.category;
    if (cat?.code === 'CLIENT') return true;
    const clientPattern = /клиент|физ\.?\s*л|юр\.?\s*л/i;
    if (cat?.name && clientPattern.test(cat.name)) return true;
    return false;
  }

  /**
   * Bank tomonida o'chirilgan CLIENT tranzaksiyasi — bog'langan OplataKv
   * qatorini ham o'chiramiz va OplataKvHistory'ga audit yozuv qoldiramiz.
   */
  private async cascadeOplataKvDelete(externalId: string, txId: string, actor: string): Promise<void> {
    try {
      const row = await this.prisma.oplataKv.findFirst({
        where: { sourceTxId: { in: [externalId, txId] } },
      });
      if (!row) return;
      await this.prisma.oplataKvHistory.create({
        data: {
          oplataKvId: row.id,
          action: 'deleted',
          actorType: 'system',
          actorId: null,
          actorName: actor,
          fieldsChanged: ['*'],
          changes: row as any,
          note: `Bank tomonida tranzaksiya o'chirilgani uchun avtomatik o'chirildi (txId=${txId})`,
        },
      });
      await this.prisma.oplataKv.delete({ where: { id: row.id } });
      this.logger.log(`OplataKv ${row.id} cascade-o'chirildi (tx ${txId} DELETED)`);
    } catch (e: any) {
      this.logger.warn(`OplataKv cascade-delete xato (tx=${txId}): ${e?.message}`);
    }
  }

  /**
   * Bank tomonida o'zgartirilgan CLIENT tranzaksiyasi — bog'langan OplataKv
   * qatorida paymentAmount'ni (yo'nalishga qarab signed) yangilaymiz.
   */
  private async cascadeOplataKvEdit(
    externalId: string,
    txId: string,
    opts: {
      newAmount: Prisma.Decimal;
      newDirection: TxnDirection;
      oldAmount: Prisma.Decimal;
      oldDirection: TxnDirection;
      actor: string;
    },
  ): Promise<void> {
    try {
      const row = await this.prisma.oplataKv.findFirst({
        where: { sourceTxId: { in: [externalId, txId] } },
        select: { id: true, paymentAmount: true },
      });
      if (!row) return;
      const newSigned = opts.newDirection === 'IN'
        ? opts.newAmount
        : opts.newAmount.negated();
      const oldSigned = row.paymentAmount;
      if (oldSigned && oldSigned.equals(newSigned)) return;
      await this.prisma.oplataKv.update({
        where: { id: row.id },
        data: { paymentAmount: newSigned },
      });
      await this.prisma.oplataKvHistory.create({
        data: {
          oplataKvId: row.id,
          action: 'edited',
          actorType: 'system',
          actorId: null,
          actorName: opts.actor,
          fieldsChanged: ['paymentAmount'],
          changes: {
            paymentAmount: {
              old: oldSigned?.toString() ?? null,
              new: newSigned.toString(),
            },
          } as any,
          note: `Bank tomonida tranzaksiya o'zgargani uchun avtomatik yangilandi (txId=${txId})`,
        },
      });
      this.logger.log(`OplataKv ${row.id} cascade-yangilandi (tx ${txId} EDITED, paymentAmount)`);
    } catch (e: any) {
      this.logger.warn(`OplataKv cascade-edit xato (tx=${txId}): ${e?.message}`);
    }
  }

  /**
   * Qo'lda chaqirilgan sana oralig'i uchun re-verify. Sync minimal sana'dan
   * oldinga chiqib bo'lmaydi. /transactions/check-changes endpoint chaqiradi.
   */
  async manualCheckChanges(opts: {
    accountId?: string;       // null → barcha sync yoqilgan hisoblar
    dateFrom: string;         // YYYY-MM-DD
    dateTo: string;           // YYYY-MM-DD
    actor: string;
  }): Promise<{ ok: boolean; checked: number; deleted: number; edited: number; skippedAccounts: string[] }> {
    const { accountId, dateFrom, dateTo, actor } = opts;
    const minDate = await this.settings.getSyncMinDate();
    if (minDate) {
      const fromD = new Date(`${dateFrom}T00:00:00Z`);
      if (fromD < minDate) {
        throw new Error(`Sanadan ${dateFrom} sync chegarasi (${minDate.toISOString().slice(0, 10)}) dan oldin bo'lmasligi kerak`);
      }
    }
    // Sana ro'yxati (dd.MM.yyyy)
    const fromD = new Date(`${dateFrom}T00:00:00Z`);
    const toD = new Date(`${dateTo}T00:00:00Z`);
    if (fromD > toD) throw new Error('Sanadan sanagacha noto\'g\'ri');
    const days: string[] = [];
    for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(format(d, 'dd.MM.yyyy'));
    }

    // Tekshirilishi kerak hisoblar
    const accounts = await this.prisma.bankAccount.findMany({
      where: accountId ? { id: accountId } : { syncEnabled: true },
      include: { credential: { include: { bank: true } } },
    });

    let totalChecked = 0;
    let totalDeleted = 0;
    let totalEdited = 0;
    const skipped: string[] = [];

    for (const acc of accounts) {
      const cred = (acc as any).credential;
      if (!cred || !cred.bank?.apiBaseUrl) {
        skipped.push(`${acc.accountNo} (credential yo'q)`);
        continue;
      }
      if (cred.bank.apiKind !== 'KAPITALBANK_V3' && cred.bank.apiKind !== 'IPAK_YOLI_V1') {
        skipped.push(`${acc.accountNo} (bank turi qo'llab-quvvatlanmaydi)`);
        continue;
      }
      const password = this.crypto.decrypt(cred.passwordEnc);
      const login = (cred.loginPrefix || '') + cred.loginName;

      const fetchedItems: KbDoc1CItem[] = [];
      const fetchedDays: Date[] = [];
      for (const ds of days) {
        try {
          const result = await this.kb.getDoc1C({
            baseUrl: cred.bank.apiBaseUrl!,
            login,
            password,
            branch: acc.branch,
            account: acc.accountNo,
            date: ds,
            useProxy: cred.useProxy === true,
          });
          fetchedItems.push(...(result?.content || []));
          const parsed = this.parseDdate(ds);
          if (parsed) fetchedDays.push(parsed);
        } catch (e: any) {
          this.logger.warn(`manualCheck getDoc1C xato (${acc.accountNo} · ${ds}): ${e?.message}`);
        }
      }
      if (fetchedDays.length === 0) {
        skipped.push(`${acc.accountNo} (kunlar olinmadi)`);
        continue;
      }
      totalChecked++;
      const stats = await this.detectChanges({
        account: { id: acc.id, accountNo: acc.accountNo },
        bankCode: cred.bank.code,
        fetchedItems,
        fetchedDays,
        actor,
      });
      totalDeleted += stats.deleted;
      totalEdited += stats.edited;
    }

    return { ok: true, checked: totalChecked, deleted: totalDeleted, edited: totalEdited, skippedAccounts: skipped };
  }

  private guessType(purpCode?: string, dtype?: string): TxnType {
    // PDF §9.6 dtype: 01,35 — to'lov; 16 — SWIFT; 97 — karta; 98 — kazna; 99 — byudjet
    if (dtype === '99') return 'TAX';
    if (dtype === '98') return 'TAX';
    if (dtype === '97') return 'PAYMENT';
    if (purpCode === '00634') return 'SALARY';
    if (dtype === '21' || dtype === '01' || dtype === '35') return 'TRANSFER';
    return 'OTHER';
  }
}
