import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, OplataKvCategory } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  CreateOplataKvDto, UpdateOplataKvDto, ListOplataKvDto, OplataKvCategoryEnum,
} from './dto/oplata-kv.dto';

type Actor = { id?: string | null; name?: string | null };

@Injectable()
export class OplataKvService {
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
        changes: this.serializeForHistory(data),
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
}
