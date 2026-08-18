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
  @ApiOperation({
    summary: 'Kvartira to\'lovlari ro\'yxati',
    description: 'Faqat split qilingan (kategoriyalangan) to\'lovlar. ' +
      'Delta-sync: updatedSince (ISO vaqt) berilsa — shu vaqt va undan keyin o\'zgargan (yangi split, ' +
      'shartnoma tuzatilgan, ma\'lumot to\'ldirilgan) to\'lovlar updatedAt bo\'yicha o\'sish tartibida qaytariladi. ' +
      'Iste\'molchi oxirgi ko\'rgan updatedAt ni saqlab, keyingi so\'rovda shuni beradi.',
  })
  async listOplataKv(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('contractNo') contractNo?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('q') q?: string,
    @Query('updatedSince') updatedSince?: string,
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
    // Delta-sync: shu vaqt va undan keyin o'zgargan (updatedAt) to'lovlar
    let deltaMode = false;
    if (updatedSince) {
      const since = new Date(updatedSince);
      if (!isNaN(since.getTime())) {
        where.updatedAt = { gte: since };
        deltaMode = true;
      }
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
    // Delta rejimda updatedAt o'sish tartibida (iste'molchi oxirgi updatedAt ni kuzatadi)
    const orderBy: any = deltaMode
      ? [{ updatedAt: 'asc' }, { id: 'asc' }]
      : [{ date: 'desc' }, { id: 'desc' }];
    const [total, items] = await Promise.all([
      this.prisma.oplataKv.count({ where }),
      this.prisma.oplataKv.findMany({
        where,
        orderBy,
        skip: (pageN - 1) * perPageN,
        take: perPageN,
      }),
    ]);
    const orderIdMap = await this.orderIdMapForContracts(items.map((it) => it.contractNo));
    return {
      ok: true,
      total,
      page: pageN,
      perPage: perPageN,
      items: items.map((it) => this.oplataKvShape(it, orderIdMap.get((it.contractNo || '').toUpperCase()) ?? null)),
    };
  }

  /** contractNo -> CRM order_id xaritasi (CrmContract'dan, katta harf bilan mos) */
  private async orderIdMapForContracts(contractNos: (string | null)[]): Promise<Map<string, string | null>> {
    const keys = [...new Set(contractNos.filter(Boolean).map((c) => (c as string).toUpperCase()))];
    const map = new Map<string, string | null>();
    if (!keys.length) return map;
    const rows = await this.prisma.crmContract.findMany({
      where: { contractNumber: { in: keys } },
      select: { contractNumber: true, crmOrderId: true },
    });
    for (const r of rows) map.set(r.contractNumber.toUpperCase(), r.crmOrderId ?? null);
    return map;
  }

  @Get('oplata-kv/deleted')
  @RequireApiScopes(API_SCOPES.OPLATA_KV_READ)
  @ApiOperation({
    summary: "O'chirilgan kvartira to'lovlari (arxiv)",
    description: "O'chirilgan (bekor qilingan) to'lovlar. Iste'molchi bularni o'z bazasidan olib tashlashi kerak. " +
      "deletedSince (ISO vaqt) berilsa — shu vaqt va undan keyin o'chirilganlar createdAt bo'yicha o'sish tartibida. " +
      "Har element to'liq to'lov ma'lumoti + deleted/deletedAt/deletedBy/deletedReason bilan qaytadi. " +
      "MUHIM: bu route :id dan OLDIN e'lon qilingan (route conflict oldini olish uchun).",
  })
  async listDeletedOplataKv(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('deletedSince') deletedSince?: string,
    @Query('compositeId') compositeId?: string,
  ) {
    const pageN = Math.max(1, Number(page) || 1);
    const perPageN = Math.min(200, Math.max(1, Number(perPage) || 50));
    const where: any = { action: 'deleted' };
    // Composite ID (bank kompozit / sourceTxId) bo'yicha aniq/qisman qidirish.
    // oplataKvId = OplataKv.id (sync qilinganlar uchun bu = Transaction.externalId = kompozit).
    if (compositeId && compositeId.trim()) {
      where.oplataKvId = { contains: compositeId.trim() };
    }
    let deltaMode = false;
    if (deletedSince) {
      const since = new Date(deletedSince);
      if (!isNaN(since.getTime())) { where.createdAt = { gte: since }; deltaMode = true; }
    }
    const orderBy: any = deltaMode ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [total, rows] = await Promise.all([
      this.prisma.oplataKvHistory.count({ where }),
      this.prisma.oplataKvHistory.findMany({ where, orderBy, skip: (pageN - 1) * perPageN, take: perPageN }),
    ]);
    // Tombstone — snapshot'dan aniqlovchi maydonlar; bo'sh bo'lsa oldingi tarixdan tiklaymiz.
    const priorMap = await this.buildPriorMap(rows);
    const rCn = (r: any) => {
      const v = this.snapVal(r.changes, 'contractNo');
      if (typeof v === 'string') return v;
      const pv = this.snapVal(priorMap.get(r.oplataKvId), 'contractNo');
      return typeof pv === 'string' ? pv : null;
    };
    const orderIdMap = await this.orderIdMapForContracts(rows.map((r) => rCn(r)));
    const oid = (cn: any) => orderIdMap.get((typeof cn === 'string' ? cn : '').toUpperCase()) ?? null;
    return {
      ok: true,
      total,
      page: pageN,
      perPage: perPageN,
      items: rows.map((r) => this.deletedTombstone(r, oid, priorMap.get(r.oplataKvId))),
    };
  }

  @Get('oplata-kv/changes')
  @RequireApiScopes(API_SCOPES.OPLATA_KV_READ)
  @ApiOperation({
    summary: "Kvartira to'lovlari — yagona o'zgarishlar feed (delta + tombstone)",
    description:
      "ENG ISHONCHLI sync yo'li. Bitta feed: yangi/o'zgargan to'lovlar (deleted:false) VA endi kerak " +
      "bo'lmaganlari (deleted:true — o'chirilgan yoki split olib tashlangan; mijoz o'z bazasidan olib " +
      "tashlashi kerak, agar bu id unda bo'lsa; bo'lmasa e'tibormaydi). KEYSET kursor — hech nima tushib " +
      "qolmaydi/takrorlanmaydi, bir xil vaqtli bulk update'da ham qotmaydi. Pul summalari ANIQ (string, " +
      "tiyingacha). Ishlatish: 1-so'rov cursor'siz; keyin har javobdagi nextCursor'ni qaytaring; " +
      "hasMore=false bo'lguncha o'qing. limit: default 100, max 500. " +
      "days: faqat oxirgi N kun o'zgarishlari (update+delete) — masalan days=7 (eski ma'lumot kerak " +
      "bo'lmasa). since: ISO vaqtdan boshlab. days/since faqat cursor bo'lmaganda ishlaydi.",
  })
  async changesOplataKv(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Query('days') days?: string,
    @Query('since') since?: string,
  ) {
    const lim = Math.min(500, Math.max(1, Number(limit) || 100));
    const cur = this.parseChangesCursor(cursor);
    // cursor yo'q-u, days/since berilgan bo'lsa — boshlanish nuqtasini shunga suramiz
    // (update VA delete ikkalasi ham shu vaqtdan). Eski ma'lumot kerak bo'lmasa: days=7.
    if (!cursor) {
      let startMs: number | null = null;
      const dN = Number(days);
      if (days != null && days !== '' && Number.isFinite(dN) && dN > 0) startMs = Date.now() - dN * 86400000;
      else if (since) { const t = new Date(since).getTime(); if (!isNaN(t)) startMs = t; }
      if (startMs != null) { cur.u = new Date(startMs); cur.ui = ''; cur.d = new Date(startMs); cur.di = ''; }
    }

    // A) oplata_kv — keyset (updatedAt, id). Kategoriya filtri YO'Q: split bo'lsa upsert,
    //    paymentCategory=null bo'lsa tombstone (un-split ham shu yerdan ushlanadi).
    const aRows = await this.prisma.oplataKv.findMany({
      where: { OR: [{ updatedAt: { gt: cur.u } }, { updatedAt: cur.u, id: { gt: cur.ui } }] },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: lim,
    });
    // B) hard-delete tombstone'lar — history keyset (createdAt, id).
    const bRows = await this.prisma.oplataKvHistory.findMany({
      where: { action: 'deleted', OR: [{ createdAt: { gt: cur.d } }, { createdAt: cur.d, id: { gt: cur.di } }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: lim,
    });

    // Merge — event vaqti bo'yicha, limitgacha kesamiz; har manba kursorini OLINGAN oxirgi elementga suramiz.
    type Ev = { at: number; src: 'A' | 'B'; a?: any; b?: any };
    const evs: Ev[] = [
      ...aRows.map((a) => ({ at: new Date(a.updatedAt).getTime(), src: 'A' as const, a })),
      ...bRows.map((b) => ({ at: new Date(b.createdAt).getTime(), src: 'B' as const, b })),
    ].sort((x, y) => x.at - y.at);
    const taken = evs.slice(0, lim);

    const nc = { u: cur.u, ui: cur.ui, d: cur.d, di: cur.di };
    for (const e of taken) {
      if (e.src === 'A') { nc.u = new Date(e.a.updatedAt); nc.ui = e.a.id; }
      else { nc.d = new Date(e.b.createdAt); nc.di = e.b.id; }
    }

    // Bo'sh o'chirish snapshotlari uchun oldingi tarixdan tiklash xaritasi
    const priorMap = await this.buildPriorMap(bRows);
    const bCn = (b: any) => {
      const v = this.snapVal(b.changes, 'contractNo');
      if (typeof v === 'string') return v;
      const pv = this.snapVal(priorMap.get(b.oplataKvId), 'contractNo');
      return typeof pv === 'string' ? pv : null;
    };
    const contractNos: (string | null)[] = [
      ...aRows.map((a) => a.contractNo),
      ...bRows.map((b) => bCn(b)),
    ];
    const orderIdMap = await this.orderIdMapForContracts(contractNos);
    const oid = (cn: any) => orderIdMap.get((typeof cn === 'string' ? cn : '').toUpperCase()) ?? null;

    const items = taken.map((e) => {
      if (e.src === 'A') {
        const it = e.a;
        // AKTIV (upsert) = split qilingan to'lov (paymentCategory) YOKI Переброска qatori
        // (perereboskaGroupId bor — u ataylab paymentCategory=null bilan yaratiladi, lekin
        // real pul harakati: manba −summa, maqsad +summa). Aks holda → tombstone.
        const isActive = it.paymentCategory != null || it.perereboskaGroupId != null;
        if (isActive) {
          return { ...this.oplataKvShapeMoney(it, oid(it.contractNo)), deleted: false };
        }
        // Split emas / olib tashlangan → tombstone. Qator hali bazada — to'liq aniqlovchi
        // maydonlar bilan beramiz (mijoz aynan qaysi to'lovligini biladi).
        return {
          id: it.id, sourceTxId: it.sourceTxId ?? null,
          contractNo: it.contractNo, order_id: oid(it.contractNo),
          client: it.client, object: it.object,
          paymentAmount: it.paymentAmount != null ? String(it.paymentAmount) : null,
          date: it.date, purpose: it.purpose, txType: it.txType,
          deleted: true, reason: 'inactive', updatedAt: this.clampFuture(it.updatedAt),
        };
      }
      return this.deletedTombstone(e.b, oid, priorMap.get(e.b.oplataKvId));
    });

    // MUHIM: tombstone'larni FILTRLAMAYMIZ. Aniqlovchi ma'lumot (contractNo/client) bo'sh
    // bo'lsa ham `id` bor — mijoz shu id bo'yicha o'chiradi (bo'lmasa e'tibormaydi). Avval
    // "bo'sh" deb filtrlaganimiz import o'chirishlarini yashirib, CRM'da to'lovlar stale
    // qolib ketgan edi — o'chirish HECH QACHON tushib qolmasligi kerak.
    const hasMore = evs.length > lim || aRows.length === lim || bRows.length === lim;
    return { ok: true, items, nextCursor: this.makeChangesCursor(nc), hasMore };
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
    const orderIdMap = await this.orderIdMapForContracts([row.contractNo]);
    return { ok: true, item: this.oplataKvShape(row, orderIdMap.get((row.contractNo || '').toUpperCase()) ?? null) };
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
  @RequireApiScopes(API_SCOPES.ACCOUNTS_READ) // FIX (A4): bank hisoblari qaytadi — scope talab qilinadi
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
  @RequireApiScopes(API_SCOPES.ACCOUNTS_READ) // FIX (A4): bank hisoblari — scope talab qilinadi
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
      createdAt: this.clampFuture(it.createdAt),
      updatedAt: this.clampFuture(it.updatedAt),
    };
  }

  /**
   * Kelajakdagi timestamp'ni HOZIRgacha "clamp" qiladi — API hech qachon now()'dan katta
   * updatedAt/createdAt qaytarmasligi uchun YAKUNIY himoya (DB soati skew bo'lsa ham).
   * Delta-sync (updatedSince) kursori kelajakka sakramaydi → oradagi to'lovlar o'tkazib
   * yuborilmaydi. updatedAt asc tartibi buzilmaydi: kelajak qiymat oxirda turadi va now()'ga
   * clamp bo'lsa ham u barcha o'tmish qiymatlardan katta/teng — monoton o'sish saqlanadi.
   */
  private clampFuture(d: any): any {
    if (!d) return d;
    const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
    if (isNaN(t)) return d;
    const now = Date.now();
    return t > now ? new Date(now) : d;
  }

  private oplataKvShape(it: any, orderId: string | null = null) {
    return {
      id: it.id,
      sourceTxId: it.sourceTxId ?? null,   // barqaror bank tranzaksiya id (ix id)
      contractNo: it.contractNo,
      order_id: orderId,   // CRM order/shartnoma ID (contractNo bo'yicha CrmContract'dan)
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
      createdAt: this.clampFuture(it.createdAt),
      updatedAt: this.clampFuture(it.updatedAt),
    };
  }

  /** oplataKvShape'ning ANIQ-PUL varianti — summalar string (Decimal → tiyingacha aniq, float emas). */
  private oplataKvShapeMoney(it: any, orderId: string | null = null) {
    return {
      id: it.id,
      sourceTxId: it.sourceTxId ?? null,   // barqaror bank tranzaksiya id (ix id) — mijoz shu bo'yicha solishtiradi
      contractNo: it.contractNo,
      order_id: orderId,
      date: it.date,
      paymentAmount: it.paymentAmount != null ? String(it.paymentAmount) : null,
      firstInstallment: it.firstInstallment != null ? String(it.firstInstallment) : null,
      monthlyAmount: it.monthlyAmount != null ? String(it.monthlyAmount) : null,
      purpose: it.purpose,
      txType: it.txType,
      note: it.note,
      paymentCategory: it.paymentCategory,
      object: it.object,
      client: it.client,
      paymentMethod: it.paymentMethod,
      // Переброска guruhi — bir o'tkazmaning manba (−) va maqsad (+) qatorlarini bog'lash uchun.
      perereboskaGroupId: it.perereboskaGroupId ?? null,
      createdAt: this.clampFuture(it.createdAt),
      updatedAt: this.clampFuture(it.updatedAt),
    };
  }

  /**
   * O'chirish snapshot'idan bitta maydon qiymatini oladi. Snapshot 3 xil formatda kelishi mumkin:
   *  - { snapshot: {...to'liq qator} }   (deleteRowById)
   *  - { field: { old, new } }           (cleanup/diff format) → old olinadi
   *  - { field: value }                  (tekis)
   */
  private snapVal(changes: any, field: string): any {
    if (!changes || typeof changes !== 'object') return null;
    const src = (changes.snapshot && typeof changes.snapshot === 'object' && !Array.isArray(changes.snapshot)) ? changes.snapshot : changes;
    const v = src?.[field];
    if (v == null) return null;
    if (typeof v === 'object' && !Array.isArray(v) && ('old' in v || 'new' in v)) return (v as any).old ?? null;
    return v;
  }

  /**
   * Hard-delete tombstone — snapshot'dan BARCHA aniqlovchi maydonlar + to'liq audit.
   * `prior`: agar o'chirish snapshoti bo'sh bo'lsa (eski import o'chirishlari faqat {reason}),
   * to'lovning oldingi (created/imported/edited) tarixidan maydon tiklaymiz.
   */
  private deletedTombstone(r: any, oid: (cn: any) => string | null, prior?: any): any {
    const g = (field: string) => {
      const v = this.snapVal(r.changes, field);
      if (v != null) return v;
      return prior != null ? this.snapVal(prior, field) : null;
    };
    const cn = g('contractNo');
    const amt = g('paymentAmount');
    const fi = g('firstInstallment');
    const mo = g('monthlyAmount');
    return {
      id: r.oplataKvId,                    // sync = bank kompozit (Transaction.externalId)
      sourceTxId: g('sourceTxId'),         // barqaror bank tranzaksiya id (mijoz shu bo'yicha solishtiradi)
      contractNo: typeof cn === 'string' ? cn : null,
      order_id: oid(cn),
      client: g('client'),
      object: g('object'),
      paymentAmount: amt != null ? String(amt) : null,
      firstInstallment: fi != null ? String(fi) : null,
      monthlyAmount: mo != null ? String(mo) : null,
      date: g('date'),
      purpose: g('purpose'),
      txType: g('txType'),
      deleted: true,
      reason: 'deleted',
      deletedAt: r.createdAt,              // QACHON o'chirilgan
      deletedBy: r.actorName ?? null,      // KIM o'chirgan
      deletedReason: r.note ?? null,       // NIMAGA o'chirilgan
    };
  }

  /**
   * O'chirish snapshoti BO'SH bo'lgan tombstone'lar uchun — to'lovning oldingi (o'chirishdan
   * boshqa: created/imported/edited) tarixidan eng so'nggisini topib, xarita qaytaradi.
   * Shu bilan eski (minimal) import o'chirishlari ham to'liq (contractNo/mijoz) chiqadi.
   */
  private async buildPriorMap(bRows: any[]): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    const need = [...new Set(
      bRows.filter((b) => !this.snapVal(b.changes, 'contractNo')).map((b) => b.oplataKvId).filter(Boolean),
    )];
    if (!need.length) return map;
    const priors = await this.prisma.oplataKvHistory.findMany({
      where: { oplataKvId: { in: need }, action: { not: 'deleted' } },
      orderBy: [{ createdAt: 'desc' }],
      select: { oplataKvId: true, changes: true },
    });
    for (const p of priors) if (!map.has(p.oplataKvId)) map.set(p.oplataKvId, p.changes);
    return map;
  }

  /** changes feed kursori — ikki manba (oplata_kv updatedAt/id + history deleted createdAt/id) opaque base64. */
  private parseChangesCursor(cursor?: string): { u: Date; ui: string; d: Date; di: string } {
    // Birinchi so'rov (cursor yo'q) yoki noto'g'ri cursor: upsert VA o'chirishlar epoch'dan
    // (to'liq). O'chirish HECH QACHON o'tkazib yuborilmasligi kerak — aks holda mijozda stale
    // to'lov qolib ketadi. Faqat yaqin davr kerak bo'lsa: days / since (ikkalasini ham suradi).
    const fresh = () => ({ u: new Date(0), ui: '', d: new Date(0), di: '' });
    if (!cursor) return fresh();
    try {
      const j = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      return {
        u: j?.u != null ? new Date(Number(j.u)) : new Date(0),
        ui: typeof j?.ui === 'string' ? j.ui : '',
        d: j?.d != null ? new Date(Number(j.d)) : new Date(0),
        di: typeof j?.di === 'string' ? j.di : '',
      };
    } catch { return fresh(); }
  }

  private makeChangesCursor(c: { u: Date; ui: string; d: Date; di: string }): string {
    return Buffer.from(JSON.stringify({ u: c.u.getTime(), ui: c.ui, d: c.d.getTime(), di: c.di }), 'utf8').toString('base64url');
  }
}
