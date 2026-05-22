import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { Prisma, OplataKvCategory } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import {
  CreateOplataKvDto, UpdateOplataKvDto, ListOplataKvDto,
} from './dto/oplata-kv.dto';

type Actor = { id?: string | null; name?: string | null };

export interface ImportResult {
  total: number;
  added: number;
  skipped: number;
  errors: number;
  errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }>;
  skippedRows: Array<{ row: number; id: string; contractNo: string; reason: string }>;
  batchId?: string;
  duration: number; // sekund
}

export interface ImportPreview {
  previewId: string;
  fileName: string | null;
  total: number;
  willInsert: number;     // bazaga qo'shiladigan yangi qatorlar
  duplicatesInDb: number; // DB'da allaqachon ID bo'lganlar
  duplicatesInFile: number; // Fayl ichida takror ID
  errors: number;
  errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }>;
  skippedRows: Array<{ row: number; id: string; contractNo: string; reason: string }>;
  duration: number; // parse vaqti (sekund)
  expiresAt: string; // ISO sana — qachongacha cache'da turadi
}

// Cache'dagi preview ma'lumotlari
interface PreviewState {
  fileName: string | null;
  fileSize: number;
  toInsert: any[];        // bazaga qo'shilishi kerak bo'lgan qatorlar (Prisma data)
  preview: ImportPreview;
  expiresAt: number;       // ms timestamp
  actor: Actor;
}

@Injectable()
export class OplataKvService {
  private readonly log = new Logger(OplataKvService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crmService: CrmService,
  ) {}

  // ─── Preview cache (in-memory) ───────────────────────────
  // Foydalanuvchi katta Excel yuklasa → avval tekshiramiz va cache'da turamiz.
  // Foydalanuvchi tasdiqlasa → cache'dan o'qib bazaga qo'shamiz.
  // TTL 30 daqiqa, tasdiqlangach yoki TTL tugagach evict qilamiz.
  private previewCache = new Map<string, PreviewState>();
  private readonly PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 daqiqa

  private cleanExpiredPreviews() {
    const now = Date.now();
    for (const [k, v] of this.previewCache) {
      if (v.expiresAt < now) this.previewCache.delete(k);
    }
  }

  // ───────────────── WHERE BUILDER (sharedmaroq) ─────────────────
  /** Vergul bilan ajratilgan string'ni massivga aylantiradi. */
  private parseList(s?: string | null): string[] | null {
    if (!s) return null;
    const arr = s.split(',').map((x) => x.trim()).filter(Boolean);
    return arr.length > 0 ? arr : null;
  }

  /** Barcha filterlardan WHERE yasaydi — list/export/distinct shu metodni ishlatadi. */
  private buildWhere(q: ListOplataKvDto): Prisma.OplataKvWhereInput {
    const where: Prisma.OplataKvWhereInput = {};

    if (q.q && q.q.trim()) {
      const s = q.q.trim();
      const ors: Prisma.OplataKvWhereInput[] = [
        { contractNo:    { contains: s, mode: 'insensitive' } },
        { client:        { contains: s, mode: 'insensitive' } },
        { object:        { contains: s, mode: 'insensitive' } },
        { purpose:       { contains: s, mode: 'insensitive' } },
        { note:          { contains: s, mode: 'insensitive' } },
        { paymentMethod: { contains: s, mode: 'insensitive' } },
        { txType:        { contains: s, mode: 'insensitive' } },
        { id:            { contains: s, mode: 'insensitive' } },
      ];
      // Raqam bo'lsa — summalar bo'yicha ham qidiramiz (aniq tenglik)
      const n = Number(s.replace(/[\s,]/g, ''));
      if (Number.isFinite(n) && n > 0) {
        ors.push(
          { paymentAmount:    n as any },
          { firstInstallment: n as any },
          { monthlyAmount:    n as any },
        );
      }
      where.OR = ors;
    }
    if (q.dateFrom) where.date = { ...(where.date as object), gte: new Date(q.dateFrom) };
    if (q.dateTo)   where.date = { ...(where.date as object), lte: new Date(q.dateTo) };
    if (q.contractNo) where.contractNo = { contains: q.contractNo, mode: 'insensitive' };
    if (q.paymentCategory) where.paymentCategory = q.paymentCategory as OplataKvCategory;
    if (q.client) where.client = { contains: q.client, mode: 'insensitive' };
    if (q.object) where.object = { contains: q.object, mode: 'insensitive' };

    // ─── Per-ustun multi-select (vergul bilan) ───
    const contractNos = this.parseList(q.contractNos);
    if (contractNos) where.contractNo = { in: contractNos };

    const paymentCategories = this.parseList(q.paymentCategories);
    if (paymentCategories) {
      where.paymentCategory = { in: paymentCategories as OplataKvCategory[] };
    }

    const clients = this.parseList(q.clients);
    if (clients) where.client = { in: clients };

    const objects = this.parseList(q.objects);
    if (objects) where.object = { in: objects };

    const paymentMethods = this.parseList(q.paymentMethods);
    if (paymentMethods) where.paymentMethod = { in: paymentMethods };

    const txTypes = this.parseList(q.txTypes);
    if (txTypes) where.txType = { in: txTypes };

    // ─── Manba filter: manual | excel | transaction ───
    const sources = this.parseList(q.sources);
    if (sources) {
      const ors: Prisma.OplataKvWhereInput[] = [];
      if (sources.includes('transaction')) ors.push({ sourceTxId: { not: null } });
      if (sources.includes('excel'))       ors.push({ sourceTxId: null, importBatchId: { not: null } });
      if (sources.includes('manual'))      ors.push({ sourceTxId: null, importBatchId: null });
      if (ors.length === 1) Object.assign(where, ors[0]);
      else if (ors.length > 1) {
        // Hozirgi OR'ni saqlab, qo'shimcha OR sifatida AND qilamiz
        if (where.OR) {
          where.AND = [{ OR: where.OR }, { OR: ors }];
          delete where.OR;
        } else {
          where.OR = ors;
        }
      }
    }

    return where;
  }

