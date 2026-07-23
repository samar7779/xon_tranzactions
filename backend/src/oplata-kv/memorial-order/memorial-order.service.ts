import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../common/prisma/prisma.service';
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

  constructor(private prisma: PrismaService) {}

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
  async generatePdf(contractNo: string): Promise<{ buffer: Buffer; filename: string }> {
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

    // 3. Bloklar
    const blocks: OrderBlock[] = rows.map((r) => {
      const tx = r.sourceTxId ? txMap.get(r.sourceTxId) : undefined;
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

    const buffer = await this.renderPdf(cn, blocks);
    const safe = cn.replace(/[^\wа-яёА-ЯЁa-zA-Z0-9-]+/g, '_').slice(0, 40);
    return { buffer, filename: `mem-order-${safe}.pdf` };
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
    const labelW = 168;
    const valueX = left + labelW;
    const col2X = left + 330;

    // Sahifada joy yetmasa — yangi sahifa (blok taxminan 320px)
    if (idx > 0) {
      if (doc.y + 320 > bottom) doc.addPage();
      else doc.y += 10;
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

    if (!b.hasTx) {
      doc.font('R').fontSize(7.5).fillColor('#b45309')
        .text('(!) Bank tranzaksiyasi bog\'lanmagan — ma\'lumot to\'liq emas', left, doc.y + 1, { width: right - left });
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
  private field(doc: Doc, left: number, labelW: number, valueX: number, right: number, label: string, value: string, bold = false) {
    const y0 = doc.y;
    doc.font('R').fontSize(8.5).fillColor('#555').text(label, left, y0, { width: labelW - 6 });
    const yLabel = doc.y;
    doc.font(bold ? 'B' : 'R').fontSize(9.5).fillColor('#000').text(value || '—', valueX, y0, { width: right - valueX });
    const yValue = doc.y;
    doc.y = Math.max(yLabel, yValue) + 2.5;
  }

  /** Ikki ustunli qator: chapda label1/value1, o'ngda label2/value2 (ИНН, Код banka kabi) */
  private field2(doc: Doc, left: number, labelW: number, valueX: number, col2X: number, right: number, label1: string, value1: string, label2: string, value2: string) {
    const y0 = doc.y;
    doc.font('R').fontSize(8.5).fillColor('#555').text(label1, left, y0, { width: labelW - 6 });
    const yl1 = doc.y;
    doc.font('R').fontSize(9.5).fillColor('#000').text(value1 || '—', valueX, y0, { width: col2X - valueX - 8 });
    const yv1 = doc.y;
    let yMax = Math.max(yl1, yv1);
    if (label2) {
      doc.font('R').fontSize(8.5).fillColor('#555').text(label2, col2X, y0, { width: 60 });
      const yl2 = doc.y;
      doc.font('R').fontSize(9.5).fillColor('#000').text(value2 || '—', col2X + 62, y0, { width: right - (col2X + 62) });
      yMax = Math.max(yMax, yl2, doc.y);
    }
    doc.y = yMax + 2.5;
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
