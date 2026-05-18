import { Injectable, Logger } from '@nestjs/common';
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
export class SyncService {
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
    this.daysBack = Number(config.get<string>('TXN_SYNC_DAYS_BACK', '1'));
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
    try {
      for (let i = 0; i < dateList.length; i++) {
        const dateStr = dateList[i];
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
        const items = result?.content || [];
        fetched += items.length;
        // i=0 (bugungi kun) saldo_out — eng oxirgi qoldiq (backfill'da qoldiqqa tegmaymiz)
        if (!isBackfill && i === 0 && result?.saldo_out != null) {
          latestSaldoOut = Number(result.saldo_out);
        }
        for (const item of items) {
          try {
            const ok = await this.upsertOne(item, acc.id, acc.accountNo, cred.bankId, cred.bank.code);
            if (ok) saved++;
          } catch (e: any) {
            errors++;
            this.logger.warn(`Upsert xato (${item.b2_id || item.general_id}): ${e?.message?.slice(0, 200)}`);
          }
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

    // Mavjudligini tekshirish — FAQAT shu account doirasida
    // (bir tranzaksiya 2 ta account uchun ikki yozuv bo'lishi kerak — sender va receiver)
    const existing = await this.prisma.transaction.findFirst({
      where: {
        accountId, // muhim — boshqa accountning yozuvini dublikat deb skip qilmaslik
        OR: [
          { externalId },
          { externalId: item.b2_id || undefined },
          { externalId: item.general_id || undefined },
          { bankB2Id: item.b2_id || undefined },
        ],
      },
    });
    if (existing) return false;

    // Sanalar
    const txnDate = this.parseKbDate(item.ddate) || new Date();
    const valueDate = this.parseKbDate(item.vdate);
    const inputAt = this.parseKbDateTime(item.input_date, item.input_time);

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
