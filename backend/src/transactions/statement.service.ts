import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';

// Bank vipiskasi (выписка лицевых счетов) — Excel formatida
@Injectable()
export class StatementService {
  constructor(private prisma: PrismaService) {}

  async build(accountId: string, dateFrom: string, dateTo: string) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom va dateTo kerak');

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { bank: true },
    });
    if (!account) throw new NotFoundException('Hisob topilmadi');

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    const txns = await this.prisma.transaction.findMany({
      where: { accountId, txnDate: { gte: from, lte: to } },
      orderBy: [{ txnDate: 'asc' }, { operationTime: 'asc' }],
    });

    // Oborotlar — debet (OUT) va kredit (IN)
    let totalDebit = 0;
    let totalCredit = 0;
    for (const t of txns) {
      const amt = Number(t.amount);
      if (t.direction === 'OUT') totalDebit += amt;
      else totalCredit += amt;
    }
    // Qoldiq: Konec dnya = hozirgi balans, Nachalo dnya = teskari hisoblab
    const closing = Number(account.balance || 0);
    const opening = closing - totalCredit + totalDebit;

    const lastOpDate = txns.length ? txns[txns.length - 1].txnDate : null;

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

    const fmtDate = (d: Date | null) =>
      d
        ? `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
        : '';

    const center = { horizontal: 'center' as const, vertical: 'middle' as const };
    const mergeRow = (row: number, text: string, bold = false, align: 'left' | 'center' = 'center') => {
      ws.mergeCells(row, 1, row, COLS);
      const cell = ws.getCell(row, 1);
      cell.value = text;
      cell.font = { bold, size: bold ? 12 : 10 };
      cell.alignment = { horizontal: align, vertical: 'middle' };
    };

    // ── Sarlavha bloki ──
    mergeRow(2, 'Выписка лицевых счетов', true);
    mergeRow(3, `за ${fmtDate(from)} по ${fmtDate(to)}`);
    mergeRow(4, `ID документа: ${randomUUID()}`, false, 'left');

    ws.getCell('A6').value = `Дата изготовления ${fmtDate(new Date())}`;
    ws.getCell('E6').value = `Дата последней операции по счёту ${fmtDate(lastOpDate)}`;
    ws.getCell('A7').value = `№ счёта ${account.accountNo}`;
    ws.getCell('E7').value = `Ответисполнитель ${account.ownerName || '—'}`;
    ws.getCell('A8').value = `Наименование счёта ${account.ownerName || '—'}`;
    ws.getCell('A9').value = 'Остаток:';
    ws.getCell('C9').value = `Начало дня ${opening.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    ws.getCell('G9').value = `Конец дня ${closing.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    for (const ref of ['A6', 'E6', 'A7', 'E7', 'A8', 'A9', 'C9', 'G9']) {
      ws.getCell(ref).font = { size: 10 };
    }

    // ── Jadval sarlavhasi ──
    const HEAD = [
      '№ пп',
      'Дата документа',
      'Дата обработки',
      '№ док',
      'Наименование счёта',
      'ИНН',
      '№ счёта',
      'МФО',
      'Обороты по дебету',
      'Обороты по кредиту',
      'Назначение платежа',
    ];
    const headRow = ws.getRow(11);
    HEAD.forEach((h, i) => {
      const cell = headRow.getCell(i + 1);
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { ...center, wrapText: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });
    headRow.height = 32;

    // ── Tranzaksiya qatorlari ──
    const MONEY = '#,##0.00';
    let r = 12;
    txns.forEach((t, idx) => {
      const isOut = t.direction === 'OUT';
      const cpName = isOut ? t.toName : t.fromName;
      const cpInn = isOut ? t.toInn : t.fromInn;
      const cpAccount = isOut ? t.toAccount : t.fromAccount;
      const cpMfo = isOut ? t.toMfo : t.fromMfo;
      const amt = Number(t.amount);

      const row = ws.getRow(r);
      row.getCell(1).value = idx + 1;
      row.getCell(2).value = fmtDate(t.txnDate);
      row.getCell(3).value = fmtDate(t.valueDate || t.txnDate);
      row.getCell(4).value = t.docNumber || t.reference || '';
      row.getCell(5).value = cpName || '';
      row.getCell(6).value = cpInn || '';
      row.getCell(7).value = cpAccount || '';
      row.getCell(8).value = cpMfo || '';
      row.getCell(9).value = isOut ? amt : 0;
      row.getCell(10).value = isOut ? 0 : amt;
      row.getCell(11).value = t.description || '';

      row.getCell(9).numFmt = MONEY;
      row.getCell(10).numFmt = MONEY;
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
    totalRow.getCell(9).numFmt = MONEY;
    totalRow.getCell(10).numFmt = MONEY;
    totalRow.getCell(9).font = { bold: true, size: 10 };
    totalRow.getCell(10).font = { bold: true, size: 10 };

    const raw = await wb.xlsx.writeBuffer();
    const buffer: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const safeAcc = account.accountNo.replace(/[^\d]/g, '');
    const filename = `vipiska_${safeAcc}_${dateFrom}_${dateTo}.xlsx`;
    return { buffer, filename, count: txns.length };
  }
}
