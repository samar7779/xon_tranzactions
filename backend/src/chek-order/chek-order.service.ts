import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CrmService } from '../crm/crm.service';
import { ListChekOrderDto, AssistantChatDto, CreateTicketDto, UpdateTicketDto, ListTicketsDto } from './dto/chek-order.dto';

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
    order: boolean | null;
    account: boolean | null;
    date: boolean | null;
    amount: boolean | null;
    contract: boolean | null;
  } | null;
}

// Bir TO'LOV uchun (bir necha order — mem.order + kvitansiya — bitta to'lovga birlashadi)
export interface PaymentResult {
  orderNos: string[];
  extracted: ExtractedOrder;
  result: 'found' | 'mismatch' | 'not_found';
  matchedTx: any | null;
  conditions: OrderResult['conditions'];
}

const norm = (s: any) => String(s ?? '').replace(/\s+/g, '').toUpperCase();
const normContract = (s: any) => String(s ?? '').replace(/[\s\-_./№]/g, '').toUpperCase();
const cleanOrderNo = (s: any) => String(s ?? '').replace(/[^\d]/g, '').trim();
const digitsOnly = (s: any) => String(s ?? '').replace(/\D/g, '');

// Levenshtein masofa (OCR xatosi — 1-2 raqam ortiqcha/kam bo'lishi mumkin)
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// Hisob raqami mosligi — OCR'ga chidamli (20 xonali raqamда nol sanash xatosi bo'ladi)
function acctSimilar(a: any, b: any): boolean {
  const x = digitsOnly(a), y = digitsOnly(b);
  if (!x || !y || x.length < 6 || y.length < 6) return false;
  if (x === y) return true;
  // OCR bir-ikki raqam ortiqcha/kam qo'shishi mumkin
  if (Math.abs(x.length - y.length) <= 2 && editDistance(x, y) <= 2) return true;
  return false;
}

@Injectable()
export class ChekOrderService {
  private readonly log = new Logger(ChekOrderService.name);
  private readonly uploadsDir: string;
  // AI yordamchi uchun CRM/grafik konteksti keshi (suhbat davomida qayta-qayta CRM'ga urmaslik)
  private readonly asstCrmCache = new Map<string, { at: number; text: string }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
    private readonly crm: CrmService,
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

  // ───────────────── SHARTNOMA / MIJOZ / OBYEKT (CRM) ─────────────────
  // Chek order natijasi ostida ko'rsatish uchun — mijoz F.I.SH, obyekt, xonadon,
  // kelishuv qiymati, to'langan/qoldiq balans. CrmContract keshi + oplataKv summasi.
  async contractInfo(contractNo: string) {
    const cn = String(contractNo || '').trim();
    if (!cn) throw new BadRequestException("contractNo bo'sh");
    const cnUpper = cn.toUpperCase();

    const [crm, sums] = await Promise.all([
      this.prisma.crmContract.findFirst({
        where: { contractNumber: cnUpper },
        select: {
          customerName: true, objectName: true, apartmentNumber: true,
          virtualStatus: true, status: true, found: true, crmOrderId: true, rawSnapshot: true,
        },
      }),
      this.prisma.oplataKv.aggregate({
        where: { contractNo: cnUpper },
        _sum: { paymentAmount: true },
        _count: true,
      }),
    ]);

    // Obyekt/mijoz — kesh bo'lmasa oplataKv qatorlaridan fallback
    let customerName = crm?.customerName || null;
    let objectName = crm?.objectName || null;
    if ((!customerName || !objectName)) {
      const row = await this.prisma.oplataKv.findFirst({
        where: { contractNo: cnUpper, object: { not: null } },
        select: { object: true, client: true },
        orderBy: { date: 'desc' },
      });
      if (!objectName) objectName = row?.object || null;
      if (!customerName) customerName = row?.client || null;
    }

    const snap: any = crm?.rawSnapshot || {};
    const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    let contractValue = num(snap.total_amount ?? snap.price ?? snap.contract_amount);
    const totalPaid = Number(sums._sum.paymentAmount || 0);

    // ── LIVE CRM detail — kesh yetarli emas (qiymat/xonadon/qavat CRM'dan keladi) ──
    let apartmentNumber = crm?.apartmentNumber || snap.apartment_number || null;
    let rooms: number | null = null, area: number | null = null, floor: any = null, block: any = null, contractDate: string | null = null;
    let virtualStatus = crm?.virtualStatus || null;
    let foundLive = false;
    try {
      const res: any = await this.crm.show({ contract: cnUpper });
      const d: any = res?.ok ? res.detail : null;
      if (d) {
        foundLive = true;
        contractValue = num(d.price ?? d.total_amount) ?? contractValue;
        const info: any = d.info || {};
        apartmentNumber = info.number ?? apartmentNumber;
        rooms = num(info.rooms);
        area = num(info.area);
        floor = info.floor ?? null;
        block = info.block ?? null;
        contractDate = d.contract_date ?? null;
        const vs = d?.virtual_status?.value?.name || d?.virtual_status?.name;
        if (vs) virtualStatus = (typeof vs === 'object' ? (vs.ru || vs.uz) : vs) || virtualStatus;
        if (!objectName) objectName = info.object_name || d.object_name || objectName;
      }
    } catch { /* CRM javob bermasa keshdan davom */ }

    const remaining = contractValue != null ? contractValue - totalPaid : null;

    return {
      ok: true,
      contractNo: cn,
      found: !!crm?.found || foundLive,
      customerName,
      objectName,
      apartmentNumber,
      rooms,
      area,
      floor: floor != null ? String(floor) : null,
      block: block != null ? String(block) : null,
      contractDate,
      virtualStatus,
      status: crm?.status || null,
      crmOrderId: crm?.crmOrderId || null,
      contractValue,
      totalPaid,
      remaining,
      paymentCount: sums._count || 0,
    };
  }

