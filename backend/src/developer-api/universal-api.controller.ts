import { Controller, Get, Query, Res, UseGuards, UseInterceptors, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma/prisma.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { StatementService } from '../transactions/statement.service';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { ApiLoggerInterceptor } from './interceptors/api-logger.interceptor';
import { RequireApiScopes } from './decorators/api-scopes.decorator';
import { API_SCOPES } from './api-scopes';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * UNIVERSAL API — bitta scope bilan uchta asosiy hisobot
 * ═══════════════════════════════════════════════════════════════════════
 * Tashqi tizim (1C, ERP, BI) shu yerdan panel bilan BIR XIL ma'lumotni oladi:
 *
 *   1) Obyektlar bo'yicha to'lovlar — sana yoki sana oralig'i + panel filtrlari
 *      (За счётчик, Возврат, bank, тип жил/пар, CRM status, сотув бўлими),
 *      shartnoma kesimi va alohida to'lov qatorlarigacha.
 *   2) Bank hisoblari — qoldiq bilan, bank bo'yicha filtr va jamlar.
 *   3) Vipiska — hisob + sana oralig'i bo'yicha tranzaksiyalar va jamlar.
 *
 * ⚠️ FAQAT O'QISH. Bank login/parol, API kalit va shaxsiy ma'lumot qaytarilmaydi.
 *
 * Sana formati: YYYY-MM-DD. `date` berilsa — o'sha bitta kun.
 * Ro'yxat filtrlar vergul bilan: crmStatuses=Сотилди,Бартер
 */
