import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { Prisma, OplataKvCategory } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CreateOplataKvDto, UpdateOplataKvDto, ListOplataKvDto,
} from './dto/oplata-kv.dto';

type Actor = { id?: string | null; name?: string | null };

export interface ImportResult {
  total: number;
  added: number;
  skipped: number;
  errors: number;
  errorRows: Array<{ row: number; reason: string }>;
  batchId?: string;
}

@Injectable()
export class OplataKvService {
  private readonly log = new Logger(OplataKvService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ───────────────── LIST ─────────────────
  async list(q: ListOplataKvDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const perPage = Math.min(200, Math.max(1, Number(q.perPage) || 50));

    const where: Prisma.OplataKvWhereInput = {};

    if (q.q && q.q.trim()) {
      const s = q.q.trim();
      where.OR = [
        { contractNo: { contains: s, mode: 'insensitive' } },
        { client:     { contains: s, mode: 'insensitive' } },
        { object:     { contains: s, mode: 'insensitive' } },
        { purpose:    { contains: s, mode: 'insensitive' } },
        { note:       { contains: s, mode: 'insensitive' } },
        { paymentMethod: { contains: s, mode: 'insensitive' } },
        { txType:     { contains: s, mode: 'insensitive' } },
      ];
    }
    if (q.dateFrom) where.date = { ...(where.date as object), gte: new Date(q.dateFrom) };
    if (q.dateTo)   where.date = { ...(where.date as object), lte: new Date(q.dateTo) };
    if (q.contractNo) where.contractNo = { contains: q.contractNo, mode: 'insensitive' };
    if (q.paymentCategory) where.paymentCategory = q.paymentCategory as OplataKvCategory;
    if (q.client) where.client = { contains: q.client, mode: 'insensitive' };
    if (q.object) where.object = { contains: q.object, mode: 'insensitive' };

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
    const data: Prisma.OplataKvCreateInput = {
      contractNo: dto.contractNo,
      date: new Date(dto.date),
      paymentAmount:    dto.paymentAmount    != null ? new Prisma.Decimal(dto.paymentAmount)    : null,
      firstInstallment: dto.firstInstallment != null ? new Prisma.Decimal(dto.firstInstallment) : null,
      monthlyAmount:    dto.monthlyAmount    != null ? new Prisma.Decimal(dto.monthlyAmount)    : null,
      purpose:        dto.purpose         ?? null,
      txType:         dto.txType          ?? null,
      note:           dto.note            ?? null,
      paymentCategory: (dto.paymentCategory ?? null) as OplataKvCategory | null,
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

    const data: Prisma.OplataKvUpdateInput = {};
    if (dto.contractNo       !== undefined) data.contractNo       = dto.contractNo!;
    if (dto.date             !== undefined) data.date             = new Date(dto.date!);
    if (dto.paymentAmount    !== undefined) data.paymentAmount    = dto.paymentAmount    === null ? null : new Prisma.Decimal(dto.paymentAmount!);
    if (dto.firstInstallment !== undefined) data.firstInstallment = dto.firstInstallment === null ? null : new Prisma.Decimal(dto.firstInstallment!);
    if (dto.monthlyAmount    !== undefined) data.monthlyAmount    = dto.monthlyAmount    === null ? null : new Prisma.Decimal(dto.monthlyAmount!);
    if (dto.purpose          !== undefined) data.purpose          = dto.purpose;
    if (dto.txType           !== undefined) data.txType           = dto.txType;
    if (dto.note             !== undefined) data.note             = dto.note;
    if (dto.paymentCategory  !== undefined) data.paymentCategory  = (dto.paymentCategory ?? null) as OplataKvCategory | null;
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

    const result: ImportResult = {
      total: 0, added: 0, skipped: 0, errors: 0,
      errorRows: [],
      batchId: batch.id,
    };

    // Birinchi qator — sarlavha, o'tkazib yuboramiz
    const rowCount = ws.actualRowCount || ws.rowCount;
    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      // Bo'sh qatorni o'tkazib yuborish
      const hasAny = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].some((c) => this.cellText(row.getCell(c)) !== '');
      if (!hasAny) continue;

      result.total++;
      try {
        const contractNo = this.cellText(row.getCell(1));
        const dateRaw   = row.getCell(2).value;
        const idValue   = this.cellText(row.getCell(13));

        if (!contractNo) throw new Error('Дог № bo\'sh');
        if (!idValue)    throw new Error('ID ustuni bo\'sh — majburiy');

        const date = this.parseDate(dateRaw);
        if (!date) throw new Error('Дата formati noto\'g\'ri (kerakli: dd.mm.yyyy)');

        // Dublikat tekshirish — ID bo'yicha
        const existing = await this.prisma.oplataKv.findUnique({ where: { id: idValue } });
        if (existing) {
          result.skipped++;
          continue;
        }

        const paymentAmount    = this.parseAmountOrNull(row.getCell(3).value);
        const firstInstallment = this.parseAmountOrNull(row.getCell(4).value);
        const monthlyAmount    = this.parseAmountOrNull(row.getCell(5).value);

        const purpose       = this.cellText(row.getCell(6)) || null;
        const txType        = this.cellText(row.getCell(7)).slice(0, 60) || null;
        const note          = this.cellText(row.getCell(8)) || null;
        const paymentCategory = this.parseCategory(this.cellText(row.getCell(9)));
        const object        = this.cellText(row.getCell(10)).slice(0, 255) || null;
        const client        = this.cellText(row.getCell(11)).slice(0, 255) || null;
        const paymentMethod = this.cellText(row.getCell(12)).slice(0, 120) || null;

        await this.prisma.oplataKv.create({
          data: {
            id: idValue, // Excel'dan kelgan uniq ID
            contractNo: contractNo.slice(0, 50),
            date,
            paymentAmount:    paymentAmount    !== null ? new Prisma.Decimal(paymentAmount)    : null,
            firstInstallment: firstInstallment !== null ? new Prisma.Decimal(firstInstallment) : null,
            monthlyAmount:    monthlyAmount    !== null ? new Prisma.Decimal(monthlyAmount)    : null,
            purpose, txType, note, paymentCategory, object, client, paymentMethod,
            createdById:   actor.id   ?? null,
            createdByName: actor.name ?? null,
            importBatchId: batch.id,
          },
        });

        // History yozuvi
        await this.prisma.oplataKvHistory.create({
          data: {
            oplataKvId: idValue,
            action: 'imported',
            actorType: actor.id ? 'user' : 'system',
            actorId: actor.id ?? null,
            actorName: actor.name ?? null,
            fieldsChanged: ['*'],
            changes: { batchId: batch.id, fileName } as any,
            note: `Excel'dan import qilindi (batch ${batch.id.slice(0, 8)})`,
          },
        });

        result.added++;
      } catch (e: any) {
        result.errors++;
        result.errorRows.push({ row: r, reason: e?.message || 'Noma\'lum xato' });
      }
    }

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
      const historyData = ids.map((id) => ({
        oplataKvId: id,
        action: 'deleted',
        actorType: 'system' as const,
        actorId: null,
        actorName: `import-batch-delete (${batchId.slice(0, 8)})`,
        fieldsChanged: ['*'],
        changes: { reason: 'Import batch o\'chirildi' } as any,
        note: `Import batch ${batchId.slice(0, 8)} bilan birga o'chirildi`,
      }));
      await this.prisma.oplataKvHistory.createMany({ data: historyData });

      const r = await this.prisma.oplataKv.deleteMany({ where: { id: { in: ids } } });
      totalDeleted += r.count;
    }

    await this.prisma.importBatch.delete({ where: { id: batchId } });
    return { ok: true, deleted: totalDeleted };
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
