import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { KapitalbankClient } from '../../integrations/kapitalbank/kapitalbank.client';
import { KbDoc1CItem } from '../../integrations/kapitalbank/types';
import { amountToWordsRu } from './ru-words';
import { mfoToBankName } from './mfo-banks';

type Doc = PDFKit.PDFDocument;

/** Bir to'lov bloki uchun ma'lumot (oplata_kv qatori + bog'langan bank tranzaksiyasi) */
interface OrderBlock {
  date: Date;
  docNumber: string;
  id: string;
  fromName: string;
  fromAccount: string;
  fromInn: string;
  fromMfo: string;
  toName: string;
  toAccount: string;
  toInn: string;
  toMfo: string;
  amount: number;
  description: string;
  hasTx: boolean;
}

@Injectable()
export class MemorialOrderService {
  private readonly log = new Logger(MemorialOrderService.name);
  private _fontDir: string | null = null;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
  ) {}

  /** Roboto shriftlari joylashgan papkani topadi (dev: src/, prod: dist/ — ikkalasidan ham backend/assets/fonts) */
  private fontDir(): string {
    if (this._fontDir) return this._fontDir;
    const candidates = [
      path.join(__dirname, '..', '..', 'assets', 'fonts'),        // dist/oplata-kv/memorial-order -> yo'q, pastda
      path.join(__dirname, '..', '..', '..', 'assets', 'fonts'),  // dist/oplata-kv/memorial-order -> backend/assets/fonts
      path.join(process.cwd(), 'assets', 'fonts'),
      path.join(process.cwd(), 'backend', 'assets', 'fonts'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, 'Roboto-Regular.ttf'))) {
        this._fontDir = c;
        return c;
      }
    }
    // Topilmasa — birinchisini qaytaramiz (xato aniq bo'lishi uchun)
    this._fontDir = candidates[1];
    return this._fontDir;
  }

  /** Shartnoma bo'yicha barcha to'lovlar uchun Мемориальный ордер PDF */
  async generatePdf(
    contractNo: string,
    opts: { fromBank?: boolean } = {},
  ): Promise<{ buffer: Buffer; filename: string }> {
    const cn = (contractNo || '').trim();
    if (!cn) throw new NotFoundException('Shartnoma raqami kerak');

    // 1. Shartnomaning barcha to'lovlari (sana bo'yicha), musbat summalar
    const rows = await this.prisma.oplataKv.findMany({
      where: { contractNo: cn },
      orderBy: { date: 'asc' },
    });

    // 2. sourceTxId -> Transaction (externalId YOKI id bo'yicha)
    const ids = rows.map((r) => r.sourceTxId).filter((x): x is string => !!x);
    const txs = ids.length
      ? await this.prisma.transaction.findMany({
          where: { OR: [{ externalId: { in: ids } }, { id: { in: ids } }] },
        })
      : [];
    const txMap = new Map<string, (typeof txs)[number]>();
    for (const t of txs) {
      if (t.externalId) txMap.set(t.externalId, t);
      txMap.set(t.id, t);
    }

    // 2b. sourceTxId bilan bog'lanmagan qatorlar uchun — DB'dagi bank tranzaksiyasini
    //     shartnoma raqami bo'yicha topib, summa + sana yaqinligi bilan moslaymiz.
    //     (Eski/qo'lda import qilingan to'lovlar sourceTxId'siz bo'ladi.)
    const rowMatch = new Map<string, (typeof txs)[number]>(); // oplataKv.id -> tx
    const unlinked = rows.filter((r) => !(r.sourceTxId && txMap.has(r.sourceTxId)));
    if (unlinked.length) {
      const linkedIds = txs.map((t) => t.id);
      const candidates = await this.prisma.transaction.findMany({
        where: {
          contractNumber: cn,
          ...(linkedIds.length ? { id: { notIn: linkedIds } } : {}),
        },
        orderBy: { txnDate: 'asc' },
      });
      const used = new Set<string>();
      for (const r of unlinked) {
        const amt = Number(r.paymentAmount ?? 0);
        const rd = (r.date as Date).getTime();
        let best: (typeof candidates)[number] | undefined;
        let bestScore = Infinity;
        for (const c of candidates) {
          if (used.has(c.id)) continue;
          const camt = Number(c.amount);
          const amtDiff = Math.abs(camt - amt);
          // Summa (deyarli) teng bo'lishi shart — bank hujjati aynan shu to'lov
          if (amtDiff > Math.max(1, camt * 0.0001)) continue;
          const dateDiff = Math.abs(c.txnDate.getTime() - rd) / 86_400_000; // kun
          const score = amtDiff * 1000 + dateDiff;
          if (score < bestScore) { bestScore = score; best = c; }
        }
        if (best) { used.add(best.id); rowMatch.set(r.id, best); }
      }
    }

    // 3. Bloklar
    const blocks: OrderBlock[] = rows.map((r) => {
      const tx = (r.sourceTxId ? txMap.get(r.sourceTxId) : undefined) || rowMatch.get(r.id);
      const amount = tx ? Number(tx.amount) : Number(r.paymentAmount ?? 0);
      return {
        date: (tx?.txnDate ?? r.date) as Date,
        docNumber: tx?.docNumber || '',
        id: tx?.bankGeneralId || tx?.externalId || '',
        fromName: tx?.fromName || '',
        fromAccount: tx?.fromAccount || '',
        fromInn: tx?.fromInn || '',
        fromMfo: tx?.fromMfo || '',
        toName: tx?.toName || '',
        toAccount: tx?.toAccount || '',
        toInn: tx?.toInn || '',
        toMfo: tx?.toMfo || '',
        amount,
        description: tx?.description || r.purpose || '',
        hasTx: !!tx,
      };
    });

    // 4. (ixtiyoriy) Bankdan to'ldirish — DB'da yo'q/to'liqsiz bloklarni
    //    bankdan (getDoc1C) real ma'lumot bilan to'ldiramiz. FAQAT O'QISH —
    //    hech narsa DB'ga yozilmaydi.
    if (opts.fromBank) {
      try {
        await this.fillFromBank(cn, rows, blocks);
      } catch (e: any) {
        this.log.warn(`Bankdan to'ldirish xatosi: ${e?.message}`);
      }
    }

    const buffer = await this.renderPdf(cn, blocks);
    const safe = cn.replace(/[^\wа-яёА-ЯЁa-zA-Z0-9-]+/g, '_').slice(0, 40);
    return { buffer, filename: `mem-order-${safe}.pdf` };
  }

  // ─────────────────────── Bankdan to'ldirish (read-only) ───────────────────────

  /**
   * To'liqsiz bloklarni (to'lovchi hisob/MFO yo'q) bankdan getDoc1C orqali
   * to'ldiradi. Sync-yoqilgan hisoblar × kerakli sanalar bo'yicha bankdan
   * o'qiydi, shartnoma № + summa bo'yicha mos to'lovni topadi.
   * FAQAT O'QISH — DB'ga hech narsa yozilmaydi.
   */
  private async fillFromBank(contractNo: string, rows: any[], blocks: OrderBlock[]) {
    // To'liqsiz (to'lovchi hisob ham, MFO ham yo'q) bloklar indeksi
    const need = blocks
      .map((b, i) => (!b.fromAccount && !b.fromMfo ? i : -1))
      .filter((i) => i >= 0);
    if (!need.length) return;

    const accounts = await this.prisma.bankAccount.findMany({
      where: { syncEnabled: true },
      include: { credential: { include: { bank: true } } },
    });
    if (!accounts.length) return;

    // Kerakli noyob sanalar (dd.MM.yyyy)
    const dates = new Set<string>();
    for (const i of need) {
      const d = this.toApiDate(rows[i].date as Date);
      if (d) dates.add(d);
    }
    if (!dates.size) return;

    // getDoc1C — har (hisob, sana) uchun, cheklangan
    const MAX_CALLS = 30;
    let calls = 0;
    const pool: KbDoc1CItem[] = [];
    for (const acc of accounts) {
      const cred: any = (acc as any).credential;
      const bank = cred?.bank;
      if (!bank?.apiBaseUrl || !cred?.passwordEnc) continue;
      let password: string;
      try { password = this.crypto.decrypt(cred.passwordEnc); } catch { continue; }
      const login = (cred.loginPrefix || '') + cred.loginName;
      for (const date of dates) {
        if (calls >= MAX_CALLS) break;
        calls++;
        try {
          const result = await this.kb.getDoc1C({
            baseUrl: bank.apiBaseUrl,
            login,
            password,
            branch: acc.branch,
            account: acc.accountNo,
            date,
            useProxy: cred.useProxy === true,
          });
          for (const it of result?.content || []) pool.push(it);
        } catch (e: any) {
          this.log.warn(`getDoc1C ${acc.accountNo} ${date}: ${e?.message}`);
        }
      }
      if (calls >= MAX_CALLS) break;
    }
    if (!pool.length) return;

    // Mos to'lovni topish: summa (deyarli) teng + shartnoma № purpose ichida
    const norm = (s?: string) => (s || '').toUpperCase().replace(/[^A-ZА-Я0-9]/gi, '');
    const cnNorm = norm(contractNo);
    for (const i of need) {
      const amt = Number(rows[i].paymentAmount ?? blocks[i].amount ?? 0);
      let best: KbDoc1CItem | undefined;
      let bestScore = Infinity;
      for (const it of pool) {
        const iamt = Number(it.amount ?? 0) / 100;
        const amtDiff = Math.abs(iamt - amt);
        if (amtDiff > Math.max(1, iamt * 0.0001)) continue;
        const hasContract = norm(it.purpose).includes(cnNorm);
        const score = (hasContract ? 0 : 1_000_000) + amtDiff;
        if (score < bestScore) { bestScore = score; best = it; }
      }
      // Faqat shartnoma № mos kelsa to'ldiramiz (noto'g'ri to'lovni oldini olish)
      if (best && norm(best.purpose).includes(cnNorm)) {
        blocks[i] = this.blockFromBankItem(best);
      }
    }
  }

  private blockFromBankItem(it: KbDoc1CItem): OrderBlock {
    return {
      date: this.parseApiDate(it.ddate) || new Date(),
      docNumber: it.num || '',
      id: it.general_id || it.b2_id || '',
      fromName: it.name_dt || '',
      fromAccount: it.acc_dt || '',
      fromInn: it.inn_dt || '',
      fromMfo: it.mfo_dt || '',
      toName: it.name_ct || '',
      toAccount: it.acc_ct || '',
      toInn: it.inn_ct || '',
      toMfo: it.mfo_ct || '',
      amount: Number(it.amount ?? 0) / 100,
      description: it.purpose || '',
      hasTx: true,
    };
  }

  /** Date -> dd.MM.yyyy (bank API formati, UTC) */
  private toApiDate(d: Date): string | null {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getUTCFullYear()}`;
  }

  /** dd.MM.yyyy -> Date (UTC) */
  private parseApiDate(s?: string): Date | null {
    if (!s) return null;
    const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!m) return null;
    return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }

  // ─────────────────────────── PDF ───────────────────────────

  private renderPdf(contractNo: string, blocks: OrderBlock[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
        const fdir = this.fontDir();
        doc.registerFont('R', path.join(fdir, 'Roboto-Regular.ttf'));
        doc.registerFont('B', path.join(fdir, 'Roboto-Medium.ttf'));

        const chunks: Buffer[] = [];
        doc.on('data', (c: Buffer) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        if (blocks.length === 0) {
          doc.font('B').fontSize(13).text('Мемориальный ордер', { align: 'center' });
          doc.moveDown(0.5);
          doc.font('R').fontSize(11).fillColor('#666')
            .text(`Договор ${contractNo}: платежи не найдены`, { align: 'center' });
          doc.end();
          return;
        }

        const todayStr = this.fmtDate(new Date());
        // Ma'lumoti to'liq bo'lmagan to'lovlar (bank tranzaksiyasi yo'q yoki hisob bo'sh)
        const incomplete = blocks.filter((b) => !b.hasTx || !b.fromAccount);
        this.drawSummary(doc, contractNo, blocks, incomplete, todayStr);
        blocks.forEach((b, i) => this.drawBlock(doc, b, i, contractNo, todayStr));

        doc.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  private drawBlock(doc: Doc, b: OrderBlock, idx: number, contractNo: string, todayStr: string) {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const bottom = doc.page.height - doc.page.margins.bottom;
    const labelW = 160;
    const valueX = left + labelW;
    const col2X = left + 320;

    // Sahifaga 3 order sig'ishi uchun ixcham (~235px). Joy yetmasa — yangi sahifa.
    if (idx > 0) {
      if (doc.y + 235 > bottom) doc.addPage();
      else doc.y += 7;
    }

    // ── Sarlavha ──
    const yTop = doc.y;
    doc.font('B').fontSize(11).fillColor('#111')
      .text(`Мемориальный ордер   № ${b.docNumber || '—'}`, left, yTop, { width: 360 });
    doc.font('R').fontSize(7.5).fillColor('#888')
      .text('Отв. системный пользователь B2', left + 360, yTop + 2, { width: right - (left + 360), align: 'right' });
    doc.fillColor('#000');
    doc.y = Math.max(doc.y, yTop + 16);

    // ── Header maydonlari ──
    this.field2(doc, left, labelW, valueX, col2X, right, 'ID', b.id || '—', 'Изг.', todayStr);
    this.field2(doc, left, labelW, valueX, col2X, right, 'Дата', this.fmtDate(b.date), '', '');

    // ── Плательщик ──
    this.field(doc, left, labelW, valueX, right, 'Наименование плательщика', b.fromName || '—');
    this.field2(doc, left, labelW, valueX, col2X, right, 'Дебет счёт плательщика', b.fromAccount || '—', 'ИНН', b.fromInn || '—');
    this.field2(doc, left, labelW, valueX, col2X, right, 'Наим. банка плательщика', mfoToBankName(b.fromMfo) || (b.fromMfo ? `Код ${b.fromMfo}` : '—'), 'Код банка', b.fromMfo || '—');
    this.field(doc, left, labelW, valueX, right, 'Сумма', this.fmtMoney(b.amount), true);

    doc.y += 4;

    // ── Получатель ──
    this.field(doc, left, labelW, valueX, right, 'Наименование получателя', b.toName || '—');
    this.field(doc, left, labelW, valueX, right, 'Кредит счёт получателя', b.toAccount || '—');
    this.field2(doc, left, labelW, valueX, col2X, right, 'Наим. банка получателя', mfoToBankName(b.toMfo) || (b.toMfo ? `Код ${b.toMfo}` : '—'), 'Код банка', b.toMfo || '—');
    this.field(doc, left, labelW, valueX, right, 'Сумма прописью', amountToWordsRu(b.amount));
    this.field(doc, left, labelW, valueX, right, 'Детали платежа', b.description || '—');

    if (!b.hasTx || !b.fromAccount) {
      doc.font('R').fontSize(6.5).fillColor('#b45309')
        .text('(!) Ma\'lumot to\'liq emas — bank tafsilotlari topilmadi', left, doc.y + 1, { width: right - left });
      doc.fillColor('#000');
    }

    // ── Imzo bloki ──
    doc.y += 10;
    const sy = doc.y;
    doc.font('R').fontSize(8.5).fillColor('#333');
    doc.text('Руководитель  ______________', left, sy, { width: 260 });
    doc.text('Главный бухгалтер  ______________', left + 270, sy, { width: right - (left + 270) });
    doc.y = Math.max(doc.y, sy + 14);
    const sy2 = doc.y;
    doc.text('Проверен  __________', left, sy2, { width: 150 });
    doc.text('Одобрен  __________', left + 160, sy2, { width: 150 });
    doc.text(`Проведён  ${this.fmtDate(b.date)}`, left + 320, sy2, { width: right - (left + 320) });
    doc.y = Math.max(doc.y, sy2 + 14);
    doc.font('B').fontSize(8.5).fillColor('#333').text('М.П.  БАНК', left, doc.y);
    doc.fillColor('#000');

    // ── Ajratuvchi chiziq ──
    doc.y += 8;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.7).strokeColor('#cbd5e1').stroke();
    doc.strokeColor('#000');
    doc.y += 2;
  }

  /** Bitta label/value qatori — value o'ralganda balandlik hisobga olinadi */
  private field(doc: Doc, left: number, labelW: number, valueX: number, right: number, label: string, value: string, bold = false, maxH = 0) {
    const y0 = doc.y;
    doc.font('R').fontSize(7).fillColor('#555').text(label, left, y0, { width: labelW - 6 });
    const yLabel = doc.y;
    const vOpts: any = { width: right - valueX };
    if (maxH) { vOpts.height = maxH; vOpts.ellipsis = true; }
    doc.font(bold ? 'B' : 'R').fontSize(8.5).fillColor('#000').text(value || '—', valueX, y0, vOpts);
    const yValue = doc.y;
    doc.y = Math.max(yLabel, yValue) + 1.5;
  }

  /** Ikki ustunli qator: chapda label1/value1, o'ngda label2/value2 (ИНН, Код banka kabi) */
  private field2(doc: Doc, left: number, labelW: number, valueX: number, col2X: number, right: number, label1: string, value1: string, label2: string, value2: string, maxH = 0) {
    const y0 = doc.y;
    doc.font('R').fontSize(7).fillColor('#555').text(label1, left, y0, { width: labelW - 6 });
    const yl1 = doc.y;
    const v1Opts: any = { width: col2X - valueX - 8 };
    if (maxH) { v1Opts.height = maxH; v1Opts.ellipsis = true; }
    doc.font('R').fontSize(8.5).fillColor('#000').text(value1 || '—', valueX, y0, v1Opts);
    const yv1 = doc.y;
    let yMax = Math.max(yl1, yv1);
    if (label2) {
      doc.font('R').fontSize(7).fillColor('#555').text(label2, col2X, y0, { width: 60 });
      const yl2 = doc.y;
      doc.font('R').fontSize(8.5).fillColor('#000').text(value2 || '—', col2X + 62, y0, { width: right - (col2X + 62) });
      yMax = Math.max(yMax, yl2, doc.y);
    }
    doc.y = yMax + 1.5;
  }

  /** Boshdagi umumiy ro'yxat — jami/to'liq/ma'lumoti yo'q + qaysi to'lovlar (sana) */
  private drawSummary(doc: Doc, contractNo: string, blocks: OrderBlock[], incomplete: OrderBlock[], todayStr: string) {
    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;

    doc.font('B').fontSize(14).fillColor('#0f172a').text('МЕМОРИАЛЬНЫЙ ОРДЕР', left, doc.y);
    doc.font('R').fontSize(9).fillColor('#475569')
      .text(`Договор № ${contractNo}    ·    Изг. ${todayStr}`, left, doc.y + 1);
    doc.y += 8;

    const total = blocks.length;
    const ok = total - incomplete.length;
    doc.font('R').fontSize(10).fillColor('#0f172a');
    doc.text(`Всего платежей: ${total}        Полные данные: ${ok}        Без данных: ${incomplete.length}`, left, doc.y);
    doc.y += 5;

    if (incomplete.length) {
      doc.font('B').fontSize(9).fillColor('#b45309')
        .text(`Платежи без полных банковских данных (${incomplete.length}):`, left, doc.y);
      doc.y += 2;
      doc.font('R').fontSize(8.5).fillColor('#7c2d12');
      incomplete.forEach((b, i) => {
        doc.text(`${i + 1}.   ${this.fmtDate(b.date)}   —   ${this.fmtMoney(b.amount)} сум`, left + 10, doc.y + 1);
        doc.y += 1;
      });
      doc.fillColor('#000');
    }

    doc.y += 8;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor('#94a3b8').stroke();
    doc.strokeColor('#000');
    doc.y += 8;
  }

  private fmtDate(d: Date): string {
    if (!(d instanceof Date) || isNaN(d.getTime())) return '—';
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = d.getUTCFullYear();
    return `${dd}.${mm}.${yy}`;
  }

  private fmtMoney(n: number): string {
    const [int, dec] = Number(n || 0).toFixed(2).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return `${grouped},${dec}`;
  }
}
