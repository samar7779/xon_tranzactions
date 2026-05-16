import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { DidoxService, DidoxCompany, DidoxBankInfo } from './didox.service';
import { ChamberService, ChamberCompany } from './chamber.service';

// vatregstatus raqamlardan matn — Soliq dokumentidan
const VAT_STATUS_MAP: Record<number, string> = {
  10: 'ҚҚС тўловчи',
  20: 'ҚҚС тўловчи+ (гувоҳнома фаол)',
  21: 'ҚҚС тўловчи+ (гувоҳнома нофаол)',
  22: 'ҚҚС тўловчи+ (гувоҳнома вақтинча нофаол)',
  30: 'Aйланмадан солиқ тўловчи',
  50: 'Якка тартибдаги тадбиркор',
  60: 'Жисмоний шахс',
};

export type RatingTier = 'high' | 'mid' | 'ok' | 'low' | 'none';
export type StatusFilter = 'manual' | 'error' | 'never' | 'enriched';

export interface ListQuery {
  page?: number;
  perPage?: number;
  q?: string;
  vatStatus?: string;
  minRating?: number;
  maxRating?: number;
  /** Reyting kategoriyasi — Yuqori (≥86), O'rta (56-85), Qoniqarli (26-55), Quyi (≤25), Reyting yo'q (null) */
  ratingTier?: RatingTier;
  /** Holat: qo'lda kiritilgan / xato berganlar / hech yangilanmagan / muvaffaqiyatli boyitilgan */
  status?: StatusFilter;
  sortBy?: 'addedAt' | 'name' | 'rating' | 'lastFetchedAt';
  sortDir?: 'asc' | 'desc';
}

/** ListQuery'dan Prisma where shartini quradi (ham list, ham export ishlatadi) */
function buildWhere(q: ListQuery): any {
  const where: any = {};
  if (q.q) {
    where.OR = [
      { inn: { contains: q.q } },
      { name: { contains: q.q, mode: 'insensitive' } },
      { director: { contains: q.q, mode: 'insensitive' } },
      { phone: { contains: q.q } },
    ];
  }
  if (q.vatStatus) where.vatStatus = { contains: q.vatStatus };

  // Reyting kategoriyasi
  if (q.ratingTier) {
    if (q.ratingTier === 'none') where.rating = null;
    else if (q.ratingTier === 'high') where.rating = { gte: 86 };
    else if (q.ratingTier === 'mid')  where.rating = { gte: 56, lte: 85 };
    else if (q.ratingTier === 'ok')   where.rating = { gte: 26, lte: 55 };
    else if (q.ratingTier === 'low')  where.rating = { gte: 0,  lte: 25 };
  } else if (q.minRating != null || q.maxRating != null) {
    where.rating = {};
    if (q.minRating != null) where.rating.gte = Number(q.minRating);
    if (q.maxRating != null) where.rating.lte = Number(q.maxRating);
  }

  // Holat filtri
  if (q.status === 'manual')   where.isManual = true;
  if (q.status === 'error')    where.lastFetchError = { not: null };
  if (q.status === 'never')    where.lastFetchedAt = null;
  if (q.status === 'enriched') {
    where.isManual = false;
    where.lastFetchedAt = { not: null };
    where.lastFetchError = null;
  }

  return where;
}

@Injectable()
export class CounterpartiesService {
  private readonly log = new Logger(CounterpartiesService.name);

  constructor(
    private prisma: PrismaService,
    private didox: DidoxService,
    private chamber: ChamberService,
  ) {}

  // ────────────────────────── audit log ──────────────────────────

  /**
   * Audit yozuvi — har bir o'zgarish shu yerda saqlanadi.
   * Hech qachon xato chiqarmaydi (log yozish biznes-logika to'xtatmaydi).
   */
  private async logHistory(input: {
    inn: string;
    action: 'created' | 'manual_edit' | 'refreshed' | 'cron_refresh' | 'imported' | 'deleted';
    actorType: 'user' | 'cron' | 'system';
    actorId?: string | null;
    source?: string | null;
    fieldsChanged?: string[];
    changes?: Record<string, { old: any; new: any }> | null;
    note?: string;
  }): Promise<void> {
    try {
      let actorName: string | null = null;
      if (input.actorId) {
        const u = await this.prisma.adminUser.findUnique({
          where: { id: input.actorId },
          select: { email: true, fullName: true },
        });
        // Login nomi (email) ustun — fullName/role nomi emas
        actorName = u?.email || u?.fullName || null;
      } else if (input.actorType === 'cron') {
        actorName = 'Avto-yangilash (cron)';
      } else if (input.actorType === 'system') {
        actorName = 'Tizim';
      }
      await this.prisma.counterpartyHistory.create({
        data: {
          inn: input.inn,
          action: input.action,
          actorType: input.actorType,
          actorId: input.actorId || null,
          actorName,
          source: input.source || null,
          fieldsChanged: input.fieldsChanged || [],
          changes: input.changes || undefined,
          note: input.note || null,
        },
      });
    } catch (e: any) {
      this.log.warn(`History log xato (${input.inn} / ${input.action}): ${e?.message}`);
    }
  }

