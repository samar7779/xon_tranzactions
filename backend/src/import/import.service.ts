import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { Prisma, TxnDirection, TxnStatus, TxnType, TxnSource } from '@prisma/client';

/**
 * Excel'dan tranzaksiyalarni qo'lda import qilish.
 *
 * Excel ustunlari (rus sarlavhalar bilan):
 *   A: Р/С                  — hisob raqami (matn yoki raqam)
 *   B: Банк Названия        — bank nomi (bo'sh bo'lsa, A bo'yicha DB'dan topiladi)
 *   C: ДАТА                 — dd.MM.yyyy
 *   D: Наименование счета   — hisob nomi (faqat ma'lumot)
 *   E: Контрагент           — kontragent nomi (bo'sh bo'lishi mumkin)
 *   F: Категория            — kategoriya nomi (bo'sh yoki bizning ro'yxatda yo'q bo'lishi mumkin)
 *   G: №Заявка/Дог          — shartnoma raqami
 *   H: ОборотДебет          — chiqim summasi (OUT)
 *   I: ОборотКредит         — kirim summasi (IN)
 *   J: Назначение платежа   — to'lov maqsadi (purpose)
 *   K: ID                   — unikal ID (dublikat skip uchun)
 *
 * Summa formati: "596616522,10" (vergul decimal)
 * Bizning DB'da Decimal sifatida saqlanadi (so'm, tiyin emas — chunki Excel'da so'm formatda keladi)
 */
@Injectable()
export class ImportService {
  private readonly log = new Logger(ImportService.name);

  constructor(private prisma: PrismaService) {}

  /** "596616522,10" yoki "596 616 522,10" → number (so'm) */
  private parseAmount(raw: any): number {
    if (raw == null || raw === '') return 0;
    if (typeof raw === 'number') return raw;
    const s = String(raw).trim().replace(/\s/g, '').replace(/,/g, '.');
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  /** "24.12.2019" yoki Date obyekt → Date */
  private parseDate(raw: any): Date | null {
    if (!raw) return null;
    if (raw instanceof Date) return raw;
    const s = String(raw).trim();
    // dd.MM.yyyy
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return isNaN(d.getTime()) ? null : d;
    }
    // ISO va boshqalar
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  private cellText(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v == null) return '';
    if (typeof v === 'object' && 'text' in (v as any)) return String((v as any).text).trim();
    if (typeof v === 'object' && 'result' in (v as any)) return String((v as any).result).trim();
    return String(v).trim();
  }

  async importExcel(
    buffer: Buffer,
    importedBy?: string,
    fileName?: string,
  ): Promise<{
    total: number;
    added: number;
    skipped: number;
    errors: number;
    errorRows: Array<{ row: number; reason: string }>;
    batchId?: string;
  }> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Excel bo'sh");

