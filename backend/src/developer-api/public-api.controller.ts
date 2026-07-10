import { Controller, Get, Param, Query, Req, UseGuards, UseInterceptors, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../common/prisma/prisma.service';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { ApiLoggerInterceptor } from './interceptors/api-logger.interceptor';
import { RequireApiScopes } from './decorators/api-scopes.decorator';
import { CurrentApiKey } from './decorators/current-api-key.decorator';
import { API_SCOPES } from './api-scopes';
import type { ValidatedApiKey } from './api-key.service';

/**
 * Tashqi tizim integratsiyasi uchun read-only REST API.
 *   X-API-Key + X-API-Secret header'lari talab qilinadi.
 *   Har endpoint o'ziga kerakli scope'ni @RequireApiScopes bilan belgilaydi.
 *
 * Hech qachon qaytarilmaydi:
 *   - Bank credentials (login, parol, API kalit)
 *   - Foydalanuvchi parollari, hashlar
 *   - Sezgir tizim sozlamalari
 */
@ApiTags('developer-api · public')
@UseGuards(ApiKeyAuthGuard)
@UseInterceptors(ApiLoggerInterceptor)
@Controller('v1')
export class PublicApiController {
  constructor(private readonly prisma: PrismaService) {}

  // ─── WHOAMI ──────────────────────────────────────────────────────

  @Get('_whoami')
  @ApiOperation({ summary: 'Hozirgi API kalit ma\'lumotini va client IP qaytaradi' })
  whoami(@CurrentApiKey() key: ValidatedApiKey, @Req() req: any) {
    // Client IP — guard'da extract qilingan (X-Forwarded-For dan yoki socket'dan)
    const clientIp: string | null = req.apiKeyIp || req.ip || null;
    const userAgent: string | null = req.headers?.['user-agent'] || null;
    return {
      ok: true,
      key: {
        id: key.id,
        keyId: key.keyId,
        name: key.name,
        description: key.description,
        scopes: key.scopes,
        expiresAt: key.expiresAt,
        allowedIps: key.allowedIps,
      },
      client: {
        ip: clientIp,
        userAgent,
      },
      serverTime: new Date().toISOString(),
    };
  }

  // ─── TRANSACTIONS ────────────────────────────────────────────────

  @Get('transactions')
  @RequireApiScopes(API_SCOPES.TRANSACTIONS_READ)
  @ApiOperation({
    summary: 'Tranzaksiyalar ro\'yxati',
    description: 'Filter: accountId, bankId, direction (IN/OUT), dateFrom, dateTo, q (search). ' +
      'Pagination: page, perPage (max 200).',
  })
  async listTransactions(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('accountId') accountId?: string,
    @Query('bankId') bankId?: string,
    @Query('direction') direction?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('q') q?: string,
  ) {
    const pageN = Math.max(1, Number(page) || 1);
    const perPageN = Math.min(200, Math.max(1, Number(perPage) || 50));
    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (bankId) where.bankId = bankId;
    if (direction === 'IN' || direction === 'OUT') where.direction = direction;
    if (dateFrom || dateTo) {
      where.txnDate = {};
      if (dateFrom) where.txnDate.gte = new Date(`${dateFrom}T00:00:00Z`);
      if (dateTo) where.txnDate.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
    if (q && q.trim()) {
      const t = q.trim();
      where.OR = [
        { description: { contains: t, mode: 'insensitive' } },
        { fromName: { contains: t, mode: 'insensitive' } },
        { toName: { contains: t, mode: 'insensitive' } },
        { fromInn: { contains: t } },
        { toInn: { contains: t } },
        { contractNumber: { contains: t, mode: 'insensitive' } },
        { externalId: { contains: t } },
      ];
    }
    const [total, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
        skip: (pageN - 1) * perPageN,
        take: perPageN,
        select: this.txSelect(),
      }),
    ]);
    return {
      ok: true,
      total,
      page: pageN,
      perPage: perPageN,
      items: items.map((it) => this.txShape(it)),
    };
  }

  @Get('transactions/:id')
  @RequireApiScopes(API_SCOPES.TRANSACTIONS_READ)
  @ApiOperation({
    summary: 'Tranzaksiya tafsiloti',
    description: 'ID sifatida qabul qilinadi: cuid (Transaction.id) YOKI externalId (bank tomonidan berilgan global_id/b2_id) YOKI reference (bank ref code) YOKI docNumber. Birinchi mosi qaytariladi.',
  })
  async getTransaction(@Param('id') id: string) {
    const idTrimmed = (id || '').trim();
    if (!idTrimmed) throw new NotFoundException('Tranzaksiya ID berilmagan');

    // Bir nechta noyob maydon bilan qidiramiz — foydalanuvchi qaysi ID
    // formatini bilmasligi mumkin. Birinchi mos kelgani qaytariladi.
    const tx = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          { id: idTrimmed },
          { externalId: idTrimmed },
          { reference: idTrimmed },
          { docNumber: idTrimmed },
        ],
      },
      select: this.txSelect(),
    });
    if (!tx) throw new NotFoundException(
      `Tranzaksiya topilmadi. Qidirilgan maydonlar: id (cuid), externalId, reference, docNumber. Berilgan: "${idTrimmed.slice(0, 64)}"`,
    );
    return { ok: true, transaction: this.txShape(tx) };
  }

  // ─── ОПЛАТЫКВ ────────────────────────────────────────────────────

  @Get('oplata-kv')
  @RequireApiScopes(API_SCOPES.OPLATA_KV_READ)
  @ApiOperation({ summary: 'Kvartira to\'lovlari ro\'yxati' })
  async listOplataKv(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('contractNo') contractNo?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('q') q?: string,
  ) {
    const pageN = Math.max(1, Number(page) || 1);
    const perPageN = Math.min(200, Math.max(1, Number(perPage) || 50));
    // Faqat SPLIT qilingan (paymentCategory tayinlangan) to'lovlar beriladi.
    // Split bo'lmagan qatorlar API'da ko'rinmaydi — split qilinganda avtomatik chiqadi.
    const where: any = { paymentCategory: { not: null } };
    if (contractNo) where.contractNo = contractNo;
    if (dateFrom || dateTo) {
      where.date = {};
      if (dateFrom) where.date.gte = new Date(`${dateFrom}T00:00:00Z`);
      if (dateTo) where.date.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
    if (q && q.trim()) {
      const t = q.trim();
      where.OR = [
        { contractNo: { contains: t, mode: 'insensitive' } },
        { client: { contains: t, mode: 'insensitive' } },
        { object: { contains: t, mode: 'insensitive' } },
        { purpose: { contains: t, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await Promise.all([
      this.prisma.oplataKv.count({ where }),
      this.prisma.oplataKv.findMany({
        where,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        skip: (pageN - 1) * perPageN,
        take: perPageN,
      }),
    ]);
    return {
      ok: true,
      total,
      page: pageN,
      perPage: perPageN,
      items: items.map((it) => this.oplataKvShape(it)),
    };
  }

  @Get('oplata-kv/:id')
  @RequireApiScopes(API_SCOPES.OPLATA_KV_READ)
  @ApiOperation({
    summary: 'ОплатыКв qatorining tafsiloti',
    description: 'ID sifatida qabul qilinadi: cuid (OplataKv.id) YOKI sourceTxId (bog\'langan Transaction.externalId). Birinchi mosi qaytariladi.',
  })
  async getOplataKv(@Param('id') id: string) {
    const idTrimmed = (id || '').trim();
    if (!idTrimmed) throw new NotFoundException('ОплатыКв ID berilmagan');

    // Split bo'lmagan (paymentCategory=null) qatorlar API'da berilmaydi — list bilan izchil.
    const row = await this.prisma.oplataKv.findFirst({
      where: {
        paymentCategory: { not: null },
        OR: [
          { id: idTrimmed },
          { sourceTxId: idTrimmed },
        ],
      },
    });
    if (!row) throw new NotFoundException(
      `ОплатыКв qatori topilmadi yoki hali split qilinmagan. Qidirilgan maydonlar: id (cuid), sourceTxId. Berilgan: "${idTrimmed.slice(0, 64)}"`,
    );
    return { ok: true, item: this.oplataKvShape(row) };
  }

  // ─── ACCOUNTS ────────────────────────────────────────────────────

  @Get('accounts')
  @RequireApiScopes(API_SCOPES.ACCOUNTS_READ)
  @ApiOperation({
    summary: 'Bank hisob raqamlari',
    description: 'Bank credentials (login/parol/API kalit) hech qachon qaytarilmaydi.',
  })
  async listAccounts(@Query('q') q?: string) {
    const where: any = {};
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
        id: true, branch: true, accountNo: true, ownerName: true,
        currency: true, balance: true, syncEnabled: true, lastSyncedAt: true,
        createdAt: true,
        bank: { select: { id: true, code: true, name: true } },
      },
    });
    return {
      ok: true,
      total: items.length,
      items: items.map((a) => ({
        id: a.id,
        accountNo: a.accountNo,
        branch: a.branch,
        ownerName: a.ownerName,
        currency: a.currency,
        balance: a.balance != null ? Number(a.balance) : null,
        syncEnabled: a.syncEnabled,
        lastSyncedAt: a.lastSyncedAt,
        createdAt: a.createdAt,
        bank: a.bank ? { id: a.bank.id, code: a.bank.code, name: a.bank.name } : null,
      })),
    };
  }

  @Get('accounts/:idOrAccountNo')
  @RequireApiScopes(API_SCOPES.ACCOUNTS_READ)
  @ApiOperation({
    summary: 'Bitta hisob raqami tafsiloti',
    description: 'ID (cuid) yoki hisob raqami (20 raqam) qabul qiladi. Ikkalasi ham qidiriladi.',
  })
  async getAccount(@Param('idOrAccountNo') idOrAccountNo: string) {
    const v = (idOrAccountNo || '').trim();
    if (!v) throw new NotFoundException('ID yoki accountNo berilmagan');

    const select = {
      id: true, branch: true, accountNo: true, ownerName: true,
      currency: true, balance: true, syncEnabled: true, lastSyncedAt: true,
      createdAt: true,
      bank: { select: { id: true, code: true, name: true } },
    };
    // Bir nechta maydon bilan qidiramiz — bitta query'da OR orqali tez
    const a = await this.prisma.bankAccount.findFirst({
      where: {
        OR: [
          { id: v },
          { accountNo: v },
        ],
      },
      select,
    });
    if (!a) throw new NotFoundException(
      `Hisob topilmadi. Qidirilgan maydonlar: id (cuid), accountNo. Berilgan: "${v.slice(0, 64)}"`,
    );
    return {
      ok: true,
      account: {
        id: a.id,
        accountNo: a.accountNo,
        branch: a.branch,
        ownerName: a.ownerName,
        currency: a.currency,
        balance: a.balance != null ? Number(a.balance) : null,
        syncEnabled: a.syncEnabled,
        lastSyncedAt: a.lastSyncedAt,
        createdAt: a.createdAt,
        bank: a.bank ? { id: a.bank.id, code: a.bank.code, name: a.bank.name } : null,
      },
    };
  }

  // ─── COUNTERPARTIES ─────────────────────────────────────────────

  @Get('counterparties')
  @RequireApiScopes(API_SCOPES.COUNTERPARTIES_READ)
  @ApiOperation({ summary: 'Kontragentlar ro\'yxati' })
  async listCounterparties(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('q') q?: string,
  ) {
    const pageN = Math.max(1, Number(page) || 1);
    const perPageN = Math.min(200, Math.max(1, Number(perPage) || 50));
    const where: any = {};
    if (q && q.trim()) {
      const t = q.trim();
      where.OR = [
        { inn: { contains: t } },
        { name: { contains: t, mode: 'insensitive' } },
        { fullName: { contains: t, mode: 'insensitive' } },
      ];
    }
    const [total, items] = await Promise.all([
      this.prisma.counterparty.count({ where }),
      this.prisma.counterparty.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (pageN - 1) * perPageN,
        take: perPageN,
        select: {
          id: true, inn: true, name: true, fullName: true, director: true,
          phone: true, email: true, address: true, vatStatus: true, oked: true,
          companyType: true, registrationDate: true, isManual: true,
          createdAt: true, updatedAt: true,
        },
      }),
    ]);
    return { ok: true, total, page: pageN, perPage: perPageN, items };
  }

  @Get('counterparties/:innOrId')
  @RequireApiScopes(API_SCOPES.COUNTERPARTIES_READ)
  @ApiOperation({
    summary: 'INN yoki ID bo\'yicha kontragent tafsiloti',
    description: 'INN (9 raqam) yoki cuid (Counterparty.id) qabul qiladi.',
  })
  async getCounterparty(@Param('innOrId') innOrId: string) {
    const v = (innOrId || '').trim();
    if (!v) throw new NotFoundException('INN yoki ID berilmagan');

    const cp = await this.prisma.counterparty.findFirst({
      where: {
        OR: [
          { inn: v },
          { id: v },
        ],
      },
      select: {
        id: true, inn: true, name: true, fullName: true, director: true,
        directorPinfl: true, accountant: true, phone: true, email: true, address: true,
        vatNumber: true, vatStatus: true, vatStatusCode: true, taxMode: true,
        opf: true, oked: true, companyType: true, businessType: true,
        registrationDate: true, registrationNumber: true, isManual: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!cp) throw new NotFoundException(
      `Kontragent topilmadi. Qidirilgan maydonlar: inn, id (cuid). Berilgan: "${v.slice(0, 64)}"`,
    );
    return { ok: true, counterparty: cp };
  }

  // ─── META: filter qurish uchun ─────────────────────────────────
  // Tashqi tizim filter UI yaratishi uchun barcha enum/ro'yxatlarni
  // bitta joydan beradi. Scope kerak emas — kalit faol bo'lishi yetarli.

  @Get('_meta/all')
  @ApiOperation({ summary: 'Barcha meta-ma\'lumotlar bitta javobda (UI filter qurish uchun)' })
  async metaAll() {
    const [banks, accounts, categories, subcategories] = await Promise.all([
      this.prisma.bank.findMany({
        select: { id: true, code: true, name: true, apiKind: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.bankAccount.findMany({
        select: {
          id: true, accountNo: true, ownerName: true, currency: true,
          bank: { select: { id: true, code: true, name: true } },
        },
        orderBy: [{ ownerName: 'asc' }, { accountNo: 'asc' }],
      }),
      this.prisma.category.findMany({
        where: { parentId: null },
        select: { id: true, code: true, name: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.category.findMany({
        where: { parentId: { not: null } },
        select: { id: true, code: true, name: true, parentId: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    return {
      ok: true,
      banks,
      accounts: accounts.map((a) => ({
        id: a.id, accountNo: a.accountNo, ownerName: a.ownerName,
        currency: a.currency, bank: a.bank,
      })),
      categories: categories.map((c) => ({
        ...c,
        subcategories: subcategories.filter((s) => s.parentId === c.id),
      })),
      enums: {
        direction: ['IN', 'OUT'],
        status: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED'],
        type: ['TRANSFER', 'PAYMENT', 'SALARY', 'TAX', 'FEE', 'REFUND'],
        matchStatus: ['UNMATCHED', 'AUTO', 'MANUAL', 'PARTIAL', 'IGNORED'],
        source: ['SYNC', 'IMPORT', 'MANUAL', 'ALOQA_BANK'],
        oplataKvCategory: ['MONTHLY', 'FIRST', 'GENERAL'],
      },
    };
  }

  @Get('_meta/banks')
  @ApiOperation({ summary: 'Banklar ro\'yxati' })
  async metaBanks() {
    const banks = await this.prisma.bank.findMany({
      select: { id: true, code: true, name: true, apiKind: true, isActive: true },
      orderBy: { name: 'asc' },
    });
    return { ok: true, total: banks.length, items: banks };
  }

  @Get('_meta/accounts')
  @ApiOperation({ summary: 'Barcha hisob raqamlar (filter uchun, accounts ga teng)' })
  async metaAccounts() {
    const items = await this.prisma.bankAccount.findMany({
      select: {
        id: true, accountNo: true, ownerName: true, currency: true,
        bank: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ ownerName: 'asc' }, { accountNo: 'asc' }],
    });
    return { ok: true, total: items.length, items };
  }

  @Get('_meta/categories')
  @ApiOperation({ summary: 'Kategoriya va subkategoriyalar (ierarxik)' })
  async metaCategories() {
    const [parents, children] = await Promise.all([
      this.prisma.category.findMany({
        where: { parentId: null },
        select: { id: true, code: true, name: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.prisma.category.findMany({
        where: { parentId: { not: null } },
        select: { id: true, code: true, name: true, parentId: true, sortOrder: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    return {
      ok: true,
      items: parents.map((p) => ({
        ...p,
        subcategories: children.filter((c) => c.parentId === p.id),
      })),
    };
  }

  @Get('_meta/enums')
  @ApiOperation({ summary: 'Barcha enum qiymatlar (direction, status, type, source va h.k.)' })
  metaEnums() {
    return {
      ok: true,
      direction: { values: ['IN', 'OUT'], labels: { IN: 'Kirim', OUT: 'Chiqim' } },
      status: {
        values: ['PENDING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED'],
        labels: {
          PENDING: 'Kutilmoqda', COMPLETED: 'Yakunlangan', FAILED: 'Muvaffaqiyatsiz',
          CANCELLED: 'Bekor qilingan', REVERSED: 'Qaytarilgan',
        },
      },
      type: {
        values: ['TRANSFER', 'PAYMENT', 'SALARY', 'TAX', 'FEE', 'REFUND'],
        labels: {
          TRANSFER: 'O\'tkazma', PAYMENT: 'To\'lov', SALARY: 'Maosh',
          TAX: 'Soliq', FEE: 'Komissiya', REFUND: 'Qaytarish',
        },
      },
      matchStatus: {
        values: ['UNMATCHED', 'AUTO', 'MANUAL', 'PARTIAL', 'IGNORED'],
        labels: {
          UNMATCHED: 'Topilmagan', AUTO: 'Avto-mos', MANUAL: 'Qo\'lda',
          PARTIAL: 'Qisman', IGNORED: 'E\'tiborsiz',
        },
      },
      source: {
        values: ['SYNC', 'IMPORT', 'MANUAL', 'ALOQA_BANK'],
        labels: { SYNC: 'Bank API sync', IMPORT: 'Excel import', MANUAL: 'Qo\'lda', ALOQA_BANK: 'Aloqa Bank import' },
      },
      oplataKvCategory: {
        values: ['MONTHLY', 'FIRST', 'GENERAL'],
        labels: { MONTHLY: 'Ежемесячный', FIRST: '1 взнос', GENERAL: 'Общий' },
      },
    };
  }

  // ─── INTERNAL HELPERS ───────────────────────────────────────────

  private txSelect() {
    return {
      id: true, externalId: true, type: true, status: true, direction: true,
      amount: true, currency: true,
      fromMfo: true, fromAccount: true, fromName: true, fromInn: true,
      toMfo: true, toAccount: true, toName: true, toInn: true,
      description: true, reference: true, purposeCode: true, docNumber: true,
      txnDate: true, valueDate: true, operationTime: true,
      contractNumber: true,
      bank: { select: { id: true, code: true, name: true } },
      account: { select: { id: true, accountNo: true, ownerName: true } },
      category: { select: { id: true, code: true, name: true } },
      subcategory: { select: { id: true, code: true, name: true } },
      createdAt: true, updatedAt: true,
    };
  }

  private txShape(it: any) {
    return {
      id: it.id,
      externalId: it.externalId,
      type: it.type,
      status: it.status,
      direction: it.direction,
      amount: it.amount != null ? Number(it.amount) : null,
      currency: it.currency,
      from: {
        mfo: it.fromMfo, account: it.fromAccount, name: it.fromName, inn: it.fromInn,
      },
      to: {
        mfo: it.toMfo, account: it.toAccount, name: it.toName, inn: it.toInn,
      },
      description: it.description,
      reference: it.reference,
      purposeCode: it.purposeCode,
      docNumber: it.docNumber,
      txnDate: it.txnDate,
      valueDate: it.valueDate,
      operationTime: it.operationTime,
      contractNumber: it.contractNumber,
      bank: it.bank,
      account: it.account,
      category: it.category,
      subcategory: it.subcategory,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    };
  }

  private oplataKvShape(it: any) {
    return {
      id: it.id,
      contractNo: it.contractNo,
      date: it.date,
      paymentAmount: it.paymentAmount != null ? Number(it.paymentAmount) : null,
      firstInstallment: it.firstInstallment != null ? Number(it.firstInstallment) : null,
      monthlyAmount: it.monthlyAmount != null ? Number(it.monthlyAmount) : null,
      purpose: it.purpose,
      txType: it.txType,
      note: it.note,
      paymentCategory: it.paymentCategory,
      object: it.object,
      client: it.client,
      paymentMethod: it.paymentMethod,
      createdAt: it.createdAt,
      updatedAt: it.updatedAt,
    };
  }
}