  /** Bitta kontragent tarixi — eng yangilari boshida */
  async getHistory(inn: string, limit = 50) {
    const items = await this.prisma.counterpartyHistory.findMany({
      where: { inn },
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, limit)),
    });
    return { ok: true, items };
  }

  // ────────────────────────── helpers ──────────────────────────

  private mapToRecord(
    company: DidoxCompany | null,
    chamber: ChamberCompany | null,
    bank: DidoxBankInfo | null,
    existingAccounts?: any[] | null,
  ): Record<string, any> {
    // Bank accounts'ni to'plash — eski + yangi (unique by account)
    let bankAccounts: Array<{ account: string; mfo: string | null; lastSeen: string }> = [];
    if (Array.isArray(existingAccounts)) bankAccounts = [...existingAccounts];
    if (bank?.account) {
      const idx = bankAccounts.findIndex((b) => b.account === bank.account);
      const entry = { account: bank.account, mfo: bank.bankid, lastSeen: new Date().toISOString() };
      if (idx >= 0) bankAccounts[idx] = entry;
      else bankAccounts.push(entry);
    }

    // Reg sana — DIDOX dd.mm.YYYY formatda berishi mumkin
    let regDate: Date | null = null;
    if (company?.registrationDate) {
      const s = company.registrationDate;
      const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (m) regDate = new Date(`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`);
      else { const d = new Date(s); if (!isNaN(d.getTime())) regDate = d; }
    }

    const vatText = company?.status_ru || (company as any)?.status || null;
    // Chamber'dan ham region/district ni manzil sifatida (DIDOX yo'q bo'lsa)
    const chamberAddress = chamber
      ? [chamber.regionName, chamber.districtName].filter(Boolean).join(', ')
      : null;

    return {
      fullName: company?.name || chamber?.nameLat || chamber?.nameRu || null,
      director: company?.directorFullName || null,
      directorPinfl: company?.directorPinfl || null,
      accountant: bank?.accountant || null,
      phone: company?.phone || null,
      email: company?.email || null,
      address: company?.billingAddress || (chamberAddress || null),
      vatNumber: company?.vatNumber ? String(company.vatNumber) : null,
      vatStatus: vatText,
      taxMode: company?.taxMode || null,
      opf: company?.opf || null,
      oked: company?.oked || chamber?.oked || null,
      companyType: company?.companyType || null,
      businessType: company?.businessType || null,
      registrationDate: regDate,
      registrationNumber: company?.registrationNumber || null,
      // Reyting — DIDOX'da bo'lsa undan, yo'q bo'lsa Chamber'dan
      rating: company?.sustainabilityRating?.points ?? chamber?.rating ?? null,
      ratingType: company?.sustainabilityRating?.type || chamber?.type || null,
      ratingTitle: company?.sustainabilityRating?.title || null,
      bankAccounts: bankAccounts.length ? bankAccounts : null,
      founders: company?.founders || null,
      rawDidoxBrief: company ? (company as any) : (chamber?.raw ? { chamber: chamber.raw } : null),
      lastFetchedAt: new Date(),
      lastFetchError: null,
    };
  }

  /**
   * Asosiy enrichment funksiyasi.
   * 1. DIDOX'ga urinib ko'radi (to'liq ma'lumot — direktor, telefon, manzil, VAT, reyting, OKED)
   * 2. DIDOX javob bermasa (env yo'q, login xato, yoki INN topilmadi) → Chamber'ga tushadi
   *    (faqat nom, reyting, region, OKED — public API, auth talab qilmaydi)
   * 3. Hech qaysi javob bermasa — null+xato.
   */
  async fetchEnrichment(inn: string): Promise<{
    company: DidoxCompany | null;
    chamber: ChamberCompany | null;
    bank: DidoxBankInfo | null;
    source: 'didox' | 'chamber' | 'didox+chamber' | 'none';
  }> {
    let company: DidoxCompany | null = null;
    let bank: DidoxBankInfo | null = null;
    let didoxError: Error | null = null;

    if (this.didox.isConfigured()) {
      try {
        company = await this.didox.getCompany(inn);
        if (company) {
          try { bank = await this.didox.findLatestBankInfo(inn); } catch { /* ignore */ }
        }
      } catch (e: any) {
        didoxError = e;
        this.log.warn(`DIDOX ${inn} xato: ${e?.message} — Chamber'ga o'taman`);
      }
    } else {
      this.log.debug(`DIDOX configured emas, faqat Chamber`);
    }

    // Chamber'ni har doim chaqiramiz — DIDOX javob bersa ham, reyting/region/oked
    // bir-birini to'ldirib turishi mumkin
    const chamber = await this.chamber.getCompany(inn);

    let source: 'didox' | 'chamber' | 'didox+chamber' | 'none';
    if (company && chamber) source = 'didox+chamber';
    else if (company) source = 'didox';
    else if (chamber) source = 'chamber';
    else source = 'none';

    if (source === 'none') {
      const reason = didoxError?.message || 'Hech bir manbada (DIDOX, Chamber) topilmadi';
      throw new NotFoundException(reason);
    }

    return { company, chamber, bank, source };
  }

  // ────────────────────────── CRUD ──────────────────────────

  async list(q: ListQuery) {
    const page = Math.max(1, Number(q.page || 1));
    const perPage = Math.min(200, Math.max(1, Number(q.perPage || 50)));
    const where = buildWhere(q);

    const sortBy = q.sortBy || 'addedAt';
    const sortDir = q.sortDir || 'desc';
    const [total, items, activeVat, ratingAgg] = await Promise.all([
      this.prisma.counterparty.count({ where }),
      this.prisma.counterparty.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      // Global stats — barcha kontragentlar bo'yicha (filtr emas)
      this.prisma.counterparty.count({
        where: {
          isActive: true,
          OR: [
            { vatStatus: { contains: 'Активн', mode: 'insensitive' } },
            { vatStatus: { contains: 'faol', mode: 'insensitive' } },
            { vatStatus: { contains: 'active', mode: 'insensitive' } },
          ],
        },
      }),
      this.prisma.counterparty.aggregate({
        where: { isActive: true, rating: { not: null } },
        _avg: { rating: true },
        _max: { lastFetchedAt: true },
        _count: { rating: true },
      }),
    ]);

    // addedBy uchun admin nomi
    const adminIds = Array.from(new Set(items.map((it) => it.addedBy).filter(Boolean)));
    const admins = adminIds.length
      ? await this.prisma.adminUser.findMany({
          where: { id: { in: adminIds as string[] } },
          select: { id: true, fullName: true, email: true },
        })
      : [];
    const adminMap = new Map(admins.map((a) => [a.id, a]));
    const itemsWithAdmin = items.map((it) => ({
      ...it,
      addedByUser: it.addedBy ? adminMap.get(it.addedBy) || null : null,
    }));

    // Global stats — sahifadan emas, butun DB'dan
    const grandTotal = await this.prisma.counterparty.count({ where: { isActive: true } });
    return {
      ok: true,
      total, page, perPage,
      items: itemsWithAdmin,
      didoxConfigured: this.didox.isConfigured(),
      stats: {
        total: grandTotal,
        activeVat,
        avgRating: ratingAgg._avg.rating != null ? Math.round(Number(ratingAgg._avg.rating)) : null,
        ratedCount: ratingAgg._count.rating,
        lastFetchedAt: ratingAgg._max.lastFetchedAt,
      },
    };
  }

  async getOne(inn: string) {
    const cp = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (!cp) throw new NotFoundException('Kontragent topilmadi');
    return { ok: true, counterparty: cp };
  }

  /**
   * Yangi kontragent qo'shish — INN + Name.
   * Qolgan barcha maydonlar DIDOX'dan olinadi.
   */
  async create(dto: { inn: string; name: string }, addedBy: string) {
    const inn = String(dto.inn || '').trim();
    const name = String(dto.name || '').trim();
    if (!inn) throw new BadRequestException('INN kerak');
    if (!name) throw new BadRequestException('Kontragent nomi kerak');
    if (inn.length > 20) {
      throw new BadRequestException("INN 20 belgidan oshmasligi kerak");
    }

    const existing = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (existing) throw new ConflictException(`INN ${inn} allaqachon mavjud`);

    // DIDOX (yoki Chamber fallback) bilan boyitish — faqat standart INN'lar uchun
    let data: Record<string, any> = {};
    let fetchError: string | null = null;
    if (/^\d{9}$|^\d{14}$/.test(inn)) {
      try {
        const { company, chamber, bank, source } = await this.fetchEnrichment(inn);
        data = this.mapToRecord(company, chamber, bank);
        this.log.log(`Create ${inn}: enrichment manbasi = ${source}`);
      } catch (e: any) {
        fetchError = humanizeEnrichmentError(e, inn);
        this.log.warn(`Create ${inn}: enrichment xatosi — saqlaymiz: ${fetchError}`);
      }
    } else {
      fetchError = "Nostandart INN (9 yoki 14 raqamli emas) — DIDOX/Chamber bu formatni qo'llab-quvvatlamaydi. Ma'lumotni qo'lda kiriting.";
    }

    const created = await this.prisma.counterparty.create({
      data: {
        inn,
        name, // foydalanuvchi kiritgani — refresh'da o'zgarmaydi
        addedBy,
        isManual: !isStandardInn(inn),
        ...data,
        lastFetchError: fetchError,
      },
    });
    await this.logHistory({
      inn, action: 'created', actorType: 'user', actorId: addedBy,
      source: fetchError ? 'none' : (data.rawDidoxBrief?.chamber ? 'chamber' : 'didox'),
      note: fetchError ? `Saqlandi, enrichment xatosi: ${fetchError.slice(0, 100)}` : `Kontragent qo'shildi`,
    });
    return { ok: true, counterparty: created, didoxFetched: !fetchError };
  }

  /**
   * Bitta kontragentni yangilash (DIDOX/Chamber'dan qaytadan olish).
   * Name tegilmaydi.
   */
  async refresh(inn: string, actorId?: string) {
    const existing = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (!existing) throw new NotFoundException('Kontragent topilmadi');

    // Nostandart INN — DIDOX/Chamber'ga so'rov yubormaymiz
    if (!isStandardInn(inn)) {
      const friendly = 'Nostandart INN — qo\'lda kiritilgan. Avto-yangilash mumkin emas, "Tahrirlash" tugmasidan foydalaning.';
      const updated = await this.prisma.counterparty.update({
        where: { inn },
        data: { lastFetchError: friendly, lastFetchedAt: new Date() },
      });
      return { ok: false, counterparty: updated, source: 'none' as const, error: friendly };
    }

    try {
      const { company, chamber, bank, source } = await this.fetchEnrichment(inn);
      const updated = await this.prisma.counterparty.update({
        where: { inn },
        data: this.mapToRecord(company, chamber, bank, existing.bankAccounts as any[] | null),
      });
      this.log.log(`Refresh ${inn}: enrichment manbasi = ${source}`);
      await this.logHistory({
        inn, action: 'refreshed', actorType: 'user', actorId, source,
        note: `Qo'lda yangilash (${source})`,
      });
      return { ok: true, counterparty: updated, source };
    } catch (e: any) {
      const friendly = humanizeEnrichmentError(e, inn);
      const updated = await this.prisma.counterparty.update({
        where: { inn },
        data: { lastFetchError: friendly, lastFetchedAt: new Date() },
      });
      await this.logHistory({
        inn, action: 'refreshed', actorType: 'user', actorId, source: 'none',
        note: `Qo'lda yangilash — xato: ${friendly.slice(0, 150)}`,
      });
      return { ok: false, counterparty: updated, source: 'none' as const, error: friendly };
    }
  }

  /**
   * Qo'lda tahrirlash — DIDOX/Chamber'da topilmaydigan kontragentlar uchun
   * (masalan PINFL'lar). Barcha maydonlarni tahrirlash mumkin.
   */
  async update(inn: string, dto: Partial<{
    name: string;
    fullName: string | null;
    director: string | null;
    accountant: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    vatNumber: string | null;
    vatStatus: string | null;
    oked: string | null;
    rating: number | null;
    bankAccounts: Array<{ account: string; mfo?: string | null }>;
    notes: string;
    isActive: boolean;
  }>, actorId?: string) {
    const existing = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (!existing) throw new NotFoundException('Kontragent topilmadi');
    const data: any = {};
    if (dto.name !== undefined) data.name = String(dto.name).trim();
    if (dto.fullName !== undefined) data.fullName = dto.fullName || null;
    if (dto.director !== undefined) data.director = dto.director || null;
    if (dto.accountant !== undefined) data.accountant = dto.accountant || null;
    if (dto.phone !== undefined) data.phone = dto.phone || null;
    if (dto.email !== undefined) data.email = dto.email || null;
    if (dto.address !== undefined) data.address = dto.address || null;
    if (dto.vatNumber !== undefined) data.vatNumber = dto.vatNumber || null;
    if (dto.vatStatus !== undefined) data.vatStatus = dto.vatStatus || null;
    if (dto.oked !== undefined) data.oked = dto.oked || null;
    if (dto.rating !== undefined) data.rating = dto.rating == null ? null : Number(dto.rating);
    if (dto.bankAccounts !== undefined) {
      const norm = Array.isArray(dto.bankAccounts)
        ? dto.bankAccounts
            .filter((b) => b?.account)
            .map((b) => ({ account: String(b.account).trim(), mfo: b.mfo ? String(b.mfo).trim() : null }))
        : null;
      data.bankAccounts = norm && norm.length ? norm : null;
    }
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isActive !== undefined) data.isActive = !!dto.isActive;

    // Diff hisoblaymiz — faqat haqiqatan o'zgargan maydonlar
    const changes: Record<string, { old: any; new: any }> = {};
    for (const k of Object.keys(data)) {
      const oldVal = (existing as any)[k];
      const newVal = data[k];
      // bankAccounts uchun JSON solishtirish
      const oldStr = oldVal == null ? '' : (typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal));
      const newStr = newVal == null ? '' : (typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal));
      if (oldStr !== newStr) {
        changes[k] = { old: oldVal, new: newVal };
      }
    }

    const updated = await this.prisma.counterparty.update({ where: { inn }, data });

    if (Object.keys(changes).length > 0) {
      await this.logHistory({
        inn, action: 'manual_edit', actorType: 'user', actorId, source: 'manual',
        fieldsChanged: Object.keys(changes),
        changes,
        note: `${Object.keys(changes).length} ta maydon yangilandi`,
      });
    }
    return { ok: true, counterparty: updated };
  }

  async remove(inn: string, actorId?: string) {
    const existing = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (!existing) throw new NotFoundException('Kontragent topilmadi');
    await this.prisma.counterparty.delete({ where: { inn } });
    await this.logHistory({
      inn, action: 'deleted', actorType: 'user', actorId,
      note: `Kontragent o'chirildi: ${existing.name}`,
    });
    return { ok: true, deleted: inn };
  }

  // ────────────────────────── Bulk / cron ──────────────────────────

  /**
   * Cron yangilashi — barcha kontragentlarni DIDOX'dan qayta olib yangilaydi.
   * Parallel emas, ketma-ket: DIDOX'ga ortiqcha bosim bo'lmasin.
   */
  /**
   * Hammasini yangilash — DARROV javob qaytaradi (background'da ishlaydi).
   * Foydalanuvchi 504 timeout kutmaydi: 100 ta kontragent = 5+ daqiqa ish.
   * Cron ham xuddi shu metodni chaqiradi.
   */
  refreshAll(actorId?: string): { ok: true; started: true; message: string } {
    this.runRefreshAllInBackground(actorId).catch((e) => {
      this.log.error(`refreshAll background xato: ${e?.message || e}`);
    });
    return {
      ok: true,
      started: true,
      message: 'Yangilash fonda boshlandi — birozdan keyin sahifani yangilang',
    };
  }

  private async runRefreshAllInBackground(actorId?: string): Promise<void> {
    // Faqat standart 9/14 raqamli INN'larga so'rov yuboramiz —
    // "kod0088", "null0004" kabi qo'lda kiritilgan kontragentlarga tegmaymiz.
    const all = await this.prisma.counterparty.findMany({
      where: { isActive: true },
      select: { inn: true, bankAccounts: true },
    });
    const standard = all.filter((cp) => isStandardInn(cp.inn));
    const skippedManual = all.length - standard.length;

    let updated = 0, failed = 0;
    const actorType: 'user' | 'cron' = actorId ? 'user' : 'cron';
    const noteAction: 'refreshed' | 'cron_refresh' = actorId ? 'refreshed' : 'cron_refresh';

    for (const cp of standard) {
      try {
        const { company, chamber, bank, source } = await this.fetchEnrichment(cp.inn);
        await this.prisma.counterparty.update({
          where: { inn: cp.inn },
          data: this.mapToRecord(company, chamber, bank, cp.bankAccounts as any[] | null),
        });
        await this.logHistory({
          inn: cp.inn, action: noteAction, actorType, actorId,
          source, note: actorId ? `Hammasini yangilash (${source})` : `Avto-yangilash (${source})`,
        });
        updated++;
      } catch (e: any) {
        failed++;
        const friendly = humanizeEnrichmentError(e, cp.inn);
        try {
          await this.prisma.counterparty.update({
            where: { inn: cp.inn },
            data: { lastFetchError: friendly, lastFetchedAt: new Date() },
          });
          await this.logHistory({
            inn: cp.inn, action: noteAction, actorType, actorId,
            source: 'none', note: `Yangilash xato: ${friendly.slice(0, 120)}`,
          });
        } catch { /* ignore */ }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    this.log.log(
      `refreshAll tugadi: ${updated} yangilandi, ${failed} xato, ${skippedManual} qo'lda (jami ${all.length})`,
    );
  }

  // ────────────────────────── Import / Export ──────────────────────────

  /**
   * Excel'dan bulk import — TEZ rejim:
   *   • Faqat INN + Name DB'ga yoziladi (DIDOX/Chamber chaqirilmaydi)
   *   • Dublikat INN'lar (skipDuplicates) o'tkazib yuboriladi
   *   • lastFetchError = "Avto-yangilanish kutilmoqda..." — keyingi cron yangilaydi
   *
   * 1000 ta INN ~1 soniyada saqlanadi. Soati kelganda (08-22 har soat)
   * background cron DIDOX'dan asta-sekin to'ldiradi.
   */
  async importExcel(buffer: Buffer, addedBy: string): Promise<{
    total: number; added: number; updated: number; skipped: number; failed: number;
    rows: Array<{ inn: string; name?: string; status: 'added' | 'updated' | 'skipped' | 'failed'; reason?: string }>;
  }> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new BadRequestException('Excel bo\'sh');

    const rowsToProcess: Array<{ inn: string; name: string }> = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const innCell = row.getCell(1).value;
      const nameCell = row.getCell(2).value;
      const inn = innCell == null ? '' : String(innCell).trim();
      const name = nameCell == null ? '' : String(nameCell).trim();
      if (!inn) return;
      rowsToProcess.push({ inn, name });
    });

    const result = {
      total: rowsToProcess.length, added: 0, updated: 0, skipped: 0, failed: 0,
      rows: [] as Array<{ inn: string; name?: string; status: 'added' | 'updated' | 'skipped' | 'failed'; reason?: string }>,
    };

    if (rowsToProcess.length === 0) return result;

    // 1) Validate — har qanday non-empty (max 20 belgi) qabul qilamiz.
    //    Legacy INN'lar (null0004, kod0088, 528369 va h.k.) ham saqlanadi —
    //    faqat avto-yangilanish 9/14 raqamli standart INN'lar uchun ishlaydi.
    const validRows: Array<{ inn: string; name: string; isStandard: boolean }> = [];
    for (const r of rowsToProcess) {
      if (r.inn.length > 20) {
        result.failed++;
        result.rows.push({ inn: r.inn, name: r.name, status: 'failed', reason: '20 belgidan oshib ketdi' });
        continue;
      }
      const isStandard = /^\d{9}$|^\d{14}$/.test(r.inn);
      validRows.push({ inn: r.inn, name: r.name || `INN ${r.inn}`, isStandard });
    }

    // 2) Mavjudlarini bitta SELECT bilan ko'rib chiqamiz (inn + name)
    const innsToCheck = validRows.map((r) => r.inn);
    const existingRows = await this.prisma.counterparty.findMany({
      where: { inn: { in: innsToCheck } },
      select: { inn: true, name: true },
    });
    const existingMap = new Map(existingRows.map((r) => [r.inn, r.name]));

    // 3) Excel'da bir xil INN bir necha marta uchrasa — eng oxirgi nomini olamiz
    //    (asl tartibida — keyingilari avvalgisini bekor qiladi)
    const uniqMap = new Map<string, { inn: string; name: string; isStandard: boolean }>();
    for (const r of validRows) {
      uniqMap.set(r.inn, r);
    }
    const uniqRows = [...uniqMap.values()];

    // 4) Yangi va mavjudlarni ajratamiz
    const toInsert: Array<{ inn: string; name: string; addedBy: string; isManual: boolean; lastFetchError: string }> = [];
    const toUpdate: Array<{ inn: string; name: string }> = [];
    for (const r of uniqRows) {
      const existingName = existingMap.get(r.inn);
      if (existingName === undefined) {
        toInsert.push({
          inn: r.inn,
          name: r.name,
          addedBy,
          isManual: !r.isStandard,
          lastFetchError: r.isStandard
            ? 'Avto-yangilanish kutilmoqda (cron 08:00–22:00)'
            : 'Nostandart INN — qo\'lda tahrirlash kerak',
        });
      } else if (existingName !== r.name) {
        // INN mavjud, lekin nom o'zgargan — yangilab qo'yamiz
        toUpdate.push({ inn: r.inn, name: r.name });
      } else {
        // Hech narsa o'zgarmagan
        result.skipped++;
        result.rows.push({ inn: r.inn, name: r.name, status: 'skipped', reason: 'O\'zgarish yo\'q' });
      }
    }

    const successfullyInserted: string[] = [];
    const successfullyUpdated: string[] = [];

    // 5) Bulk INSERT yangi qatorlar uchun
    if (toInsert.length > 0) {
      try {
        const inserted = await this.prisma.counterparty.createMany({
          data: toInsert,
          skipDuplicates: true,
        });
        result.added = inserted.count;
        for (const r of toInsert) {
          result.rows.push({ inn: r.inn, name: r.name, status: 'added' });
          successfullyInserted.push(r.inn);
        }
      } catch (e: any) {
        this.log.warn(`Bulk insert xato: ${e?.message} — har birini alohida sinaymiz`);
        for (const r of toInsert) {
          try {
            await this.prisma.counterparty.create({ data: r });
            result.added++;
            result.rows.push({ inn: r.inn, name: r.name, status: 'added' });
            successfullyInserted.push(r.inn);
          } catch (ee: any) {
            result.failed++;
            result.rows.push({ inn: r.inn, name: r.name, status: 'failed', reason: ee?.message || 'xato' });
          }
        }
      }
    }

    // 6) Bulk UPDATE — mavjud INN'lar uchun faqat name'ni yangilaymiz
    //    (boshqa maydonlar — director, phone, reyting va h.k. — cron orqali keladi)
    const updateDiffs: Array<{ inn: string; oldName: string; newName: string }> = [];
    for (const r of toUpdate) {
      try {
        const oldName = existingMap.get(r.inn) || '';
        await this.prisma.counterparty.update({
          where: { inn: r.inn },
          data: { name: r.name },
        });
        result.updated++;
        result.rows.push({ inn: r.inn, name: r.name, status: 'updated' });
        successfullyUpdated.push(r.inn);
        updateDiffs.push({ inn: r.inn, oldName, newName: r.name });
      } catch (e: any) {
        result.failed++;
        result.rows.push({ inn: r.inn, name: r.name, status: 'failed', reason: e?.message || 'xato' });
      }
    }

    // 7) History — bulk audit yozuvi (added va updated alohida tarix yozuvlari)
    if (successfullyInserted.length > 0 || successfullyUpdated.length > 0) {
      try {
        let actorName: string | null = null;
        const u = await this.prisma.adminUser.findUnique({
          where: { id: addedBy }, select: { email: true, fullName: true },
        });
        // Login (email) ustun — fullName emas
        actorName = u?.email || u?.fullName || null;

        const historyData: any[] = [];
        for (const inn of successfullyInserted) {
          historyData.push({
            inn, action: 'imported', actorType: 'user', actorId: addedBy, actorName,
            source: null, fieldsChanged: [],
            note: 'Excel import orqali qo\'shildi',
          });
        }
        for (const diff of updateDiffs) {
          historyData.push({
            inn: diff.inn, action: 'manual_edit', actorType: 'user', actorId: addedBy, actorName,
            source: 'manual', fieldsChanged: ['name'],
            changes: { name: { old: diff.oldName, new: diff.newName } },
            note: 'Excel re-import: nom yangilandi',
          });
        }
        await this.prisma.counterpartyHistory.createMany({ data: historyData });
      } catch (e: any) {
        this.log.warn(`Import history yozish xato: ${e?.message}`);
      }
    }

    this.log.log(
      `Import: ${result.added} yangi, ${result.updated} yangilandi, ${result.skipped} o'zgarish yo'q, ${result.failed} xato`,
    );
    return result;
  }

  /** Excel eksport — list bilan bir xil filter mantig'ini ishlatadi */
  async exportExcel(q: ListQuery): Promise<{ buffer: Buffer; filename: string; count: number }> {
    const where = buildWhere(q);

    const items = await this.prisma.counterparty.findMany({
      where,
      orderBy: { addedAt: 'desc' },
      take: 50000,
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('Kontragentlar');

    ws.columns = [
      { header: 'INN', key: 'inn', width: 14 },
      { header: 'Kontragent', key: 'name', width: 40 },
      { header: 'Direktor', key: 'director', width: 32 },
      { header: 'Reyting', key: 'rating', width: 10 },
      { header: 'Telefon', key: 'phone', width: 18 },
      { header: 'Manzil', key: 'address', width: 50 },
      { header: 'VAT status', key: 'vatStatus', width: 30 },
      { header: 'VAT reg kod', key: 'vatNumber', width: 18 },
      { header: 'OKED', key: 'oked', width: 40 },
      { header: 'Hisob raqamlari', key: 'accounts', width: 40 },
      { header: 'Qo\'shilgan', key: 'addedAt', width: 18 },
      { header: 'Oxirgi yangilash', key: 'lastFetchedAt', width: 18 },
    ];

    const head = ws.getRow(1);
    head.font = { bold: true, size: 10 };
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });

    for (const it of items) {
      const accounts = Array.isArray(it.bankAccounts)
        ? (it.bankAccounts as any[]).map((b) => `${b.account} (MFO ${b.mfo || '—'})`).join('; ')
        : '';
      ws.addRow({
        inn: it.inn,
        name: it.name,
        director: it.director || '',
        rating: it.rating ?? '',
        phone: it.phone || '',
        address: it.address || '',
        vatStatus: it.vatStatus || '',
        vatNumber: it.vatNumber || '',
        oked: it.oked || '',
        accounts,
        addedAt: it.addedAt ? it.addedAt.toISOString().slice(0, 19).replace('T', ' ') : '',
        lastFetchedAt: it.lastFetchedAt ? it.lastFetchedAt.toISOString().slice(0, 19).replace('T', ' ') : '',
      });
    }

    const raw = await wb.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    return {
      buffer,
      filename: `kontragentlar_${new Date().toISOString().slice(0, 10)}.xlsx`,
      count: items.length,
    };
  }
}