  // ───────────────── SHARTNOMA BO'YICHA — CRM taklif + to'lovlar ─────────────────
  /** Shartnoma raqami avtomatik takliflari (CRM'dan). */
  async crmSuggest(q: string) {
    const s = String(q || '').trim();
    if (s.length < 2) return { ok: true, items: [] };
    try {
      const res: any = await this.crm.searchContracts(s, 10);
      const items = (res?.items || []).map((it: any) => ({
        contract: it.contract,
        clientFullName: it.clientFullName || null,
        object: it.object || null,
        apartmentNumber: it.apartmentNumber || null,
        status: it.status || null,
      })).filter((x: any) => x.contract);
      return { ok: true, items };
    } catch {
      return { ok: true, items: [] };
    }
  }

  /** Shartnoma bo'yicha tranzaksiya (to'lov)lar ro'yxati. */
  async contractPayments(contract: string) {
    const cn = String(contract || '').trim();
    if (!cn) throw new BadRequestException("contract bo'sh");
    const cnUpper = cn.toUpperCase();
    const rows = await this.prisma.transaction.findMany({
      where: {
        OR: [
          { contractNumber: cnUpper },
          { description: { contains: cn, mode: 'insensitive' } },
        ],
      },
      orderBy: { txnDate: 'desc' },
      take: 60,
      select: {
        id: true, externalId: true, direction: true, amount: true, currency: true,
        txnDate: true, docNumber: true, reference: true,
        fromName: true, fromAccount: true, toName: true, toAccount: true, description: true,
      },
    });
    return { ok: true, contract: cn, items: rows.map((t) => ({ ...t, amount: Number(t.amount) })) };
  }

