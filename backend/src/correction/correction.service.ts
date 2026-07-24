import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CategorizationService } from '../categorization/categorization.service';
import { AttachmentsService } from '../attachments/attachments.service';
import { CrmService } from '../crm/crm.service';

type Flow = 'all' | 'in' | 'out';

/**
 * XATO to'lovni to'g'rilash arizalari (2 bosqichli).
 *
 * Oqim: yuborish (pending) → tasdiqlovchi xodim to'g'rlaydi (shartnoma +
 * kategoriya + ariza fayl) → approved. Hech narsa avtomat tasdiqlanmaydi.
 */
@Injectable()
export class CorrectionService {
  private readonly log = new Logger(CorrectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categorization: CategorizationService,
    private readonly attachments: AttachmentsService,
    private readonly crm: CrmService,
  ) {}

  // ─── Ariza yuborish (pending) ──────────────────────────────────────
  async createRequest(input: {
    oplataKvId?: string | null;
    txId?: string | null;
    proposedContractNo?: string | null;
    note?: string | null;
    source: 'telegram' | 'web' | 'app';
    submittedByName: string;
    submittedByChatId?: string | null;
    submittedById?: string | null;
  }): Promise<{ ok: true; id: string; alreadyPending?: boolean }> {
    return this.persistRequest(input, undefined);
  }

  /** Ariza yuborish + ariza faylini biriktirish (web/telegram — fayl majburiy). */
  async createRequestWithFile(
    input: Parameters<CorrectionService['createRequest']>[0],
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
  ): Promise<{ ok: true; id: string; alreadyPending?: boolean }> {
    if (!file?.buffer) throw new BadRequestException('Ariza fayli majburiy');
    return this.persistRequest(input, file);
  }

  /** Tx'ni aniqlaydi, snapshot yig'adi, (ixtiyoriy) fayl biriktiradi, arizani yaratadi. */
  private async persistRequest(
    input: Parameters<CorrectionService['createRequest']>[0],
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
  ): Promise<{ ok: true; id: string; alreadyPending?: boolean }> {
    const { txId, oplataKvId, snap } = await this.resolveTx(input);

    // Duplikat pending — bir to'lovga bir vaqtda bitta ariza
    const existing = await this.prisma.xatoCorrectionRequest.findFirst({
      where: { txId, status: 'pending' },
      select: { id: true },
    });
    if (existing) return { ok: true, id: existing.id, alreadyPending: true };

    const contract = this.cleanContract(input.proposedContractNo);

    // Taklif qilingan shartnoma CRM'da bo'lsa — OBYEKT va klientni undan olamiz
    // (Kutilmoqda ro'yxatida to'g'ri obyekt ko'rinishi uchun).
    if (contract) {
      try {
        const r: any = await this.crm.searchContracts(contract, 3);
        const items: any[] = r?.items || [];
        const match = items.find((it) => String(it.contract || it.contractNumber || '').toUpperCase() === contract) || items[0];
        if (match) {
          if (match.object) snap.snapObject = match.object;
          const cl = match.clientFullName || match.client_full_name || match.customerName || match.client;
          if (cl) snap.snapClient = cl;
        }
      } catch { /* CRM xato — snapshot o'zgarmaydi */ }
    }

    // Fayl bo'lsa — tranzaksiyaga biriktiramiz
    let attachmentId: string | null = null;
    let attachmentName: string | null = null;
    if (file?.buffer) {
      // notify:false — ariza YUBORILGANDA Telegram'ga xabar YUBORMAYMIZ.
      // Xabar faqat TASDIQLANGANDA keladi (approve).
      const up: any = await this.attachments.upload(txId, file, {
        type: 'ariza', contractNumber: contract, uploadedBy: input.submittedByName, notify: false,
      });
      attachmentId = up?.item?.id || null;
      attachmentName = up?.item?.filename || null;
    }

    const req = await this.prisma.xatoCorrectionRequest.create({
      data: {
        txId,
        oplataKvId,
        proposedContractNo: contract,
        note: input.note?.slice(0, 2000) || null,
        source: input.source,
        submittedByName: (input.submittedByName || '?').slice(0, 190),
        submittedByChatId: input.submittedByChatId?.slice(0, 64) || null,
        submittedById: input.submittedById || null,
        attachmentId, attachmentName,
        ...snap,
      },
      select: { id: true },
    });
    this.log.log(`Ariza yuborildi: ${req.id} · tx=${txId} · ${input.source} · ${input.submittedByName}${attachmentId ? ' · fayl bilan' : ''}`);
    return { ok: true, id: req.id };
  }

