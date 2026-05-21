import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
  errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }>;
  skippedRows: Array<{ row: number; id: string; contractNo: string; reason: string }>;
  batchId?: string;
  duration: number; // sekund
}

export interface ImportPreview {
  previewId: string;
  fileName: string | null;
  total: number;
  willInsert: number;     // bazaga qo'shiladigan yangi qatorlar
  duplicatesInDb: number; // DB'da allaqachon ID bo'lganlar
  duplicatesInFile: number; // Fayl ichida takror ID
  errors: number;
  errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }>;
  skippedRows: Array<{ row: number; id: string; contractNo: string; reason: string }>;
  duration: number; // parse vaqti (sekund)
  expiresAt: string; // ISO sana — qachongacha cache'da turadi
}

// Cache'dagi preview ma'lumotlari
interface PreviewState {
  fileName: string | null;
  fileSize: number;
  toInsert: any[];        // bazaga qo'shilishi kerak bo'lgan qatorlar (Prisma data)
  preview: ImportPreview;
  expiresAt: number;       // ms timestamp
  actor: Actor;
}

@Injectable()
export class OplataKvService {
  private readonly log = new Logger(OplataKvService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ─── Preview cache (in-memory) ───────────────────────────
  // Foydalanuvchi katta Excel yuklasa → avval tekshiramiz va cache'da turamiz.
  // Foydalanuvchi tasdiqlasa → cache'dan o'qib bazaga qo'shamiz.
  // TTL 30 daqiqa, tasdiqlangach yoki TTL tugagach evict qilamiz.
  private previewCache = new Map<string, PreviewState>();
  private readonly PREVIEW_TTL_MS = 30 * 60 * 1000; // 30 daqiqa

  private cleanExpiredPreviews() {
    const now = Date.now();
    for (const [k, v] of this.previewCache) {
      if (v.expiresAt < now) this.previewCache.delete(k);
    }
  }

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
    const data: any = {
      contractNo: dto.contractNo,
      date: new Date(dto.date),
      paymentAmount:    dto.paymentAmount    != null ? new Prisma.Decimal(dto.paymentAmount)    : null,
      firstInstallment: dto.firstInstallment != null ? new Prisma.Decimal(dto.firstInstallment) : null,
      monthlyAmount:    dto.monthlyAmount    != null ? new Prisma.Decimal(dto.monthlyAmount)    : null,
      purpose:        dto.purpose         ?? null,
      txType:         dto.txType          ?? null,
      note:           dto.note            ?? null,
      paymentCategory: dto.paymentCategory ?? null,
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

    const data: any = {};
    if (dto.contractNo       !== undefined) data.contractNo       = dto.contractNo;
    if (dto.date             !== undefined) data.date             = new Date(dto.date as string);
    if (dto.paymentAmount    !== undefined) data.paymentAmount    = dto.paymentAmount    === null ? null : new Prisma.Decimal(dto.paymentAmount as number);
    if (dto.firstInstallment !== undefined) data.firstInstallment = dto.firstInstallment === null ? null : new Prisma.Decimal(dto.firstInstallment as number);
    if (dto.monthlyAmount    !== undefined) data.monthlyAmount    = dto.monthlyAmount    === null ? null : new Prisma.Decimal(dto.monthlyAmount as number);
    if (dto.purpose          !== undefined) data.purpose          = dto.purpose;
    if (dto.txType           !== undefined) data.txType           = dto.txType;
    if (dto.note             !== undefined) data.note             = dto.note;
    if (dto.paymentCategory  !== undefined) data.paymentCategory  = dto.paymentCategory ?? null;
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
  /**
   * Preview — fayldagi qatorlarni o'qiydi va tekshiradi, lekin BAZAGA QO'SHMAYDI.
   * Cache'ga saqlaydi va previewId qaytaradi. Foydalanuvchi tasdiqlagach commitImport
   * chaqirilib bazaga qo'shiladi.
   *
   * Bu yondashuvning sabablari:
   *   - 230k qatorlik kabi katta fayllarda xato bo'lsa hech narsa qo'shilmaydi
   *   - Foydalanuvchi xatolarni ko'rib qaror qabul qiladi
   *   - Tasodifiy/no'noqlik bilan import qilingan ma'lumot keyin tozalashga to'g'ri kelmaydi
   */
  async previewImport(
    buffer: Buffer,
    actor: Actor,
    fileName?: string,
  ): Promise<ImportPreview> {
    this.cleanExpiredPreviews();

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException("Excel bo'sh");

    const startTs = Date.now();
    const preview: ImportPreview = {
      previewId: '',
      fileName: fileName?.slice(0, 255) || null,
      total: 0,
      willInsert: 0,
      duplicatesInDb: 0,
      duplicatesInFile: 0,
      errors: 0,
      errorRows: [],
      skippedRows: [],
      duration: 0,
      expiresAt: '',
    };

    const { validRows, allCandidateIds } = await this.parseExcelRows(ws, preview);

    // DB'dagi mavjud ID'larni topish
    const existingIdSet = new Set<string>();
    if (allCandidateIds.length > 0) {
      const CHUNK = 5000;
      for (let i = 0; i < allCandidateIds.length; i += CHUNK) {
        const chunk = allCandidateIds.slice(i, i + CHUNK);
        const found = await this.prisma.oplataKv.findMany({
          where: { id: { in: chunk } },
          select: { id: true },
        });
        for (const f of found) existingIdSet.add(f.id);
      }
    }
    preview.duplicatesInDb = existingIdSet.size;

    // Fayl ichidagi takror ID'lar va yakuniy insert ro'yxati
    const seenInFile = new Set<string>();
    const toInsert: any[] = [];
    for (const v of validRows) {
      const id: string = v.data.id;
      if (existingIdSet.has(id)) {
        if (preview.skippedRows.length < 100) {
          preview.skippedRows.push({
            row: v.row, id, contractNo: v.data.contractNo,
            reason: "ID DB'da allaqachon bor",
          });
        }
        continue;
      }
      if (seenInFile.has(id)) {
        preview.duplicatesInFile++;
        if (preview.skippedRows.length < 100) {
          preview.skippedRows.push({
            row: v.row, id, contractNo: v.data.contractNo,
            reason: 'Fayl ichida takror ID',
          });
        }
        continue;
      }
      seenInFile.add(id);
      toInsert.push(v.data);
    }
    preview.willInsert = toInsert.length;
    preview.duration = Math.round((Date.now() - startTs) / 1000);

    // Cache'ga saqlaymiz — foydalanuvchi tasdiqlasa shu yerdan o'qiymiz
    const previewId = randomUUID();
    const expiresAt = Date.now() + this.PREVIEW_TTL_MS;
    preview.previewId = previewId;
    preview.expiresAt = new Date(expiresAt).toISOString();

    this.previewCache.set(previewId, {
      fileName: preview.fileName,
      fileSize: buffer.length,
      toInsert,
      preview,
      expiresAt,
      actor,
    });

    this.log.log(
      `ОплатыКв preview ${previewId.slice(0, 8)}: ${preview.total} jami, ${preview.willInsert} qo'shiladigan, ${preview.duplicatesInDb} DB-dub, ${preview.duplicatesInFile} fayl-dub, ${preview.errors} xato — ${preview.duration}s`,
    );

    return preview;
  }

  /**
   * Commit — previewImport'dagi cache'dan o'qib bazaga BULK qo'shadi.
   * Cache'dan o'chiriladi (yana ishlatib bo'lmaydi).
   */
  async commitImport(previewId: string, actor: Actor): Promise<ImportResult> {
    this.cleanExpiredPreviews();
    const state = this.previewCache.get(previewId);
    if (!state) {
      throw new BadRequestException('Preview topilmadi yoki muddati o\'tgan — qaytadan yuklang');
    }
    // Cache'ni darrov olib tashlaymiz (qayta commit'dan saqlash uchun)
    this.previewCache.delete(previewId);

    const startTs = Date.now();
    const batch = await this.prisma.importBatch.create({
      data: {
        kind: 'oplata-kv',
        fileName: state.fileName,
        fileSize: state.fileSize,
        importedBy: actor.name?.slice(0, 190) || state.actor.name?.slice(0, 190) || null,
      },
    });

    const result: ImportResult = {
      total: state.preview.total,
      added: 0,
      skipped: state.preview.duplicatesInDb + state.preview.duplicatesInFile,
      errors: state.preview.errors,
      errorRows: state.preview.errorRows,
      skippedRows: state.preview.skippedRows,
      batchId: batch.id,
      duration: 0,
    };

    // toInsert'ga importBatchId qo'shamiz
    const toInsert = state.toInsert.map((d) => ({ ...d, importBatchId: batch.id }));

    const INSERT_CHUNK = 1000;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK);
      try {
        const r = await this.prisma.oplataKv.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        result.added += r.count;
      } catch (e: any) {
        this.log.error(`Bulk insert xato (chunk ${i}): ${e?.message}`);
        for (const item of chunk) {
          result.errors++;
          if (result.errorRows.length < 200) {
            result.errorRows.push({
              row: -1, reason: `Bulk insert xato: ${e?.message || 'noma\'lum'}`,
              id: item.id, contractNo: item.contractNo,
            });
          }
        }
      }
      if (i % (INSERT_CHUNK * 5) === 0) {
        this.log.log(`ОплатыКв commit: ${i + chunk.length} / ${toInsert.length} qoshildi`);
      }
    }

    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: `BATCH-${batch.id}`,
        action: 'imported',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: ['*'],
        changes: { batchId: batch.id, fileName: state.fileName, count: result.added } as any,
        note: `Excel'dan ${result.added} ta qator import qilindi (batch ${batch.id.slice(0, 8)}, previewId ${previewId.slice(0, 8)})`,
      },
    });

    result.duration = Math.round((Date.now() - startTs) / 1000);

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        rowsTotal:   result.total,
        rowsAdded:   result.added,
        rowsSkipped: result.skipped,
        rowsErrors:  result.errors,
      },
    });

    this.log.log(`ОплатыКв commit ${previewId.slice(0, 8)}: ${result.added} qoshildi, ${result.duration}s`);
    return result;
  }

  /** Cache'dan preview'ni olib tashlash (bekor qilish) */
  cancelPreview(previewId: string): { ok: boolean; canceled: boolean } {
    const had = this.previewCache.has(previewId);
    this.previewCache.delete(previewId);
    return { ok: true, canceled: had };
  }

  /**
   * Asl bir bosqichli import — preview + commit'ni birga bajaradi.
   * Eski client'lar uchun saqlanadi (backwards compat).
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

    const startTs = Date.now();
    const result: ImportResult = {
      total: 0, added: 0, skipped: 0, errors: 0,
      errorRows: [],
      skippedRows: [],
      batchId: batch.id,
      duration: 0,
    };

    // ─── 1-bosqich: barcha qatorlarni Excel'dan o'qib, valid yozuvlarni to'plash ───
    const { validRows, allCandidateIds } = await this.parseExcelRows(ws, result);
    // importBatchId va createdBy ma'lumotlarini har bir qatorga qo'shamiz
    for (const v of validRows) {
      v.data.createdById    = actor.id   ?? null;
      v.data.createdByName  = actor.name ?? null;
      v.data.importBatchId  = batch.id;
    }
    this.log.log(`ОплатыКв import: ${result.total} qator, ${validRows.length} valid, ${result.errors} xato`);

    // ─── 2-bosqich: barcha ID'larni bitta zaprosda tekshirish ───
    const existingIdSet = new Set<string>();
    if (allCandidateIds.length > 0) {
      const CHUNK = 5000;
      for (let i = 0; i < allCandidateIds.length; i += CHUNK) {
        const chunk = allCandidateIds.slice(i, i + CHUNK);
        const found = await this.prisma.oplataKv.findMany({
          where: { id: { in: chunk } },
          select: { id: true },
        });
        for (const f of found) existingIdSet.add(f.id);
      }
    }
    this.log.log(`ОплатыКв import: ${existingIdSet.size} ta dublikat ID topildi`);

    // Dublikatlarni va fayl ichidagi takrorlarni ajratish
    const seenInFile = new Set<string>();
    const toInsert: any[] = [];
    for (const v of validRows) {
      const id: string = v.data.id;
      if (existingIdSet.has(id) || seenInFile.has(id)) {
        result.skipped++;
        if (result.skippedRows.length < 100) {
          result.skippedRows.push({
            row: v.row,
            id,
            contractNo: v.data.contractNo,
            reason: existingIdSet.has(id) ? 'ID DB\'da allaqachon bor' : 'Fayl ichida takror ID',
          });
        }
        continue;
      }
      seenInFile.add(id);
      toInsert.push(v.data);
    }

    // ─── 3-bosqich: BULK INSERT (chunk'larda) ───
    const INSERT_CHUNK = 1000;
    for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
      const chunk = toInsert.slice(i, i + INSERT_CHUNK);
      try {
        const r = await this.prisma.oplataKv.createMany({
          data: chunk,
          skipDuplicates: true,
        });
        result.added += r.count;
      } catch (e: any) {
        this.log.error(`Bulk insert xato (chunk ${i}): ${e?.message}`);
        // Chunk xato bersa, qatorlarni alohida xato qilamiz
        for (const item of chunk) {
          result.errors++;
          if (result.errorRows.length < 200) {
            result.errorRows.push({
              row: -1, reason: `Bulk insert xato: ${e?.message || 'noma\'lum'}`,
              id: item.id, contractNo: item.contractNo,
            });
          }
        }
      }
      if (i % (INSERT_CHUNK * 5) === 0) {
        this.log.log(`ОплатыКв import: ${i + chunk.length} / ${toInsert.length} qoshildi`);
      }
    }

    // ─── 4-bosqich: BULK HISTORY (bitta yozuv har 1000 qator uchun emas, batch summary uchun) ───
    // Har bir qator uchun alohida history yozuvi yaratish o'rniga, bitta batch summary yozamiz.
    // Bu 70k qator uchun 70k → 1 yozuv (juda tez).
    await this.prisma.oplataKvHistory.create({
      data: {
        oplataKvId: `BATCH-${batch.id}`, // batch-level marker
        action: 'imported',
        actorType: actor.id ? 'user' : 'system',
        actorId: actor.id ?? null,
        actorName: actor.name ?? null,
        fieldsChanged: ['*'],
        changes: { batchId: batch.id, fileName, count: result.added } as any,
        note: `Excel'dan ${result.added} ta qator import qilindi (batch ${batch.id.slice(0, 8)})`,
      },
    });

    result.duration = Math.round((Date.now() - startTs) / 1000);

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
      const historyData: any[] = ids.map((id) => ({
        oplataKvId: id,
        action: 'deleted',
        actorType: 'system',
        actorId: null,
        actorName: `import-batch-delete (${batchId.slice(0, 8)})`,
        fieldsChanged: ['*'],
        changes: { reason: 'Import batch o\'chirildi' },
        note: `Import batch ${batchId.slice(0, 8)} bilan birga o'chirildi`,
      }));
      await this.prisma.oplataKvHistory.createMany({ data: historyData });

      const r = await this.prisma.oplataKv.deleteMany({ where: { id: { in: ids } } });
      totalDeleted += r.count;
    }

    await this.prisma.importBatch.delete({ where: { id: batchId } });
    return { ok: true, deleted: totalDeleted };
  }

  /**
   * Excel sheet'dan qatorlarni o'qib valid yozuvlar va kandidat ID'larni qaytaradi.
   * Xato qatorlar accumulator.errors va errorRows ga yoziladi (preview yoki ImportResult).
   * previewImport va importExcel ikkalasi ishlatadi.
   */
  private async parseExcelRows(
    ws: ExcelJS.Worksheet,
    accumulator: { total: number; errors: number; errorRows: Array<{ row: number; reason: string; id?: string; contractNo?: string }> },
  ): Promise<{
    validRows: Array<{ row: number; data: any }>;
    allCandidateIds: string[];
  }> {
    const rowCount = ws.actualRowCount || ws.rowCount;
    const validRows: Array<{ row: number; data: any }> = [];
    const allCandidateIds: string[] = [];

    for (let r = 2; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const hasAny = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].some((c) => this.cellText(row.getCell(c)) !== '');
      if (!hasAny) continue;

      accumulator.total++;
      const contractNo = this.cellText(row.getCell(1));
      const idValue   = this.cellText(row.getCell(13));

      try {
        const dateRaw   = row.getCell(2).value;
        if (!contractNo) throw new Error('Дог № bo\'sh');
        if (!idValue)    throw new Error('ID ustuni bo\'sh — majburiy');

        const date = this.parseDate(dateRaw);
        if (!date) throw new Error('Дата formati noto\'g\'ri (kerakli: dd.mm.yyyy)');

        const paymentAmount    = this.parseAmountOrNull(row.getCell(3).value);
        const firstInstallment = this.parseAmountOrNull(row.getCell(4).value);
        const monthlyAmount    = this.parseAmountOrNull(row.getCell(5).value);

        validRows.push({
          row: r,
          data: {
            id: idValue,
            contractNo: contractNo.slice(0, 50),
            date,
            paymentAmount:    paymentAmount    !== null ? new Prisma.Decimal(paymentAmount)    : null,
            firstInstallment: firstInstallment !== null ? new Prisma.Decimal(firstInstallment) : null,
            monthlyAmount:    monthlyAmount    !== null ? new Prisma.Decimal(monthlyAmount)    : null,
            purpose:        this.cellText(row.getCell(6)) || null,
            txType:         this.cellText(row.getCell(7)).slice(0, 60) || null,
            note:           this.cellText(row.getCell(8)) || null,
            paymentCategory: this.parseCategory(this.cellText(row.getCell(9))),
            object:         this.cellText(row.getCell(10)).slice(0, 255) || null,
            client:         this.cellText(row.getCell(11)).slice(0, 255) || null,
            paymentMethod:  this.cellText(row.getCell(12)).slice(0, 120) || null,
          },
        });
        allCandidateIds.push(idValue);
      } catch (e: any) {
        accumulator.errors++;
        if (accumulator.errorRows.length < 200) {
          accumulator.errorRows.push({
            row: r,
            reason: e?.message || 'Noma\'lum xato',
            id: idValue || undefined,
            contractNo: contractNo || undefined,
          });
        }
      }
    }

    return { validRows, allCandidateIds };
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
