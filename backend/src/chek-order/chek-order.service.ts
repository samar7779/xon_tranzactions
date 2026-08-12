import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { ListChekOrderDto } from './dto/chek-order.dto';

type Actor = { id: string | null; name: string | null };

// Agent ajratgan bitta order
export interface ExtractedOrder {
  orderNo: string;
  date?: string | null;
  amount?: number | null;
  payerName?: string | null;
  payerAccount?: string | null;
  recipientName?: string | null;
  recipientAccount?: string | null;
  contractNo?: string | null;
  purpose?: string | null;
}

// Bitta order uchun tekshiruv natijasi
export interface OrderResult {
  orderNo: string;
  extracted: ExtractedOrder;
  result: 'found' | 'mismatch' | 'not_found';
  matchedTx: any | null;
  conditions: {
    account: boolean | null;
    date: boolean | null;
    amount: boolean | null;
    contract: boolean | null;
  } | null;
}

const norm = (s: any) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
const normContract = (s: any) => String(s ?? '').replace(/[\s\-_./№]/g, '').toUpperCase();
const cleanOrderNo = (s: any) => String(s ?? '').replace(/[^\d]/g, '').trim();

@Injectable()
export class ChekOrderService {
  private readonly log = new Logger(ChekOrderService.name);
  private readonly uploadsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {
    this.uploadsDir = this.config.get<string>('UPLOADS_DIR') || '/var/www/xon_tranzactions/uploads';
  }

  /** ANTHROPIC kalit — agent.aiKey (shifrlangan) yoki env */
  private async getAiKey(): Promise<string | null> {
    const enc = await this.settings.get('agent.aiKey');
    if (enc) { try { return this.crypto.decrypt(enc); } catch { /* skip */ } }
    return process.env.ANTHROPIC_API_KEY || null;
  }

  private async getAiModel(): Promise<string> {
    const m = await this.settings.get('agent.aiModel');
    return m || 'claude-sonnet-4-6';
  }

  // ───────────────── SURAT / PDF YUKLASH → AGENT ─────────────────
  async analyzeFile(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    actor: Actor,
  ): Promise<{ ok: true; batchId: string; results: OrderResult[] }> {
    if (!file?.buffer) throw new BadRequestException('Hujjat (file) majburiy');
    if (file.size > 25 * 1024 * 1024) throw new BadRequestException('Fayl 25 MB dan oshmasligi kerak');
    const apiKey = await this.getAiKey();
    if (!apiKey) throw new BadRequestException('AI kalit sozlanmagan (Admin → Agent → AI kalit)');

    const b64 = file.buffer.toString('base64');
    const isPdf = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    const isImage = (file.mimetype || '').startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(file.originalname);
    let fileBlock: any;
    if (isPdf) {
      fileBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
    } else if (isImage) {
      const media = (file.mimetype || '').startsWith('image/') ? file.mimetype : 'image/jpeg';
      fileBlock = { type: 'image', source: { type: 'base64', media_type: media, data: b64 } };
    } else {
      throw new BadRequestException("Hujjat PDF yoki rasm bo'lishi kerak");
    }

    const model = await this.getAiModel();
    const orders = await this.claudeExtractOrders(apiKey, model, fileBlock);
    if (!orders.length) throw new BadRequestException("Hujjatда memorial order topilmadi (o'qib bo'lmadi)");

    // Faylni saqlaymiz (batch bo'yicha bir marta)
    const batchId = `chk_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
    const filePath = await this.saveFile(file, batchId);

    const results: OrderResult[] = [];
    for (const o of orders) {
      const r = await this.matchOrder(o, true);
      results.push(r);
      await this.persist(r, {
        batchId,
        source: isPdf ? 'pdf' : 'photo',
        fileName: file.originalname,
        fileMime: file.mimetype,
        fileSize: file.size,
        filePath,
        extractedRaw: o,
      }, actor);
    }
    return { ok: true, batchId, results };
  }

  // ───────────────── QO'LDA ORDER RAQAM(LAR)I ─────────────────
  async checkManual(orderNosRaw: string, actor: Actor): Promise<{ ok: true; batchId: string; results: OrderResult[] }> {
    const nums = String(orderNosRaw || '')
      .split(/[\s,;\n]+/)
      .map((s) => cleanOrderNo(s))
      .filter(Boolean);
    const uniq = Array.from(new Set(nums));
    if (!uniq.length) throw new BadRequestException('Order raqami kiritilmadi');

    const batchId = `chk_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
    const results: OrderResult[] = [];
    for (const n of uniq) {
      const o: ExtractedOrder = { orderNo: n };
      const r = await this.matchOrder(o, false); // manba yo'q — shartlar N/A
      results.push(r);
      await this.persist(r, { batchId, source: 'manual', extractedRaw: o }, actor);
    }
    return { ok: true, batchId, results };
  }