  // ───────────────── SURAT / PDF YUKLASH → AGENT ─────────────────
  async analyzeFile(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    actor: Actor,
  ): Promise<{ ok: true; batchId: string; results: PaymentResult[] }> {
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

    const orderResults: OrderResult[] = [];
    for (const o of orders) {
      const r = await this.matchOrder(o, true);
      orderResults.push(r);
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
    // Bir xil to'lovga tegishli orderlarni (mem.order + kvitansiya) birlashtiramiz
    return { ok: true, batchId, results: this.groupResults(orderResults) };
  }

  // ───────────────── QO'LDA ORDER RAQAM(LAR)I ─────────────────
  async checkManual(orderNosRaw: string, actor: Actor): Promise<{ ok: true; batchId: string; results: PaymentResult[] }> {
    const nums = String(orderNosRaw || '')
      .split(/[\s,;\n]+/)
      .map((s) => cleanOrderNo(s))
      .filter(Boolean);
    const uniq = Array.from(new Set(nums));
    if (!uniq.length) throw new BadRequestException('Order raqami kiritilmadi');

    const batchId = `chk_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
    const orderResults: OrderResult[] = [];
    for (const n of uniq) {
      const o: ExtractedOrder = { orderNo: n };
      const r = await this.matchOrder(o, false); // manba yo'q — shartlar N/A
      orderResults.push(r);
      await this.persist(r, { batchId, source: 'manual', extractedRaw: o }, actor);
    }
    return { ok: true, batchId, results: this.groupResults(orderResults) };
  }

  // ───────────────── SOLISHTIRISH (order → tranzaksiya) ─────────────────
  private async matchOrder(o: ExtractedOrder, hasSource: boolean): Promise<OrderResult> {
    const orderNo = cleanOrderNo(o.orderNo);
    const base: OrderResult = { orderNo, extracted: o, result: 'not_found', matchedTx: null, conditions: null };
    if (!orderNo) return base;

    const sel = {
      id: true, externalId: true, direction: true, amount: true, currency: true,
      txnDate: true, docNumber: true, reference: true, contractNumber: true,
      fromName: true, fromAccount: true, toName: true, toAccount: true, description: true,
    };
    // ── Nomzodlarni bir necha signal bo'yicha yig'amiz ──
    // Order № (kvitansiya raqami) bank docNumber'idan farq qilishi mumkin, shu bois
    // FAQAT order № ga tayanmaymiz — shartnoma + summa + sana ham qidiriladi.
    const cand = new Map<string, any>();
    const addRows = (rows: any[]) => rows.forEach((r) => cand.set(r.id, r));

    // 1) Order № == docNumber (aniq mos)
    addRows(await this.prisma.transaction.findMany({ where: { docNumber: orderNo }, take: 20, select: sel }));

    // 2) Shartnoma raqami to'lov tafsilotida (kvitansiyada shartnoma bor — ishonchli)
    const cn = String(o.contractNo || '').replace(/[№\s]/g, '').trim();
    if (cn.length >= 5) {
      addRows(await this.prisma.transaction.findMany({
        where: { description: { contains: cn, mode: 'insensitive' } },
        orderBy: { txnDate: 'desc' }, take: 40, select: sel,
      }));
    }

    // 3) Summa + sana oynasi (± 4 kun)
    if (o.amount != null && o.date) {
      const d = new Date(o.date);
      if (!isNaN(d.getTime())) {
        const from = new Date(d); from.setDate(from.getDate() - 4); from.setHours(0, 0, 0, 0);
        const to = new Date(d); to.setDate(to.getDate() + 4); to.setHours(23, 59, 59, 999);
        addRows(await this.prisma.transaction.findMany({
          where: { amount: o.amount as any, txnDate: { gte: from, lte: to } },
          take: 40, select: sel,
        }));
      }
    }

    if (cand.size === 0) {
      return { ...base, result: 'not_found', conditions: hasSource ? this.emptyConds(o) : null };
    }

    // Hisob mosligi — order'dan keyingi 2-darajali MUHIM kalit. Naqd kvitansiyada oluvchi
    // hisob tranzaksiyaning to yoki from tomonида bo'lishi mumkin (oraliq hisob), OCR'ga
    // chidamli (fuzzy). Mos kelgan tomon (to/from) qiymatini ham qaytaramiz — ko'rsatish uchun.
    const accInfo = (t: any): { ok: boolean | null; matched: string | null } => {
      if (!o.recipientAccount) return { ok: null, matched: null };
      if (acctSimilar(o.recipientAccount, t.toAccount)) return { ok: true, matched: t.toAccount };
      if (acctSimilar(o.recipientAccount, t.fromAccount)) return { ok: true, matched: t.fromAccount };
      return { ok: false, matched: null };
    };
    const condsFor = (t: any) => ({
      order: orderNo ? (norm(t.docNumber) === norm(orderNo)) : null,
      account: accInfo(t).ok,
      date: o.date ? this.sameDay(t.txnDate, o.date) : null,
      amount: o.amount != null ? (Math.abs(Number(t.amount) - Number(o.amount)) < 0.01) : null,
      contract: o.contractNo ? normContract(t.description).includes(normContract(o.contractNo)) : null,
    });
    const scoreOf = (t: any) => {
      const c = condsFor(t);
      let s = 0;
      if (c.order === true) s += 50;     // 1-kalit: order№ aniq mos
      if (c.account === true) s += 40;   // 2-kalit: hisob raqami (MUHIM)
      if (c.amount === true) s += 25;    // summa
      if (c.contract === true) s += 25;  // shartnoma
      if (c.date === true) s += 10;      // sana
      return s;
    };

    let best: any = null;
    let bestScore = -1;
    for (const t of cand.values()) {
      const s = scoreOf(t);
      if (s > bestScore) { bestScore = s; best = t; }
    }

    // Chegara 50: order№(50), yoki hisob+summa(65), yoki shartnoma+summa(50), yoki hisob+shartnoma(65).
    // Faqat summa+sana(35) yoki faqat shartnoma(25) — yetarli emas (soxta moslik bo'lmasin).
    if (!best || bestScore < 50) {
      return { ...base, result: 'not_found', conditions: hasSource ? this.emptyConds(o) : null };
    }

    const conditions = condsFor(best);
    (best as any)._matchAccount = accInfo(best).matched;
    const result = this.resultOf(conditions);

    return { orderNo, extracted: o, result, matchedTx: this.txSnapshot(best), conditions };
  }

  /**
   * Natija qoidasi:
   *  - summa yoki shartnoma aniq FALSE → NOMUVOFIQ (to'lov mohiyati mos emas).
   *  - order№ VA hisob IKKALASI ham FALSE → NOMUVOFIQ (shubhali: shartnoma+summa bor,
   *    lekin 1 va 2-kalit mos emas — tekshirish kerak). "Yo'q" demaymiz — bazaдa bor.
   *  - aks holda → TOPILDI (order№ yoki hisobdan bittasi mos + summa/shartnoma zid emas).
   */
  private resultOf(c: OrderResult['conditions']): 'found' | 'mismatch' {
    if (!c) return 'found';
    const hardFail = c.amount === false || c.contract === false;
    const bothKeysFail = c.order === false && c.account === false;
    return (hardFail || bothKeysFail) ? 'mismatch' : 'found';
  }

  // Bir necha order bitta to'lovga (bir xil tranzaksiya yoki summa+shartnoma+sana)
  // tegishli bo'lsa — bitta natijaga birlashtiramiz (bank ham mem.order, ham kvitansiya beradi).
  private groupResults(rs: OrderResult[]): PaymentResult[] {
    const groups = new Map<string, OrderResult[]>();
    for (const r of rs) {
      let key: string;
      if (r.matchedTx?.id) key = `tx:${r.matchedTx.id}`;
      else if (r.extracted.contractNo || r.extracted.amount != null) {
        key = `sig:${r.extracted.amount ?? ''}|${normContract(r.extracted.contractNo)}|${r.extracted.date ?? ''}`;
      } else key = `u:${r.orderNo}`;
      const arr = groups.get(key) || [];
      arr.push(r);
      groups.set(key, arr);
    }
    return Array.from(groups.values()).map((arr) => this.mergeGroup(arr));
  }

  private mergeGroup(arr: OrderResult[]): PaymentResult {
    const orderNos = Array.from(new Set(arr.map((r) => r.orderNo).filter(Boolean)));
    if (arr.length === 1) {
      const r = arr[0];
      return { orderNos, extracted: r.extracted, result: r.result, matchedTx: r.matchedTx, conditions: r.conditions };
    }
    const withTx = arr.find((r) => r.matchedTx);
    const primary = withTx || arr[0];
    // Shartlarni OR bilan birlashtiramiz — bir hujjat hisobga mos kelsa, hisob ✓ bo'ladi.
    const orCond = (k: keyof NonNullable<OrderResult['conditions']>): boolean | null => {
      const vals = arr.map((r) => r.conditions?.[k]);
      if (vals.some((v) => v === true)) return true;
      if (vals.some((v) => v === false)) return false;
      return null;
    };
    const conditions = primary.matchedTx
      ? { order: orCond('order'), account: orCond('account'), date: orCond('date'), amount: orCond('amount'), contract: orCond('contract') }
      : null;
    const result = primary.matchedTx ? this.resultOf(conditions) : 'not_found';
    // Eng to'liq (ko'proq maydonli) extracted'ni tanlaymiz
    const richness = (e: ExtractedOrder) => [e.recipientAccount, e.contractNo, e.amount, e.date, e.payerName, e.recipientName].filter((x) => x != null && x !== '').length;
    const richest = arr.slice().sort((a, b) => richness(b.extracted) - richness(a.extracted))[0];
    return { orderNos, extracted: richest.extracted, result, matchedTx: primary.matchedTx, conditions };
  }

  private emptyConds(o: ExtractedOrder) {
    return {
      order: o.orderNo ? false : null,
      account: o.recipientAccount ? false : null,
      date: o.date ? false : null,
      amount: o.amount != null ? false : null,
      contract: o.contractNo ? false : null,
    };
  }

  // Sana solishtirish — Toshkent (+5) taqvim kuni bo'yicha. txnDate UTC'da saqlanadi
  // (masalan 21T19:00Z = Toshkent 22-kun), shu bois +5 soatga surib kunni olamiz.
  private sameDay(txnDate: Date | null, orderDateStr: string): boolean | null {
    if (!txnDate || !orderDateStr) return null;
    // Order sanasi — sof taqvim kuni (YYYY-MM-DD)
    const m = String(orderDateStr).match(/(\d{4})-(\d{2})-(\d{2})/);
    let orderDay: string;
    if (m) {
      orderDay = `${m[1]}-${Number(m[2])}-${Number(m[3])}`;
    } else {
      const d = new Date(orderDateStr);
      if (isNaN(d.getTime())) return null;
      const t = new Date(d.getTime() + 5 * 3600 * 1000);
      orderDay = `${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`;
    }
    const tk = new Date(txnDate.getTime() + 5 * 3600 * 1000);
    const txDay = `${tk.getUTCFullYear()}-${tk.getUTCMonth() + 1}-${tk.getUTCDate()}`;
    return orderDay === txDay;
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
      contractNumber: tx.contractNumber ?? null, // tranzaksiyaдаги HAQIQIY shartnoma (OCR emas)
      matchAccount: tx._matchAccount ?? null, // kvitansiya hisobiga mos kelgan tomon (to/from)
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
          condOrder: r.conditions?.order ?? null,
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
        order: r.condOrder,
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

  /** Butun tarixni o'chirish (fayllar bilan). */
  async clearAll(): Promise<{ deleted: number }> {
    const withFiles = await this.prisma.chekOrder.findMany({
      where: { filePath: { not: null } },
      select: { filePath: true },
      distinct: ['filePath'],
    });
    for (const r of withFiles) {
      if (r.filePath) {
        try { await fs.unlink(r.filePath); await fs.rmdir(path.dirname(r.filePath)).catch(() => {}); } catch { /* skip */ }
      }
    }
    const res = await this.prisma.chekOrder.deleteMany({});
    return { deleted: res.count };
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
  // ═════════════════ AI YORDAMCHI (muammo aniqlash) ═════════════════
  /** Tranzaksiya izohidan shartnoma raqamini ajratish (masalan "дог. №34VHA263N" → 34VHA263N). */
  private parseContractFromText(text: string | null | undefined): string | null {
    const s = String(text || '');
    // "дог. №34VHA263N" / "shartnoma №34VHA263N" / oddiy "№34VHA263N"
    const m =
      s.match(/(?:дог[оаы]?[вб]?[оа]?р?\.?|shartnoma|contract|dog)[^0-9A-Za-z]{0,4}№?\s*([0-9]{1,4}[A-Za-z]{2,4}[0-9]{2,6}[A-Za-z]?)/i) ||
      s.match(/№\s*([0-9]{1,4}[A-Za-z]{2,4}[0-9]{2,6}[A-Za-z]?)/);
    return m ? m[1].toUpperCase() : null;
  }

  /**
   * AI yordamchi uchun — HAQIQIY shartnomani (tranzaksiyadan) aniqlab, CRM'dan
   * qiymat/to'langan/qoldiq + grafik (boshlang'ich/oylik reja va to'langan) +
   * ОплатыКв taqsimotini yig'ib, prompt uchun matn qaytaradi. 90s kesh.
   */
  private async assistantContractContext(orders: any[]): Promise<{ contract: string | null; text: string }> {
    // 1) Matched tranzaksiyalardan ishonchli shartnoma (contractNumber yoki izohdan)
    const extIds = orders.map((o) => o?.matchedTxExtId).filter(Boolean);
    const txContracts: string[] = [];
    if (extIds.length) {
      try {
        const txs = await this.prisma.transaction.findMany({
          where: { externalId: { in: extIds } },
          select: { contractNumber: true, description: true },
        });
        for (const t of txs) {
          const c = (t.contractNumber && t.contractNumber.trim()) || this.parseContractFromText(t.description);
          if (c) txContracts.push(c.toUpperCase());
        }
      } catch { /* skip */ }
    }
    // 2) Nomzodlar: avval tranzaksiyadan (ishonchli), keyin kontekstdagi (OCR bo'lishi mumkin)
    const cand: string[] = [];
    const pushC = (v: any) => { const x = String(v || '').trim().toUpperCase(); if (x && !cand.includes(x)) cand.push(x); };
    txContracts.forEach(pushC);
    orders.forEach((o) => { pushC(o?.contractNo); pushC(o?.docContractNo); });
    const primary = txContracts[0] || cand[0] || null;
    if (!primary) return { contract: null, text: "  (shartnoma aniqlanmadi — tranzaksiya/CRM'da topilmadi)" };

    const cached = this.asstCrmCache.get(primary);
    if (cached && Date.now() - cached.at < 90_000) return { contract: primary, text: cached.text };

    // 3) CRM info + grafik + ОплатыКв taqsimoti (parallel, xatolarga chidamli)
    const [info, sched, kv] = await Promise.all([
      this.contractInfo(primary).catch(() => null as any),
      this.crm.getContractSchedules(primary).catch(() => null as any),
      this.prisma.oplataKv.aggregate({
        where: { contractNo: primary },
        _sum: { firstInstallment: true, monthlyAmount: true, paymentAmount: true },
        _count: true,
      }).catch(() => null as any),
    ]);

    const money = (n: any) => (n == null ? '—' : Number(n).toLocaleString('ru-RU'));
    const schedules: any[] = sched?.schedules || [];
    const sumBy = (kind: string, field: string) =>
      schedules.filter((s) => s.kind === kind).reduce((a, s) => a + Number(s[field] || 0), 0);
    const initExp = sumBy('initial', 'amount'), initPaid = sumBy('initial', 'amountPaid');
    const monExp = sumBy('monthly', 'amount'), monPaid = sumBy('monthly', 'amountPaid');
    const found = !!(info?.found || (sched?.ok && schedules.length));

    const lines: string[] = [
      `  CRM shartnoma: ${primary} — CRM'da: ${found ? 'BOR' : "YO'Q"}${info?.virtualStatus ? ` · holat: ${info.virtualStatus}` : ''}`,
    ];
    if (txContracts[0] && cand.find((c) => c !== txContracts[0] && c)) {
      const ocr = cand.find((c) => c !== txContracts[0]);
      if (ocr) lines.push(`  (eslatma: hujjatda OCR '${ocr}' — lekin tranzaksiyadagi haqiqiy shartnoma '${txContracts[0]}')`);
    }
    if (found) {
      lines.push(`  Kelishuv qiymati: ${money(info?.contractValue)} · jami to'langan: ${money(info?.totalPaid)} · qoldiq: ${money(info?.remaining)}`);
      if (schedules.length) {
        lines.push(`  Grafik — Boshlang'ich: reja ${money(initExp)}, to'langan ${money(initPaid)}, qolgan ${money(initExp - initPaid)}`);
        lines.push(`  Grafik — Oylik: reja ${money(monExp)}, to'langan ${money(monPaid)}, qolgan ${money(monExp - monPaid)}`);
      } else {
        lines.push("  Grafik: CRM'dan olinmadi.");
      }
      if (kv) lines.push(`  ОплатыКв yozuvlari: 1 взнос (boshlang'ich) jami ${money(kv._sum?.firstInstallment)} · ежемесячный (oylik) jami ${money(kv._sum?.monthlyAmount)} — ${kv._count || 0} ta yozuv`);
    }
    const text = lines.join('\n');
    this.asstCrmCache.set(primary, { at: Date.now(), text });
    return { contract: primary, text };
  }

  async assistantChat(dto: AssistantChatDto, _actor: Actor) {
    const apiKey = await this.getAiKey();
    if (!apiKey) throw new BadRequestException('AI kalit sozlanmagan (Admin → Agent → AI kalit)');
    const model = await this.getAiModel();

    const ctx: any = dto.context || {};
    const orders: any[] = Array.isArray(ctx.orders) ? ctx.orders : [];
    const ctxText = orders.length
      ? orders.map((o, i) => {
          const real = o.contractNo || '—';
          const doc = o.docContractNo && o.docContractNo !== o.contractNo ? ` (hujjatда OCR: ${o.docContractNo})` : '';
          return `  [${i + 1}] order№: ${(o.orderNos || []).join(', ') || '—'} · shartnoma: ${real}${doc} · summa: ${o.amount ?? '—'} · natija: ${o.result || '—'}`;
        }).join('\n')
      : '  (hozircha natija yo\'q)';

    // CRM/grafik konteksti — shartnomani aniqlab, boshlang'ich/oylik grafikni yig'amiz
    const crmCtx = await this.assistantContractContext(orders).catch(() => ({ contract: null as string | null, text: '' }));

    const loc = String(dto.locale || 'uz').toLowerCase();
    const langRule = loc === 'ru'
      ? "- Отвечай ВСЕГДА на РУССКОМ языке, коротко и понятно. Все поля murojaat (summary/category/details) тоже на русском."
      : loc === 'en'
        ? "- ALWAYS reply in ENGLISH, short and clear. All ticket fields (summary/category/details) in English too."
        : "- Har doim O'ZBEK LOTIN yozuvida, qisqa va tushunarli gapir. Murojaat maydonlari (summary/category/details) ham o'zbekcha.";
    const system = [
      "Sen Xon Saroy quruvchi kompaniyasining ichki moliyaviy YORDAMCHISISAN.",
      "Xodim 'Chek order'да to'lovni tekshirgach, o'sha to'lov/shartnoma bo'yicha MUAMMO haqida sen bilan gaplashadi.",
      "Vazifang: xodim bilan qisqa, samimiy suhbatda muammoni ANIQLASH, keyin murojaat (ticket) taklif qilish.",
      "Ekrandagi natija(lar):",
      ctxText,
      "CRM / GRAFIK (shartnomani va boshlang'ich/oylik to'lovlarni tekshirish uchun — SENGA berilgan, o'zing foydalanasan):",
      crmCtx.text || "  (CRM ma'lumoti yo'q)",
      "QOIDALAR:",
      langRule,
      "- Bir necha order bo'lsa — FAQAT BIRINCHI xabarда qaysi order(lar) haqida ekanini so'ra. quickReplies: har order uchun bittadan + oxiriga 'Barchasi (hammasi)'.",
      "- Foydalanuvchi order(lar)ni TANLAGACH (yoki 'Barchasi' desa) — QAYTA order tanlashni SO'RAMA, order chiplarini QAYTA BERMA. Darhol o'sha order(lar) bo'yicha muammoga o't.",
      "- Keyin muammoni SO'RA (erkin). Odatiy muammolar: to'lov xonadonда/CRM'да ko'rinmayapti; summa oylik/boshlang'ichга noto'g'ri o'tgan; to'lov XATO bo'lgan; va h.k. Lekin tayyor variant majburlама — xodim erkin aytadi.",
      "- Muammoni so'raganда odatda quickReplies BERMA (erkin javob). Faqat aniq HA/YO'Q kerak bo'lсa quickReplies ber.",
      "- Aniq bo'lmasa ANIQLASHTIRUVCHI savol ber (1 tadan). Taxmin qilma.",
      "- proposeTicket.orderNos — foydalanuvchi tanlagan order(lar) ('Barchasi' bo'lsa hammasi).",
      // ── SHARTNOMA: o'zing aniqlaysan, so'ramaysan ──
      "- SHARTNOMA (MUHIM): shartnoma raqamini YUQORIDAGI 'CRM shartnoma' dan OL — u tranzaksiyadan aniqlangan, ISHONCHLI (hujjatдаги OCR raqami xato bo'lishi mumkin). proposeTicket.contractNo shu bo'lsin. CRM'da 'BOR' bo'lsa — foydalanuvchidan shartnoma raqamini SO'RAMA.",
      "- Shartnoma raqamini FAQAT quyidagi holatda so'ra: 'CRM shartnoma' umuman aniqlanmagan YOKI 'CRM'da: YO'Q' bo'lsa (ya'ni shartnoma CRM'da yo'q / xato). Boshqa hollarda so'rama.",
      // ── BOSHLANG'ICH ↔ OYLIK: avval tekshir, keyin xulosa ──
      "- BOSHLANG'ICH↔OYLIK muammosi (to'lov noto'g'ri joyga — boshlang'ich/oylikка — o'tgan desa): DARHOL murojaat YARATMA. Avval YUQORIDAGI CRM grafik (Boshlang'ich reja/to'langan, Oylik reja/to'langan) va ОплатыКв taqsimotini TAHLIL qil.",
      "- ANIQ raqamlar bilan tekshir: masalan 'grafik bo'yicha boshlang'ich reja X, to'langan Y (to'liq/to'liq emas); oylik reja Z...'. Shu asosda to'lov qayerga tegishli ekanini ayt.",
      "- Agar foydalanuvchi ADASHGAN bo'lsa (to'lov aslida to'g'ri joyda) — hurmat bilan, raqamlar bilan tushuntir va murojaat taklif QILMA (kerak bo'lsa 'baribir murojaat yarataymi?' deb so'ra). Agar HAQIQATAN xato bo'lsa — tushuntirib, murojaat taklif qil.",
      "- Muammo YETARLICHA aniq va TASDIQLANGAN bo'lsa — proposeTicket to'ldir: qisqa summary (1-2 jumla), category (masalan 'CRMда ko'rinmayapti', 'Oylik/boshlang'ichга o'tgan', 'XATO', 'Boshqa'), contractNo (CRM shartnoma), orderNos, details (grafik raqamlari bilan). proposeTicket berilса ham qisqa message yoz ('Murojaat tayyor, tasdiqlang').",
      "- HAR safar FAQAT assistant_turn tool orqali javob ber.",
      "- Foydalanuvchi '/start' yozsa — salomlash va (bir nechta bo'lsa) qaysi order haqida ekanini so'rash.",
    ].join('\n');

    const messages = (dto.messages || [])
      .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) }))
      .filter((m) => m.content);
    // Claude: birinchi xabar 'user' bo'lishi shart
    if (!messages.length) messages.push({ role: 'user', content: '/start' });
    if (messages[0].role !== 'user') messages.unshift({ role: 'user', content: '/start' });

    const tools = [{
      name: 'assistant_turn',
      description: 'Yordamchining bitta javobi — xabar + (ixtiyoriy) tez javob tugmalari + (ixtiyoriy) murojaat taklifi',
      input_schema: {
        type: 'object',
        properties: {
          message: { type: 'string', description: "Xodimга ko'rsatiladigan xabar (o'zbek lotin, qisqa)" },
          quickReplies: { type: 'array', items: { type: 'string' }, description: 'Tez javob tugmalari (masalan order raqamlari yoki Ha/Yo\'q)' },
          proposeTicket: {
            type: 'object',
            description: "Muammo aniq bo'lganда — murojaat taklifi",
            properties: {
              summary: { type: 'string' },
              category: { type: 'string' },
              contractNo: { type: 'string' },
              orderNos: { type: 'array', items: { type: 'string' } },
              details: { type: 'string' },
              priority: { type: 'string', enum: ['low', 'normal', 'high'] },
            },
            required: ['summary'],
          },
        },
        required: ['message'],
      },
    }];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1200, system, messages, tools, tool_choice: { type: 'tool', name: 'assistant_turn' } }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BadRequestException(`Claude API xatosi (${res.status}): ${errText.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const toolUse = (data?.content || []).find((c: any) => c.type === 'tool_use');
    const out: any = toolUse?.input || { message: 'Kechirasiz, javob berolmadim.' };
    return {
      ok: true,
      reply: out.message || '',
      quickReplies: Array.isArray(out.quickReplies) ? out.quickReplies.slice(0, 8) : [],
      proposal: out.proposeTicket || null,
    };
  }

  // ═════════════════ MUROJAATLAR (tickets) ═════════════════
  async assignees() {
    const rows = await this.prisma.adminUser.findMany({
      where: { isActive: true },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: 'asc' },
      take: 200,
    });
    return { ok: true, items: rows.map((u) => ({ id: u.id, name: u.fullName || u.email })) };
  }

  async createTicket(dto: CreateTicketDto, actor: Actor) {
    if (!dto?.summary || !dto.summary.trim()) throw new BadRequestException('Muammo xulosasi (summary) majburiy');
    let assignedToName: string | null = null;
    if (dto.assignedToId) {
      const u = await this.prisma.adminUser.findUnique({ where: { id: dto.assignedToId }, select: { fullName: true, email: true } });
      assignedToName = u?.fullName || u?.email || null;
    }
    const row = await this.prisma.chekTicket.create({
      data: {
        contractNo: dto.contractNo?.trim() || null,
        orderNos: Array.isArray(dto.orderNos) ? dto.orderNos.filter(Boolean) : [],
        matchedTxExtId: dto.matchedTxExtId || null,
        category: dto.category?.slice(0, 80) || null,
        summary: dto.summary.trim(),
        details: dto.details?.trim() || null,
        transcript: dto.transcript ?? undefined,
        priority: dto.priority || 'normal',
        status: 'new',
        assignedToId: dto.assignedToId || null,
        assignedToName,
        createdById: actor.id,
        createdByName: actor.name,
      },
    });
    return { ok: true, id: row.id, ticketNo: row.ticketNo };
  }

  async listTickets(q: ListTicketsDto, actor: Actor) {
    const page = Math.max(1, Number(q.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(q.perPage) || 30));
    const where: any = {};
    if (q.status && q.status !== 'all') where.status = q.status;
    if (q.mine === '1' && actor.id) where.assignedToId = actor.id;
    if (q.q && q.q.trim()) {
      const s = q.q.trim();
      where.OR = [
        { summary: { contains: s, mode: 'insensitive' } },
        { contractNo: { contains: s, mode: 'insensitive' } },
        { category: { contains: s, mode: 'insensitive' } },
        { assignedToName: { contains: s, mode: 'insensitive' } },
      ];
    }
    const [items, total, stats] = await Promise.all([
      this.prisma.chekTicket.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.chekTicket.count({ where }),
      this.prisma.chekTicket.groupBy({ by: ['status'], _count: true }),
    ]);
    const statMap: Record<string, number> = {};
    for (const s of stats) statMap[s.status] = (s as any)._count;
    return {
      ok: true, page, perPage, total,
      pageCount: Math.max(1, Math.ceil(total / perPage)),
      items,
      stats: { new: statMap['new'] || 0, in_progress: statMap['in_progress'] || 0, resolved: statMap['resolved'] || 0, rejected: statMap['rejected'] || 0 },
    };
  }

  async getTicket(id: string) {
    const row = await this.prisma.chekTicket.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Murojaat topilmadi');
    return { ok: true, item: row };
  }

  async updateTicket(id: string, dto: UpdateTicketDto, actor: Actor) {
    const row = await this.prisma.chekTicket.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Murojaat topilmadi');
    const data: any = {};
    if (dto.priority) data.priority = dto.priority;
    if (dto.status) {
      data.status = dto.status;
      if (dto.status === 'resolved') { data.resolvedByName = actor.name; data.resolvedAt = new Date(); }
    }
    if (dto.resolution !== undefined) data.resolution = dto.resolution?.trim() || null;
    if (dto.assignedToId !== undefined) {
      data.assignedToId = dto.assignedToId || null;
      if (dto.assignedToId) {
        const u = await this.prisma.adminUser.findUnique({ where: { id: dto.assignedToId }, select: { fullName: true, email: true } });
        data.assignedToName = u?.fullName || u?.email || null;
      } else data.assignedToName = null;
    }
    const updated = await this.prisma.chekTicket.update({ where: { id }, data });
    return { ok: true, item: updated };
  }

  async removeTicket(id: string) {
    const row = await this.prisma.chekTicket.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Murojaat topilmadi');
    await this.prisma.chekTicket.delete({ where: { id } });
    return { ok: true };
  }

  private async claudeExtractOrders(apiKey: string, model: string, fileBlock: any): Promise<ExtractedOrder[]> {
    const system = [
      "Sen Xon Saroy quruvchi kompaniyasining ichki moliyaviy yordamchisisan.",
      "Foydalanuvchi bank to'lov hujjati suratini/PDF'ini yuklaydi. Bu ikki xil bo'lishi mumkin:",
      "  (a) МЕМОРИАЛЬНЫЙ ОРДЕР, (b) КВИТАНЦИЯ О ВЗНОСЕ НАЛИЧНЫХ ДЕНЕГ (naqd pul kvitansiyasi).",
      "BITTA rasmда BIR NECHTA hujjat bo'lishi mumkin — HAMMASINI ajrat.",
      "Har hujjat uchun quyidagilarni DIQQAT bilan o'qi (raqamlarni raqamma-raqam, adashmasdan):",
      "- orderNo: yuqoridagi hujjat/kvitansiya RAQAMI — 'Мемориальный ордер №' yoki 'Квитанция ... № '. FAQAT raqamlar. Har bir raqamни aniq o'qi (0 va 8, 1 va 7 ni adashtirma).",
      "- date: hujjat sanasi ('Дата' yoki '\"22\" ИЮЛЯ 2026') — YYYY-MM-DD formatда.",
      "- amount: 'Сумма'/'СУММА' (faqat son, ajratuvchilarsiz — masalan 42500000).",
      "- payerName: to'lovchi shaxs ismi — 'Вноситель наличных денег' yoki 'Детали платежа' ichida (masalan 'RASULOV ZUHRIDDIN SHOKIR OGLI').",
      "- payerAccount: 'Дебет'/'Дебет счет плательщика' raqami.",
      "- recipientName: 'Наименование получателя' yoki pulni oluvchi tashkilot nomi.",
      "- recipientAccount: 'Кредит'/'Кредит счет получателя' raqami.",
      "- contractNo: to'lov maqsadi/tafsilotidagi SHARTNOMA raqami (masalan '№3962SRH26HV SONLI SHARTNOMAGA' → 3962SRH26HV, yoki 'дог. №34УНА263N' → 34УНА263N). Bu ENG MUHIM maydon — albatta topishga harakat qil.",
      "- purpose: 'Цель оплаты'/'Детали платежа' matni (qisqa).",
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