  /** oplataKvId yoki txId → txId + snapshot (ko'rsatish uchun). */
  private async resolveTx(input: { oplataKvId?: string | null; txId?: string | null }): Promise<{
    txId: string; oplataKvId: string | null; snap: Record<string, any>;
  }> {
    let txId = (input.txId || '').trim() || null;
    const oplataKvId: string | null = input.oplataKvId || null;
    let snap: Record<string, any> = {};

    if (input.oplataKvId) {
      const row = await this.prisma.oplataKv.findUnique({
        where: { id: input.oplataKvId },
        select: {
          id: true, sourceTxId: true, contractNo: true, paymentAmount: true,
          date: true, client: true, object: true, txType: true, purpose: true,
        },
      });
      if (!row) throw new BadRequestException("To'lov topilmadi");
      if (!row.sourceTxId) throw new BadRequestException("Bu to'lov tranzaksiyadan kelmagan — ariza yuborib bo'lmaydi");
      const tx = await this.prisma.transaction.findFirst({
        where: { OR: [{ externalId: row.sourceTxId }, { id: row.sourceTxId }] },
        select: { id: true },
      });
      if (!tx) throw new BadRequestException('Manba tranzaksiya topilmadi');
      txId = tx.id;
      snap = {
        snapAmount: row.paymentAmount ?? null,
        snapDate: row.date ?? null,
        snapClient: row.client ?? null,
        snapObject: row.object ?? null,
        snapContractNo: row.contractNo ?? null,
        snapTxType: row.txType ?? null,
        snapPurpose: row.purpose ?? null,
      };
    } else if (txId) {
      const tx = await this.prisma.transaction.findUnique({
        where: { id: txId },
        select: {
          id: true, amount: true, direction: true, valueDate: true,
          description: true, fromName: true, contractNumber: true, type: true,
        },
      });
      if (!tx) throw new BadRequestException('Tranzaksiya topilmadi');
      const signed = Number(tx.amount) * (tx.direction === 'OUT' ? -1 : 1);
      snap = {
        snapAmount: signed,
        snapDate: tx.valueDate ?? null,
        snapClient: tx.fromName ?? null,
        snapObject: null,
        snapContractNo: tx.contractNumber ?? null,
        snapTxType: String(tx.type || '') || null,
        snapPurpose: tx.description ?? null,
      };
    } else {
      throw new BadRequestException("To'lov ko'rsatilmagan");
    }
    return { txId: txId!, oplataKvId, snap };
  }

  // ─── Badge uchun: qaysi txId'larda pending ariza bor ───────────────
  async pendingTxIds(txIds: string[]): Promise<Set<string>> {
    const ids = txIds.filter(Boolean);
    if (!ids.length) return new Set();
    const rows = await this.prisma.xatoCorrectionRequest.findMany({
      where: { status: 'pending', txId: { in: ids } },
      select: { txId: true },
    });
    return new Set(rows.map((r) => r.txId));
  }

  // ─── Badge uchun: qaysi oplataKv'larda pending ariza bor (web ro'yxat) ─
  async pendingOplataKvIds(ids: string[]): Promise<Set<string>> {
    const list = ids.filter(Boolean);
    if (!list.length) return new Set();
    const rows = await this.prisma.xatoCorrectionRequest.findMany({
      where: { status: 'pending', oplataKvId: { in: list } },
      select: { oplataKvId: true },
    });
    return new Set(rows.map((r) => r.oplataKvId!).filter(Boolean));
  }

  // ─── Web pending modal uchun: to'liq ariza ma'lumoti ───────────────
  async pendingInfoByOplataKvId(ids: string[]): Promise<Map<string, {
    by: string; at: Date; contractNo: string | null; attachmentId: string | null; attachmentName: string | null;
  }>> {
    const list = ids.filter(Boolean);
    const map = new Map<string, any>();
    if (!list.length) return map;
    const rows = await this.prisma.xatoCorrectionRequest.findMany({
      where: { status: 'pending', oplataKvId: { in: list } },
      select: {
        oplataKvId: true, submittedByName: true, submittedAt: true,
        proposedContractNo: true, attachmentId: true, attachmentName: true,
      },
      orderBy: { submittedAt: 'desc' },
    });
    for (const r of rows) {
      if (r.oplataKvId && !map.has(r.oplataKvId)) {
        map.set(r.oplataKvId, {
          by: r.submittedByName, at: r.submittedAt, contractNo: r.proposedContractNo,
          attachmentId: r.attachmentId, attachmentName: r.attachmentName,
        });
      }
    }
    return map;
  }