  // ───────────────── LIST ─────────────────
  async list(q: ListOplataKvDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const perPage = Math.min(200, Math.max(1, Number(q.perPage) || 50));

    const where = this.buildWhere(q);

    const sortBy = q.sortBy || 'date';
    const sortDir: 'asc' | 'desc' = q.sortDir || 'desc';
    const orderBy: Prisma.OplataKvOrderByWithRelationInput = { [sortBy]: sortDir } as any;

    const [items, total, sums] = await Promise.all([
      this.prisma.oplataKv.findMany({
        where, orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.oplataKv.count({ where }),
      this.prisma.oplataKv.aggregate({
        where,
        _sum: { paymentAmount: true, firstInstallment: true, monthlyAmount: true },
      }),
    ]);

    return {
      ok: true,
      page, perPage, total,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      items,
      sums: {
        paymentAmount:    Number(sums._sum.paymentAmount    ?? 0),
        firstInstallment: Number(sums._sum.firstInstallment ?? 0),
        monthlyAmount:    Number(sums._sum.monthlyAmount    ?? 0),
      },
    };
  }

  // ───────────────── FIND ONE ─────────────────
  async findOne(id: string) {
    const row = await this.prisma.oplataKv.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('ОплатыКв qator topilmadi');
    return { ok: true, item: row };
  }

  // ───────────────── SYNC FROM TRANSACTIONS (avto-import) ─────────────────
  /**
   * Tranzaksiyalardan OplatyKv'ga avto-import.
   * Shartlar:
   *  - direction = 'IN' (kirim)
   *  - category.code = 'CLIENT' (Клиент / Физ.Л / Юр.Л)
   *  - contractNumber not null (shartnoma raqami bor)
   *  - txnDate > minDate (foydalanuvchi sozlamasi)
   *
   * Dedup: sourceTxId (unique) orqali — mavjud bo'lsa update, bo'lmasa create.
   */
  async syncFromTransactions(opts: { minDate?: Date | null; actor?: Actor } = {}) {
    const startedAt = Date.now();
    const minDate = opts.minDate ?? null;

    const where: Prisma.TransactionWhereInput = {
      direction: 'IN',
      category: { code: 'CLIENT' },
      contractNumber: { not: null },
    };
    if (minDate) {
      // Foydalanuvchi kiritgan sananing OXIRGI sekundidan (23:59:59.999) keyingi tranzaksiyalar
      // Misol: 30.04.2026 qo'ysangiz, 01.05.2026 00:00 dan boshlab olinadi (shu sana o'zi olinmaydi)
      const dayEnd = new Date(minDate);
      dayEnd.setUTCHours(23, 59, 59, 999);
      where.txnDate = { gt: dayEnd };
    }

    const txList = await this.prisma.transaction.findMany({
      where,
      select: {
        id: true,
        externalId: true,
        txnDate: true,
        amount: true,
        contractNumber: true,
        description: true,
        fromName: true,
      },
      orderBy: { txnDate: 'asc' },
    });

    if (txList.length === 0) {
      return {
        ok: true,
        total: 0, added: 0, updated: 0, skipped: 0,
        duration: Math.round((Date.now() - startedAt) / 1000),
        minDate: minDate ? minDate.toISOString().slice(0, 10) : null,
      };
    }

    // CRM contract cache'dan object va client'larni olamiz (bir martalik query)
    const contractNos = Array.from(new Set(txList.map((t) => t.contractNumber).filter((c): c is string => !!c)));
    const crmContracts = await this.prisma.crmContract.findMany({
      where: { contractNumber: { in: contractNos } },
      select: { contractNumber: true, customerName: true, objectName: true },
    });
    const crmByContract = new Map(crmContracts.map((c) => [c.contractNumber, c]));

    // Object mapping (CRM nomi -> OplatyKv nomi)
    const mappings = await this.prisma.oplataKvObjectMapping.findMany();
    const objMap = new Map(mappings.map((m) => [m.crmName.trim().toLowerCase(), m.oplataName]));
    const mapObject = (crmName: string | null | undefined): string | null => {
      if (!crmName) return null;
      const mapped = objMap.get(crmName.trim().toLowerCase());
      return mapped || crmName;
    };

    let added = 0;
    let updated = 0;
    // Skip sabablari alohida — debugging uchun
    let skippedNoData = 0;     // contractNumber yoki txnDate yo'q
    let skippedExists = 0;     // mavjud va o'zgarmagan
    let skippedError = 0;      // create/update da xato
    const errorSamples: Array<{ txId: string; reason: string }> = [];
    const actorName = opts.actor?.name || 'auto · tranzaksiyadan';

    for (const tx of txList) {
      if (!tx.contractNumber || !tx.txnDate) { skippedNoData++; continue; }
      const crm = crmByContract.get(tx.contractNumber);
      const amount = new Prisma.Decimal(tx.amount);
      // Tranzaksiya externalId — bank kompozit ID (masalan: 5606448707_439_22.05.2026_...)
      // Agar externalId bo'lsa — uni OplatyKv.id va sourceTxId qilib ishlatamiz (dedup va kuzatish uchun)
      // Bo'lmasa — fallback: random UUID + tx.id (cuid)
      const oplataId = tx.externalId || randomUUID();
      const dedupKey = tx.externalId || tx.id;

      const data: Prisma.OplataKvUncheckedCreateInput = {
        id: oplataId,
        contractNo: tx.contractNumber,
        date: tx.txnDate,
        paymentAmount: amount,
        purpose: tx.description || null,
        txType: 'Взносы за квартиры',
        client: crm?.customerName || tx.fromName || null,
        object: mapObject(crm?.objectName),
        sourceTxId: dedupKey,
        createdByName: actorName,
      };

      try {
        const existing = await this.prisma.oplataKv.findUnique({
          where: { sourceTxId: dedupKey },
          select: { id: true, paymentAmount: true, contractNo: true, date: true },
        });
        if (existing) {
          // Yangilanish kerakmi?
          const amountChanged   = Number(existing.paymentAmount || 0) !== Number(amount);
          const contractChanged = existing.contractNo !== tx.contractNumber;
          const dateChanged     = new Date(existing.date).getTime() !== new Date(tx.txnDate).getTime();
          if (amountChanged || contractChanged || dateChanged) {
            const updateData = {
              contractNo: tx.contractNumber,
              date: tx.txnDate,
              paymentAmount: amount,
              purpose: tx.description || null,
              client: crm?.customerName || tx.fromName || null,
              object: mapObject(crm?.objectName),
            };
            await this.prisma.oplataKv.update({
              where: { id: existing.id },
              data: updateData,
            });
            // History — edited
            await this.prisma.oplataKvHistory.create({
              data: {
                oplataKvId: existing.id,
                action: 'edited',
                actorType: 'system',
                actorId: null,
                actorName: actorName,
                fieldsChanged: ['paymentAmount', 'contractNo', 'date'].filter((f) => {
                  if (f === 'paymentAmount') return amountChanged;
                  if (f === 'contractNo')    return contractChanged;
                  if (f === 'date')          return dateChanged;
                  return false;
                }),
                changes: this.serializeForHistory(updateData) as any,
                note: `Tranzaksiyadan yangilandi (txId: ${tx.id})`,
              },
            });
            updated++;
          } else {
            skippedExists++;
          }
        } else {
          const created = await this.prisma.oplataKv.create({ data });
          // History — created
          await this.prisma.oplataKvHistory.create({
            data: {
              oplataKvId: created.id,
              action: 'created',
              actorType: 'system',
              actorId: null,
              actorName: actorName,
              fieldsChanged: Object.keys(data).filter((k) => k !== 'id'),
              changes: this.serializeForHistory(data) as any,
              note: `Tranzaksiyadan avto-import (txId: ${tx.id}, externalId: ${tx.externalId || '—'})`,
            },
          });
          added++;
        }
      } catch (e: any) {
        const reason = e?.message || 'unknown';
        this.log.warn(`syncFromTransactions: tx ${tx.id} (ext=${tx.externalId}) → xato: ${reason}`);
        skippedError++;
        if (errorSamples.length < 5) {
          errorSamples.push({ txId: tx.externalId || tx.id, reason });
        }
      }
    }

    const duration = Math.round((Date.now() - startedAt) / 1000);
    const skippedTotal = skippedNoData + skippedExists + skippedError;
    this.log.log(
      `syncFromTransactions: total=${txList.length} added=${added} updated=${updated} ` +
      `skipped=${skippedTotal} (noData=${skippedNoData} exists=${skippedExists} error=${skippedError}) ` +
      `duration=${duration}s`,
    );
    return {
      ok: true,
      total: txList.length,
      added,
      updated,
      skipped: skippedTotal,
      skippedBreakdown: {
        noData: skippedNoData,     // contractNumber yoki txnDate yo'q
        exists: skippedExists,     // mavjud va o'zgarmagan
        error:  skippedError,      // create/update da xato
      },
      errorSamples,
      duration,
      minDate: minDate ? minDate.toISOString().slice(0, 10) : null,
    };
  }

  // ───────────────── OBJECT MAPPING (CRM nomi → OplatyKv nomi) ─────────────────
  async listObjectMappings() {
    const items = await this.prisma.oplataKvObjectMapping.findMany({
      orderBy: { crmName: 'asc' },
    });
    return { ok: true, items };
  }

  async createObjectMapping(crmName: string, oplataName: string, actor: Actor) {
    const cn = crmName?.trim();
    const on = oplataName?.trim();
    if (!cn || !on) throw new BadRequestException("CRM va OplatyKv nomi bo'sh bo'lmasligi kerak");
    try {
      const item = await this.prisma.oplataKvObjectMapping.create({
        data: {
          crmName: cn,
          oplataName: on,
          createdByName: actor.name ?? null,
        },
      });
      return { ok: true, item };
    } catch (e: any) {
      if (e?.code === 'P2002') throw new BadRequestException(`'${cn}' uchun mapping allaqachon mavjud`);
      throw e;
    }
  }

  async deleteObjectMapping(id: string) {
    try {
      await this.prisma.oplataKvObjectMapping.delete({ where: { id } });
      return { ok: true };
    } catch {
      throw new NotFoundException('Mapping topilmadi');
    }
  }

  /**
   * Tranzaksiya-manba (sourceTxId not null) OplatyKv qatorlarini o'chirish.
   * Optional: belgilangan sana bo'yicha filter.
   * Foydalanish: noto'g'ri sana bilan sync qilinganni tozalab, qaytadan sync qilish.
   */
  async cleanupTxSource(opts: { dateFrom?: string | null; dateTo?: string | null; actor?: Actor } = {}) {
    const where: Prisma.OplataKvWhereInput = {
      sourceTxId: { not: null },
    };
    if (opts.dateFrom || opts.dateTo) {
      const dateFilter: any = {};
      if (opts.dateFrom) {
        const d = new Date(opts.dateFrom);
        if (isNaN(d.getTime())) throw new BadRequestException("Noto'g'ri dateFrom");
        d.setUTCHours(0, 0, 0, 0);
        dateFilter.gte = d;
      }
      if (opts.dateTo) {
        const d = new Date(opts.dateTo);
        if (isNaN(d.getTime())) throw new BadRequestException("Noto'g'ri dateTo");
        d.setUTCHours(23, 59, 59, 999);
        dateFilter.lte = d;
      }
      where.date = dateFilter;
    }
    // O'chiriladigan qatorlarni avval olamiz — history uchun
    const toDelete = await this.prisma.oplataKv.findMany({
      where,
      select: { id: true, contractNo: true, paymentAmount: true, date: true, sourceTxId: true },
    });
    const actorName = opts.actor?.name || 'system · cleanup';
    // History (deleted) — har biri uchun
    if (toDelete.length > 0) {
      await this.prisma.oplataKvHistory.createMany({
        data: toDelete.map((r) => ({
          oplataKvId: r.id,
          action: 'deleted',
          actorType: opts.actor?.id ? 'user' : 'system',
          actorId: opts.actor?.id ?? null,
          actorName,
          fieldsChanged: [],
          changes: {
            contractNo: { old: r.contractNo, new: null },
            paymentAmount: { old: r.paymentAmount?.toString(), new: null },
            date: { old: r.date?.toISOString(), new: null },
            sourceTxId: { old: r.sourceTxId, new: null },
          } as any,
          note: `Tranzaksiya-manba tozalash${
            opts.dateFrom || opts.dateTo
              ? ` (${opts.dateFrom || '∞'}…${opts.dateTo || '∞'})`
              : ''
          }`,
        })),
      });
    }
    const result = await this.prisma.oplataKv.deleteMany({ where });
    const range = opts.dateFrom || opts.dateTo
      ? `${opts.dateFrom || '∞'}…${opts.dateTo || '∞'}`
      : 'ALL';
    this.log.warn(`cleanupTxSource: deleted=${result.count} range=${range}`);
    return {
      ok: true,
      deleted: result.count,
      matched: toDelete.length,
      dateFrom: opts.dateFrom || null,
      dateTo: opts.dateTo || null,
    };
  }

  // ───────────────── CRM SVERKA (OplatyKv vs XonSaroy CRM taqqoslash) ─────────────────
  /**
   * Bitta shartnoma uchun:
   * - OplatyKv qatorlari + jami (bizning DB)
   * - XonSaroy CRM payment_histories (tashqi API)
   * - Taqqoslash: jami summa, boshlangich, oylik
   */
  async crmSverka(contractNo: string) {
    if (!contractNo || !contractNo.trim()) {
      return { ok: false, error: "contractNo bo'sh" };
    }
    const cn = contractNo.trim();

    const [oplataItems, crmResp] = await Promise.all([
      this.prisma.oplataKv.findMany({
        where: { contractNo: cn },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      this.crmService.show({ contract: cn }).catch((e) => ({ ok: false, error: e?.message || 'CRM xato' })),
    ]);

    // OplatyKv summalari (kategoriya bo'yicha)
    const oplataInitial = oplataItems.reduce((s, i) => s + Number(i.firstInstallment || 0), 0);
    const oplataMonthly = oplataItems.reduce((s, i) => s + Number(i.monthlyAmount    || 0), 0);
    const oplataTotalPayment = oplataItems.reduce((s, i) => s + Number(i.paymentAmount || 0), 0);

    // CRM payment_histories'ni boshlangich/oylik bo'yicha guruhlash
    const detail: any = (crmResp as any)?.detail || null;
    const histories: any[] = Array.isArray(detail?.payment_histories) ? detail.payment_histories : [];

    const crmHistInitial: any[] = [];
    const crmHistMonthly: any[] = [];
    for (const h of histories) {
      const k = String(h?.type?.key || '').toLowerCase();
      if (k.includes('init') || k.includes('boshlang') || k.includes('перво')) crmHistInitial.push(h);
      else crmHistMonthly.push(h);
    }

    const crmInitialSum = crmHistInitial.reduce((s, h) => s + Number(h?.amount || 0), 0);
    const crmMonthlySum = crmHistMonthly.reduce((s, h) => s + Number(h?.amount || 0), 0);
    const crmTotalPaid  = crmInitialSum + crmMonthlySum;

    // Taqqoslash — har kategoriya
    const diffTotal   = oplataTotalPayment - crmTotalPaid;
    const diffInitial = oplataInitial - crmInitialSum;
    const diffMonthly = oplataMonthly - crmMonthlySum;
    const matched     = Math.abs(diffTotal) < 0.01;

    return {
      ok: true,
      contractNo: cn,
      crmConnected: (crmResp as any)?.ok !== false,
      oplata: {
        items: oplataItems,
        count: oplataItems.length,
        totalPayment: oplataTotalPayment,
        initial: oplataInitial,
        monthly: oplataMonthly,
      },
      crm: {
        connected: (crmResp as any)?.ok !== false,
        error: (crmResp as any)?.ok === false ? (crmResp as any).error : null,
        contractInfo: detail ? {
          price:        Number(detail?.price || 0),
          contractDate: detail?.contract_date || null,
          status:       detail?.status?.key || null,
          initialPlan:  Number(detail?.initial?.total?.amount || 0),
          initialPaid:  Number(detail?.initial?.total?.paid   || 0),
          monthlyPlan:  Number(detail?.monthly?.total?.amount || 0),
          monthlyPaid:  Number(detail?.monthly?.total?.paid   || 0),
        } : null,
        histories: histories.map((h) => ({
          amount:    Number(h?.amount || 0),
          datePaid:  h?.date_paid || null,
          typeKey:   String(h?.type?.key || ''),
          typeLabel: h?.type?.value?.name?.uz || h?.type?.value?.name?.ru || '',
        })),
        count: histories.length,
        initialSum: crmInitialSum,
        monthlySum: crmMonthlySum,
        totalPaid:  crmTotalPaid,
      },
      comparison: {
        oplataTotal: oplataTotalPayment,
        crmTotal:    crmTotalPaid,
        diff:        diffTotal,
        diffInitial,
        diffMonthly,
        matched,
        status: matched ? 'ok' : (diffTotal > 0 ? 'oplata-more' : 'crm-more'),
      },
    };
  }

  // ───────────────── BY CONTRACT (Akt Sverka) ─────────────────
  /**
   * Bitta shartnoma bo'yicha barcha to'lovlar tarixi + jami summalar.
   * Akt sverka modal'i uchun.
   */
  async findByContract(contractNo: string) {
    if (!contractNo || !contractNo.trim()) {
      return { ok: false, error: "contractNo bo'sh", items: [], sums: null, meta: null };
    }
    const items = await this.prisma.oplataKv.findMany({
      where: { contractNo: contractNo.trim() },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    const sums = {
      paymentAmount:    items.reduce((s, i) => s + Number(i.paymentAmount    || 0), 0),
      firstInstallment: items.reduce((s, i) => s + Number(i.firstInstallment || 0), 0),
      monthlyAmount:    items.reduce((s, i) => s + Number(i.monthlyAmount    || 0), 0),
    };
    // Eng so'nggi mijoz/obyekt ma'lumotini olamiz (eng yangi qatordan)
    const latest = items[items.length - 1];
    const meta = latest ? {
      client:        latest.client,
      object:        latest.object,
      paymentMethod: latest.paymentMethod,
      firstDate:     items[0]?.date || null,
      lastDate:      latest.date,
    } : null;
    return {
      ok: true,
      contractNo: contractNo.trim(),
      count: items.length,
      items,
      sums,
      meta,
    };
  }

  // ───────────────── EXPORT (Excel / JSON) ─────────────────
  /** Filtr bo'yicha BARCHA qatorlarni qaytaradi (export uchun). */
  private async fetchAllForExport(q: ListOplataKvDto) {
    const where = this.buildWhere(q);
    const sortBy = q.sortBy || 'date';
    const sortDir: 'asc' | 'desc' = q.sortDir || 'desc';
    return this.prisma.oplataKv.findMany({
      where,
      orderBy: { [sortBy]: sortDir } as any,
    });
  }

  // ───────────────── DISTINCT (column filter popover) ─────────────────
  /**
   * Berilgan ustun uchun distinct qiymatlar.
   * SELF-EXCLUSION: shu ustunning o'z filtri istisno qilinadi (foydalanuvchi qaytadan tanlay olsin).
   */
  async distinctValues(
    column: string,
    q: ListOplataKvDto,
    search?: string,
  ): Promise<{ ok: true; values: Array<{ id: string; name: string }> }> {
    // Column → DTO field nomi va self-exclusion uchun
    const COLUMN_TO_PARAM: Record<string, keyof ListOplataKvDto> = {
      contractNo:      'contractNos',
      paymentCategory: 'paymentCategories',
      client:          'clients',
      object:          'objects',
      paymentMethod:   'paymentMethods',
      txType:          'txTypes',
    };

    // Column DB field
    const COLUMN_TO_FIELD: Record<string, keyof Prisma.OplataKvScalarFieldEnum | string> = {
      contractNo:      'contractNo',
      paymentCategory: 'paymentCategory',
      client:          'client',
      object:          'object',
      paymentMethod:   'paymentMethod',
      txType:          'txType',
    };

    // Source ustun — fixed options (DB'dan emas)
    if (column === 'source') {
      const fixed = [
        { id: 'manual',      name: "Qo'lda" },
        { id: 'excel',       name: 'Excel' },
        { id: 'transaction', name: 'Tranzaksiya' },
      ];
      const filtered = search
        ? fixed.filter((v) => v.name.toLowerCase().includes(search.toLowerCase()))
        : fixed;
      return { ok: true, values: filtered };
    }

    const field = COLUMN_TO_FIELD[column];
    if (!field) return { ok: true, values: [] };

    // Self-exclusion: shu ustunning filtri olib tashlanadi
    const queryCopy: any = { ...q };
    const selfParam = COLUMN_TO_PARAM[column];
    if (selfParam) delete queryCopy[selfParam];

    // PaymentCategory enum — alohida ko'rib chiqamiz (contains qabul qilmaydi)
    if (column === 'paymentCategory') {
      const rows = await this.prisma.oplataKv.findMany({
        where: this.buildWhere(queryCopy),
        select: { paymentCategory: true },
        distinct: ['paymentCategory'],
        take: 50,
      });
      const labels: Record<string, string> = {
        MONTHLY: 'ежемесячный',
        FIRST:   '1 взнос',
        GENERAL: 'Общий',
      };
      let values = rows
        .map((r) => r.paymentCategory)
        .filter((v): v is OplataKvCategory => !!v)
        .map((v) => ({ id: v, name: labels[v] || v }));
      if (search) {
        const s = search.toLowerCase();
        values = values.filter((v) => v.name.toLowerCase().includes(s));
      }
      return { ok: true, values };
    }

    // Boshqa text columnlar
    // Qaysi maydon nullable — schema bo'yicha (contractNo required, qolganlar nullable)
    const NULLABLE_FIELDS = new Set(['client', 'object', 'paymentMethod', 'purpose', 'note', 'txType']);

    const where = this.buildWhere(queryCopy);

    // Search filterini qo'shamiz (lekin not:null faqat nullable maydonlar uchun)
    const fieldFilter: any = {};
    if (NULLABLE_FIELDS.has(String(field))) fieldFilter.not = null;
    if (search) {
      fieldFilter.contains = search;
      fieldFilter.mode = 'insensitive';
    }
    if (Object.keys(fieldFilter).length > 0) {
      (where as any)[field] = fieldFilter;
    }

    const rows = await this.prisma.oplataKv.findMany({
      where,
      select: { [field]: true } as any,
      distinct: [field as any],
      take: 300,
    });
    let values = rows
      .map((r: any) => r[field])
      .filter((v: any) => v !== null && v !== undefined && String(v).trim() !== '')
      .map((v: any) => ({ id: String(v), name: String(v) }));

    // Alifbo tartibida
    values.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    return { ok: true, values };
  }

  async exportXlsx(q: ListOplataKvDto): Promise<{ buffer: Buffer; filename: string }> {
    const items = await this.fetchAllForExport(q);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('ОплатыКв');

    ws.columns = [
      { header: 'Дог №',          key: 'contractNo',       width: 16 },
      { header: 'Дата',           key: 'date',             width: 12 },
      { header: 'Сумма оплаты',   key: 'paymentAmount',    width: 18 },
      { header: '1 взнос',        key: 'firstInstallment', width: 18 },
      { header: 'Ежемесячный',    key: 'monthlyAmount',    width: 18 },
      { header: 'Оплата',         key: 'paymentCategory',  width: 14 },
      { header: 'Клиент',         key: 'client',           width: 28 },
      { header: 'Объект',         key: 'object',           width: 22 },
      { header: 'Способ оплаты',  key: 'paymentMethod',    width: 22 },
      { header: 'Назначение',     key: 'purpose',          width: 42 },
      { header: 'Тип',            key: 'txType',           width: 14 },
      { header: 'Примечание',     key: 'note',             width: 28 },
      { header: 'ID',             key: 'id',               width: 38 },
    ];

    const head = ws.getRow(1);
    head.font = { bold: true, size: 10 };
    head.height = 22;
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    const categoryLabel: Record<string, string> = {
      MONTHLY: 'ежемесячный',
      FIRST:   '1 взнос',
      GENERAL: 'Общий',
    };

    for (const it of items) {
      let date = '';
      if (it.date) {
        const d = new Date(it.date);
        const dd = String(d.getUTCDate()).padStart(2, '0');
        const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
        date = `${dd}.${mm}.${d.getUTCFullYear()}`;
      }
      const row = ws.addRow({
        contractNo: it.contractNo || '',
        date,
        paymentAmount:    it.paymentAmount    ? Number(it.paymentAmount)    : null,
        firstInstallment: it.firstInstallment ? Number(it.firstInstallment) : null,
        monthlyAmount:    it.monthlyAmount    ? Number(it.monthlyAmount)    : null,
        paymentCategory:  it.paymentCategory ? (categoryLabel[it.paymentCategory] || it.paymentCategory) : '',
        client: it.client || '',
        object: it.object || '',
        paymentMethod: it.paymentMethod || '',
        purpose: it.purpose || '',
        txType: it.txType || '',
        note: it.note || '',
        id: it.id,
      });
      row.font = { size: 9 };
      row.getCell('paymentAmount').numFmt    = '#,##0.00';
      row.getCell('firstInstallment').numFmt = '#,##0.00';
      row.getCell('monthlyAmount').numFmt    = '#,##0.00';
      row.getCell('date').numFmt = '@';
      row.getCell('date').alignment = { horizontal: 'center' };
    }

    // Yakuniy yig'indi qatori
    if (items.length > 0) {
      const totalRow = ws.addRow({
        contractNo: 'ИТОГО:',
        paymentAmount:    items.reduce((s, x) => s + Number(x.paymentAmount || 0), 0),
        firstInstallment: items.reduce((s, x) => s + Number(x.firstInstallment || 0), 0),
        monthlyAmount:    items.reduce((s, x) => s + Number(x.monthlyAmount || 0), 0),
      });
      totalRow.font = { bold: true, size: 10 };
      totalRow.getCell('paymentAmount').numFmt    = '#,##0.00';
      totalRow.getCell('firstInstallment').numFmt = '#,##0.00';
      totalRow.getCell('monthlyAmount').numFmt    = '#,##0.00';
      totalRow.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      });
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ts = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `oplaty-kv-${ts}.xlsx` };
  }

  async exportJson(q: ListOplataKvDto): Promise<{ buffer: Buffer; filename: string }> {
    const items = await this.fetchAllForExport(q);
    const json = JSON.stringify({
      exportedAt: new Date().toISOString(),
      total: items.length,
      filter: { q: q.q || null, dateFrom: q.dateFrom || null, dateTo: q.dateTo || null, paymentCategory: q.paymentCategory || null },
      items,
    }, null, 2);
    const buffer = Buffer.from(json, 'utf8');
    const ts = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `oplaty-kv-${ts}.json` };
  }

  // ───────────────── HISTORY ─────────────────
  async getHistory(id: string, limit = 100) {
    const items = await this.prisma.oplataKvHistory.findMany({
      where: { oplataKvId: id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(500, Math.max(1, limit)),
    });
    return { ok: true, items };
  }

  // ───────────────── CREATE ─────────────────
  async create(dto: CreateOplataKvDto, actor: Actor) {
    const data: any = {
      contractNo: dto.contractNo,
      date: new Date(dto.date),
      paymentAmount:    dto.paymentAmount    != null ? new Prisma.Decimal(dto.paymentAmount)    : null,
      firstInstallment: dto.firstInstallment != null ? new Prisma.Decimal(dto.firstInstallment) : null,
      monthlyAmount:    dto.monthlyAmount    != null ? new Prisma.Decimal(dto.monthlyAmount)    : null,
      purpose:        dto.purpose         ?? null,
      txType:         dto.txType          ?? null,
      note:           dto.note            ?? null,
      paymentCategory: dto.paymentCategory ?? null,
      object:         dto.object          ?? null,
      client:         dto.client          ?? null,
      paymentMethod:  dto.paymentMethod   ?? null,
      createdById:    actor.id   ?? null,
      createdByName:  actor.name ?? null,
    };

    const created = await this.prisma.oplataKv.create({ data });

    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: created.id,
        action: 'created',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: Object.keys(data).filter((k) => k !== 'createdById' && k !== 'createdByName'),
        changes: this.serializeForHistory(data) as any,
        note: 'Yangi qator yaratildi',
      },
    });

    return { ok: true, item: created };
  }

  // ───────────────── UPDATE ─────────────────
  async update(id: string, dto: UpdateOplataKvDto, actor: Actor) {
    const before = await this.prisma.oplataKv.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('ОплатыКв qator topilmadi');

    const data: any = {};
    if (dto.contractNo       !== undefined) data.contractNo       = dto.contractNo;
    if (dto.date             !== undefined) data.date             = new Date(dto.date as string);
    if (dto.paymentAmount    !== undefined) data.paymentAmount    = dto.paymentAmount    === null ? null : new Prisma.Decimal(dto.paymentAmount as number);
    if (dto.firstInstallment !== undefined) data.firstInstallment = dto.firstInstallment === null ? null : new Prisma.Decimal(dto.firstInstallment as number);
    if (dto.monthlyAmount    !== undefined) data.monthlyAmount    = dto.monthlyAmount    === null ? null : new Prisma.Decimal(dto.monthlyAmount as number);
    if (dto.purpose          !== undefined) data.purpose          = dto.purpose;
    if (dto.txType           !== undefined) data.txType           = dto.txType;
    if (dto.note             !== undefined) data.note             = dto.note;
    if (dto.paymentCategory  !== undefined) data.paymentCategory  = dto.paymentCategory ?? null;
    if (dto.object           !== undefined) data.object           = dto.object;
    if (dto.client           !== undefined) data.client           = dto.client;
    if (dto.paymentMethod    !== undefined) data.paymentMethod    = dto.paymentMethod;

    const diff: Record<string, { old: unknown; new: unknown }> = {};
    for (const key of Object.keys(data)) {
      const beforeVal = this.normalizeForDiff((before as any)[key]);
      const afterVal  = this.normalizeForDiff((data as any)[key]);
      if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
        diff[key] = { old: beforeVal, new: afterVal };
      }
    }

    if (Object.keys(diff).length === 0) {
      return { ok: true, item: before, message: 'Hech qanday o\'zgarish yo\'q' };
    }

    const updated = await this.prisma.oplataKv.update({ where: { id }, data });

    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: id,
        action: 'edited',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: Object.keys(diff),
        changes: diff as any,
        note: `Tahrirlandi (${Object.keys(diff).length} ta maydon)`,
      },
    });

    return { ok: true, item: updated };
  }

  // ───────────────── DELETE ─────────────────
  async remove(id: string, actor: Actor) {
    const before = await this.prisma.oplataKv.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('ОплатыКв qator topilmadi');

    // History yozuvini saqlash uchun oldin yozib qoyamiz, keyin onDelete: Cascade
    // tarixni ham o'chiradi — shuning uchun snapshotni alohida arxivga yozamiz.
    // Hozircha: history yozib keyin o'chiramiz.
    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: id,
        action: 'deleted',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: ['*'],
        changes: { snapshot: this.serializeForHistory(before) } as any,
        note: `O'chirildi (${before.contractNo} · ${before.date.toISOString().slice(0, 10)})`,
      },
    });

    await this.prisma.oplataKv.delete({ where: { id } });
    return { ok: true, deletedId: id };
  }

  // ───────────────── helpers ─────────────────
  private normalizeForDiff(v: any) {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object' && 'toFixed' in v) return Number(v); // Decimal
    return v;
  }

  private serializeForHistory(obj: any): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = this.normalizeForDiff(v);
    }
    return out;
  }

  // ───────────────── IMPORT (Excel) ─────────────────
  /**
   * Excel ustunlari (rus sarlavhalar):
   *   A: Дог №                — Shartnoma raqami (majburiy)
   *   B: Дата                 — dd.MM.yyyy (majburiy)
   *   C: Сумма оплаты         — +/- (bo'sh bo'lishi mumkin)
   *   D: 1 взнос              — +/-
   *   E: ежемесячный          — +/-
   *   F: Назначение платежа   — purpose
   *   G: Тип                  — type
   *   H: Примечание           — note
   *   I: Оплата               — ежемесячный | 1 взнос | Общий (mapped)
   *   J: Объект               — object
   *   K: Клиент               — client
   *   L: Способ оплаты        — paymentMethod
   *   M: ID                   — uniq id (majburiy, dublikat skip)
   */
  /**
   * Preview — fayldagi qatorlarni o'qiydi va tekshiradi, lekin BAZAGA QO'SHMAYDI.
   * Cache'ga saqlaydi va previewId qaytaradi. Foydalanuvchi tasdiqlagach commitImport
   * chaqirilib bazaga qo'shiladi.
   *
   * Bu yondashuvning sabablari:
   *   - 230k qatorlik kabi katta fayllarda xato bo'lsa hech narsa qo'shilmaydi
   *   - Foydalanuvchi xatolarni ko'rib qaror qabul qiladi
   *   - Tasodifiy/no'noqlik bilan import qilingan ma'lumot keyin tozalashga to'g'ri kelmaydi
   */
  async previewImport(
    buffer: Buffer,
    actor: Actor,
    fileName?: string,
  ): Promise<ImportPreview> {
    this.cleanExpiredPreviews();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Excel bo'sh");

    const startTs = Date.now();
    const preview: ImportPreview = {
      previewId: '',
      fileName: fileName?.slice(0, 255) || null,
      total: 0,
      willInsert: 0,
      duplicatesInDb: 0,
      duplicatesInFile: 0,
      errors: 0,
      errorRows: [],
      skippedRows: [],
      duration: 0,
      expiresAt: '',
    };

    const { validRows, allCandidateIds } = await this.parseExcelRows(ws, preview);

    // DB'dagi mavjud ID'larni topish
    const existingIdSet = new Set<string>();
    if (allCandidateIds.length > 0) {
      const CHUNK = 5000;
      for (let i = 0; i < allCandidateIds.length; i += CHUNK) {
        const chunk = allCandidateIds.slice(i, i + CHUNK);
        const found = await this.prisma.oplataKv.findMany({
          where: { id: { in: chunk } },
          select: { id: true },
        });
        for (const f of found) existingIdSet.add(f.id);
      }
    }
    preview.duplicatesInDb = existingIdSet.size;

    // Fayl ichidagi takror ID'lar va yakuniy insert ro'yxati
    const seenInFile = new Set<string>();
    const toInsert: any[] = [];
    for (const v of validRows) {
      const id: string = v.data.id;
      if (existingIdSet.has(id)) {
        if (preview.skippedRows.length < 100) {
          preview.skippedRows.push({
            row: v.row, id, contractNo: v.data.contractNo,
            reason: "ID DB'da allaqachon bor",
          });
        }
        continue;
      }
      if (seenInFile.has(id)) {
        preview.duplicatesInFile++;
        if (preview.skippedRows.length < 100) {
          preview.skippedRows.push({
            row: v.row, id, contractNo: v.data.contractNo,
            reason: 'Fayl ichida takror ID',
          });
        }
        continue;
      }
      seenInFile.add(id);
      toInsert.push(v.data);
    }
    preview.willInsert = toInsert.length;
    preview.duration = Math.round((Date.now() - startTs) / 1000);

    // Cache'ga saqlaymiz — foydalanuvchi tasdiqlasa shu yerdan o'qiymiz
    const previewId = randomUUID();
    const expiresAt = Date.now() + this.PREVIEW_TTL_MS;
    preview.previewId = previewId;
    preview.expiresAt = new Date(expiresAt).toISOString();

    this.previewCache.set(previewId, {
      fileName: preview.fileName,
      fileSize: buffer.length,
      toInsert,
      preview,
      expiresAt,
      actor,
    });

    this.log.log(
      `ОплатыКв preview ${previewId.slice(0, 8)}: ${preview.total} jami, ${preview.willInsert} qo'shiladigan, ${preview.duplicatesInDb} DB-dub, ${preview.duplicatesInFile} fayl-dub, ${preview.errors} xato — ${preview.duration}s`,
    );

    return preview;
  }

  /**
   * Commit — previewImport'dagi cache'dan o'qib bazaga BULK qo'shadi.
   * Cache'dan o'chiriladi (yana ishlatib bo'lmaydi).
   */
  async commitImport(previewId: string, actor: Actor): Promise<ImportResult> {
    this.cleanExpiredPreviews();
    const state = this.previewCache.get(previewId);
    if (!state) {
      throw new BadRequestException('Preview topilmadi yoki muddati o\'tgan — qaytadan yuklang');
    }
    // Cache'ni darrov olib tashlaymiz (qayta commit'dan saqlash uchun)
    this.previewCache.delete(previewId);

    const startTs = Date.now();
    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'oplata-kv',
        fileName: state.fileName,
        fileSize: state.fileSize,
        importedBy: actor.name?.slice(0, 190) || state.actor.name?.slice(0, 190) || null,
      },
    });

    const result: ImportResult = {
      total: state.preview.total,
      added: 0,
      skipped: state.preview.duplicatesInDb + state.preview.duplicatesInFile,
      errors: state.preview.errors,
      errorRows: state.preview.errorRows,
      skippedRows: state.preview.skippedRows,
      batchId: batch.id,
      duration: 0,
    };

    // toInsert'ga importBatchId qo'shamiz
    const toInsert = state.toInsert.map((d) => ({ ...d, importBatchId: batch.id }));

    const INSERT_CHUNK = 1000;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK);
      try {
        const r = await this.prisma.oplataKv.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        result.added += r.count;
      } catch (e: any) {
        this.log.error(`Bulk insert xato (chunk ${i}): ${e?.message}`);
        for (const item of chunk) {
          result.errors++;
          if (result.errorRows.length < 200) {
            result.errorRows.push({
              row: -1, reason: `Bulk insert xato: ${e?.message || 'noma\'lum'}`,
              id: item.id, contractNo: item.contractNo,
            });
          }
        }
      }
      if (i % (INSERT_CHUNK * 5) === 0) {
        this.log.log(`ОплатыКв commit: ${i + chunk.length} / ${toInsert.length} qoshildi`);
      }
    }

    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: `BATCH-${batch.id}`,
        action: 'imported',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: ['*'],
        changes: { batchId: batch.id, fileName: state.fileName, count: result.added } as any,
        note: `Excel'dan ${result.added} ta qator import qilindi (batch ${batch.id.slice(0, 8)}, previewId ${previewId.slice(0, 8)})`,
      },
    });

    result.duration = Math.round((Date.now() - startTs) / 1000);

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        rowsTotal:   result.total,
        rowsAdded:   result.added,
        rowsSkipped: result.skipped,
        rowsErrors:  result.errors,
      },
    });

    this.log.log(`ОплатыКв commit ${previewId.slice(0, 8)}: ${result.added} qoshildi, ${result.duration}s`);
    return result;
  }

  /** Cache'dan preview'ni olib tashlash (bekor qilish) */
  cancelPreview(previewId: string): { ok: boolean; canceled: boolean } {
    const had = this.previewCache.has(previewId);
    this.previewCache.delete(previewId);
    return { ok: true, canceled: had };
  }

  /**
   * Asl bir bosqichli import — preview + commit'ni birga bajaradi.
   * Eski client'lar uchun saqlanadi (backwards compat).
   */
  async importExcel(
    buffer: Buffer,
    actor: Actor,
    fileName?: string,
  ): Promise<ImportResult> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Excel bo'sh");

    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'oplata-kv',
        fileName: fileName?.slice(0, 255) || null,
        fileSize: buffer.length,
        importedBy: actor.name?.slice(0, 190) || null,
      },
    });

    const startTs = Date.now();
    const result: ImportResult = {
      total: 0, added: 0, skipped: 0, errors: 0,
      errorRows: [],
      skippedRows: [],
      batchId: batch.id,
      duration: 0,
    };

    // ─── 1-bosqich: barcha qatorlarni Excel'dan o'qib, valid yozuvlarni to'plash ───
    const { validRows, allCandidateIds } = await this.parseExcelRows(ws, result);
    // importBatchId va createdBy ma'lumotlarini har bir qatorga qo'shamiz
    for (const v of validRows) {
      v.data.createdById    = actor.id   ?? null;
      v.data.createdByName  = actor.name ?? null;
      v.data.importBatchId  = batch.id;
    }
    this.log.log(`ОплатыКв import: ${result.total} qator, ${validRows.length} valid, ${result.errors} xato`);

    // ─── 2-bosqich: barcha ID'larni bitta zaprosda tekshirish ───
    const existingIdSet = new Set<string>();
    if (allCandidateIds.length > 0) {
      const CHUNK = 5000;
      for (let i = 0; i < allCandidateIds.length; i += CHUNK) {
        const chunk = allCandidateIds.slice(i, i + CHUNK);
        const found = await this.prisma.oplataKv.findMany({
          where: { id: { in: chunk } },
          select: { id: true },
        });
        for (const f of found) existingIdSet.add(f.id);
      }
    }
    this.log.log(`ОплатыКв import: ${existingIdSet.size} ta dublikat ID topildi`);

    // Dublikatlarni va fayl ichidagi takrorlarni ajratish
    const seenInFile = new Set<string>();
    const toInsert: any[] = [];
    for (const v of validRows) {
      const id: string = v.data.id;
      if (existingIdSet.has(id) || seenInFile.has(id)) {
        result.skipped++;
        if (result.skippedRows.length < 100) {
          result.skippedRows.push({
            row: v.row,
            id,
            contractNo: v.data.contractNo,
            reason: existingIdSet.has(id) ? 'ID DB\'da allaqachon bor' : 'Fayl ichida takror ID',
          });
        }
        continue;
      }
      seenInFile.add(id);
      toInsert.push(v.data);
    }

    // ─── 3-bosqich: BULK INSERT (chunk'larda) ───
    const INSERT_CHUNK = 1000;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK);
      try {
        const r = await this.prisma.oplataKv.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        result.added += r.count;
      } catch (e: any) {
        this.log.error(`Bulk insert xato (chunk ${i}): ${e?.message}`);
        // Chunk xato bersa, qatorlarni alohida xato qilamiz
        for (const item of chunk) {
          result.errors++;
          if (result.errorRows.length < 200) {
            result.errorRows.push({
              row: -1, reason: `Bulk insert xato: ${e?.message || 'noma\'lum'}`,
              id: item.id, contractNo: item.contractNo,
            });
          }
        }
      }
      if (i % (INSERT_CHUNK * 5) === 0) {
        this.log.log(`ОплатыКв import: ${i + chunk.length} / ${toInsert.length} qoshildi`);
      }
    }

    // ─── 4-bosqich: BULK HISTORY (bitta yozuv har 1000 qator uchun emas, batch summary uchun) ───
    // Har bir qator uchun alohida history yozuvi yaratish o'rniga, bitta batch summary yozamiz.
    // Bu 70k qator uchun 70k → 1 yozuv (juda tez).
    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: `BATCH-${batch.id}`, // batch-level marker
        action: 'imported',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: ['*'],
        changes: { batchId: batch.id, fileName, count: result.added } as any,
        note: `Excel'dan ${result.added} ta qator import qilindi (batch ${batch.id.slice(0, 8)})`,
      },
    });

    result.duration = Math.round((Date.now() - startTs) / 1000);

    // Batch ma'lumotlarini yangilab qoyamiz
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        rowsTotal:   result.total,
        rowsAdded:   result.added,
        rowsSkipped: result.skipped,
        rowsErrors:  result.errors,
      },
    });

    this.log.log(`ОплатыКв import: ${result.added} qoshildi, ${result.skipped} skip, ${result.errors} xato`);
    return result;
  }

  /**
   * Importni o'chirish — batch'dagi barcha oplata_kv qatorlarini va batch'ning o'zini o'chiradi.
   * History (oplata_kv_history) qoladi — audit log uchun.
   */
  async deleteImportBatch(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BadRequestException('Import batch topilmadi');
    if (batch.kind !== 'oplata-kv') {
      throw new BadRequestException('Bu batch oplata-kv emas');
    }

    const CHUNK = 500;
    let totalDeleted = 0;
    while (true) {
      const rows = await this.prisma.oplataKv.findMany({
        where: { importBatchId: batchId },
        select: { id: true },
        take: CHUNK,
      });
      if (rows.length === 0) break;
      const ids = rows.map((r) => r.id);

      // Audit yozuvi — har bir qatorni o'chirilganini history'ga yozamiz
      const historyData: any[] = ids.map((id) => ({
        oplataKvId: id,
        action: 'deleted',
        actorType: 'system',
        actorId: null,
        actorName: `import-batch-delete (${batchId.slice(0, 8)})`,
        fieldsChanged: ['*'],
        changes: { reason: 'Import batch o\'chirildi' },
        note: `Import batch ${batchId.slice(0, 8)} bilan birga o'chirildi`,
      }));
      await this.prisma.oplataKvHistory.createMany({ data: historyData });

      const r = await this.prisma.oplataKv.deleteMany({ where: { id: { in: ids } } });
      totalDeleted += r.count;
    }

    await this.prisma.importBatch.delete({ where: { id: batchId } });
    return { ok: true, deleted: totalDeleted };
  }

  /**
   * Excel sheet'dan qatorlarni o'qib valid yozuvlar va kandidat ID'larni qaytaradi.
   * Xato qatorlar accumulator.errors va errorRows ga yoziladi (preview yoki ImportResult).
   * previewImport va importExcel ikkalasi ishlatadi.
   */
  private async parseExcelRows(
    ws: ExcelJS.Worksheet,
    accumulator: { total: number; errors: number; errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }> },
  ): Promise<{
    validRows: Array<{ row: number; data: any }>;
    allCandidateIds: string[];
  }> {
    const rowCount = ws.actualRowCount || ws.rowCount;
    const validRows: Array<{ row: number; data: any }> = [];
    const allCandidateIds: string[] = [];

    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const hasAny = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].some((c) => this.cellText(row.getCell(c)) !== '');
      if (!hasAny) continue;

      accumulator.total++;
      const contractNo = this.cellText(row.getCell(1));
      const idValue   = this.cellText(row.getCell(13));

      try {
        const dateRaw   = row.getCell(2).value;
        if (!contractNo) throw new Error('Дог № bo\'sh');
        if (!idValue)    throw new Error('ID ustuni bo\'sh — majburiy');

        const date = this.parseDate(dateRaw);
        if (!date) throw new Error('Дата formati noto\'g\'ri (kerakli: dd.mm.yyyy)');

        const paymentAmount    = this.parseAmountOrNull(row.getCell(3).value);
        const firstInstallment = this.parseAmountOrNull(row.getCell(4).value);
        const monthlyAmount    = this.parseAmountOrNull(row.getCell(5).value);

        validRows.push({
          row: r,
          data: {
            id: idValue,
            contractNo: contractNo.slice(0, 50),
            date,
            paymentAmount:    paymentAmount    !== null ? new Prisma.Decimal(paymentAmount)    : null,
            firstInstallment: firstInstallment !== null ? new Prisma.Decimal(firstInstallment) : null,
            monthlyAmount:    monthlyAmount    !== null ? new Prisma.Decimal(monthlyAmount)    : null,
            purpose:        this.cellText(row.getCell(6)) || null,
            txType:         this.cellText(row.getCell(7)).slice(0, 60) || null,
            note:           this.cellText(row.getCell(8)) || null,
            paymentCategory: this.parseCategory(this.cellText(row.getCell(9))),
            object:         this.cellText(row.getCell(10)).slice(0, 255) || null,
            client:         this.cellText(row.getCell(11)).slice(0, 255) || null,
            paymentMethod:  this.cellText(row.getCell(12)).slice(0, 120) || null,
          },
        });
        allCandidateIds.push(idValue);
      } catch (e: any) {
        accumulator.errors++;
        if (accumulator.errorRows.length < 200) {
          accumulator.errorRows.push({
            row: r,
            reason: e?.message || 'Noma\'lum xato',
            id: idValue || undefined,
            contractNo: contractNo || undefined,
          });
        }
      }
    }

    return { validRows, allCandidateIds };
  }

  // ─── Excel parsing helpers ───────────────────────────
  private cellText(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v == null) return '';
    if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text).trim();
    if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result).trim();
    return String(v).trim();
  }

  /** "100 000,50" | "100000.5" | number → number | null */
  private parseAmountOrNull(raw: any): number | null {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number') return raw;
    const s = String(raw).trim().replace(/\s/g, '').replace(/,/g, '.');
    if (!s) return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  /** dd.MM.yyyy | yyyy-MM-dd | Date | Excel date number → Date | null */
  private parseDate(raw: any): Date | null {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    if (typeof raw === 'number') {
      // Excel date serial
      const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
      return isNaN(d.getTime()) ? null : d;
    }
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  /** Excel'dagi "ежемесячный" | "1 взнос" | "Общий" → enum yoki null */
  private parseCategory(s: string): OplataKvCategory | null {
    const t = (s || '').trim().toLowerCase();
    if (!t) return null;
    if (t.includes('ежемесяч')) return 'MONTHLY';
    if (t.includes('1 взнос') || t.includes('первый') || t.includes('1-взнос')) return 'FIRST';
    if (t.includes('общий') || t.includes('общая') || t === 'общ') return 'GENERAL';
    return null;
  }
}
