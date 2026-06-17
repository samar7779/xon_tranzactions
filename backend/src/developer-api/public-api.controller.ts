import { Controller, Get, Param, Query, UseGuards, UseInterceptors, NotFoundException } from '@nestjs/common';
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
  @ApiOperation({ summary: 'Hozirgi API kalit ma\'lumotini qaytaradi' })
  whoami(@CurrentApiKey() key: ValidatedApiKey) {
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
  @ApiOperation({ summary: 'Tranzaksiya tafsiloti' })
  async getTransaction(@Param('id') id: string) {
    const tx = await this.prisma.transaction.findUnique({
      where: { id },
      select: this.txSelect(),
    });
    if (!tx) throw new NotFoundException('Tranzaksiya topilmadi');
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
    const where: any = {};
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
  @ApiOperation({ summary: 'ОплатыКв qatorining tafsiloti' })
  async getOplataKv(@Param('id') id: string) {
    const row = await this.prisma.oplataKv.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ОплатыКв qatori topilmadi');
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

  @Get('accounts/:id')
  @RequireApiScopes(API_SCOPES.ACCOUNTS_READ)
  @ApiOperation({ summary: 'Bitta hisob raqami tafsiloti' })
  async getAccount(@Param('id') id: string) {
    const a = await this.prisma.bankAccount.findUnique({
      where: { id },
      select: {
        id: true, branch: true, accountNo: true, ownerName: true,
        currency: true, balance: true, syncEnabled: true, lastSyncedAt: true,
        createdAt: true,
        bank: { select: { id: true, code: true, name: true } },
      },
    });
    if (!a) throw new NotFoundException('Hisob raqami topilmadi');
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

  @Get('counterparties/:inn')
  @RequireApiScopes(API_SCOPES.COUNTERPARTIES_READ)
  @ApiOperation({ summary: 'INN bo\'yicha kontragent tafsiloti' })
  async getCounterparty(@Param('inn') inn: string) {
    const cp = await this.prisma.counterparty.findUnique({
      where: { inn },
      select: {
        id: true, inn: true, name: true, fullName: true, director: true,
        directorPinfl: true, accountant: true, phone: true, email: true, address: true,
        vatNumber: true, vatStatus: true, vatStatusCode: true, taxMode: true,
        opf: true, oked: true, companyType: true, businessType: true,
        registrationDate: true, registrationNumber: true, isManual: true,
        createdAt: true, updatedAt: true,
      },
    });
    if (!cp) throw new NotFoundException('Kontragent topilmadi');
    return { ok: true, counterparty: cp };
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
