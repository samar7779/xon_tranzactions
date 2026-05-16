import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

// YYYY-MM-DD ko'rinishidagi sana — Tashkent kunining boshi/oxiri (UTC+5)
// Filtrlash bu yerda bo'lishi shart, aks holda foydalanuvchi tanlagan sana
// UTC sifatida talqin qilinib, kun 5 soatga "siljiydi".
const parseDayStartTashkent = (d: string) => new Date(`${d}T00:00:00+05:00`);
const parseDayEndTashkent   = (d: string) => new Date(`${d}T23:59:59.999+05:00`);

export interface ExportFilters {
  q?: string;
  direction?: string;
  bankId?: string;
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  status?: string;
  matchStatus?: string;
  // Column filterlar (Google Sheets stilida)
  bankIds?: string;
  categoryIds?: string;
  subcategoryIds?: string;
  directions?: string;
  contractStatuses?: string;
  amountMin?: number;
  amountMax?: number;
  hisobNomi?: string;
}

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  /** Vergul bilan ajratilgan string'ni arrayga aylantiradi. Bo'sh bo'lsa null. */
  private parseList(s?: string): string[] | null {
    if (!s) return null;
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  }

  /** ListTransactionsDto'dan Prisma WhereInput yasaydi — list va distinct ham ishlatadi. */
  private buildWhere(query: ListTransactionsDto): any {
    const {
      type, status, direction, bankId, accountId, dateFrom, dateTo, q,
      bankIds, categoryIds, subcategoryIds, directions, contractStatuses,
      amountMin, amountMax, hisobNomi,
    } = query;
    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (direction) where.direction = direction;
    if (bankId) where.bankId = bankId;
    if (accountId) where.accountId = accountId;
    if (dateFrom || dateTo) {
      where.txnDate = {};
      if (dateFrom) where.txnDate.gte = parseDayStartTashkent(dateFrom);
      if (dateTo) where.txnDate.lte = parseDayEndTashkent(dateTo);
    }
    if (q) {
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { fromName: { contains: q, mode: 'insensitive' } },
        { toName: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
        { fromAccount: { contains: q } },
        { toAccount: { contains: q } },
      ];
    }

    // Column filterlar
    const bankIdsList = this.parseList(bankIds);
    if (bankIdsList) where.bankId = { in: bankIdsList };

    const categoryIdsList = this.parseList(categoryIds);
    if (categoryIdsList) where.categoryId = { in: categoryIdsList };

    const subcategoryIdsList = this.parseList(subcategoryIds);
    if (subcategoryIdsList) where.subcategoryId = { in: subcategoryIdsList };

    const directionsList = this.parseList(directions);
    if (directionsList) where.direction = { in: directionsList as any };

    const hisobNomiList = this.parseList(hisobNomi);
    if (hisobNomiList) {
      // Yuboruvchi yoki Qabul qiluvchi nomi — har biri uchun OR
      const conds = hisobNomiList.flatMap((n) => [
        { fromName: { equals: n } },
        { toName: { equals: n } },
      ]);
      if (where.OR) where.AND = [{ OR: where.OR }, { OR: conds }];
      else where.OR = conds;
    }

    if (amountMin != null || amountMax != null) {
      where.amount = {};
      if (amountMin != null) where.amount.gte = amountMin;
      if (amountMax != null) where.amount.lte = amountMax;
    }

    // contractStatuses / contractNumbers — shartnoma raqamlari (vergul bilan)
    // Maxsus qiymatlar:
    //   __NONE__ — NULL contractNumber (shartnomasi yo'q)
    //   __XATO__ — contractNumber bor lekin CrmContract'da topilmagan (xato)
    const csList = this.parseList(contractStatuses);
    if (csList) {
      const includeNone = csList.includes('__NONE__');
      const includeXato = csList.includes('__XATO__');
      const nums = csList.filter((s) => s !== '__NONE__' && s !== '__XATO__');
      const conds: any[] = [];
      if (nums.length > 0) conds.push({ contractNumber: { in: nums } });
      if (includeNone) conds.push({ contractNumber: null });
      // __XATO__ — Prisma'da to'g'ridan-to'g'ri JOIN yo'q, shuning uchun Set yondashuvi:
      // Bu yerda faqat 'contractNumber not null' qo'shamiz, post-filter qilamiz
      // (haqiqiy aniq emas, lekin verifiedSet ham yetishishi mumkin emas list endpoint'da)
      // Yaxshiroq: maxsus marker'ni keyin (this.list ichida) qayta ishlaymiz
      if (includeXato) {
        (where as any).__xato_requested = true;
      }
      if (conds.length > 0) {
        if (where.OR) where.AND = [{ OR: where.OR }, { OR: conds }];
        else where.OR = conds;
      }
    }

    return where;
  }

  /**
   * __xato_requested marker bo'lsa, verified contractNumber'larni topib OR shartiga qo'shamiz.
   * (buildWhere'da JOIN qilolmaymiz, shuning uchun bu yerda alohida ishlaymiz)
   */
  private async applyXatoFilter(where: any): Promise<any> {
    if (!where.__xato_requested) return where;
    delete where.__xato_requested;
    // Verified shartnomalar ro'yxati
    const verified = await this.prisma.crmContract.findMany({
      where: { found: true },
      select: { contractNumber: true },
    });
    const verifiedList = verified.map((c) => c.contractNumber);
    // Xato shart: contractNumber bor + verified ro'yxatda yo'q
    const xatoCond = {
      AND: [{ contractNumber: { not: null } }, { contractNumber: { notIn: verifiedList } }],
    };
    // Mavjud OR'ga qo'shamiz
    if (where.OR) {
      where.OR.push(xatoCond);
    } else if (where.AND) {
      // AND ichida OR bo'lishi mumkin — kerak bo'lsa qayta yig'amiz
      where.OR = [xatoCond];
    } else {
      where.OR = [xatoCond];
    }
    return where;
  }

  async list(query: ListTransactionsDto) {
    const { page = 1, perPage = 50 } = query;
    let where = this.buildWhere(query);
    where = await this.applyXatoFilter(where);

    const [total, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        // Sana → vaqt → ID bo'yicha kamayish: eng yangi tepada
        orderBy: [
          { txnDate: 'desc' },
          { inputAt: 'desc' },
          { operationTime: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          bank: { select: { id: true, code: true, name: true } },
          account: {
            select: {
              id: true, branch: true, accountNo: true, ownerName: true,
              bank: { select: { id: true, code: true, name: true } },
            },
          },
          category: true,
          subcategory: true,
        },
      }),
    ]);

    // ── Enrichment: counterpartyDisplay (firma nomi) + contractStatus
    // 1) Boshqa tomon INN/account/shartnomalarini yig'amiz
    const otherInns = new Set<string>();
    const otherAccs = new Set<string>();
    const contractNums = new Set<string>();
    for (const tx of items) {
      const inn = tx.direction === 'IN' ? tx.fromInn : tx.toInn;
      const acc = tx.direction === 'IN' ? tx.fromAccount : tx.toAccount;
      if (inn) otherInns.add(inn);
      if (acc) otherAccs.add(acc);
      if (tx.contractNumber) contractNums.add(tx.contractNumber);
    }
    // 2) Counterparty + BankAccount + CrmContract jadvallaridan bir martalik yig'ib olamiz
    const [counterparties, ownAccs, crmContracts] = await Promise.all([
      otherInns.size > 0
        ? this.prisma.counterparty.findMany({
            where: { inn: { in: Array.from(otherInns) } },
            select: { inn: true, name: true },
          })
        : Promise.resolve([]),
      otherAccs.size > 0
        ? this.prisma.bankAccount.findMany({
            where: { accountNo: { in: Array.from(otherAccs) } },
            select: { accountNo: true, ownerName: true },
          })
        : Promise.resolve([]),
      contractNums.size > 0
        ? this.prisma.crmContract.findMany({
            where: { contractNumber: { in: Array.from(contractNums) } },
            select: { contractNumber: true, found: true, customerName: true, objectName: true },
          })
        : Promise.resolve([]),
    ]);
    const cpByInn = new Map(counterparties.map((c) => [c.inn, c.name]));
    const accByNo = new Map(ownAccs.map((a) => [a.accountNo, a.ownerName]));
    const crmByContract = new Map(crmContracts.map((c) => [c.contractNumber, c]));

    // 3) Har bir tx'ga counterpartyDisplay maydonini qo'shamiz
    // Logika:
    //   - TRANSFER (Переброска) → BankAccount.ownerName (LEVEL UP-STROY)
    //   - COUNTERPARTY (matched specific firm) → Counterparty.name (GREATCITY, BARAKAT)
    //   - Boshqa kategoriyalar (CLIENT/BANK/MINFIN/SALARY/LOAN) → kategoriya nomi
    //   - Kategoriya yo'q → null
    const enriched = items.map((tx: any) => {
      const inn = tx.direction === 'IN' ? tx.fromInn : tx.toInn;
      const acc = tx.direction === 'IN' ? tx.fromAccount : tx.toAccount;
      const code = tx.category?.code;

      // Shartnoma holati + CRM mijoz nomi
      let contractStatus: 'verified' | 'unverified' | null = null;
      let contractCustomer: string | null = null;
      if (tx.contractNumber) {
        const crm = crmByContract.get(tx.contractNumber);
        if (crm) {
          contractStatus = crm.found ? 'verified' : 'unverified';
          contractCustomer = crm.customerName || null;
        } else {
          contractStatus = 'unverified';
        }
      }

      // counterpartyDisplay — legacy F ustun (Excel) bilan moslangan:
      //   1) Specific entity bor bo'lsa — uni ko'rsatamiz (eng aniq)
      //      - CLIENT (CRM verified) → mijoz nomi (Ivanov Ivan)
      //      - TRANSFER → o'z bank hisobimiz egasi (LEVEL UP-STROY)
      //      - COUNTERPARTY → Counterparty.name (GREATCITY, BARAKAT)
      //   2) Aks holda — kategoriya nomi (placeholder turi)
      //      "Банк", "Клиент / Физ.Л / Юр.Л", "Молия Вазирлиги", "Зарплата"
      //   3) Kategoriya ham yo'q → null
      let counterpartyDisplay: string | null = null;
      if (code === 'CLIENT') {
        counterpartyDisplay = contractCustomer || tx.category?.name || null;
      } else if (code === 'TRANSFER') {
        counterpartyDisplay = (acc && accByNo.get(acc)) || tx.category?.name || null;
      } else if (code === 'COUNTERPARTY') {
        counterpartyDisplay = (inn && cpByInn.get(inn)) || tx.category?.name || null;
      } else if (tx.category?.name) {
        // BANK / MINFIN / SALARY / LOAN / COUNTERPARTY_RETURN
        counterpartyDisplay = tx.category.name;
      }
      return { ...tx, counterpartyDisplay, contractStatus, contractCustomer };
    });

    return { ok: true, total, page, perPage, items: enriched };
  }

  /**
   * Ustun bo'yicha distinct qiymatlar — Google Sheets stilida filter uchun.
   * MUHIM: boshqa aktiv filterlar (dateFrom/To, q, boshqa ustun filterlari) inobatga olinadi.
   * Faqat O'Z filteri istisno qilinadi — shunda foydalanuvchi qaytadan tanlash imkoniga ega.
   * @param search — qisman matn bo'yicha qidirish (limit'dan tashqarisini topish uchun)
   */
  async distinctValues(column: string, query: ListTransactionsDto, search?: string): Promise<{ ok: true; values: Array<{ id: string; name: string }> }> {
    // Ustun nomidan tegishli filter paramini chiqarib tashlash (self-exclusion)
    const COLUMN_TO_PARAM: Record<string, string> = {
      bank: 'bankIds',
      kontragent: 'categoryIds',
      kategoriya: 'subcategoryIds',
      direction: 'directions',
      contractStatus: 'contractStatuses',
      contractNumber: 'contractStatuses',
      hisobNomi: 'hisobNomi',
    };
    const selfParam = COLUMN_TO_PARAM[column];
    const queryExcludingSelf: any = { ...query };
    if (selfParam) delete queryExcludingSelf[selfParam];
    let where = this.buildWhere(queryExcludingSelf);
    where = await this.applyXatoFilter(where);

    switch (column) {
      case 'bank': {
        const txs = await this.prisma.transaction.findMany({
          where, distinct: ['bankId'], select: { bankId: true }, take: 1000,
        });
        const ids = txs.map((t) => t.bankId).filter(Boolean) as string[];
        if (ids.length === 0) return { ok: true, values: [] };
        const banks = await this.prisma.bank.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        });
        return { ok: true, values: banks.map((b) => ({ id: b.id, name: b.name })) };
      }
      case 'kontragent': {
        // Aktiv filter'lar ostida tranzaksiyalarda mavjud top kategoriyalar
        const txs = await this.prisma.transaction.findMany({
          where: { ...where, categoryId: { not: null } },
          distinct: ['categoryId'], select: { categoryId: true }, take: 100,
        });
        const ids = txs.map((t) => t.categoryId!).filter(Boolean);
        if (ids.length === 0) return { ok: true, values: [] };
        const cats = await this.prisma.category.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        });
        return { ok: true, values: cats.map((c) => ({ id: c.id, name: c.name })) };
      }
      case 'kategoriya': {
        const txs = await this.prisma.transaction.findMany({
          where: { ...where, subcategoryId: { not: null } },
          distinct: ['subcategoryId'], select: { subcategoryId: true }, take: 200,
        });
        const ids = txs.map((t) => t.subcategoryId!).filter(Boolean);
        if (ids.length === 0) return { ok: true, values: [] };
        const subs = await this.prisma.category.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, parent: { select: { name: true } }, sortOrder: true },
          orderBy: { sortOrder: 'asc' },
        });
        return {
          ok: true,
          values: subs.map((s) => ({ id: s.id, name: s.parent ? `${s.parent.name} / ${s.name}` : s.name })),
        };
      }
      case 'direction': {
        // Aktiv filter'lar ostida qaysi yo'nalishlar mavjud
        const txs = await this.prisma.transaction.findMany({
          where, distinct: ['direction'], select: { direction: true }, take: 10,
        });
        const set = new Set(txs.map((t) => t.direction));
        const values: Array<{ id: string; name: string }> = [];
        if (set.has('IN' as any)) values.push({ id: 'IN', name: 'Kirim' });
        if (set.has('OUT' as any)) values.push({ id: 'OUT', name: 'Chiqim' });
        return { ok: true, values };
      }
      case 'contractStatus':
      case 'contractNumber': {
        // Faqat VERIFIED shartnomalar individual ko'rsatiladi (mijoz bergan xato raqamlar emas)
        // Xato bo'lganlar bitta "__XATO__" entry'siga guruhlanadi
        // search bo'lsa, filter qilamiz (limit 500 dan ortig'ini ham topadi)

        // 1) Verified shartnomalar — CrmContract found=true bo'lgan
        const verifiedRows = await this.prisma.crmContract.findMany({
          where: { found: true },
          select: { contractNumber: true, customerName: true },
        });
        const verifiedSet = new Set(verifiedRows.map((c) => c.contractNumber));

        // 2) Tranzaksiyalardagi distinct contractNumber'lar (search bilan filter)
        const txWhere: any = { ...where, contractNumber: { not: null } };
        if (search) {
          // Search — case-insensitive contains
          txWhere.contractNumber = { not: null, contains: search.toUpperCase(), mode: 'insensitive' };
        }
        const txs = await this.prisma.transaction.findMany({
          where: txWhere,
          distinct: ['contractNumber'],
          select: { contractNumber: true },
          orderBy: { contractNumber: 'asc' },
          take: search ? 100 : 500,
        });
        const allUsedContracts = txs.map((t) => t.contractNumber!).filter(Boolean);

        // Tranzaksiyalarda ishlatilgan verified shartnomalar (mijoz nomi bilan)
        const usedVerified = allUsedContracts.filter((c) => verifiedSet.has(c));
        const customerMap = new Map(verifiedRows.map((c) => [c.contractNumber, c.customerName]));
        const values: Array<{ id: string; name: string }> = usedVerified.map((c) => {
          const cust = customerMap.get(c);
          return { id: c, name: cust ? `${c} — ${cust.slice(0, 40)}` : c };
        });

        // 3) Xato (unverified) bo'lganlar — bittagina entry
        const hasUnverified = allUsedContracts.some((c) => !verifiedSet.has(c));
        if (hasUnverified && !search) {
          const unverifiedCount = allUsedContracts.filter((c) => !verifiedSet.has(c)).length;
          values.unshift({ id: '__XATO__', name: `⚠ Xato (CRM tasdiqlamagan, ${unverifiedCount} ta)` });
        }

        // 4) Bo'sh (shartnomasi yo'q)
        if (!search) {
          const anyEmpty = await this.prisma.transaction.findFirst({
            where: { ...where, contractNumber: null },
            select: { id: true },
          });
          if (anyEmpty) values.unshift({ id: '__NONE__', name: "— Shartnoma yo'q" });
        }

        return { ok: true, values };
      }
      case 'hisobNomi': {
        // Yuboruvchi va Qabul qiluvchi nomlari — distinct (limit 500)
        const [fromList, toList] = await Promise.all([
          this.prisma.transaction.findMany({
            where, distinct: ['fromName'], select: { fromName: true }, take: 500,
          }),
          this.prisma.transaction.findMany({
            where, distinct: ['toName'], select: { toName: true }, take: 500,
          }),
        ]);
        const set = new Set<string>();
        for (const r of fromList) if (r.fromName) set.add(r.fromName);
        for (const r of toList) if (r.toName) set.add(r.toName);
        const arr = Array.from(set).sort();
        return { ok: true, values: arr.map((n) => ({ id: n, name: n })) };
      }
      default:
        return { ok: true, values: [] };
    }
  }

  /**
   * Hisob raqami bo'yicha tranzaksiyalar sonini olish (cleanup oldidan ko'rsatish uchun).
   */
  async countByAccountNo(accountNo: string) {
    const acc = await this.prisma.bankAccount.findFirst({
      where: { accountNo },
      select: {
        id: true, accountNo: true, ownerName: true, branch: true, balance: true, currency: true,
        bank: { select: { id: true, code: true, name: true } },
      },
    });
    if (!acc) return { ok: false, error: 'Bunday hisob raqami topilmadi' };
    const [count, payments, lastTxn, firstTxn] = await Promise.all([
      this.prisma.transaction.count({ where: { accountId: acc.id } }),
      this.prisma.payment.count({ where: { transaction: { accountId: acc.id } } }),
      this.prisma.transaction.findFirst({
        where: { accountId: acc.id },
        orderBy: { txnDate: 'desc' },
        select: { txnDate: true },
      }),
      this.prisma.transaction.findFirst({
        where: { accountId: acc.id },
        orderBy: { txnDate: 'asc' },
        select: { txnDate: true },
      }),
    ]);
    return {
      ok: true,
      account: acc,
      count,
      paymentsCount: payments,
      firstTxnDate: firstTxn?.txnDate || null,
      lastTxnDate: lastTxn?.txnDate || null,
    };
  }

  /**
   * Hisob raqami bo'yicha barcha tranzaksiyalarni o'chirish.
   * Bog'liq Payment yozuvlarini ham birga o'chiradi (avval).
   * Hisob raqamining o'zi DB'dan o'chmaydi — faqat tranzaksiyalar.
   */
  async deleteByAccountNo(accountNo: string) {
    const acc = await this.prisma.bankAccount.findFirst({
      where: { accountNo },
      select: { id: true, accountNo: true, ownerName: true, branch: true },
    });
    if (!acc) return { ok: false, error: 'Bunday hisob raqami topilmadi' };

    // Bog'liq payment'larni avval o'chiramiz (FK cascade'siz)
    const txnIds = await this.prisma.transaction.findMany({
      where: { accountId: acc.id },
      select: { id: true },
    });
    const ids = txnIds.map((t) => t.id);
    if (ids.length === 0) {
      return { ok: true, deleted: 0, account: acc };
    }
    await this.prisma.payment.deleteMany({ where: { transactionId: { in: ids } } });
    const res = await this.prisma.transaction.deleteMany({ where: { accountId: acc.id } });
    // Hisob qoldig'ini tiklash (foydalanuvchi keyingi sync'da o'qiydi)
    await this.prisma.bankAccount.update({
      where: { id: acc.id },
      data: { balance: null, lastSyncedAt: null },
    });
    return { ok: true, deleted: res.count, account: acc };
  }

  async findOne(idOrExternal: string) {
    // Ichki id yoki bank bergan kompozit externalId bo'yicha qidiramiz
    const tx: any = await this.prisma.transaction.findFirst({
      where: { OR: [{ id: idOrExternal }, { externalId: idOrExternal }] },
      include: {
        bank: true,
        account: true,
        category: true,
        subcategory: true,
      },
    });
    if (!tx) return null;
    // Enrichment (list bilan bir xil mantiq)
    const inn = tx.direction === 'IN' ? tx.fromInn : tx.toInn;
    const acc = tx.direction === 'IN' ? tx.fromAccount : tx.toAccount;
    const code = tx.category?.code;

    const [cpRow, accRow, crmRow] = await Promise.all([
      inn ? this.prisma.counterparty.findUnique({ where: { inn }, select: { name: true } }) : Promise.resolve(null),
      acc ? this.prisma.bankAccount.findFirst({ where: { accountNo: acc }, select: { ownerName: true } }) : Promise.resolve(null),
      tx.contractNumber
        ? this.prisma.crmContract.findUnique({
            where: { contractNumber: tx.contractNumber },
            select: { found: true, customerName: true, objectName: true },
          })
        : Promise.resolve(null),
    ]);

    let contractStatus: 'verified' | 'unverified' | null = null;
    let contractCustomer: string | null = null;
    if (tx.contractNumber) {
      if (crmRow) {
        contractStatus = crmRow.found ? 'verified' : 'unverified';
        contractCustomer = crmRow.customerName || null;
      } else {
        contractStatus = 'unverified';
      }
    }

    let counterpartyDisplay: string | null = null;
    if (code === 'CLIENT') counterpartyDisplay = contractCustomer || null;
    else if (code === 'TRANSFER') counterpartyDisplay = accRow?.ownerName || null;
    else if (code === 'COUNTERPARTY') counterpartyDisplay = cpRow?.name || null;

    return { ...tx, counterpartyDisplay, contractStatus, contractCustomer };
  }

  /**
   * Kunma-kun kirim/chiqim — dashboard diagrammasi uchun.
   * Sana oralig'i berilmasa — oxirgi 30 kun. bankId/accountId bilan filtrlanadi.
   * Har bir kun to'ldiriladi (tranzaksiyasiz kunlar ham 0 bilan), grafik uzluksiz bo'lishi uchun.
   */
  async daily(from?: string, to?: string, bankId?: string, accountId?: string) {
    // Tashkent kuni asosida ishlaymiz — backend serveri qaysi TZ'da bo'lishidan qat'i nazar
    const TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5
    const tashkentToday = (() => {
      const d = new Date(Date.now() + TZ_OFFSET_MS);
      return d.toISOString().slice(0, 10);
    })();
    const endStr = to || tashkentToday;
    const startStr = from || (() => {
      const d = new Date(`${endStr}T00:00:00+05:00`);
      d.setUTCDate(d.getUTCDate() - 29);
      return d.toISOString().slice(0, 10);
    })();

    const start = new Date(`${startStr}T00:00:00+05:00`);
    const end   = new Date(`${endStr}T23:59:59.999+05:00`);

    const where: any = { txnDate: { gte: start, lte: end } };
    if (bankId) where.bankId = bankId;
    if (accountId) where.accountId = accountId;

    const txns = await this.prisma.transaction.findMany({
      where,
      select: { txnDate: true, direction: true, amount: true },
    });

    // Bucket key — Tashkent kun (YYYY-MM-DD), UTC emas
    const toTashkentKey = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

    const map = new Map<string, { inflow: number; outflow: number; count: number }>();
    for (const t of txns) {
      const key = toTashkentKey(t.txnDate);
      const e = map.get(key) || { inflow: 0, outflow: 0, count: 0 };
      const amt = Number(t.amount);
      if (t.direction === 'IN') e.inflow += amt;
      else e.outflow += amt;
      e.count += 1;
      map.set(key, e);
    }

    const days: { date: string; inflow: number; outflow: number; net: number; count: number }[] = [];
    let cursor = new Date(`${startStr}T00:00:00+05:00`);
    const limit = new Date(`${endStr}T00:00:00+05:00`);
    while (cursor <= limit) {
      const key = toTashkentKey(cursor);
      const e = map.get(key) || { inflow: 0, outflow: 0, count: 0 };
      days.push({ date: key, inflow: e.inflow, outflow: e.outflow, net: e.inflow - e.outflow, count: e.count });
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }

    const totalIn = days.reduce((s, d) => s + d.inflow, 0);
    const totalOut = days.reduce((s, d) => s + d.outflow, 0);
    return { ok: true, from: startStr, to: endStr, totalIn, totalOut, net: totalIn - totalOut, days };
  }

  /**
   * Tranzaksiyalarni filtr bo'yicha Excel qilib eksport — sahifalanmagan,
   * barcha mos yozuvlar (xavfsizlik uchun 50 000 ta bilan cheklangan).
   */
  async exportXlsx(filters: ExportFilters) {
    // buildWhere bilan bir xil mantiqdan foydalanish — list bilan moslangan
    const where: any = this.buildWhere(filters as any);
    if (filters.matchStatus) where.matchStatus = filters.matchStatus;

    const items = await this.prisma.transaction.findMany({
      where,
      orderBy: [
        { txnDate: 'desc' },
        { inputAt: 'desc' },
        { operationTime: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 50000,
      include: {
        bank: { select: { name: true } },
        account: {
          select: {
            accountNo: true, ownerName: true,
            bank: { select: { name: true } },
          },
        },
        category: true,
        subcategory: true,
      },
    });

    // Kontragent display uchun bir martalik join'lar
    const otherInns = new Set<string>();
    const otherAccs = new Set<string>();
    for (const tx of items as any[]) {
      const inn = tx.direction === 'IN' ? tx.fromInn : tx.toInn;
      const acc = tx.direction === 'IN' ? tx.fromAccount : tx.toAccount;
      if (inn) otherInns.add(inn);
      if (acc) otherAccs.add(acc);
    }
    const [cpRows, accRows] = await Promise.all([
      otherInns.size > 0
        ? this.prisma.counterparty.findMany({ where: { inn: { in: Array.from(otherInns) } }, select: { inn: true, name: true } })
        : Promise.resolve([]),
      otherAccs.size > 0
        ? this.prisma.bankAccount.findMany({ where: { accountNo: { in: Array.from(otherAccs) } }, select: { accountNo: true, ownerName: true } })
        : Promise.resolve([]),
    ]);
    const cpByInn = new Map(cpRows.map((c) => [c.inn, c.name]));
    const accByNo = new Map(accRows.map((a) => [a.accountNo, a.ownerName]));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('Tranzaksiyalar');

    ws.columns = [
      { header: 'Bank nomi', key: 'bank', width: 22 },
      { header: 'Hisob raqami', key: 'accountNo', width: 26 },
      { header: 'Hisob nomi', key: 'accountName', width: 32 },
      { header: 'Sana', key: 'date', width: 12 },
      { header: 'Vaqt', key: 'time', width: 10 },
      { header: 'Yuboruvchi nomi', key: 'fromName', width: 32 },
      { header: "Yo'nalish", key: 'direction', width: 12 },
      { header: 'Kontragent', key: 'kontragent', width: 28 },
      { header: 'Kategoriya', key: 'kategoriya', width: 28 },
      { header: 'Shartnoma', key: 'shartnoma', width: 18 },
      { header: 'Summa', key: 'amount', width: 18 },
      { header: "Izoh (to'lov maqsadi)", key: 'description', width: 50 },
      { header: 'Tranzaksiya ID', key: 'externalId', width: 30 },
    ];

    // Sarlavha qatorini bezash
    const headRow = ws.getRow(1);
    headRow.font = { bold: true, size: 10 };
    headRow.height = 22;
    headRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    for (const it of items as any[]) {
      // Kontragent display (list bilan bir xil mantiq)
      const inn = it.direction === 'IN' ? it.fromInn : it.toInn;
      const acc = it.direction === 'IN' ? it.fromAccount : it.toAccount;
      const code = it.category?.code;
      let kontragent = '';
      if (code === 'TRANSFER') kontragent = (acc && accByNo.get(acc)) || it.category?.name || '';
      else if (code === 'COUNTERPARTY') kontragent = (inn && cpByInn.get(inn)) || it.category?.name || '';
      else if (it.category?.name) kontragent = it.category.name;
      // Kategoriya = subcategory.name yoki category.name (TRANSFER/SALARY uchun)
      const kategoriya = it.subcategory?.name || it.category?.name || '';
      // Sana — dd.MM.yyyy (Tashkent kuni asosida), Vaqt — alohida ustun (HH:mm)
      let date = '';
      if (it.txnDate) {
        const d = new Date(it.txnDate);
        // Tashkent (UTC+5) kuni — server TZ'dan qat'i nazar
        const tz = new Date(d.getTime() + 5 * 60 * 60 * 1000);
        const dd = String(tz.getUTCDate()).padStart(2, '0');
        const mm = String(tz.getUTCMonth() + 1).padStart(2, '0');
        const yyyy = tz.getUTCFullYear();
        date = `${dd}.${mm}.${yyyy}`;
      }
      const time = it.operationTime ? it.operationTime.slice(0, 5) : '';

      const row = ws.addRow({
        bank: it.bank?.name || it.account?.bank?.name || '',
        accountNo: it.account?.accountNo || '',
        accountName: it.account?.ownerName || '',
        date,
        time,
        fromName: it.fromName || '',
        direction: it.direction === 'IN' ? 'Kirim' : 'Chiqim',
        kontragent,
        kategoriya,
        shartnoma: it.contractNumber || '',
        amount: Number(it.amount),
        description: it.description || '',
        externalId: it.externalId || it.id,
      });
      row.font = { size: 9 };
      row.getCell('amount').numFmt = '#,##0.00';
      row.getCell('amount').font = {
        size: 9,
        color: { argb: it.direction === 'IN' ? 'FF047857' : 'FFBE123C' },
      };
      // Sana va Vaqt — Excel auto-format'siz (text), markazlashtirilgan
      const dateCell = row.getCell('date');
      dateCell.numFmt = '@';
      dateCell.alignment = { horizontal: 'center', vertical: 'middle' };
      const timeCell = row.getCell('time');
      timeCell.numFmt = '@';
      timeCell.alignment = { horizontal: 'center', vertical: 'middle' };
      // Shartnoma — monospace ko'rinish uchun
      if (it.contractNumber) {
        row.getCell('shartnoma').font = { name: 'Consolas', size: 9, bold: true };
      }
    }

    const raw = await wb.xlsx.writeBuffer();
    const buffer: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const filename = `tranzaksiyalar_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { buffer, filename, count: items.length };
  }

  async stats(dateFrom?: string, dateTo?: string, categoryCode?: string) {
    const where: any = {};
    if (dateFrom || dateTo) {
      where.txnDate = {};
      if (dateFrom) where.txnDate.gte = parseDayStartTashkent(dateFrom);
      if (dateTo) where.txnDate.lte = parseDayEndTashkent(dateTo);
    }
    // Kategoriya bo'yicha filter (masalan: CLIENT — faqat Klient/Fiz.L/Yur.L tranzaksiyalari)
    if (categoryCode) {
      const cat = await this.prisma.category.findUnique({
        where: { code: categoryCode },
        select: { id: true },
      });
      if (cat) where.categoryId = cat.id;
      else where.categoryId = '__nonexistent__'; // 0 ta yozuv qaytarish uchun
    }
    const [grouped, total, byBank] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['direction', 'status'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.groupBy({
        by: ['bankId', 'direction'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    return { ok: true, total, groups: grouped, byBank };
  }
}