// __ Re-export VAT status map ___ (foydali bo'lishi mumkin)
export { VAT_STATUS_MAP };

/** Standart INN — 9 yoki 14 raqamli. Aks holda "qo'lda kiritilgan". */
export function isStandardInn(inn: string): boolean {
  return /^\d{9}$|^\d{14}$/.test(inn);
}

/**
 * DIDOX/Chamber xato xabarlarini foydalanuvchiga tushunarli matnga aylantiradi.
 */
function humanizeEnrichmentError(e: any, inn: string): string {
  const raw = e?.message || String(e);
  // 14 raqam = PINFL (yakka tartibdagi tadbirkor / jismoniy shaxs)
  if (/^\d{14}$/.test(inn)) {
    return `INN ${inn} — bu 14 raqamli PINFL (jismoniy shaxs / yakka tartibdagi tadbirkor). DIDOX va Chamber faqat 9 raqamli kompaniya INN'lari bo'yicha ma'lumot beradi. Ma'lumotni qo'lda kiriting.`;
  }
  if (/topilmadi|404|400|Не удалось|Ma'lumotlar topilmadi/i.test(raw)) {
    return `INN ${inn} bo'yicha ma'lumot DIDOX va Chamber bazasida topilmadi.`;
  }
  if (/401|403|env vars not configured|login failed/i.test(raw)) {
    return `DIDOX serverda sozlanmagan yoki login muvaffaqiyatsiz. Faqat Chamber'dan asosiy ma'lumot olinadi.`;
  }
  // Asosiy texnik xato — qisqartirib
  return raw.length > 200 ? raw.slice(0, 200) + '…' : raw;
}