    // Import batch — tarix uchun
    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'transactions',
        fileName: fileName?.slice(0, 255) || null,
        fileSize: buffer.length,
        importedBy: importedBy?.slice(0, 190) || null,
      },
    });

    const result = {
      total: 0,
      added: 0,
      skipped: 0,
      errors: 0,
      errorRows: [] as Array<{ row: number; reason: string }>,
    };

    const rowsToProcess: Array<{
      rowNum: number;
      accountNo: string;
      bankNameText: string;
      txnDate: Date;
      accountNameText: string;
      counterpartyText: string;
      categoryText: string;
      contractNumber: string;
      debit: number;
      credit: number;
      purpose: string;
      externalId: string;
    }> = [];

    // 1) Excel'ni o'qib chiqamiz (header skip)
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header

      const accountNo = this.cellText(row.getCell(1));
      const bankNameText = this.cellText(row.getCell(2));
      const txnDate = this.parseDate(row.getCell(3).value);
      const accountNameText = this.cellText(row.getCell(4));
      const counterpartyText = this.cellText(row.getCell(5));
      const categoryText = this.cellText(row.getCell(6));
      const contractNumber = this.cellText(row.getCell(7));
      const debit = this.parseAmount(row.getCell(8).value);
      const credit = this.parseAmount(row.getCell(9).value);
      const purpose = this.cellText(row.getCell(10));
      const externalId = this.cellText(row.getCell(11));

      // Bo'sh qator
      if (!accountNo && !externalId && debit === 0 && credit === 0) return;

      result.total++;

      // Asosiy validatsiya
      if (!externalId) {
        result.errors++;
        result.errorRows.push({ row: rowNumber, reason: "ID (K ustun) bo'sh" });
        return;
      }
      if (!accountNo) {
        result.errors++;
        result.errorRows.push({ row: rowNumber, reason: "Hisob raqami (A ustun) bo'sh" });
        return;
      }
      if (!txnDate) {
        result.errors++;
        result.errorRows.push({ row: rowNumber, reason: "Sana noto'g'ri (C ustun)" });
        return;
      }
      if (debit === 0 && credit === 0) {
        result.errors++;
        result.errorRows.push({ row: rowNumber, reason: 'Debet va Kredit ikkalasi 0' });
        return;
      }
      if (debit > 0 && credit > 0) {
        result.errors++;
        result.errorRows.push({
          row: rowNumber,
          reason: "Debet va Kredit ikkalasi ham > 0 (bittasi bo'lishi kerak)",
        });
        return;
      }

      rowsToProcess.push({
        rowNum: rowNumber,
        accountNo,
        bankNameText,
        txnDate,
        accountNameText,
        counterpartyText,
        categoryText,
        contractNumber,
        debit,
        credit,
        purpose,
        externalId,
      });
    });

    if (rowsToProcess.length === 0) return result;

    // 2) Account'larni topib olamiz (bir martalik query)
    const uniqAccountNos = Array.from(new Set(rowsToProcess.map((r) => r.accountNo)));
    const accounts = await this.prisma.bankAccount.findMany({
      where: { accountNo: { in: uniqAccountNos } },
      include: { bank: true },
    });
    const accByNo = new Map(accounts.map((a) => [a.accountNo, a]));

    // 3) Kategoriya nomlari → bizning kategoriyalar bilan match qilish (case-insensitive)
    const uniqCategoryNames = Array.from(
      new Set(rowsToProcess.map((r) => r.categoryText).filter(Boolean)),
    );
    const categories = uniqCategoryNames.length > 0
      ? await this.prisma.category.findMany({
          where: { OR: uniqCategoryNames.map((n) => ({ name: { equals: n, mode: 'insensitive' } })) },
        })
      : [];
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

    // 4) Mavjud externalId'larni topamiz (dublikat skip uchun)
    const uniqIds = Array.from(new Set(rowsToProcess.map((r) => r.externalId)));
    const existing = await this.prisma.transaction.findMany({
      where: { externalId: { in: uniqIds } },
      select: { externalId: true },
    });
    const existingIds = new Set(existing.map((e) => e.externalId));

    // 5) Yangi qatorlarni filterlash (dublikat — externalId DB'da bor)
    const newRows = rowsToProcess.filter((r) => {
      if (existingIds.has(r.externalId)) {
        result.skipped++;
        return false;
      }
      return true;
    });

    if (newRows.length === 0) {
      this.log.log(`Import: jami ${result.total}, hammasi dublikat — skip ${result.skipped}`);
      return result;
    }

    // 6) BULK INSERT — createMany bilan (per-row create'dan 50-100x tezroq)
    // 1000+ qatorlarda nginx 60s timeout'iga sig'maslik muammosini hal qiladi
    const importedAt = new Date();
    const BATCH_SIZE = 500;

    // Xavfsizlik uchun matnlarni qisqartirish — DB'da uzunlik chegarasi bor maydonlar uchun
    const trunc = (s: string | null | undefined, max: number) =>
      s == null ? null : (s.length > max ? s.slice(0, max) : s);

    const txnData = newRows.map((r) => {
      const acc = accByNo.get(r.accountNo);
      const direction: TxnDirection = r.credit > 0 ? 'IN' : 'OUT';
      const amount = r.credit > 0 ? r.credit : r.debit;
      const matchedCat = r.categoryText ? catByName.get(r.categoryText.toLowerCase()) : null;
      return {
        externalId: trunc(r.externalId, 190),                              // DB index uchun
        type: 'OTHER' as TxnType,
        status: 'COMPLETED' as TxnStatus,
        direction,
        amount: new Prisma.Decimal(amount),
        currency: 'UZS',
        fromAccount: trunc(direction === 'OUT' ? r.accountNo : null, 64),
        fromName: direction === 'OUT' ? r.accountNameText || null : r.counterpartyText || null,
        toAccount: trunc(direction === 'IN' ? r.accountNo : null, 64),
        toName: direction === 'IN' ? r.accountNameText || null : r.counterpartyText || null,
        description: r.purpose || null,                                    // Text — unlimited
        contractNumber: trunc(r.contractNumber || null, 128),              // VarChar(128)
        bankId: acc?.bankId ?? null,
        accountId: acc?.id ?? null,
        categoryId: matchedCat?.id ?? null,
        source: 'IMPORT' as TxnSource,
        importCategoryText: r.categoryText || null,                        // Text — unlimited
        importCounterpartyText: r.counterpartyText || null,                // Text — unlimited
        importBankNameText: r.bankNameText || (acc?.bank?.name ?? null),   // Text — unlimited
        importedBy: trunc(importedBy || null, 190),                        // VarChar(190)
        importedAt,
        importBatchId: batch.id,                                           // ← batch'ga link
        txnDate: r.txnDate,
      };
    });

    // Batch createMany
    for (let i = 0; i < txnData.length; i += BATCH_SIZE) {
      const batch = txnData.slice(i, i + BATCH_SIZE);
      try {
        const r = await this.prisma.transaction.createMany({
          data: batch,
          skipDuplicates: true, // externalId @unique uchun himoya
        });
        result.added += r.count;
      } catch (e: any) {
        // Butun batch fail bo'lsa — fallback: bittadan urinib ko'ramiz
        this.log.warn(`Batch createMany xato (${i}-${i + batch.length}): ${e?.message?.slice(0, 200)}`);
        for (let j = 0; j < batch.length; j++) {
          try {
            await this.prisma.transaction.create({ data: batch[j] });
            result.added++;
          } catch (e2: any) {
            result.errors++;
            result.errorRows.push({
              row: newRows[i + j].rowNum,
              reason: e2?.message?.slice(0, 200) || "Noma'lum xato",
            });
          }
        }
      }
    }

    // 7) Tarix yozuvlari — bulk insert (kim qachon import qilgani uchun)
    try {
      const inserted = await this.prisma.transaction.findMany({
        where: { externalId: { in: newRows.map((r) => r.externalId) }, source: 'IMPORT' },
        select: { id: true, externalId: true, categoryId: true, category: { select: { name: true } } },
      });
      const txByExtId = new Map(inserted.map((t) => [t.externalId, t]));

      const historyData = newRows
        .map((r) => {
          const tx = txByExtId.get(r.externalId);
          if (!tx) return null;
          return {
            txId: tx.id,
            action: 'import',
            actorName: importedBy || 'import',
            newCategoryId: tx.categoryId ?? null,
            newCategoryName: tx.category?.name ?? (r.categoryText || null),
            contractNumber: r.contractNumber || null,
            reason: `Qo'lda Excel'dan import qilindi (qator ${r.rowNum})`,
          };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);

      for (let i = 0; i < historyData.length; i += BATCH_SIZE) {
        try {
          await this.prisma.transactionCategoryHistory.createMany({
            data: historyData.slice(i, i + BATCH_SIZE),
          });
        } catch (e: any) {
          this.log.warn(`History batch xato: ${e?.message?.slice(0, 200)}`);
        }
      }
    } catch (e: any) {
      // History asosiy ishni to'xtatmasin
      this.log.warn(`History yozuv umumiy xato: ${e?.message}`);
    }

    // Batch statistikasini yangilash
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        rowsTotal: result.total,
        rowsAdded: result.added,
        rowsSkipped: result.skipped,
        rowsErrors: result.errors,
      },
    });

    this.log.log(
      `Import: batch ${batch.id} — jami ${result.total}, qo'shildi ${result.added}, skip ${result.skipped}, xato ${result.errors}`,
    );
    return { ...result, batchId: batch.id };
  }

  // ═══ BATCH MANAGEMENT ═══════════════════════════════════════════════

  /** Barcha import batch'lar (yangi avval) — frontend tarix uchun */
  async listBatches() {
    const batches = await this.prisma.importBatch.findMany({
      orderBy: { importedAt: 'desc' },
      take: 200,
    });
    return { ok: true, items: batches };
  }

  /**
   * Batchni o'chirish — undagi tranzaksiyalarni ham (CASCADE).
   * Faqat source=IMPORT bo'lganlar o'chiriladi (sync data tegmaydi).
   */
  async deleteBatch(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BadRequestException('Batch topilmadi');

    // Tranzaksiyalarni topish (source IMPORT bo'lganlar)
    const txns = await this.prisma.transaction.findMany({
      where: { importBatchId: batchId, source: 'IMPORT' },
      select: { id: true },
    });
    const ids = txns.map((t) => t.id);

    // Bog'liq history va payment yozuvlarini avval o'chirish (FK)
    if (ids.length > 0) {
      await this.prisma.transactionCategoryHistory.deleteMany({
        where: { txId: { in: ids } },
      });
      await this.prisma.payment.deleteMany({
        where: { transactionId: { in: ids } },
      });
      await this.prisma.transaction.deleteMany({
        where: { id: { in: ids } },
      });
    }

    // Batchni o'chirish
    await this.prisma.importBatch.delete({ where: { id: batchId } });

    this.log.log(`Batch ${batchId} o'chirildi: ${ids.length} ta tranzaksiya`);
    return { ok: true, deleted: ids.length };
  }

  /**
   * Batchdagi tranzaksiyalarni Excel'ga eksport qilish.
   * Format: import'ga teskari (rus sarlavhalar bilan, foydalanuvchi qayta import qila olishi uchun)
   */
  async exportBatch(batchId: string): Promise<{ buffer: Buffer; filename: string }> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BadRequestException('Batch topilmadi');

    const txns = await this.prisma.transaction.findMany({
      where: { importBatchId: batchId, source: 'IMPORT' },
      include: {
        bank: true,
        account: { include: { bank: true } }, // nested — account.bank ham kerak
        category: true,
      },
      orderBy: { txnDate: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar — Import Backup';
    wb.created = new Date();
    const ws = wb.addWorksheet('Tranzaksiyalar');

    ws.columns = [
      { header: 'Р/С',                key: 'rs',         width: 26 },
      { header: 'Банк Названия',      key: 'bank',       width: 22 },
      { header: 'ДАТА',               key: 'date',       width: 12 },
      { header: 'Наименование счета', key: 'accName',    width: 32 },
      { header: 'Контрагент',         key: 'cp',         width: 32 },
      { header: 'Категория',          key: 'cat',        width: 24 },
      { header: '№Заявка/Дог',        key: 'contract',   width: 18 },
      { header: 'ОборотДебет',        key: 'debit',      width: 16 },
      { header: 'ОборотКредит',       key: 'credit',     width: 16 },
      { header: 'Назначение платежа', key: 'purpose',    width: 50 },
      { header: 'ID',                 key: 'id',         width: 30 },
    ];
    const head = ws.getRow(1);
    head.font = { bold: true, size: 10 };
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    const fmtDate = (d: Date) => {
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${dd}.${mm}.${d.getFullYear()}`;
    };

    for (const t of txns) {
      const isOut = t.direction === 'OUT';
      const accountNo = isOut ? t.fromAccount : t.toAccount;
      const accountName = isOut ? t.fromName : t.toName;
      const counterparty = isOut ? t.toName : t.fromName;
      const cat = t.category?.name || t.importCategoryText || '';

      ws.addRow({
        rs: accountNo || t.account?.accountNo || '',
        bank: t.importBankNameText || t.bank?.name || t.account?.bank?.name || '',
        date: t.txnDate ? fmtDate(new Date(t.txnDate)) : '',
        accName: accountName || '',
        cp: t.importCounterpartyText || counterparty || '',
        cat,
        contract: t.contractNumber || '',
        debit: isOut ? Number(t.amount) : '',
        credit: isOut ? '' : Number(t.amount),
        purpose: t.description || '',
        id: t.externalId || '',
      });
    }

    const raw = await wb.xlsx.writeBuffer();
    const buffer: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const safeName = (batch.fileName || `import-${batch.id}`).replace(/\.xlsx?$/i, '');
    const filename = `${safeName}_backup.xlsx`;
    return { buffer, filename };
  }

  /**
   * Eski importlarni (batch'siz) bitta 'Legacy' batch'ga guruhlash.
   * Idempotent — qayta ishga tushirish xavfsiz.
   */
  async backfillLegacyBatch(): Promise<{ batchId: string | null; linked: number }> {
    const orphans = await this.prisma.transaction.count({
      where: { source: 'IMPORT', importBatchId: null },
    });
    if (orphans === 0) return { batchId: null, linked: 0 };

    // Birinchi va oxirgi importedAt sanalarini olish
    const earliest = await this.prisma.transaction.findFirst({
      where: { source: 'IMPORT', importBatchId: null },
      orderBy: { importedAt: 'asc' },
      select: { importedAt: true, importedBy: true },
    });

    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'transactions',
        fileName: 'legacy-import',
        importedBy: earliest?.importedBy || null,
        importedAt: earliest?.importedAt || new Date(),
        rowsTotal: orphans,
        rowsAdded: orphans,
        notes: 'Eski import (batch tarixsiz) — avtomatik guruhlangan',
      },
    });

    // Barcha orphan'larni shu batch'ga bog'lash
    const r = await this.prisma.transaction.updateMany({
      where: { source: 'IMPORT', importBatchId: null },
      data: { importBatchId: batch.id },
    });

    this.log.log(`Legacy batch ${batch.id}: ${r.count} ta tranzaksiya bog'landi`);
    return { batchId: batch.id, linked: r.count };
  }
}
