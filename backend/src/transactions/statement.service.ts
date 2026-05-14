import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';
import { KbDoc1CItem } from '../integrations/kapitalbank/types';

const DAY_MS = 86_400_000;
const MAX_DAYS = 92; // bankni urib yubormaslik uchun davr chegarasi

// Bank vipiskasi (выписка лицевых счетов) — to'g'ridan-to'g'ri bankdan (GetDoc1C), Excel formatida
@Injectable()
export class StatementService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
  ) {}

  async build(accountId: string, dateFrom: string, dateTo: string) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom va dateTo kerak');

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { bank: true, credential: { include: { bank: true } } },
    });
    if (!account) throw new NotFoundException('Hisob topilmadi');

    const cred = account.credential;
    if (!cred) throw new BadRequestException('Hisobga bank ulanishi biriktirilmagan');
    const bank = cred.bank;
    if (bank.apiKind !== 'KAPITALBANK_V3') {
      throw new BadRequestException("Vipiska hozircha faqat KAPITALBANK_V3 banklar uchun");
    }
    if (!bank.apiBaseUrl) {
      throw new BadRequestException('Bank API manzili sozlanmagan');
    }

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);
    const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (days < 1) throw new BadRequestException("dateFrom dateTo dan keyin bo'lmasligi kerak");
    if (days > MAX_DAYS) {
      throw new BadRequestException(`Davr ${MAX_DAYS} kundan oshmasligi kerak`);
    }

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;

    // ── Bankdan kunma-kun GetDoc1C ──
    const items: KbDoc1CItem[] = [];
    let saldoInTiyin: number | null = null;   // birinchi muvaffaqiyatli kun
    let saldoOutTiyin: number | null = null;  // oxirgi muvaffaqiyatli kun
    let totalDebitTiyin = 0;
    let totalCreditTiyin = 0;
    let failedDays = 0;
    let lastError: any = null;

    for (let i = 0; i < days; i++) {
      const day = new Date(from.getTime() + i * DAY_MS);
      const dateStr = this.fmtDate(day);
      try {
        const result = await this.kb.getDoc1C({
          baseUrl: bank.apiBaseUrl,
          login,
          password,
          branch: account.branch,
          account: account.accountNo,
          date: dateStr,
          useProxy: cred.useProxy === true,
        });
        const content = result?.content || [];
        items.push(...content);
        if (saldoInTiyin === null && result?.saldo_in != null) {
          saldoInTiyin = Number(result.saldo_in);
        }
        if (result?.saldo_out != null) saldoOutTiyin = Number(result.saldo_out);
        if (result?.total_debit != null) totalDebitTiyin += Number(result.total_debit);
        if (result?.total_credit != null) totalCreditTiyin += Number(result.total_credit);
      } catch (e: any) {
        // Dam olish/non-operatsion kunlar xato berishi mumkin — o'tkazib yuboramiz
        failedDays++;
        lastError = e;
      }
    }
    // Hamma kun xato bo'lsa — foydalanuvchiga xatoni ko'rsatamiz
    if (failedDays === days) {
      throw new BadRequestException(
        `Bankdan vipiska olinmadi: ${lastError?.message || 'noma\'lum xato'}`,
      );
    }

    // tiyin → so'm
    const opening = (saldoInTiyin ?? 0) / 100;
    const closing = (saldoOutTiyin ?? 0) / 100;
    const totalDebit = totalDebitTiyin / 100;
    const totalCredit = totalCreditTiyin / 100;

    // Sana + vaqt bo'yicha tartiblash
    items.sort((a, b) => {
      const da = this.parseDate(a.ddate);
      const db = this.parseDate(b.ddate);
      if (da !== db) return da - db;
      return (a.time || '').localeCompare(b.time || '');
    });

    const lastOpDate = items.length ? items[items.length - 1].ddate || '' : '';

    return this.buildWorkbook({
      account,
      from,
      to,
      items,
      opening,
      closing,
      totalDebit,
      totalCredit,
      lastOpDate,
      partial: failedDays > 0,
    });
  }

  private fmtDate(d: Date): string {
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }

  // "dd.MM.yyyy" → sortlash uchun raqam
  private parseDate(s?: string): number {
    if (!s) return 0;
    const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!m) return 0;
    return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
  }

  private async buildWorkbook(d: {
    account: any;
    from: Date;
    to: Date;
    items: KbDoc1CItem[];
    opening: number;
    closing: number;
    totalDebit: number;
    totalCredit: number;
    lastOpDate: string;
    partial: boolean;
  }) {
    const { account, from, to, items, opening, closing, totalDebit, totalCredit, lastOpDate } = d;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('Vipiska');

    const COLS = 11; // A..K
    ws.columns = [
      { width: 6 },   // A № пп
      { width: 13 },  // B Дата документа
      { width: 13 },  // C Дата обработки
      { width: 14 },  // D № док
      { width: 34 },  // E Наименование счёта
      { width: 14 },  // F ИНН
      { width: 24 },  // G № счёта
      { width: 9 },   // H МФО
      { width: 18 },  // I Обороты по дебету
      { width: 18 },  // J Обороты по кредиту
      { width: 50 },  // K Назначение платежа
    ];

    const money = (n: number) =>
      n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const mergeRow = (row: number, text: string, bold = false, align: 'left' | 'center' = 'center') => {
      ws.mergeCells(row, 1, row, COLS);
      const cell = ws.getCell(row, 1);
      cell.value = text;
      cell.font = { bold, size: bold ? 12 : 10 };
      cell.alignment = { horizontal: align, vertical: 'middle' };
    };

    // ── Sarlavha bloki ──
    mergeRow(2, 'Выписка лицевых счетов', true);
    mergeRow(3, `за ${this.fmtDate(from)} по ${this.fmtDate(to)}`);
    mergeRow(4, `ID документа: ${randomUUID()}`, false, 'left');

    ws.getCell('A6').value = `Дата изготовления ${this.fmtDate(new Date())}`;
    ws.getCell('E6').value = `Дата последней операции по счёту ${lastOpDate || '—'}`;
    ws.getCell('A7').value = `№ счёта ${account.accountNo}`;
    ws.getCell('E7').value = `Ответисполнитель ${account.ownerName || '—'}`;
    ws.getCell('A8').value = `Наименование счёта ${account.ownerName || '—'}`;
    ws.getCell('A9').value = 'Остаток:';
    ws.getCell('C9').value = `Начало дня ${money(opening)}`;
    ws.getCell('G9').value = `Конец дня ${money(closing)}`;
    for (const ref of ['A6', 'E6', 'A7', 'E7', 'A8', 'A9', 'C9', 'G9']) {
      ws.getCell(ref).font = { size: 10 };
    }
    if (d.partial) {
      mergeRow(10, "⚠ Ba'zi kunlar uchun ma'lumot olinmadi — vipiska to'liq bo'lmasligi mumkin", false, 'left');
      ws.getCell('A10').font = { size: 9, italic: true, color: { argb: 'FFB45309' } };
    }

    // ── Jadval sarlavhasi ──
    const HEAD = [
      '№ пп', 'Дата документа', 'Дата обработки', '№ док', 'Наименование счёта',
      'ИНН', '№ счёта', 'МФО', 'Обороты по дебету', 'Обороты по кредиту', 'Назначение платежа',
    ];
    const headRow = ws.getRow(11);
    HEAD.forEach((h, i) => {
      const cell = headRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    headRow.height = 32;

    // ── Tranzaksiya qatorlari ──
    const MONEY_FMT = '#,##0.00';
    let r = 12;
    items.forEach((it, idx) => {
      // Bizning hisob debet tomonda bo'lsa — chiqim (debet), aks holda kirim (kredit)
      const isDebit = it.acc_dt === account.accountNo;
      const cpName = isDebit ? it.name_ct : it.name_dt;
      const cpInn = isDebit ? it.inn_ct : it.inn_dt;
      const cpAcc = isDebit ? it.acc_ct : it.acc_dt;
      const cpMfo = isDebit ? it.mfo_ct : it.mfo_dt;
      const amount = Number(it.amount || 0) / 100; // tiyin → so'm

      const row = ws.getRow(r);
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = it.ddate || '';
      row.getCell(3).value = it.vdate || it.input_date || it.ddate || '';
      row.getCell(4).value = it.num || '';
      row.getCell(5).value = cpName || '';
      row.getCell(6).value = cpInn || '';
      row.getCell(7).value = cpAcc || '';
      row.getCell(8).value = cpMfo || '';
      row.getCell(9).value = isDebit ? amount : 0;
      row.getCell(10).value = isDebit ? 0 : amount;
      row.getCell(11).value = it.purpose || '';

      row.getCell(9).numFmt = MONEY_FMT;
      row.getCell(10).numFmt = MONEY_FMT;
      for (let c = 1; c <= COLS; c++) {
        const cell = row.getCell(c);
        cell.font = { size: 9 };
        cell.alignment = { vertical: 'top', wrapText: c === 5 || c === 11 };
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      }
      r++;
    });

    // ── Jami (итого) qatori ──
    const totalRow = ws.getRow(r);
    totalRow.getCell(8).value = 'Итого:';
    totalRow.getCell(8).font = { bold: true, size: 10 };
    totalRow.getCell(8).alignment = { horizontal: 'right' };
    totalRow.getCell(9).value = totalDebit;
    totalRow.getCell(10).value = totalCredit;
    totalRow.getCell(9).numFmt = MONEY_FMT;
    totalRow.getCell(10).numFmt = MONEY_FMT;
    totalRow.getCell(9).font = { bold: true, size: 10 };
    totalRow.getCell(10).font = { bold: true, size: 10 };

    const raw = await wb.xlsx.writeBuffer();
    const buffer: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const safeAcc = account.accountNo.replace(/[^\d]/g, '');
    const fromIso = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    const toIso = `${to.getFullYear()}-${String(to.getMonth() + 1).padStart(2, '0')}-${String(to.getDate()).padStart(2, '0')}`;
    const filename = `vipiska_${safeAcc}_${fromIso}_${toIso}.xlsx`;
    return { buffer, filename, count: items.length };
  }
}