  // ───────────────── SOLISHTIRISH (order → tranzaksiya) ─────────────────
  private async matchOrder(o: ExtractedOrder, hasSource: boolean): Promise<OrderResult> {
    const orderNo = cleanOrderNo(o.orderNo);
    const base: OrderResult = { orderNo, extracted: o, result: 'not_found', matchedTx: null, conditions: null };
    if (!orderNo) return base;

    // Order № = tranzaksiya docNumber. IN yo'nalish afzal (bizga tushgan pul).
    const candidates = await this.prisma.transaction.findMany({
      where: { docNumber: orderNo },
      orderBy: [{ direction: 'asc' }, { txnDate: 'desc' }],
      take: 20,
      select: {
        id: true, externalId: true, direction: true, amount: true, currency: true,
        txnDate: true, docNumber: true, reference: true,
        fromName: true, fromAccount: true, toName: true, toAccount: true,
        description: true,
      },
    });
    if (!candidates.length) {
      return { ...base, result: 'not_found', conditions: hasSource ? this.emptyConds(o) : null };
    }

    // Eng mos nomzod: summa mos kelgani afzal, aks holda birinchisi
    let tx = candidates[0];
    if (o.amount != null) {
      const exact = candidates.find((c) => Math.abs(Number(c.amount) - Number(o.amount)) < 0.01);
      if (exact) tx = exact;
    }

    const conditions = hasSource ? {
      account: o.recipientAccount ? (norm(tx.toAccount) === norm(o.recipientAccount)) : null,
      date: o.date ? this.sameDay(tx.txnDate, o.date) : null,
      amount: o.amount != null ? (Math.abs(Number(tx.amount) - Number(o.amount)) < 0.01) : null,
      contract: o.contractNo ? normContract(tx.description).includes(normContract(o.contractNo)) : null,
    } : null;

    // mismatch — biror shart aniq FALSE bo'lsa (null = tekshirilmadi, hisobga olinmaydi)
    const anyFalse = conditions && Object.values(conditions).some((v) => v === false);
    const result: OrderResult['result'] = anyFalse ? 'mismatch' : 'found';

    return { orderNo, extracted: o, result, matchedTx: this.txSnapshot(tx), conditions };
  }

  private emptyConds(o: ExtractedOrder) {
    return {
      account: o.recipientAccount ? false : null,
      date: o.date ? false : null,
      amount: o.amount != null ? false : null,
      contract: o.contractNo ? false : null,
    };
  }

  private sameDay(a: Date | null, b: string): boolean | null {
    if (!a || !b) return null;
    const d = new Date(b);
    if (isNaN(d.getTime())) return null;
    return a.getUTCFullYear() === d.getUTCFullYear()
      && a.getUTCMonth() === d.getUTCMonth()
      && a.getUTCDate() === d.getUTCDate();
  }

  private txSnapshot(tx: any) {
    return {
      id: tx.id,
      externalId: tx.externalId,
      direction: tx.direction,
      amount: Number(tx.amount),
      currency: tx.currency,
      txnDate: tx.txnDate,
      docNumber: tx.docNumber,
      reference: tx.reference,
      fromName: tx.fromName,
      fromAccount: tx.fromAccount,
      toName: tx.toName,
      toAccount: tx.toAccount,
      description: tx.description,
    };
  }

  // ───────────────── SAQLASH ─────────────────
  private async saveFile(file: { buffer: Buffer; originalname: string }, batchId: string): Promise<string | null> {
    try {
      const dir = path.join(this.uploadsDir, 'chek-order', batchId);
      await fs.mkdir(dir, { recursive: true });
      const ext = (path.extname(file.originalname) || '').slice(0, 8) || '.bin';
      const safe = `order${ext}`;
      const fp = path.join(dir, safe);
      await fs.writeFile(fp, file.buffer);
      return fp;
    } catch (e: any) {
      this.log.warn(`Chek order fayl saqlanmadi: ${e?.message}`);
      return null;
    }
  }