  /** Ariza faylini olish (faqat correction'ga bog'langan bo'lsa — public sahifa uchun). */
  async getArizaFile(attachmentId: string) {
    const req = await this.prisma.xatoCorrectionRequest.findFirst({
      where: { attachmentId }, select: { txId: true },
    });
    if (!req) throw new NotFoundException('Fayl topilmadi');
    return this.attachments.getFile(req.txId, attachmentId);
  }

  // ─── Badge uchun: qaysi oplataKv'larda rad etilgan ariza bor ───────
  async rejectedOplataKvIds(ids: string[]): Promise<Set<string>> {
    const list = ids.filter(Boolean);
    if (!list.length) return new Set();
    const rows = await this.prisma.xatoCorrectionRequest.findMany({
      where: { status: 'rejected', oplataKvId: { in: list } },
      select: { oplataKvId: true },
    });
    return new Set(rows.map((r) => r.oplataKvId!).filter(Boolean));
  }

  // ─── Kutilmoqda ro'yxati ───────────────────────────────────────────
  async listPending(opts: { q?: string; page?: number; perPage?: number } = {}) {
    const page = Math.max(1, opts.page || 1);
    const perPage = Math.min(200, Math.max(1, opts.perPage || 50));
    const where: any = { status: 'pending' };
    this.applySearch(where, opts.q);
    const [total, rows] = await Promise.all([
      this.prisma.xatoCorrectionRequest.count({ where }),
      this.prisma.xatoCorrectionRequest.findMany({
        where, orderBy: { submittedAt: 'desc' },
        skip: (page - 1) * perPage, take: perPage,
      }),
    ]);
    return { ok: true, total, page, perPage, rows: rows.map((r) => this.serialize(r)) };
  }

  // ─── Tasdiqlangan ro'yxati (audit + filtrlar) ──────────────────────
  async listApproved(opts: {
    q?: string; from?: string; to?: string; actor?: string; flow?: Flow;
    page?: number; perPage?: number;
  } = {}) {
    const page = Math.max(1, opts.page || 1);
    const perPage = Math.min(200, Math.max(1, opts.perPage || 50));
    const where: any = { status: 'approved' };
    this.applySearch(where, opts.q);

    // Sana oralig'i (tasdiqlangan vaqt bo'yicha)
    const reviewedAt: any = {};
    if (opts.from) { const d = new Date(opts.from); if (!isNaN(d.getTime())) reviewedAt.gte = d; }
    if (opts.to) { const d = new Date(opts.to); if (!isNaN(d.getTime())) { d.setHours(23, 59, 59, 999); reviewedAt.lte = d; } }
    if (reviewedAt.gte || reviewedAt.lte) where.reviewedAt = reviewedAt;

    // Kim tasdiqladi
    if (opts.actor?.trim()) where.reviewedByName = { contains: opts.actor.trim(), mode: 'insensitive' };

    // Musbat / manfiy summa
    if (opts.flow === 'in') where.snapAmount = { gte: 0 };
    else if (opts.flow === 'out') where.snapAmount = { lt: 0 };

    const [total, rows] = await Promise.all([
      this.prisma.xatoCorrectionRequest.count({ where }),
      this.prisma.xatoCorrectionRequest.findMany({
        where, orderBy: { reviewedAt: 'desc' },
        skip: (page - 1) * perPage, take: perPage,
      }),
    ]);
    return { ok: true, total, page, perPage, rows: rows.map((r) => this.serialize(r)) };
  }

