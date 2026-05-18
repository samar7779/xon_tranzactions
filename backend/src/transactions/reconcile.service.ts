import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';
import { SyncService } from '../sync/sync.service';

const DAY_MS = 86_400_000;
const MAX_DAYS = 92;
// 1 so'mgacha farq — yaxlitlash xatosi deb hisoblanadi, "mos" sanaladi
const EPSILON = 1;

/**
 * Hisob sverkasi (reconciliation).
 *
 * Bankdan sana oralig'i uchun: ochilish/yopilish saldosi + debet/kredit oborotini
 * oladi (GetDoc1C, kunma-kun). Bizning DB'dagi tranzaksiya summalari bilan
 * solishtiradi — yetishmayotgan yoki ortiqcha yozuvlarni aniqlaydi.
 *
 * Birliklar: bank API tiyin qaytaradi (×100), bizning DB so'mda saqlaydi.
 */
// reconcileToday natijasini 5 minutga keshlash — har bir foydalanuvchi
// alohida bank fan-out qilmasin (140 ta hisob bo'lsa, har bir kishi
// alohida 30s+ kutib o'tirmasin).
const TODAY_CACHE_TTL_MS = 5 * 60 * 1000;
let todayCache: { date: string; expiresAt: number; data: any } | null = null;

@Injectable()
export class ReconcileService {
  private readonly log = new Logger(ReconcileService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
    private sync: SyncService,
  ) {}