  private async persist(
    r: OrderResult,
    meta: {
      batchId: string; source: string;
      fileName?: string; fileMime?: string; fileSize?: number; filePath?: string | null;
      extractedRaw: ExtractedOrder;
    },
    actor: Actor,
  ) {
    const o = r.extracted;
    try {
      await this.prisma.chekOrder.create({
        data: {
          batchId: meta.batchId,
          source: meta.source,
          fileName: meta.fileName ?? null,
          fileMime: meta.fileMime ?? null,
          fileSize: meta.fileSize ?? null,
          filePath: meta.filePath ?? null,
          orderNo: r.orderNo || '—',
          orderDate: o.date ? this.safeDate(o.date) : null,
          amount: o.amount != null ? (o.amount as any) : null,
          payerName: o.payerName ?? null,
          payerAccount: o.payerAccount ?? null,
          recipientName: o.recipientName ?? null,
          recipientAccount: o.recipientAccount ?? null,
          contractNo: o.contractNo ?? null,
          purpose: o.purpose ?? null,
          extracted: meta.extractedRaw as any,
          result: r.result,
          matchedTxId: r.matchedTx?.id ?? null,
          matchedTxExtId: r.matchedTx?.externalId ?? null,
          condAccount: r.conditions?.account ?? null,
          condDate: r.conditions?.date ?? null,
          condAmount: r.conditions?.amount ?? null,
          condContract: r.conditions?.contract ?? null,
          matchedTx: r.matchedTx ?? undefined,
          createdById: actor.id,
          createdByName: actor.name,
        },
      });
    } catch (e: any) {
      this.log.warn(`Chek order yozib bo'lmadi (${r.orderNo}): ${e?.message}`);
    }
  }

  private safeDate(s: string): Date | null {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  // ───────────────── TARIX ─────────────────
  async list(q: ListChekOrderDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(q.perPage) || 30));
    const where: any = {};
    if (q.result && q.result !== 'all') where.result = q.result;
    if (q.q && q.q.trim()) {
      const s = q.q.trim();
      where.OR = [
        { orderNo: { contains: s, mode: 'insensitive' } },
        { contractNo: { contains: s, mode: 'insensitive' } },
        { payerName: { contains: s, mode: 'insensitive' } },
        { recipientName: { contains: s, mode: 'insensitive' } },
      ];
    }
    if (q.dateFrom || q.dateTo) {
      where.createdAt = {};
      if (q.dateFrom) where.createdAt.gte = new Date(`${q.dateFrom}T00:00:00+05:00`);
      if (q.dateTo) where.createdAt.lte = new Date(`${q.dateTo}T23:59:59.999+05:00`);
    }

    const [items, total, stats] = await Promise.all([
      this.prisma.chekOrder.findMany({
        where, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage, take: perPage,
      }),
      this.prisma.chekOrder.count({ where }),
      this.prisma.chekOrder.groupBy({ by: ['result'], _count: true }),
    ]);
    const statMap: Record<string, number> = {};
    for (const s of stats) statMap[s.result] = (s as any)._count;