  // ─── Tasdiqlash (fayl + shartnoma + kategoriya) ────────────────────
  async approve(
    id: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    opts: { contractNo?: string | null; categoryId?: string | null; subCategoryId?: string | null; actorId: string },
  ) {
    const req = await this.prisma.xatoCorrectionRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Ariza topilmadi');
    if (req.status !== 'pending') throw new BadRequestException("Bu ariza allaqachon ko'rib chiqilgan");

    const contract = this.cleanContract(opts.contractNo || req.proposedContractNo);
    if (!contract) throw new BadRequestException('Shartnoma raqami kerak');
    if (!file?.buffer && !req.attachmentId) throw new BadRequestException('Ariza fayli majburiy');

    const actorEmail = await this.actorEmail(opts.actorId);

    // 1) Ariza fayli — yangi yuklangan bo'lsa biriktiramiz, aks holda web'da
    //    yuborilgan mavjud faylni saqlaymiz
    let attachmentId: string | null = req.attachmentId || null;
    let attachmentName: string | null = req.attachmentName || null;
    if (file?.buffer) {
      const up: any = await this.attachments.upload(req.txId, file, {
        type: 'ariza', contractNumber: contract, uploadedBy: actorEmail,
      });
      attachmentId = up?.item?.id || null;
      attachmentName = up?.item?.filename || null;
    }

    // 2) Shartnoma (qo'lda — XATO holatini yopadi)
    await this.categorization.setContractManual(req.txId, contract, opts.actorId);

    // 3) Kategoriya (ixtiyoriy)
    let categoryName: string | null = null;
    let subCategoryName: string | null = null;
    if (opts.categoryId) {
      await this.categorization.setManual(
        req.txId,
        { categoryId: opts.categoryId, subcategoryId: opts.subCategoryId || null },
        opts.actorId,
      );
      const catIds = [opts.categoryId, opts.subCategoryId].filter(Boolean) as string[];
      const cats = await this.prisma.category.findMany({ where: { id: { in: catIds } }, select: { id: true, name: true } });
      categoryName = cats.find((c) => c.id === opts.categoryId)?.name || null;
      subCategoryName = opts.subCategoryId ? (cats.find((c) => c.id === opts.subCategoryId)?.name || null) : null;
    }

    const updated = await this.prisma.xatoCorrectionRequest.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedById: opts.actorId,
        reviewedByName: actorEmail,
        reviewedAt: new Date(),
        appliedContractNo: contract,
        categoryId: opts.categoryId || null, categoryName,
        subCategoryId: opts.subCategoryId || null, subCategoryName,
        attachmentId, attachmentName,
      },
    });
    // Tasdiqlangach Telegram'ga xabar (fayl bilan) — fire-and-forget
    if (attachmentId) {
      this.attachments.notifyApproved(attachmentId, actorEmail || undefined)
        .catch((e: any) => this.log.warn(`notifyApproved xato: ${e?.message}`));
    }

    this.log.log(`Ariza tasdiqlandi: ${id} · tx=${req.txId} · ${contract} · ${actorEmail}`);
    return { ok: true, item: this.serialize(updated) };
  }

  /**
   * To'g'ridan-to'g'ri to'g'rilash (raw XATO ro'yxatidan) — ariza yaratadi va
   * darhol tasdiqlaydi. Natija Tasdiqlangan ro'yxatida ko'rinadi.
   */
  async directCorrect(
    txId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number } | undefined,
    opts: { contractNo?: string | null; categoryId?: string | null; subCategoryId?: string | null; actorId: string; actorEmail?: string | null },
  ) {
    if (!txId) throw new BadRequestException("To'lov ko'rsatilmagan");
    const created = await this.createRequest({
      txId,
      proposedContractNo: opts.contractNo || null,
      source: 'app',
      submittedByName: opts.actorEmail || 'app',
      submittedById: opts.actorId,
    });
    return this.approve(created.id, file, {
      contractNo: opts.contractNo || null,
      categoryId: opts.categoryId || null,
      subCategoryId: opts.subCategoryId || null,
      actorId: opts.actorId,
    });
  }

  // ─── Rad etish ─────────────────────────────────────────────────────
  async reject(id: string, reason: string, actorId: string) {
    const req = await this.prisma.xatoCorrectionRequest.findUnique({ where: { id }, select: { status: true } });
    if (!req) throw new NotFoundException('Ariza topilmadi');
    if (req.status !== 'pending') throw new BadRequestException("Bu ariza allaqachon ko'rib chiqilgan");
    const actorEmail = await this.actorEmail(actorId);
    const updated = await this.prisma.xatoCorrectionRequest.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedById: actorId, reviewedByName: actorEmail, reviewedAt: new Date(),
        rejectReason: (reason || '').slice(0, 2000) || null,
      },
    });
    return { ok: true, item: this.serialize(updated) };
  }

  async stats() {
    const [pending, approved] = await Promise.all([
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'pending' } }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'approved' } }),
    ]);
    return { ok: true, pending, approved };
  }

  /** Kim qancha va qanday holatda ariza yuborgan — header statistikasi. */
  async submitterStats(): Promise<Array<{
    name: string; total: number; pending: number; approved: number; rejected: number;
  }>> {
    const rows = await this.prisma.xatoCorrectionRequest.groupBy({
      by: ['submittedByName', 'status'],
      _count: { _all: true },
    });
    const map = new Map<string, { name: string; total: number; pending: number; approved: number; rejected: number }>();
    for (const r of rows) {
      const name = r.submittedByName || '?';
      if (!map.has(name)) map.set(name, { name, total: 0, pending: 0, approved: 0, rejected: 0 });
      const e = map.get(name)!;
      const c = r._count._all;
      e.total += c;
      if (r.status === 'pending') e.pending += c;
      else if (r.status === 'approved') e.approved += c;
      else if (r.status === 'rejected') e.rejected += c;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }

  // ─── XATO ro'yxatidan yashirish / qaytarish ────────────────────────
  async setHidden(txId: string, hidden: boolean, actorId: string) {
    const tx = await this.prisma.transaction.findUnique({ where: { id: txId }, select: { id: true } });
    if (!tx) throw new NotFoundException('Tranzaksiya topilmadi');
    await this.prisma.transaction.update({ where: { id: txId }, data: { xatoHidden: hidden } });
    const actorEmail = await this.actorEmail(actorId);
    try {
      await this.prisma.transactionCategoryHistory.create({
        data: {
          txId, action: 'xato-hide', actorId, actorName: actorEmail,
          reason: hidden ? "XATO ro'yxatidan yashirildi" : "XATO ro'yxatiga qaytarildi",
        },
      });
    } catch { /* skip */ }
    this.log.log(`XATO ${hidden ? 'yashirildi' : 'qaytarildi'}: tx=${txId} · ${actorEmail}`);
    return { ok: true, hidden };
  }

  // ─── Yordamchilar ──────────────────────────────────────────────────
  private cleanContract(v?: string | null): string | null {
    if (!v) return null;
    return v.replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase().slice(0, 128) || null;
  }

  private applySearch(where: any, q?: string) {
    const s = (q || '').trim();
    if (!s) return;
    where.OR = [
      { proposedContractNo: { contains: s, mode: 'insensitive' } },
      { appliedContractNo: { contains: s, mode: 'insensitive' } },
      { snapContractNo: { contains: s, mode: 'insensitive' } },
      { snapClient: { contains: s, mode: 'insensitive' } },
      { snapObject: { contains: s, mode: 'insensitive' } },
      { submittedByName: { contains: s, mode: 'insensitive' } },
      { reviewedByName: { contains: s, mode: 'insensitive' } },
    ];
  }

  private async actorEmail(actorId?: string | null): Promise<string | null> {
    if (!actorId) return null;
    const u = await this.prisma.adminUser.findUnique({ where: { id: actorId }, select: { email: true } });
    return u?.email || null;
  }

  private serialize(r: any) {
    return {
      id: r.id,
      txId: r.txId,
      oplataKvId: r.oplataKvId,
      status: r.status,
      source: r.source,
      proposedContractNo: r.proposedContractNo,
      note: r.note,
      submittedByName: r.submittedByName,
      submittedAt: r.submittedAt,
      reviewedByName: r.reviewedByName,
      reviewedAt: r.reviewedAt,
      rejectReason: r.rejectReason,
      appliedContractNo: r.appliedContractNo,
      categoryName: r.categoryName,
      subCategoryName: r.subCategoryName,
      attachmentId: r.attachmentId,
      attachmentName: r.attachmentName,
      // snapshot (ko'rsatish uchun)
      amount: r.snapAmount != null ? Number(r.snapAmount) : null,
      date: r.snapDate,
      client: r.snapClient,
      object: r.snapObject,
      contractNo: r.snapContractNo,
      txType: r.snapTxType,
      purpose: r.snapPurpose,
    };
  }
}