@ApiTags('developer-api · universal')
@UseGuards(ApiKeyAuthGuard)
@UseInterceptors(ApiLoggerInterceptor)
@Controller('v1/universal')
export class UniversalApiController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oplataKv: OplataKvService,
    private readonly statementSvc: StatementService,
  ) {}

  /** Toshkent (UTC+5) bo'yicha bugungi kun — YYYY-MM-DD. */
  private bugun(): string {
    return new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10);
  }

  /** `date` berilsa bitta kunga aylantiradi; aks holda dateFrom/dateTo. */
  private sanalar(date?: string, dateFrom?: string, dateTo?: string) {
    const d = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s.trim()) ? s.trim() : undefined);
    const one = d(date);
    if (one) return { dateFrom: one, dateTo: one };
    const from = d(dateFrom);
    const to = d(dateTo);
    if ((dateFrom && !from) || (dateTo && !to) || (date && !one)) {
      throw new BadRequestException('Sana formati YYYY-MM-DD bo\'lishi kerak');
    }
    return { dateFrom: from, dateTo: to };
  }

  private bool(v?: string): boolean {
    return v === '1' || v === 'true' || v === 'yes';
  }

  // ═══════════════ 1-QOIDA: OBYEKTLAR BO'YICHA TO'LOVLAR ═══════════════

  @Get('objects')
  @RequireApiScopes(API_SCOPES.UNIVERSAL_READ)
  @ApiOperation({
    summary: "Obyektlar bo'yicha to'lovlar (panel hisoboti bilan bir xil)",
    description:
      "Parametrlar: date | dateFrom & dateTo, mode=normal|refund, includeSchotchik=1, " +
      "crmStatuses, propertyTypes (apartment|parking), branches, banks (bank id yoki __none__), " +
      "withContracts=1 — har obyekt ichida shartnomalar kesimi ham qaytadi.",
  })
  async objects(
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('mode') mode?: 'normal' | 'refund',
    @Query('includeSchotchik') includeSchotchik?: string,
    @Query('crmStatuses') crmStatuses?: string,
    @Query('propertyTypes') propertyTypes?: string,
    @Query('branches') branches?: string,
    @Query('banks') banks?: string,
    @Query('withContracts') withContracts?: string,
  ) {
    const opts = {
      ...this.sanalar(date, dateFrom, dateTo),
      mode: mode === 'refund' ? ('refund' as const) : ('normal' as const),
      includeSchotchik: this.bool(includeSchotchik),
      crmStatuses, propertyTypes, branches, banks,
    };
    const res = await this.oplataKv.byObject(opts);

    if (!this.bool(withContracts)) {
      return { ok: true, filter: opts, total: res.total, items: res.rows };
    }

    // Shartnoma kesimini obyektlar ichiga joylaymiz
    const c = await this.oplataKv.byObjectContracts(opts);
    const byObj = new Map<string, any[]>();
    for (const r of c.rows) {
      const arr = byObj.get(r.object);
      if (arr) arr.push(r); else byObj.set(r.object, [r]);
    }
    return {
      ok: true,
      filter: opts,
      total: res.total,
      items: res.rows.map((r) => ({
        ...r,
        contracts: (byObj.get(r.object) || []).map((x) => ({
          contractNo: x.contractNo,
          client: x.client,
          paymentAmount: x.paymentAmount,
          firstInstallment: x.firstInstallment,
          monthlyAmount: x.monthlyAmount,
          count: x.count,
        })),
      })),
    };
  }

  @Get('objects/contracts')
  @RequireApiScopes(API_SCOPES.UNIVERSAL_READ)
  @ApiOperation({
    summary: "Shartnoma kesimi — to'lovlar qaysi shartnomalardan tushgan",
    description: "Obyekt hisoboti bilan bir xil filtrlar. `object` berilsa faqat o'sha obyekt.",
  })
  async objectContracts(
    @Query('object') object?: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('mode') mode?: 'normal' | 'refund',
    @Query('includeSchotchik') includeSchotchik?: string,
    @Query('crmStatuses') crmStatuses?: string,
    @Query('propertyTypes') propertyTypes?: string,
    @Query('branches') branches?: string,
    @Query('banks') banks?: string,
  ) {
    const opts = {
      ...this.sanalar(date, dateFrom, dateTo),
      mode: mode === 'refund' ? ('refund' as const) : ('normal' as const),
      includeSchotchik: this.bool(includeSchotchik),
      crmStatuses, propertyTypes, branches, banks, object,
    };
    const res = await this.oplataKv.byObjectContracts(opts);
    return { ok: true, filter: opts, total: res.total, items: res.rows };
  }

  @Get('objects/payments')
  @RequireApiScopes(API_SCOPES.UNIVERSAL_READ)
  @ApiOperation({
    summary: "Alohida to'lov qatorlari (drill-down)",
    description: "`object` — aniq obyekt, `—` obyektsizlar, bo'sh/`__ALL__` hammasi. Filtrlar yuqoridagidek.",
  })
  async objectPayments(
    @Query('object') object?: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('mode') mode?: 'normal' | 'refund',
    @Query('includeSchotchik') includeSchotchik?: string,
    @Query('crmStatuses') crmStatuses?: string,
    @Query('propertyTypes') propertyTypes?: string,
    @Query('branches') branches?: string,
    @Query('banks') banks?: string,
  ) {
    const opts = {
      object: object && object.trim() ? object.trim() : '__ALL__',
      ...this.sanalar(date, dateFrom, dateTo),
      mode: mode === 'refund' ? ('refund' as const) : ('normal' as const),
      includeSchotchik: this.bool(includeSchotchik),
      crmStatuses, propertyTypes, branches, banks,
    };
    const res = await this.oplataKv.byObjectDetail(opts);
    return {
      ok: true,
      filter: opts,
      count: res.count,
      truncated: res.truncated,
      total: res.total,
      items: res.rows.map((r: any) => ({
        id: r.id,
        contractNo: r.contractNo,
        client: r.client,
        object: r.object,
        date: r.date,
        paymentAmount: r.paymentAmount != null ? Number(r.paymentAmount) : null,
        firstInstallment: r.firstInstallment != null ? Number(r.firstInstallment) : null,
        monthlyAmount: r.monthlyAmount != null ? Number(r.monthlyAmount) : null,
        paymentCategory: r.paymentCategory,
        txType: r.txType,
        purpose: r.purpose,
        paymentMethod: r.paymentMethod,
      })),
    };
  }

  // ═══════════════ 2-QOIDA: BANK HISOBLARI VA QOLDIQ ═══════════════

  @Get('accounts')
  @RequireApiScopes(API_SCOPES.UNIVERSAL_READ)
  @ApiOperation({
    summary: 'Bank hisoblari va qoldiqlar',
    description:
      "Standart: FAQAT faol banklar. Parametrlar: bank (kod yoki id, vergul bilan), " +
      "allBanks=1 — nofaol banklar ham, syncOnly=1 — faqat sync yoqilganlar, q — qidiruv. " +
      "Javobda umumiy jami va bank kesimi ham bor. Login/parol BERILMAYDI.",
  })
  async accounts(
    @Query('bank') bank?: string,
    @Query('allBanks') allBanks?: string,
    @Query('syncOnly') syncOnly?: string,
    @Query('q') q?: string,
  ) {
    const where: any = {};
    if (!this.bool(allBanks)) where.bank = { isActive: true };
    if (bank && bank.trim()) {
      const list = bank.split(',').map((x) => x.trim()).filter(Boolean);
      where.bank = { ...(where.bank || {}), OR: [{ code: { in: list } }, { id: { in: list } }] };
    }
    if (this.bool(syncOnly)) where.syncEnabled = true;
    if (q && q.trim()) {
      const t = q.trim();
      where.OR = [
        { accountNo: { contains: t } },
        { ownerName: { contains: t, mode: 'insensitive' } },
      ];
    }

    const items = await this.prisma.bankAccount.findMany({
      where,
      orderBy: [{ ownerName: 'asc' }, { accountNo: 'asc' }],
      select: {
        id: true, accountNo: true, branch: true, ownerName: true, currency: true,
        balance: true, syncEnabled: true, lastSyncedAt: true,
        bank: { select: { id: true, code: true, name: true, isActive: true } },
      },
    });

    const rows = items.map((a) => ({
      id: a.id,
      accountNo: a.accountNo,
      branch: a.branch,
      ownerName: a.ownerName,
      currency: a.currency,
      balance: a.balance != null ? Number(a.balance) : 0,
      syncEnabled: a.syncEnabled,
      lastSyncedAt: a.lastSyncedAt,
      bank: a.bank ? { id: a.bank.id, code: a.bank.code, name: a.bank.name, isActive: a.bank.isActive } : null,
    }));

    // Bank kesimi
    const perBank = new Map<string, { code: string; name: string; count: number; balance: number }>();
    for (const r of rows) {
      const code = r.bank?.code || '—';
      const g = perBank.get(code) ?? { code, name: r.bank?.name || 'Bank yo\'q', count: 0, balance: 0 };
      g.count++; g.balance += r.balance;
      perBank.set(code, g);
    }

    return {
      ok: true,
      total: {
        accounts: rows.length,
        balance: rows.reduce((s, r) => s + r.balance, 0),
        syncEnabled: rows.filter((r) => r.syncEnabled).length,
      },
      banks: Array.from(perBank.values()).sort((a, b) => b.balance - a.balance),
      items: rows,
    };
  }

  // ═══════════════ 3-QOIDA: VIPISKA ═══════════════

  @Get('statement')
  @RequireApiScopes(API_SCOPES.UNIVERSAL_READ)
  @ApiOperation({
    summary: 'Vipiska — hisob bo\'yicha tranzaksiyalar',
    description:
      "Majburiy: account (hisob raqami yoki id) YOKI bank (o'sha bankning hamma hisobi) + sana oralig'i. " +
      "Qo'shimcha: direction=IN|OUT, q (izoh/nom/shartnoma), contractNo, minAmount, maxAmount, " +
      "limit (standart 1000, max 5000), offset. Javobda kirim/chiqim jamlari bor.",
  })
  async statement(
    @Query('account') account?: string,
    @Query('bank') bank?: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('direction') direction?: string,
    @Query('q') q?: string,
    @Query('contractNo') contractNo?: string,
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { dateFrom: df, dateTo: dt } = this.sanalar(date, dateFrom, dateTo);
    if (!account && !bank) {
      throw new BadRequestException("account (hisob raqami/id) yoki bank (kod/id) berilishi kerak");
    }

    const where: any = {};
    if (account && account.trim()) {
      const t = account.trim();
      where.account = { OR: [{ accountNo: t }, { id: t }] };
    } else if (bank && bank.trim()) {
      const list = bank.split(',').map((x) => x.trim()).filter(Boolean);
      where.bank = { OR: [{ code: { in: list } }, { id: { in: list } }] };
    }
    if (df || dt) {
      where.txnDate = {};
      if (df) where.txnDate.gte = new Date(`${df}T00:00:00+05:00`);
      if (dt) where.txnDate.lte = new Date(`${dt}T23:59:59.999+05:00`);
    }
    if (direction === 'IN' || direction === 'OUT') where.direction = direction;
    if (contractNo && contractNo.trim()) where.contractNumber = contractNo.trim();
    const min = Number(minAmount);
    const max = Number(maxAmount);
    if (Number.isFinite(min) || Number.isFinite(max)) {
      where.amount = {};
      if (Number.isFinite(min)) where.amount.gte = min;
      if (Number.isFinite(max)) where.amount.lte = max;
    }
    if (q && q.trim()) {
      const t = q.trim();
      where.OR = [
        { description: { contains: t, mode: 'insensitive' } },
        { fromName: { contains: t, mode: 'insensitive' } },
        { toName: { contains: t, mode: 'insensitive' } },
        { contractNumber: { contains: t, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(5000, Math.max(1, Number(limit) || 1000));
    const skip = Math.max(0, Number(offset) || 0);

    const [items, count, agg] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
        take, skip,
        select: {
          id: true, externalId: true, txnDate: true, operationTime: true, valueDate: true,
          direction: true, amount: true, currency: true, status: true,
          docNumber: true, purposeCode: true, description: true,
          fromName: true, fromAccount: true, fromInn: true, fromMfo: true,
          toName: true, toAccount: true, toInn: true, toMfo: true,
          contractNumber: true,
          erpSupplier: true, erpArticle: true, erpContract: true, erpObject: true,
          bank: { select: { code: true, name: true } },
          account: { select: { accountNo: true, ownerName: true } },
          category: { select: { code: true, name: true } },
          subcategory: { select: { code: true, name: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.groupBy({
        by: ['direction'],
        where,
        _sum: { amount: true },
        _count: true,
      }) as any,
    ]);

    const kirim = (agg as any[]).find((x) => x.direction === 'IN');
    const chiqim = (agg as any[]).find((x) => x.direction === 'OUT');
    const inSum = Number(kirim?._sum?.amount ?? 0);
    const outSum = Number(chiqim?._sum?.amount ?? 0);

    return {
      ok: true,
      filter: { account: account || null, bank: bank || null, dateFrom: df || null, dateTo: dt || null, direction: direction || null },
      total: {
        count,
        kirim: inSum,
        chiqim: outSum,
        sof: inSum - outSum,
        kirimSoni: Number(kirim?._count ?? 0),
        chiqimSoni: Number(chiqim?._count ?? 0),
      },
      page: { limit: take, offset: skip, returned: items.length },
      items: items.map((t) => ({
        id: t.id,
        externalId: t.externalId,
        date: t.txnDate,
        time: t.operationTime,
        valueDate: t.valueDate,
        direction: t.direction,
        amount: Number(t.amount),
        currency: t.currency,
        status: t.status,
        docNumber: t.docNumber,
        purposeCode: t.purposeCode,
        description: t.description,
        from: { name: t.fromName, account: t.fromAccount, inn: t.fromInn, mfo: t.fromMfo },
        to: { name: t.toName, account: t.toAccount, inn: t.toInn, mfo: t.toMfo },
        contractNo: t.contractNumber,
        bank: t.bank ? { code: t.bank.code, name: t.bank.name } : null,
        account: t.account ? { accountNo: t.account.accountNo, ownerName: t.account.ownerName } : null,
        category: t.category ? { code: t.category.code, name: t.category.name } : null,
        subcategory: t.subcategory ? { code: t.subcategory.code, name: t.subcategory.name } : null,
        taminot: t.erpSupplier || t.erpArticle || t.erpContract
          ? { supplier: t.erpSupplier, article: t.erpArticle, contract: t.erpContract, object: t.erpObject }
          : null,
      })),
    };
  }

  /**
   * Paneldagi "Vipiska" tugmasi beradigan AYNAN o'sha Excel — bankning rasmiy
   * «Выписка лицевых счетов» hujjati. Ma'lumot bazadan emas, to'g'ridan-to'g'ri
   * bankdan (GetDoc1C) kunma-kun olinadi, shuning uchun sekinroq ishlaydi.
   *
   * Telegram bot shu faylni yuklab olib foydalanuvchiga uzatadi — bot o'zi
   * hech narsa yasamaydi, panel bilan bir xil hujjat chiqadi.
   *
   * Sana berilmasa — bugungi kun (Toshkent).
   * ⚠️ Hozircha faqat KAPITALBANK_V3 hisoblari; boshqa bankda xato qaytadi.
   */
  @Get('statement.xlsx')
  @RequireApiScopes(API_SCOPES.UNIVERSAL_READ)
  @ApiOperation({
    summary: 'Bank vipiskasi — Excel fayl (paneldagi bilan aynan bir xil)',
    description:
      "account — hisob raqami yoki id (majburiy). Sana: date, yoki dateFrom+dateTo; " +
      "berilmasa bugungi kun olinadi. Javob — .xlsx fayl (JSON emas). " +
      "Ma'lumot bankdan jonli olinadi, davr 92 kundan oshmasligi kerak. " +
      "Faqat Kapitalbank hisoblari uchun ishlaydi.",
  })
  async statementXlsx(
    @Res() res: Response,
    @Query('account') account?: string,
    @Query('date') date?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    if (!account || !account.trim()) {
      throw new BadRequestException('account (hisob raqami yoki id) berilishi kerak');
    }
    const t = account.trim();
    const acc = await this.prisma.bankAccount.findFirst({
      where: { OR: [{ accountNo: t }, { id: t }] },
      select: { id: true },
    });
    if (!acc) throw new NotFoundException(`Hisob topilmadi: ${t}`);

    let { dateFrom: df, dateTo: dt } = this.sanalar(date, dateFrom, dateTo);
    if (!df && !dt) { const b = this.bugun(); df = b; dt = b; }
    else if (!df) df = dt;
    else if (!dt) dt = df;

    const { buffer, filename } = await this.statementSvc.build(acc.id, df!, dt!);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  // ═══════════════ FILTR QIYMATLARI ═══════════════

  @Get('filters')
  @RequireApiScopes(API_SCOPES.UNIVERSAL_READ)
  @ApiOperation({
    summary: 'Filtrlarda ishlatiladigan qiymatlar (obyekt, bank, CRM status, bo\'lim, tip)',
    description: 'Tashqi tizim shu ro\'yxatlardan foydalanib filtr quradi.',
  })
  async filters() {
    const [banks, objects, branches, statuses] = await Promise.all([
      this.prisma.bank.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.oplataKv.findMany({
        where: { object: { not: null } },
        select: { object: true }, distinct: ['object'], take: 300,
        orderBy: { object: 'asc' },
      }),
      this.prisma.crmContract.findMany({
        where: { found: true, branchName: { not: null } },
        select: { branchName: true }, distinct: ['branchName'], take: 300,
      }),
      this.prisma.crmContract.findMany({
        where: { found: true, virtualStatus: { not: null } },
        select: { virtualStatus: true }, distinct: ['virtualStatus'], take: 100,
      }),
    ]);
    return {
      ok: true,
      banks: [...banks, { id: '__none__', code: '__none__', name: "Bank yo'q (import / qo'lda)" }],
      objects: objects.map((o) => o.object).filter(Boolean),
      branches: branches.map((b) => b.branchName).filter(Boolean),
      crmStatuses: statuses.map((s) => s.virtualStatus).filter(Boolean),
      propertyTypes: [
        { value: 'apartment', label: 'Жилой' },
        { value: 'parking', label: 'Парковка' },
      ],
      modes: [
        { value: 'normal', label: "Oddiy (взнос to'lovlari)" },
        { value: 'refund', label: 'Возврат (qaytarilganlar)' },
      ],
    };
  }
}