    return {
      ok: true, page, perPage, total,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      items: items.map((i) => this.rowOut(i)),
      stats: {
        found: statMap['found'] || 0,
        mismatch: statMap['mismatch'] || 0,
        not_found: statMap['not_found'] || 0,
      },
    };
  }

  async getOne(id: string) {
    const row = await this.prisma.chekOrder.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Topilmadi');
    return { ok: true, item: this.rowOut(row, true) };
  }

  async getBatch(batchId: string) {
    const rows = await this.prisma.chekOrder.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } });
    if (!rows.length) throw new NotFoundException('Topilmadi');
    return { ok: true, batchId, items: rows.map((r) => this.rowOut(r, true)) };
  }

  private rowOut(r: any, full = false) {
    const base = {
      id: r.id,
      batchId: r.batchId,
      source: r.source,
      orderNo: r.orderNo,
      orderDate: r.orderDate,
      amount: r.amount != null ? Number(r.amount) : null,
      payerName: r.payerName,
      recipientName: r.recipientName,
      recipientAccount: r.recipientAccount,
      contractNo: r.contractNo,
      result: r.result,
      conditions: {
        account: r.condAccount,
        date: r.condDate,
        amount: r.condAmount,
        contract: r.condContract,
      },
      matchedTxExtId: r.matchedTxExtId,
      hasFile: !!r.filePath,
      createdByName: r.createdByName,
      createdAt: r.createdAt,
    };
    if (!full) return base;
    return {
      ...base,
      payerAccount: r.payerAccount,
      purpose: r.purpose,
      fileName: r.fileName,
      fileMime: r.fileMime,
      matchedTx: r.matchedTx,
      extracted: r.extracted,
    };
  }

  async remove(id: string) {
    const row = await this.prisma.chekOrder.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Topilmadi');
    // Fayl faqat batchда oxirgi yozuv o'chsagina o'chiriladi
    if (row.filePath) {
      const others = await this.prisma.chekOrder.count({ where: { batchId: row.batchId, id: { not: id } } });
      if (others === 0) {
        try { await fs.unlink(row.filePath); await fs.rmdir(path.dirname(row.filePath)).catch(() => {}); } catch { /* skip */ }
      }
    }
    await this.prisma.chekOrder.delete({ where: { id } });
    return { ok: true };
  }

  async getFile(id: string): Promise<{ buffer: Buffer; mime: string; name: string }> {
    const row = await this.prisma.chekOrder.findUnique({ where: { id } });
    if (!row || !row.filePath) throw new NotFoundException('Fayl yo\'q');
    let buffer: Buffer;
    try { buffer = await fs.readFile(row.filePath); }
    catch { throw new NotFoundException('Fayl topilmadi (o\'chirilgan)'); }
    return { buffer, mime: row.fileMime || 'application/octet-stream', name: row.fileName || 'order' };
  }

  // ───────────────── CLAUDE VISION EXTRACTION ─────────────────
  private async claudeExtractOrders(apiKey: string, model: string, fileBlock: any): Promise<ExtractedOrder[]> {
    const system = [
      "Sen Xon Saroy quruvchi kompaniyasining ichki moliyaviy yordamchisisan.",
      "Foydalanuvchi bank MEMORIAL ORDER(lar) suratini yoki PDF'ini yuklaydi. BITTA rasmда BIR NECHTA memorial order bo'lishi mumkin — HAMMASINI ajrat.",
      "Har order uchun quyidagilarni o'qi:",
      "- orderNo: 'Мемориальный ордер №' dan keyingi RAQAM (masalan 13473268). FAQAT raqamlar.",
      "- date: 'Дата' (YYYY-MM-DD formatда qaytar).",
      "- amount: 'Сумма' (faqat son, ajratuvchilarsiz — masalan 200000).",
      "- payerName: to'lovchi shaxs ismi — odatda 'Детали платежа' ichida (masalan 'от KURYAZOV AZIZBEK MARATOVICH'). Naименование плательщика emas (u bank hisobi nomi).",
      "- payerAccount: 'Дебет счет плательщика' raqami.",
      "- recipientName: 'Наименование получателя' (masalan ООО ALMAZA CITY).",
      "- recipientAccount: 'Кредит счет получателя' raqami.",
      "- contractNo: to'lov tafsilotidagi shartnoma raqami (masalan 'дог. №34УНА263N' → 34УНА263N).",
      "- purpose: 'Детали платежа' matni (qisqa).",
      "Aniq o'qilmagan maydonni null qoldir, taxmin qilma. extract_chek_orders tool orqali qaytar.",
    ].join(' ');

    const userContent = [
      { type: 'text', text: "Ushbu hujjatdagi BARCHA memorial orderlarni o'qib, extract_chek_orders tool orqali qaytar." },
      fileBlock,
    ];
    const tools = [{
      name: 'extract_chek_orders',
      description: "Memorial order(lar)dan ma'lumot ajratish",
      input_schema: {
        type: 'object',
        properties: {
          orders: {
            type: 'array',
            description: 'Hujjatдаги barcha memorial orderlar',
            items: {
              type: 'object',
              properties: {
                orderNo: { type: 'string', description: 'Memorial order raqami (faqat raqamlar)' },
                date: { type: 'string', description: 'Sana YYYY-MM-DD' },
                amount: { type: 'number', description: 'Summa (son)' },
                payerName: { type: 'string', description: "To'lovchi shaxs ismi" },
                payerAccount: { type: 'string', description: "Debet (to'lovchi) hisobi" },
                recipientName: { type: 'string', description: 'Oluvchi nomi' },
                recipientAccount: { type: 'string', description: 'Kredit (oluvchi) hisobi' },
                contractNo: { type: 'string', description: 'Shartnoma raqami' },
                purpose: { type: 'string', description: "To'lov tafsiloti" },
              },
              required: ['orderNo'],
            },
          },
        },
        required: ['orders'],
      },
    }];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 2000, system,
        messages: [{ role: 'user', content: userContent }],
        tools, tool_choice: { type: 'tool', name: 'extract_chek_orders' },
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BadRequestException(`Claude API xatosi (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const toolUse = (data?.content || []).find((c: any) => c.type === 'tool_use');
    const orders: any[] = toolUse?.input?.orders || [];
    return orders
      .map((o) => ({
        orderNo: cleanOrderNo(o?.orderNo),
        date: o?.date || null,
        amount: o?.amount != null ? Number(o.amount) : null,
        payerName: o?.payerName || null,
        payerAccount: o?.payerAccount ? String(o.payerAccount).replace(/\s+/g, '') : null,
        recipientName: o?.recipientName || null,
        recipientAccount: o?.recipientAccount ? String(o.recipientAccount).replace(/\s+/g, '') : null,
        contractNo: o?.contractNo ? String(o.contractNo).trim() : null,
        purpose: o?.purpose || null,
      }))
      .filter((o) => o.orderNo);
  }
}
