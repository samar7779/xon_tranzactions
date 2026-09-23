import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { Prisma, TxnDirection, TxnStatus, TxnType, TxnSource } from '@prisma/client';
import {
  hamkorDedupKey,
  hamkorDedupKeyFromExisting,
} from '../integrations/hamkorbank/hamkor-dedup.util';

// windows-1251 → Unicode yuqori diapazon (0x80–0xFF). Hamkor vipiskasi HTML-jadval
// bo'lib win-1251 kodlashda keladi; Node ICU'ga bog'lanmasdan aniq dekod qilish uchun.
const CP1251_HIGH =
  'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏ' +
  'ђ‘’“”•–—�™љ›њќћџ' +
  ' ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї' +
  '°±Ііґµ¶·ё№є»јЅѕї' +
  'АБВГДЕЖЗИЙКЛМНОП' +
  'РСТУФХЦЧШЩЪЫЬЭЮЯ' +
  'абвгдежзийклмноп' +
  'рстуфхцчшщъыьэюя';

/** Hamkor vipiska preview holati — commitgacha xotirada saqlanadi (bazaga tegmaydi). */
interface HamkorPreviewRow {
  externalId: string;
  hbDedupKey: string;
  direction: TxnDirection;
  amountSom: number;
  txnDate: Date;
  valueDate: Date | null;
  docNumber: string;
  description: string;
  fromAccount: string | null;
  toAccount: string | null;
  fromName: string | null;
  toName: string | null;
}
interface HamkorPreviewState {
  fileName: string | null;
  fileSize: number;
  accountNo: string;
  accountId: string;
  bankId: string | null;
  rows: HamkorPreviewRow[]; // FAQAT qo'shiladigan (yangi) qatorlar
  total: number;
  willInsert: number;
  duplicatesInDb: number;
  duplicatesInFile: number;
  errors: number;
  integrityOk: boolean | null; // opening + net = closing (balans mos keldimi)
  importedBy?: string;
  expiresAt: number;
}

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

  // Hamkor vipiska preview → commit uchun vaqtincha kesh (30 daqiqa TTL).
  private hamkorPreviewCache = new Map<string, HamkorPreviewState>();
  private static readonly HAMKOR_PREVIEW_TTL_MS = 30 * 60 * 1000;

  constructor(private prisma: PrismaService) {}

  /** Muddati o'tgan preview'larni tozalaydi (har chaqiruvda). */
  private sweepHamkorPreviews() {
    const now = Date.now();
    for (const [k, v] of this.hamkorPreviewCache) {
      if (v.expiresAt < now) this.hamkorPreviewCache.delete(k);
    }
  }

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

  // ═══ ALOQA BANK IMPORT ═══════════════════════════════════════════════
  // Aloqa Bank uchun alohida Excel format (10 ustun, shartnoma raqami yo'q).
  // Source: ALOQA_BANK → edit/delete/category bloklanadi.
  // Batch kind: 'aloqa-bank' — alohida tarix tabida ko'rinadi.

  async importExcelAloqaBank(
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

    // Import batch — alohida 'aloqa-bank' kind bilan
    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'aloqa-bank',
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

    // Aloqa Bank format (11 ustun, mavjud transactions formati bilan bir xil):
    //   A: Р/С (hisob raqami)
    //   B: Банк Названия
    //   C: ДАТА (13.05.2026)
    //   D: Наименование счета
    //   E: Контрагент
    //   F: Категория
    //   G: №Заявка/Дог (shartnoma raqami — saqlanadi, lekin edit bloklangan)
    //   H: ОборотДебет
    //   I: ОборотКредит
    //   J: Назначение платежа
    //   K: ID
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

      if (!accountNo && !externalId && debit === 0 && credit === 0) return;
      result.total++;

      if (!externalId) {
        result.errors++;
        result.errorRows.push({ row: rowNumber, reason: "ID (K ustun) bo'sh" });
        return;
      }
      if (!accountNo) {
        result.errors++;
        result.errorRows.push({ row: rowNumber, reason: "P/C (A ustun) bo'sh" });
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
        accountNo, bankNameText, txnDate, accountNameText, counterpartyText,
        categoryText, contractNumber, debit, credit, purpose, externalId,
      });
    });

    if (rowsToProcess.length === 0) return { ...result, batchId: batch.id };

    // Aloqa Bank ID prefiksi (boshqa import'lar bilan kollision bo'lmasin)
    // Misol: 'ALB_<original_id>' — Aloqa Bank source bilan birlashganda noyob bo'ladi
    const ALOQA_PREFIX = 'ALB_';
    rowsToProcess.forEach((r) => {
      if (!r.externalId.startsWith(ALOQA_PREFIX)) {
        r.externalId = ALOQA_PREFIX + r.externalId;
      }
    });

    // Hisoblar va kategoriyalarni topish (parallel)
    const uniqAccountNos = Array.from(new Set(rowsToProcess.map((r) => r.accountNo)));
    const accounts = await this.prisma.bankAccount.findMany({
      where: { accountNo: { in: uniqAccountNos } },
      include: { bank: true },
    });
    const accByNo = new Map(accounts.map((a) => [a.accountNo, a]));

    const uniqCategoryNames = Array.from(
      new Set(rowsToProcess.map((r) => r.categoryText).filter(Boolean)),
    );
    const categories = uniqCategoryNames.length > 0
      ? await this.prisma.category.findMany({
          where: { OR: uniqCategoryNames.map((n) => ({ name: { equals: n, mode: 'insensitive' } })) },
        })
      : [];
    const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

    // Mavjud externalId'lar (dublikat skip)
    const uniqIds = Array.from(new Set(rowsToProcess.map((r) => r.externalId)));
    const existing = await this.prisma.transaction.findMany({
      where: { externalId: { in: uniqIds } },
      select: { externalId: true },
    });
    const existingIds = new Set(existing.map((e) => e.externalId));

    const newRows = rowsToProcess.filter((r) => {
      if (existingIds.has(r.externalId)) {
        result.skipped++;
        return false;
      }
      return true;
    });

    if (newRows.length === 0) {
      // Batch statistikasini yangilash
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { rowsTotal: result.total, rowsAdded: 0, rowsSkipped: result.skipped, rowsErrors: result.errors },
      });
      return { ...result, batchId: batch.id };
    }

    const importedAt = new Date();
    const BATCH_SIZE = 500;
    const trunc = (s: string | null | undefined, max: number) =>
      s == null ? null : (s.length > max ? s.slice(0, max) : s);

    const txnData = newRows.map((r) => {
      const acc = accByNo.get(r.accountNo);
      const direction: TxnDirection = r.credit > 0 ? 'IN' : 'OUT';
      const amount = r.credit > 0 ? r.credit : r.debit;
      const matchedCat = r.categoryText ? catByName.get(r.categoryText.toLowerCase()) : null;
      return {
        externalId: trunc(r.externalId, 190),
        type: 'OTHER' as TxnType,
        status: 'COMPLETED' as TxnStatus,
        direction,
        amount: new Prisma.Decimal(amount),
        currency: 'UZS',
        fromAccount: trunc(direction === 'OUT' ? r.accountNo : null, 64),
        fromName: direction === 'OUT' ? r.accountNameText || null : r.counterpartyText || null,
        toAccount: trunc(direction === 'IN' ? r.accountNo : null, 64),
        toName: direction === 'IN' ? r.accountNameText || null : r.counterpartyText || null,
        description: r.purpose || null,
        contractNumber: trunc(r.contractNumber || null, 128),
        bankId: acc?.bankId ?? null,
        accountId: acc?.id ?? null,
        categoryId: matchedCat?.id ?? null,
        source: 'ALOQA_BANK' as TxnSource,  // ← ASOSIY: ALOQA_BANK source
        importCategoryText: r.categoryText || null,
        importCounterpartyText: r.counterpartyText || null,
        importBankNameText: r.bankNameText || (acc?.bank?.name ?? null),
        importedBy: trunc(importedBy || null, 190),
        importedAt,
        importBatchId: batch.id,
        txnDate: r.txnDate,
      };
    });

    for (let i = 0; i < txnData.length; i += BATCH_SIZE) {
      const chunk = txnData.slice(i, i + BATCH_SIZE);
      try {
        const r = await this.prisma.transaction.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        result.added += r.count;
      } catch (e: any) {
        this.log.warn(`Aloqa createMany xato (${i}-${i + chunk.length}): ${e?.message?.slice(0, 200)}`);
        for (let j = 0; j < chunk.length; j++) {
          try {
            await this.prisma.transaction.create({ data: chunk[j] });
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
      `Aloqa Bank import: batch ${batch.id} — jami ${result.total}, qo'shildi ${result.added}, skip ${result.skipped}, xato ${result.errors}`,
    );
    return { ...result, batchId: batch.id };
  }

  // ═══ HAMKORBANK VIPISKA (выписка) IMPORT ════════════════════════════
  // Bank rasmiy vipiskasi = HTML-jadval (.xls kengaytmali, win-1251). Eski davrlar uchun
  // (byacc timeout tufayli ololmaydigan). byacc bilan DUBLIKAT bo'lmasligi uchun har yozuvga
  // hbDedupKey (xonpay uuid yoki kompozit) hisoblanadi — byacc/sync bilan bir xil formulada.
  // Preview → Commit: avval tekshiriladi (bazaga tegilmaydi), tasdiqlangach yoziladi.

  /** win-1251 bufer → matn (TextDecoder, ICU yo'q bo'lsa qo'lda jadval). */
  private decodeCp1251(buf: Buffer): string {
    try {
      const s = new TextDecoder('windows-1251', { fatal: false }).decode(buf);
      if (s && /[а-яА-Я]/.test(s)) return s;
    } catch {
      /* ICU yo'q — qo'lda dekod */
    }
    let out = '';
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      out += b < 0x80 ? String.fromCharCode(b) : CP1251_HIGH[b - 0x80];
    }
    return out;
  }

  /** HTML teg + entity'larni tozalab matnni normallashtiradi. */
  private stripHtml(s: string): string {
    return s
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Vipiska summasi "1 238 000,00" / "1 238 000.00" → number (so'm). */
  private parseVipiskaAmount(raw: string): number {
    const n = parseFloat(String(raw || '').replace(/[\s ]/g, '').replace(/,/g, '.'));
    return isNaN(n) ? 0 : n;
  }

  /** "dd.mm.yyyy" yoki "dd.mm.yyyy HH:mm:ss" → Date (Toshkent, +5). */
  private parseHamkorDateTime(s: string): Date | null {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || '').trim());
    if (!m) return null;
    const [, dd, mo, yyyy, hh, mi, ss] = m;
    const d = new Date(Date.UTC(
      Number(yyyy), Number(mo) - 1, Number(dd),
      (hh != null ? Number(hh) : 0) - 5, // Toshkent (+5) → UTC
      mi != null ? Number(mi) : 0,
      ss != null ? Number(ss) : 0,
    ));
    return isNaN(d.getTime()) ? null : d;
  }

  /** Purpos ichidan HAQIQIY to'langan kun (Время транзакции). Karta to'lovlarida bor. */
  private actualDateFromPurpose(s: string): string | undefined {
    const m = /Время\s+транзакции\s+(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)/.exec(String(s || ''));
    return m ? m[1].replace(/\s+/g, ' ').trim() : undefined;
  }

  /**
   * Vipiskani parse qiladi (bazaga tegmaydi): HTML jadvaldan yozuvlar + header'dan
   * hisob/egasi/davr/qoldiqlarni ajratadi.
   */
  private parseHamkorVipiska(buffer: Buffer): {
    accountNo: string | null;
    ownerName: string | null;
    period: string | null;
    opening: number | null;
    closing: number | null;
    records: string[][];
  } {
    const html = this.decodeCp1251(buffer);
    const rows: string[][] = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = trRe.exec(html))) {
      const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      const cells: string[] = [];
      let c: RegExpExecArray | null;
      while ((c = tdRe.exec(m[1]))) cells.push(this.stripHtml(c[1]));
      if (cells.length) rows.push(cells);
    }
    // Yozuvlar: datetime bilan boshlanadigan 8-katakli qatorlar
    const dr = /^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}$/;
    const records: string[][] = [];
    for (const r of rows) {
      for (let i = 0; i < r.length; i++) {
        if (dr.test(r[i]) && r[i + 6] !== undefined) {
          records.push(r.slice(i, i + 8));
          i += 7;
        }
      }
    }
    // Header — birinchi yozuvgacha; o'z hisobimiz = header'dagi 1-chi 20-xonali raqam
    const flat = rows.map((r) => r.join(' | ')).join('\n');
    const firstDate = /\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}:\d{2}/.exec(flat);
    const header = firstDate ? flat.slice(0, firstDate.index) : flat;
    const accountNo = (/(\d{20})/.exec(header) || [])[1] || null;
    let ownerName: string | null = null;
    if (accountNo) {
      const after = header.slice(header.indexOf(accountNo) + 20);
      const nm = /^[\s|]*([^|]+?)\s*(?:ИНН|INN|\||$)/.exec(after);
      ownerName = nm && nm[1].trim() ? nm[1].trim().slice(0, 190) : null;
    }
    const per = /[cсCС]\s+(\d{2}\.\d{2}\.\d{4})\s+по\s+(\d{2}\.\d{2}\.\d{4})/.exec(flat);
    const period = per ? `${per[1]} – ${per[2]}` : null;
    const pick = (re: RegExp): number | null => {
      const mm = re.exec(flat);
      return mm ? this.parseVipiskaAmount(mm[1]) : null;
    };
    const opening = pick(/начало периода:\s*([\d\s .,]+)/i);
    const closing = pick(/конец периода:\s*([\d\s .,]+)/i);
    return { accountNo, ownerName, period, opening, closing, records };
  }

  async previewHamkorVipiska(
    buffer: Buffer,
    importedBy?: string,
    fileName?: string,
  ): Promise<{
    previewId: string;
    fileName: string | null;
    accountNo: string | null;
    accountMapped: boolean;
    ownerName: string | null;
    period: string | null;
    opening: number | null;
    closing: number | null;
    netCalc: number | null;
    integrityOk: boolean | null;
    total: number;
    willInsert: number;
    duplicatesInDb: number;
    duplicatesInFile: number;
    errors: number;
    errorRows: Array<{ row: number; reason: string }>;
    skippedRows: Array<{ row: number; id: string; contractNo: string; reason: string }>;
    duration: number;
    expiresAt: string;
  }> {
    this.sweepHamkorPreviews();
    const started = Date.now();
    const parsed = this.parseHamkorVipiska(buffer);
    if (!parsed.accountNo) {
      throw new BadRequestException("Vipiska'dan hisob raqami (Счет) topilmadi — fayl Hamkor vipiskasi ekaniga ishonch hosil qiling");
    }

    const account = await this.prisma.bankAccount.findFirst({
      where: { accountNo: parsed.accountNo },
      include: { bank: true },
    });

    // Integrity: opening + kredit − debit ?= closing (bironta qator o'tkazib yuborilmaganini tekshiradi)
    let sumCr = 0;
    let sumDt = 0;

    const errorRows: Array<{ row: number; reason: string }> = [];
    const skippedRows: Array<{ row: number; id: string; contractNo: string; reason: string }> = [];
    const seen = new Set<string>();
    const newRows: HamkorPreviewRow[] = [];
    let duplicatesInFile = 0;
    let duplicatesInDb = 0;

    // Mavjud yozuvlar kalitlari (shu hisob doirasida) — live hisoblanadi (backfill shart emas)
    const existingKeys = new Set<string>();
    if (account) {
      const existing = await this.prisma.transaction.findMany({
        where: { accountId: account.id, externalId: { startsWith: 'HB_' } },
        select: { externalId: true, description: true, hbDedupKey: true },
      });
      for (const e of existing) {
        const k = hamkorDedupKeyFromExisting(e);
        if (k) existingKeys.add(k);
      }
    }

    const own = parsed.accountNo;
    parsed.records.forEach((rec, idx) => {
      const rowNum = idx + 1;
      const dat = rec[0];
      const cell1 = rec[1] || '';
      const doc = rec[2] || '';
      const debit = this.parseVipiskaAmount(rec[5]);
      const credit = this.parseVipiskaAmount(rec[6]);
      const purpose = rec[7] || '';
      sumCr += credit;
      sumDt += debit;

      if (debit === 0 && credit === 0) {
        errorRows.push({ row: rowNum, reason: 'Debet va Kredit ikkalasi 0' });
        return;
      }
      if (debit > 0 && credit > 0) {
        errorRows.push({ row: rowNum, reason: "Debet va Kredit ikkalasi > 0 (bittasi bo'lishi kerak)" });
        return;
      }

      const direction: TxnDirection = credit > 0 ? 'IN' : 'OUT';
      const amountSom = credit > 0 ? credit : debit;
      const amountTiyin = Math.round(amountSom * 100);
      const cpAcc = (/(\d{20})/.exec(cell1) || [])[1] || null;
      const accCt = direction === 'IN' ? own : cpAcc; // kirimda biz kreditormiz
      const accDt = direction === 'IN' ? cpAcc : own;

      const key = hamkorDedupKey({ purpose, num: doc, ddate: dat, accCt, accDt, amountTiyin, ownAccount: own });
      const externalId = ('HB_IMP_' + key.replace(':', '_')).slice(0, 190);

      // in-file dublikat
      if (seen.has(key)) {
        duplicatesInFile++;
        if (skippedRows.length < 50) skippedRows.push({ row: rowNum, id: externalId, contractNo: doc, reason: 'Faylda takror' });
        return;
      }
      seen.add(key);
      // DB dublikat (byacc yoki oldingi import)
      if (existingKeys.has(key)) {
        duplicatesInDb++;
        if (skippedRows.length < 50) skippedRows.push({ row: rowNum, id: externalId, contractNo: doc, reason: 'Bazada bor (byacc yoki oldingi import)' });
        return;
      }

      // sana — HAQIQIY kun (Время транзакции) bo'lsa, aks holda Дата (byacc bilan bir xil)
      const actual = this.actualDateFromPurpose(purpose);
      const txnDate = (actual ? this.parseHamkorDateTime(actual) : null) || this.parseHamkorDateTime(dat) || new Date();
      const cpName = cell1.replace(/\d{20}/g, '').replace(/ИНН.*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 255) || null;

      newRows.push({
        externalId,
        hbDedupKey: key,
        direction,
        amountSom,
        txnDate,
        valueDate: null,
        docNumber: doc.slice(0, 64),
        description: purpose.slice(0, 10000),
        fromAccount: accDt, // payer
        toAccount: accCt, // receiver
        fromName: direction === 'IN' ? cpName : parsed.ownerName,
        toName: direction === 'IN' ? parsed.ownerName : cpName,
      });
    });

    const total = parsed.records.length;
    const netCalc = sumCr - sumDt;
    const integrityOk =
      parsed.closing != null
        ? Math.abs((parsed.opening ?? 0) + netCalc - parsed.closing) < 0.5
        : null;

    const previewId = randomUUID();
    const expiresAt = Date.now() + ImportService.HAMKOR_PREVIEW_TTL_MS;

    // Hisob topilmasa — hech narsa yozib bo'lmaydi (jimgina tashlamaymiz, xabar beramiz)
    this.hamkorPreviewCache.set(previewId, {
      fileName: fileName?.slice(0, 255) || null,
      fileSize: buffer.length,
      accountNo: parsed.accountNo,
      accountId: account?.id || '',
      bankId: account?.bankId || null,
      rows: account ? newRows : [],
      total,
      willInsert: account ? newRows.length : 0,
      duplicatesInDb,
      duplicatesInFile,
      errors: errorRows.length,
      integrityOk,
      importedBy,
      expiresAt,
    });

    const duration = Math.round((Date.now() - started) / 1000);
    this.log.log(
      `Hamkor vipiska preview ${previewId.slice(0, 8)}: acc ${parsed.accountNo} (${account ? 'topildi' : 'TOPILMADI'}), ` +
      `${total} yozuv, ${account ? newRows.length : 0} yangi, ${duplicatesInDb} DB-dub, ${duplicatesInFile} fayl-dub, ${errorRows.length} xato, integrity=${integrityOk}`,
    );

    return {
      previewId,
      fileName: fileName?.slice(0, 255) || null,
      accountNo: parsed.accountNo,
      accountMapped: !!account,
      ownerName: parsed.ownerName,
      period: parsed.period,
      opening: parsed.opening,
      closing: parsed.closing,
      netCalc,
      integrityOk,
      total,
      willInsert: account ? newRows.length : 0,
      duplicatesInDb,
      duplicatesInFile,
      errors: errorRows.length,
      errorRows: errorRows.slice(0, 100),
      skippedRows,
      duration,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async commitHamkorVipiska(
    previewId: string,
    importedBy?: string,
  ): Promise<{ total: number; added: number; skipped: number; errors: number; errorRows: Array<{ row: number; reason: string }>; batchId?: string; duration: number }> {
    this.sweepHamkorPreviews();
    const state = this.hamkorPreviewCache.get(previewId);
    if (!state) throw new BadRequestException("Preview topilmadi yoki muddati o'tgan (30 daqiqa) — faylni qayta yuklang");
    if (!state.accountId) throw new BadRequestException("Bu hisob bazada topilmagan — avval hisobni qo'shing, keyin qayta import qiling");
    this.hamkorPreviewCache.delete(previewId);

    // Balans mos kelmagan bo'lsa (parser qator o'tkazib yuborgan bo'lishi mumkin) — audit uchun
    // yozib qo'yamiz. Foydalanuvchi frontend'da ataylab tasdiqlagan (ogohlantirish ko'rsatilgan).
    if (state.integrityOk === false) {
      this.log.warn(`Hamkor vipiska commit ${previewId.slice(0, 8)}: BALANS MOS EMAS — foydalanuvchi ataylab tasdiqladi (acc ${state.accountNo})`);
    }

    const started = Date.now();
    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'hamkor-vipiska',
        fileName: state.fileName,
        fileSize: state.fileSize,
        importedBy: (importedBy || state.importedBy)?.slice(0, 190) || null,
      },
    });

    const result = {
      total: state.total,
      added: 0,
      skipped: state.duplicatesInDb + state.duplicatesInFile,
      errors: state.errors,
      errorRows: [] as Array<{ row: number; reason: string }>,
    };

    // ── RACE HIMOYASI ──
    // Preview'dan keyin (30 daqiqa ichida) byacc sync shu yozuvlarni qo'shgan bo'lishi
    // mumkin. Yozishdan OLDIN mavjud kalitlarni qayta o'qib, ustma-ust tushganini chiqaramiz.
    const existKeys = new Set<string>();
    const existing = await this.prisma.transaction.findMany({
      where: { accountId: state.accountId, externalId: { startsWith: 'HB_' } },
      select: { externalId: true, description: true, hbDedupKey: true },
    });
    for (const e of existing) {
      const k = hamkorDedupKeyFromExisting(e);
      if (k) existKeys.add(k);
    }
    const rowsToInsert = state.rows.filter((r) => !existKeys.has(r.hbDedupKey));
    result.skipped += state.rows.length - rowsToInsert.length;

    const importedAt = new Date();
    const BATCH_SIZE = 500;
    const actor = (importedBy || state.importedBy)?.slice(0, 190) || null;
    const data = rowsToInsert.map((r) => ({
      externalId: r.externalId,
      type: 'OTHER' as TxnType,
      status: 'COMPLETED' as TxnStatus,
      direction: r.direction,
      amount: new Prisma.Decimal(r.amountSom),
      currency: 'UZS',
      fromAccount: r.fromAccount,
      toAccount: r.toAccount,
      fromName: r.fromName,
      toName: r.toName,
      description: r.description || null,
      docNumber: r.docNumber || null,
      hbDedupKey: r.hbDedupKey,
      source: 'HAMKOR_IMPORT' as TxnSource,
      importBankNameText: 'Hamkorbank',
      importedBy: actor,
      importedAt,
      importBatchId: batch.id,
      bankId: state.bankId,
      accountId: state.accountId,
      txnDate: r.txnDate,
      valueDate: r.valueDate,
    }));

    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const chunk = data.slice(i, i + BATCH_SIZE);
      try {
        const rr = await this.prisma.transaction.createMany({ data: chunk, skipDuplicates: true });
        result.added += rr.count;
      } catch (e: any) {
        this.log.warn(`Hamkor commit createMany xato (${i}-${i + chunk.length}): ${e?.message?.slice(0, 200)}`);
        for (const row of chunk) {
          try {
            await this.prisma.transaction.create({ data: row });
            result.added++;
          } catch (e2: any) {
            result.errors++;
            result.errorRows.push({ row: 0, reason: e2?.message?.slice(0, 200) || "Noma'lum xato" });
          }
        }
      }
    }

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { rowsTotal: result.total, rowsAdded: result.added, rowsSkipped: result.skipped, rowsErrors: result.errors },
    });

    const duration = Math.round((Date.now() - started) / 1000);
    this.log.log(`Hamkor vipiska commit ${previewId.slice(0, 8)}: +${result.added}, skip ${result.skipped}, xato ${result.errors}, acc ${state.accountNo}`);
    return { ...result, batchId: batch.id, duration };
  }

  cancelHamkorVipiska(previewId: string): { ok: boolean; canceled: boolean } {
    const had = this.hamkorPreviewCache.has(previewId);
    this.hamkorPreviewCache.delete(previewId);
    return { ok: true, canceled: had };
  }

  // ═══ BATCH MANAGEMENT ═══════════════════════════════════════════════

  /** Barcha import batch'lar (yangi avval) — frontend tarix uchun */
  async listBatches(kind?: string) {
    const batches = await this.prisma.importBatch.findMany({
      where: kind ? { kind } : undefined,
      orderBy: { importedAt: 'desc' },
      take: 200,
    });
    return { ok: true, items: batches };
  }

  /**
   * Batchni o'chirish — undagi tranzaksiyalarni ham (CASCADE).
   * Faqat source=IMPORT bo'lganlar o'chiriladi (sync data tegmaydi).
   *
   * 60k+ qator bo'lsa, IN clause juda katta bo'lib PostgreSQL choke qiladi va
   * 500 xato beradi. Shuning uchun chunk'larda o'chiramiz (har biri 500 ID).
   */
  async deleteBatch(batchId: string) {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BadRequestException('Batch topilmadi');

    // ─── ОплатыКв batch ──────────────────────────────────────
    if (batch.kind === 'oplata-kv') {
      const CHUNK = 500;
      let totalDeleted = 0;
      while (true) {
        const rows = await this.prisma.oplataKv.findMany({
          where: { importBatchId: batchId },
          select: { id: true, sourceTxId: true, contractNo: true, client: true, object: true, paymentAmount: true, date: true, purpose: true, txType: true },
          take: CHUNK,
        });
        if (rows.length === 0) break;
        const ids = rows.map((r) => r.id);

        // Audit history — TO'LIQ snapshot (mijoz API'dan o'chirilgan to'lovni aniqlab olsin)
        const historyData: any[] = rows.map((row) => ({
          oplataKvId: row.id,
          action: 'deleted',
          actorType: 'system',
          actorId: null,
          actorName: `import-batch-delete (${batchId.slice(0, 8)})`,
          fieldsChanged: ['*'],
          changes: { snapshot: {
            id: row.id, sourceTxId: row.sourceTxId, contractNo: row.contractNo, client: row.client, object: row.object,
            paymentAmount: row.paymentAmount?.toString() ?? null, date: row.date ? row.date.toISOString().slice(0, 10) : null,
            purpose: row.purpose, txType: row.txType,
          }, reason: 'Import batch o\'chirildi' },
          note: `Import batch ${batchId.slice(0, 8)} bilan birga o'chirildi`,
        }));
        await this.prisma.oplataKvHistory.createMany({ data: historyData });

        const r = await this.prisma.oplataKv.deleteMany({ where: { id: { in: ids } } });
        totalDeleted += r.count;
      }
      await this.prisma.importBatch.delete({ where: { id: batchId } });
      this.log.log(`ОплатыКв batch ${batchId} o'chirildi: jami ${totalDeleted}`);
      return { ok: true, deleted: totalDeleted };
    }

    // ─── Transactions batch (default) ─────────────────────────
    // kind='transactions'   → source='IMPORT'
    // kind='aloqa-bank'     → source='ALOQA_BANK'
    // kind='hamkor-vipiska' → source='HAMKOR_IMPORT'
    const batchSource: TxnSource =
      batch.kind === 'aloqa-bank' ? 'ALOQA_BANK'
        : batch.kind === 'hamkor-vipiska' ? 'HAMKOR_IMPORT'
        : 'IMPORT';
    const CHUNK = 500;
    let totalDeleted = 0;

    let totalOplataDeleted = 0;
    while (true) {
      const txns = await this.prisma.transaction.findMany({
        where: { importBatchId: batchId, source: batchSource },
        select: { id: true, externalId: true },
        take: CHUNK,
      });
      if (txns.length === 0) break;
      const ids = txns.map((t) => t.id);

      // Shu tranzaksiyalardan ОплатыКв'ga o'tган to'lovlarni ham o'chiramiz.
      // OplataKv.sourceTxId = Transaction.externalId (bank kompozit) YOKI id (cuid).
      const sourceKeys = Array.from(new Set([
        ...ids,
        ...txns.map((t) => t.externalId).filter((x): x is string => !!x),
      ]));
      const opRows = await this.prisma.oplataKv.findMany({
        where: { sourceTxId: { in: sourceKeys } },
        select: { id: true, sourceTxId: true, contractNo: true, client: true, object: true, paymentAmount: true, date: true, purpose: true, txType: true },
      });
      if (opRows.length > 0) {
        const opIds = opRows.map((r) => r.id);
        await this.prisma.oplataKvHistory.createMany({
          data: opRows.map((row) => ({
            oplataKvId: row.id,
            action: 'deleted',
            actorType: 'system',
            actorId: null,
            actorName: `import-batch-delete (${batchId.slice(0, 8)})`,
            fieldsChanged: ['*'],
            changes: { snapshot: {
              id: row.id, sourceTxId: row.sourceTxId, contractNo: row.contractNo, client: row.client, object: row.object,
              paymentAmount: row.paymentAmount?.toString() ?? null, date: row.date ? row.date.toISOString().slice(0, 10) : null,
              purpose: row.purpose, txType: row.txType,
            }, reason: "Import batch (tranzaksiya) o'chirildi — bog'liq ОплатыКв qatori" },
            note: `Import batch ${batchId.slice(0, 8)} tranzaksiyasidan o'tган to'lov o'chirildi`,
          })),
        });
        const opr = await this.prisma.oplataKv.deleteMany({ where: { id: { in: opIds } } });
        totalOplataDeleted += opr.count;
      }

      await this.prisma.transactionCategoryHistory.deleteMany({
        where: { txId: { in: ids } },
      });
      await this.prisma.payment.deleteMany({
        where: { transactionId: { in: ids } },
      });
      const r = await this.prisma.transaction.deleteMany({
        where: { id: { in: ids } },
      });
      totalDeleted += r.count;
      this.log.log(`Batch ${batchId}: ${totalDeleted} tx, ${totalOplataDeleted} ОплатыКв o'chirildi (chunk ${ids.length})`);
    }

    await this.prisma.importBatch.delete({ where: { id: batchId } });
    this.log.log(`Batch ${batchId} o'chirildi: ${totalDeleted} tranzaksiya, ${totalOplataDeleted} ОплатыКв`);
    return { ok: true, deleted: totalDeleted, oplataKvDeleted: totalOplataDeleted };
  }

  /**
   * Batchdagi tranzaksiyalarni Excel'ga eksport qilish.
   * Format: import'ga teskari (rus sarlavhalar bilan, foydalanuvchi qayta import qila olishi uchun)
   */
  async exportBatch(batchId: string): Promise<{ buffer: Buffer; filename: string }> {
    const batch = await this.prisma.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new BadRequestException('Batch topilmadi');

    // kind ga qarab to'g'ri source bilan filtrlash (aloqa-bank / hamkor-vipiska alohida source)
    const batchSource: TxnSource =
      batch.kind === 'aloqa-bank' ? 'ALOQA_BANK'
        : batch.kind === 'hamkor-vipiska' ? 'HAMKOR_IMPORT'
        : 'IMPORT';
    const txns = await this.prisma.transaction.findMany({
      where: { importBatchId: batchId, source: batchSource },
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