  async reconcile(accountId: string, dateFrom: string, dateTo: string) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom va dateTo kerak');

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { bank: true, credential: { include: { bank: true } } },
    });
    if (!account) throw new NotFoundException('Hisob topilmadi');

    const cred = account.credential;
    if (!cred) throw new BadRequestException('Hisobga bank ulanishi biriktirilmagan');
    const bank = cred.bank;
    if (bank.apiKind !== 'KAPITALBANK_V3' && bank.apiKind !== 'IPAK_YOLI_V1') {
      throw new BadRequestException("Sverka faqat Kapitalbank va Ipak Yo'li banklar uchun");
    }
    if (!bank.apiBaseUrl) throw new BadRequestException('Bank API manzili sozlanmagan');

    // Sana stringlari (YYYY-MM-DD) Tashkent kunlari sifatida talqin qilinadi
    const from = new Date(`${dateFrom}T00:00:00+05:00`);
    const to   = new Date(`${dateTo}T00:00:00+05:00`);
    const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (days < 1) throw new BadRequestException("dateFrom dateTo dan keyin bo'lmasligi kerak");
    if (days > MAX_DAYS) throw new BadRequestException(`Davr ${MAX_DAYS} kundan oshmasligi kerak`);

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;

    // ── Bankdan kunma-kun: ochilish/yopilish saldosi + oborotlar ──
    let saldoInTiyin: number | null = null;   // birinchi muvaffaqiyatli kun
    let saldoOutTiyin: number | null = null;  // oxirgi muvaffaqiyatli kun
    let totalDebitTiyin = 0;
    let totalCreditTiyin = 0;
    let failedDays = 0;
    let lastError: any = null;

    // Kunma-kun bank totallari — multi-day range'da qaysi kun farqli ekanini ko'rsatish uchun
    const bankByDay = new Map<string, { credit: number; debit: number; failed: boolean }>();

    for (let i = 0; i < days; i++) {
      const day = new Date(from.getTime() + i * DAY_MS);
      const dateStr = this.fmtDate(day);
      const isoKey = day.toISOString().slice(0, 10);
      try {
        const result = await this.kb.getDoc1C({
          baseUrl: bank.apiBaseUrl,
          login,
          password,
          branch: account.branch,
          account: account.accountNo,
          date: dateStr,
          useProxy: cred.useProxy === true,
        });
        if (saldoInTiyin === null && result?.saldo_in != null) {
          saldoInTiyin = Number(result.saldo_in);
        }
        if (result?.saldo_out != null) saldoOutTiyin = Number(result.saldo_out);
        const dayCredit = Number(result?.total_credit || 0);
        const dayDebit = Number(result?.total_debit || 0);
        totalDebitTiyin += dayDebit;
        totalCreditTiyin += dayCredit;
        bankByDay.set(isoKey, {
          credit: dayCredit / 100,
          debit: dayDebit / 100,
          failed: false,
        });
      } catch (e: any) {
        failedDays++;
        lastError = e;
        bankByDay.set(isoKey, { credit: 0, debit: 0, failed: true });
      }
    }
    if (failedDays === days) {
      throw new BadRequestException(
        `Bankdan ma'lumot olinmadi: ${lastError?.message || "noma'lum xato"}`,
      );
    }

    // tiyin → so'm
    const bankOpening = (saldoInTiyin ?? 0) / 100;
    const bankClosing = (saldoOutTiyin ?? 0) / 100;
    const bankDebit = totalDebitTiyin / 100;    // chiqim oboroti
    const bankCredit = totalCreditTiyin / 100;  // kirim oboroti

    // ── Bizning DB: shu hisob, shu oraliqdagi tranzaksiya summalari ──
    const start = new Date(`${dateFrom}T00:00:00+05:00`);
    const end   = new Date(`${dateTo}T23:59:59.999+05:00`);
    const grouped = await this.prisma.transaction.groupBy({
      by: ['direction'],
      where: { accountId, txnDate: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    });
    let dbInflow = 0, dbOutflow = 0, dbInCount = 0, dbOutCount = 0;
    for (const g of grouped) {
      if (g.direction === 'IN') {
        dbInflow = Number(g._sum.amount || 0);
        dbInCount = g._count;
      } else if (g.direction === 'OUT') {
        dbOutflow = Number(g._sum.amount || 0);
        dbOutCount = g._count;
      }
    }

    // ── DB kunma-kun: dailyBreakdown uchun (faqat range > 1 kun bo'lganda foydali) ──
    const dbByDay = new Map<string, { inflow: number; outflow: number }>();
    if (days > 1) {
      const dayTxns = await this.prisma.transaction.findMany({
        where: { accountId, txnDate: { gte: start, lte: end } },
        select: { txnDate: true, direction: true, amount: true },
      });
      const TZ = 5 * 60 * 60 * 1000;
      for (const t of dayTxns) {
        const key = new Date(t.txnDate.getTime() + TZ).toISOString().slice(0, 10);
        const e = dbByDay.get(key) || { inflow: 0, outflow: 0 };
        const amt = Number(t.amount);
        if (t.direction === 'IN') e.inflow += amt;
        else e.outflow += amt;
        dbByDay.set(key, e);
      }
    }

    // dailyBreakdown — har bir kun uchun bank vs DB
    let dailyBreakdown: Array<{
      date: string; bankCredit: number; bankDebit: number; dbInflow: number; dbOutflow: number;
      creditDiff: number; debitDiff: number; failed: boolean; status: 'ok' | 'mismatch' | 'failed';
    }> | undefined;
    if (days > 1) {
      dailyBreakdown = [];
      for (let i = 0; i < days; i++) {
        const day = new Date(from.getTime() + i * DAY_MS);
        const key = day.toISOString().slice(0, 10);
        const b = bankByDay.get(key) || { credit: 0, debit: 0, failed: false };
        const d = dbByDay.get(key) || { inflow: 0, outflow: 0 };
        const cDiff = b.credit - d.inflow;
        const dDiff = b.debit - d.outflow;
        const dayStatus: 'ok' | 'mismatch' | 'failed' = b.failed
          ? 'failed'
          : (Math.abs(cDiff) < EPSILON && Math.abs(dDiff) < EPSILON ? 'ok' : 'mismatch');
        dailyBreakdown.push({
          date: key,
          bankCredit: b.credit,
          bankDebit: b.debit,
          dbInflow: d.inflow,
          dbOutflow: d.outflow,
          creditDiff: cDiff,
          debitDiff: dDiff,
          failed: b.failed,
          status: dayStatus,
        });
      }
    }

    // ── Solishtirish ──
    const creditDiff = bankCredit - dbInflow;   // bank kirim oboroti − bizdagi kirim
    const debitDiff = bankDebit - dbOutflow;    // bank chiqim oboroti − bizdagi chiqim
    const computedClosing = bankOpening + dbInflow - dbOutflow;
    const formulaDiff = bankClosing - computedClosing;

    const ok =
      Math.abs(creditDiff) < EPSILON &&
      Math.abs(debitDiff) < EPSILON &&
      Math.abs(formulaDiff) < EPSILON;

    return {
      ok: true,
      accountId,
      accountNo: account.accountNo,
      ownerName: account.ownerName,
      bankName: bank.name,
      dateFrom,
      dateTo,
      partial: failedDays > 0,
      failedDays,
      bank: {
        opening: bankOpening,
        closing: bankClosing,
        debit: bankDebit,
        credit: bankCredit,
      },
      db: {
        inflow: dbInflow,
        outflow: dbOutflow,
        inCount: dbInCount,
        outCount: dbOutCount,
      },
      diff: {
        credit: creditDiff,
        debit: debitDiff,
        formula: formulaDiff,
        computedClosing,
      },
      status: ok ? 'ok' : 'mismatch',
      dailyBreakdown,
    };
  }

  private fmtDate(d: Date): string {
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }

  /** Tashkent bugungi sanasini YYYY-MM-DD shaklida qaytaradi */
  private todayTashkent(): string {
    const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
    return now.toISOString().slice(0, 10);
  }

  /**
   * Barcha aktiv hisoblar uchun bugungi (yoki ko'rsatilgan) sverka — parallel
   * (concurrency=3, bank API ni overload qilmaslik uchun). Farq summasi
   * bo'yicha kamayish tartibida qaytaradi (eng katta muammo tepada).
   */
  async reconcileToday(date?: string) {
    const targetDate = date || this.todayTashkent();

    // Kesh tekshirish — 5 min ichida bir xil sana so'ralsa, darrov qaytaramiz
    if (todayCache && todayCache.date === targetDate && todayCache.expiresAt > Date.now()) {
      this.log.log(`reconcileToday: kesh urildi (${targetDate})`);
      return todayCache.data;
    }

    const tStart = Date.now();

    // Barcha aktiv KB+Ipak hisoblar
    const accounts = await this.prisma.bankAccount.findMany({
      where: {
        bank: { isActive: true, apiKind: { in: ['KAPITALBANK_V3', 'IPAK_YOLI_V1'] } },
      },
      include: {
        bank: { select: { id: true, name: true, code: true } },
        credential: { include: { bank: true } },
      },
      orderBy: { ownerName: 'asc' },
    });
    this.log.log(`reconcileToday: ${accounts.length} ta hisob, sverka ${targetDate}`);

    // Worker pool — batch o'rniga. Batch bilan: bitta sekin item butun batchni
    // 25s ushlab turardi. Pool bilan: tez worker'lar darrov yangi item oladi,
    // faqat sekin worker o'z item'ini kutadi.
    const CONCURRENCY = 15;
    const PER_ACCOUNT_TIMEOUT_MS = 12_000;

    const withTimeout = <T,>(p: Promise<T>, ms: number, label: string): Promise<T> =>
      new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms);
        p.then((v) => { clearTimeout(t); resolve(v); })
         .catch((e) => { clearTimeout(t); reject(e); });
      });

    const results: any[] = new Array(accounts.length);
    let nextIdx = 0;
    const worker = async () => {
      while (true) {
        const myIdx = nextIdx++;
        if (myIdx >= accounts.length) return;
        const a = accounts[myIdx];
        try {
          results[myIdx] = await withTimeout(
            this.reconcile(a.id, targetDate, targetDate),
            PER_ACCOUNT_TIMEOUT_MS,
            `${a.bank?.name} · ${a.accountNo}`,
          );
        } catch (e: any) {
          results[myIdx] = {
            ok: false,
            accountId: a.id,
            accountNo: a.accountNo,
            ownerName: a.ownerName,
            bankName: a.bank?.name,
            error: e?.message || "noma'lum xato",
            status: 'error' as const,
          };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, accounts.length) }, worker));

    // Sort: error → eng tepada; mismatch → diff bo'yicha kamayish; ok → eng pastda
    const score = (r: any) => {
      if (r.status === 'error') return Number.POSITIVE_INFINITY;
      if (r.status === 'mismatch') {
        const d = Math.abs(Number(r.diff?.credit || 0)) + Math.abs(Number(r.diff?.debit || 0));
        return d;
      }
      return -1; // ok
    };
    results.sort((a, b) => score(b) - score(a));

    const summary = {
      total: results.length,
      ok: results.filter((r) => r.status === 'ok').length,
      mismatch: results.filter((r) => r.status === 'mismatch').length,
      error: results.filter((r) => r.status === 'error').length,
    };
    this.log.log(
      `reconcileToday yakunlandi: ${summary.total} ta hisob ` +
      `(${summary.ok} mos, ${summary.mismatch} farqli, ${summary.error} xato) ` +
      `· ${((Date.now() - tStart) / 1000).toFixed(1)}s`,
    );
    const payload = { ok: true, date: targetDate, summary, items: results };
    todayCache = { date: targetDate, expiresAt: Date.now() + TODAY_CACHE_TTL_MS, data: payload };
    return payload;
  }

  /** Manual refresh — keshni o'chiradi va qaytadan hisoblaydi */
  invalidateTodayCache() { todayCache = null; }

  /**
   * Bir kun ichidagi farqning sababini topadi: bankdagi har bir tranzaksiya
   * (GetDoc1C content[]) ni bizning DB bilan solishtiradi va:
   *   - bankOnly: bankda bor, bizda yo'q
   *   - dbOnly: bizda bor, bankda yo'q
   * larini qaytaradi. Frontend ularni ko'rsatib, foydalanuvchi muammoni biladi.
   */
  async diagnoseDay(accountId: string, date: string) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!date) throw new BadRequestException('date kerak (YYYY-MM-DD)');

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { bank: true, credential: { include: { bank: true } } },
    });
    if (!account) throw new NotFoundException('Hisob topilmadi');
    const cred = account.credential;
    if (!cred) throw new BadRequestException('Hisobga bank ulanishi biriktirilmagan');
    const bank = cred.bank;
    if (bank.apiKind !== 'KAPITALBANK_V3' && bank.apiKind !== 'IPAK_YOLI_V1') {
      throw new BadRequestException("Diagnostika faqat Kapitalbank va Ipak Yo'li banklar uchun");
    }
    if (!bank.apiBaseUrl) throw new BadRequestException('Bank API manzili sozlanmagan');

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;
    const dateDmy = this.fmtDate(new Date(`${date}T00:00:00+05:00`));

    // Bankdan ushbu kun uchun barcha tranzaksiyalarni olamiz
    const bankRes = await this.kb.getDoc1C({
      baseUrl: bank.apiBaseUrl,
      login,
      password,
      branch: account.branch,
      account: account.accountNo,
      date: dateDmy,
      useProxy: cred.useProxy === true,
    });
    const bankItems = bankRes?.content || [];

    // DB dan o'sha kun uchun tranzaksiyalarni olamiz
    const dayStart = new Date(`${date}T00:00:00+05:00`);
    const dayEnd = new Date(`${date}T23:59:59.999+05:00`);
    // 1) Bu kun uchun saqlangan tx'lar — bankOnly/matched tahlili uchun
    const dbItems = await this.prisma.transaction.findMany({
      where: { accountId, txnDate: { gte: dayStart, lte: dayEnd } },
      select: {
        id: true,
        externalId: true,
        bankB2Id: true,
        bankGeneralId: true,
        amount: true,
        direction: true,
        fromAccount: true,
        toAccount: true,
        fromName: true,
        toName: true,
        description: true,
        docNumber: true,
        txnDate: true,
      },
    });

    // 2) Boshqa sanalardagi tx'lar — bank b2_id/general_id bo'yicha (eski sync paytida
    // boshqa sana ostida saqlangan bo'lishi mumkin). Bank items dan b2_id'larni
    // yig'ib, ulardan tashqarisi (today emas) bo'lganlarini olamiz.
    const bankB2Ids = bankItems.map((i) => i.b2_id).filter(Boolean) as string[];
    const bankGenIds = bankItems.map((i) => i.general_id).filter(Boolean) as string[];
    const offDateItems = (bankB2Ids.length > 0 || bankGenIds.length > 0)
      ? await this.prisma.transaction.findMany({
          where: {
            accountId,
            OR: [
              bankB2Ids.length > 0 ? { bankB2Id: { in: bankB2Ids } } : { id: '__never__' },
              bankGenIds.length > 0 ? { bankGeneralId: { in: bankGenIds } } : { id: '__never__' },
            ],
            // Faqat shu kunga teglanmagan yozuvlar
            NOT: { txnDate: { gte: dayStart, lte: dayEnd } },
          },
          select: { id: true, externalId: true, bankB2Id: true, bankGeneralId: true, txnDate: true },
        })
      : [];

    const offDateMap = new Map<string, typeof offDateItems[number]>();
    for (const tx of offDateItems) {
      if (tx.bankB2Id) offDateMap.set(`b2:${tx.bankB2Id}`, tx);
      if (tx.bankGeneralId) offDateMap.set(`gen:${tx.bankGeneralId}`, tx);
    }

    // Indekslar — externalId / b2_id / general_id orqali tezda topish
    const dbByKey = new Map<string, typeof dbItems[number]>();
    for (const tx of dbItems) {
      if (tx.externalId) dbByKey.set(tx.externalId, tx);
      if (tx.bankB2Id) dbByKey.set(`b2:${tx.bankB2Id}`, tx);
      if (tx.bankGeneralId) dbByKey.set(`gen:${tx.bankGeneralId}`, tx);
      // Legacy: ba'zi eski yozuvlarda b2_id/general_id externalId sifatida saqlangan
    }
    const matchedDbIds = new Set<string>();

    const bankOnly: any[] = [];
    for (const item of bankItems) {
      // Composite externalId — eski tx'larda bankB2Id null bo'lishi mumkin,
      // shuning uchun composite key bilan ham qidirib ko'ramiz
      const composite = this.sync.makeCompositeId(item, account.accountNo, bank.code);
      const keys = [
        item.b2_id ? `b2:${item.b2_id}` : null,
        item.general_id ? `gen:${item.general_id}` : null,
        composite,
        item.b2_id || null,        // legacy: b2_id saved as externalId
        item.general_id || null,   // legacy: general_id saved as externalId
      ].filter(Boolean) as string[];
      let found: typeof dbItems[number] | undefined;
      for (const k of keys) {
        const m = dbByKey.get(k);
        if (m) { found = m; break; }
      }

      // Boshqa sanada saqlanganmi tekshiramiz
      const offDateKeys = [
        item.b2_id ? `b2:${item.b2_id}` : null,
        item.general_id ? `gen:${item.general_id}` : null,
      ].filter(Boolean) as string[];
      let offDateMatch: typeof offDateItems[number] | undefined;
      if (!found) {
        for (const k of offDateKeys) {
          const m = offDateMap.get(k);
          if (m) { offDateMatch = m; break; }
        }
      }
      if (found) {
        matchedDbIds.add(found.id);
      } else {
        bankOnly.push({
          b2Id: item.b2_id,
          generalId: item.general_id,
          docNumber: item.num,
          ddate: item.ddate,
          time: item.time,
          direction: item.dir === 1 ? 'OUT' : item.dir === 2 ? 'IN' : null,
          amount: (item.amount ?? 0) / 100,
          fromAccount: item.acc_dt,
          fromName: item.name_dt,
          toAccount: item.acc_ct,
          toName: item.name_ct,
          purpose: item.purpose,
          // Agar shu tx boshqa sana ostida saqlangan bo'lsa — uni ko'rsatamiz
          // (user "qo'shish" tugmasini bosmasligi uchun — chunki dublikat bo'lmaydi)
          existsOnDate: offDateMatch?.txnDate ? offDateMatch.txnDate.toISOString().slice(0, 10) : undefined,
          existingTxId: offDateMatch?.id,
        });
      }
    }

    const dbOnly = dbItems
      .filter((tx) => !matchedDbIds.has(tx.id))
      .map((tx) => ({
        id: tx.id,
        externalId: tx.externalId,
        b2Id: tx.bankB2Id,
        generalId: tx.bankGeneralId,
        docNumber: tx.docNumber,
        direction: tx.direction,
        amount: Number(tx.amount),
        fromAccount: tx.fromAccount,
        fromName: tx.fromName,
        toAccount: tx.toAccount,
        toName: tx.toName,
        description: tx.description,
      }));

    return {
      ok: true,
      date,
      accountId,
      accountNo: account.accountNo,
      bankCount: bankItems.length,
      dbCount: dbItems.length,
      matchedCount: matchedDbIds.size,
      bankOnly,
      dbOnly,
    };
  }

  /**
   * Diagnose'da topilgan yo'qolgan tranzaksiyani DB ga qo'shadi.
   * Bankdan ushbu kun uchun ma'lumotni qaytadan oladi (eski cache emas, fresh),
   * b2_id yoki general_id orqali kerakli item'ni topib SyncService.upsertOne
   * orqali to'liq logika bilan inserts qiladi (auto-match + categorization
   * shu yerda ham ishlaydi).
   */
  async fixMissing(accountId: string, b2Id?: string, generalId?: string, date?: string) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!b2Id && !generalId) throw new BadRequestException('b2Id yoki generalId kerak');
    if (!date) throw new BadRequestException('date kerak (YYYY-MM-DD)');

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { bank: true, credential: { include: { bank: true } } },
    });
    if (!account) throw new NotFoundException('Hisob topilmadi');
    const cred = account.credential;
    if (!cred) throw new BadRequestException('Hisobga bank ulanishi biriktirilmagan');
    const bank = cred.bank;
    if (bank.apiKind !== 'KAPITALBANK_V3' && bank.apiKind !== 'IPAK_YOLI_V1') {
      throw new BadRequestException("Faqat Kapitalbank va Ipak Yo'li banklar uchun");
    }
    if (!bank.apiBaseUrl) throw new BadRequestException('Bank API manzili sozlanmagan');

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;
    const dateDmy = this.fmtDate(new Date(`${date}T00:00:00+05:00`));

    const res = await this.kb.getDoc1C({
      baseUrl: bank.apiBaseUrl,
      login,
      password,
      branch: account.branch,
      account: account.accountNo,
      date: dateDmy,
      useProxy: cred.useProxy === true,
    });
    const items = res?.content || [];
    const target = items.find(
      (i) => (b2Id && i.b2_id === b2Id) || (generalId && i.general_id === generalId),
    );
    if (!target) {
      throw new NotFoundException(
        `Bankda topilmadi: b2Id=${b2Id || '—'}, generalId=${generalId || '—'}. Ehtimol, bank tomondan o'chirilgan.`,
      );
    }

    const inserted = await this.sync.upsertOne(
      target,
      accountId,
      account.accountNo,
      account.bankId,
      bank.code,
    );

    // Qo'shilgan tranzaksiyani topib externalId qaytaramiz — UI'da copy uchun
    const orConds: any[] = [];
    if (b2Id) orConds.push({ bankB2Id: b2Id });
    if (generalId) orConds.push({ bankGeneralId: generalId });
    const found = orConds.length > 0
      ? await this.prisma.transaction.findFirst({
          where: { accountId, OR: orConds },
          select: { id: true, externalId: true },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    if (inserted) this.invalidateTodayCache();

    return {
      ok: true,
      inserted,
      message: inserted
        ? "Tranzaksiya AllTranzactions'ga qo'shildi"
        : "Tranzaksiya allaqachon AllTranzactions'da mavjud edi",
      transactionId: found?.id || null,
      externalId: found?.externalId || null,
    };
  }

  /**
   * Bir nechta yo'qolgan tranzaksiyani bitta zaprosda DB ga qo'shish.
   * Bank'dan ma'lumotni 1 marta oladi (har bir item uchun alohida emas),
   * keyin har birini upsertOne bilan inserts qiladi va natijalar ro'yxatini
   * qaytaradi — qaysisi muvaffaqiyatli, qaysisi xato bilan + sababi.
   */
  async fixAllMissing(
    accountId: string,
    date: string,
    items: Array<{ b2Id?: string; generalId?: string }>,
  ) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!date) throw new BadRequestException('date kerak (YYYY-MM-DD)');
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException("Items bo'sh — qo'shish uchun hech narsa yo'q");
    }

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { bank: true, credential: { include: { bank: true } } },
    });
    if (!account) throw new NotFoundException('Hisob topilmadi');
    const cred = account.credential;
    if (!cred) throw new BadRequestException('Hisobga bank ulanishi biriktirilmagan');
    const bank = cred.bank;
    if (bank.apiKind !== 'KAPITALBANK_V3' && bank.apiKind !== 'IPAK_YOLI_V1') {
      throw new BadRequestException("Faqat Kapitalbank va Ipak Yo'li banklar uchun");
    }
    if (!bank.apiBaseUrl) throw new BadRequestException('Bank API manzili sozlanmagan');

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;
    const dateDmy = this.fmtDate(new Date(`${date}T00:00:00+05:00`));

    // Bankdan ushbu kun uchun barcha tranzaksiyalarni BIR MARTA olamiz
    let bankItems: any[] = [];
    try {
      const res = await this.kb.getDoc1C({
        baseUrl: bank.apiBaseUrl,
        login,
        password,
        branch: account.branch,
        account: account.accountNo,
        date: dateDmy,
        useProxy: cred.useProxy === true,
      });
      bankItems = res?.content || [];
    } catch (e: any) {
      throw new BadRequestException(`Bankdan ma'lumot olinmadi: ${e?.message || "noma'lum xato"}`);
    }

    const results: Array<{
      b2Id?: string | null; generalId?: string | null;
      ok: boolean; inserted: boolean;
      transactionId: string | null; externalId: string | null;
      error?: string;
    }> = [];

    let okCount = 0;
    let errCount = 0;

    for (const wanted of items) {
      try {
        const target = bankItems.find(
          (i) =>
            (wanted.b2Id && i.b2_id === wanted.b2Id) ||
            (wanted.generalId && i.general_id === wanted.generalId),
        );
        if (!target) {
          results.push({
            b2Id: wanted.b2Id, generalId: wanted.generalId,
            ok: false, inserted: false,
            transactionId: null, externalId: null,
            error: 'Bankda topilmadi (ehtimol, o\'chirilgan)',
          });
          errCount++;
          continue;
        }
        const inserted = await this.sync.upsertOne(
          target,
          accountId,
          account.accountNo,
          account.bankId,
          bank.code,
        );
        // Topib qaytaramiz — eski tx'larda bankB2Id/bankGeneralId null bo'lishi mumkin,
        // shuning uchun composite externalId orqali ham qidiramiz
        const composite = this.sync.makeCompositeId(target, account.accountNo, bank.code);
        const orConds: any[] = [{ externalId: composite }];
        if (wanted.b2Id) {
          orConds.push({ bankB2Id: wanted.b2Id });
          orConds.push({ externalId: wanted.b2Id });
        }
        if (wanted.generalId) {
          orConds.push({ bankGeneralId: wanted.generalId });
          orConds.push({ externalId: wanted.generalId });
        }
        const found = await this.prisma.transaction.findFirst({
          where: { accountId, OR: orConds },
          select: { id: true, externalId: true, txnDate: true },
          orderBy: { createdAt: 'desc' },
        });
        results.push({
          b2Id: wanted.b2Id, generalId: wanted.generalId,
          ok: true, inserted,
          transactionId: found?.id || null,
          externalId: found?.externalId || composite,
          existingDate: !inserted && found?.txnDate
            ? found.txnDate.toISOString().slice(0, 10)
            : undefined,
        });
        okCount++;
      } catch (e: any) {
        results.push({
          b2Id: wanted.b2Id, generalId: wanted.generalId,
          ok: false, inserted: false,
          transactionId: null, externalId: null,
          error: e?.message || "noma'lum xato",
        });
        errCount++;
      }
    }

    if (okCount > 0) this.invalidateTodayCache();

    return {
      ok: true,
      summary: {
        total: items.length,
        ok: okCount,
        error: errCount,
      },
      results,
    };
  }
}
