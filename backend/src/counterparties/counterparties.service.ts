import { Injectable, Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { DidoxService, DidoxCompany, DidoxBankInfo } from './didox.service';
import { ChamberService, ChamberCompany } from './chamber.service';
import { XontaminotService } from './xontaminot.service';

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

  // refreshAll bir vaqtning o'zida faqat bitta ishlasin —
  // cron eskisi tugamasdan ikkinchi marta ishga tushsa, DIDOX'ga ikki baravar bosim tushadi.
  private refreshAllRunning = false;
  private refreshAllStartedAt: Date | null = null;
  private refreshAllProgress: { done: number; total: number } | null = null;

  constructor(
    private prisma: PrismaService,
    private didox: DidoxService,
    private chamber: ChamberService,
    private xontaminot: XontaminotService,
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
    const [total, items, enrichedCount, ratingAgg] = await Promise.all([
      this.prisma.counterparty.count({ where }),
      this.prisma.counterparty.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      // Global stats — DIDOX/Chamber'dan to'liq ma'lumot olingan qatorlar soni
      // (standart INN, oxirgi yangilash bor, xato yo'q)
      this.prisma.counterparty.count({
        where: {
          isActive: true,
          isManual: false,
          lastFetchedAt: { not: null },
          lastFetchError: null,
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
        enrichedCount,
        enrichedPct: grandTotal > 0 ? Math.round((enrichedCount / grandTotal) * 100) : 0,
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

    // Auto-refresh sozlamasi o'chirilgan bo'lsa — bitta qatorni yangilash ham bloklanadi
    // (admin to'liq cheklov istagan, DIDOX/Chamber'ga hech qanday so'rov yubormaymiz).
    const enabled = await this.isAutoRefreshEnabled();
    if (!enabled) {
      throw new BadRequestException(
        "DIDOX va Chamber so'rovlari o'chirilgan. Avval Settings'dan yoqing.",
      );
    }

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
  async refreshAll(actorId?: string): Promise<{ ok: boolean; started: boolean; message: string; runningSince?: string; progress?: { done: number; total: number } }> {
    // Auto-refresh o'chirilgan bo'lsa — qo'lda chaqirilsa ham bajarmaymiz
    // (admin to'liq cheklov istagan, DIDOX/Chamber'ga so'rov yubormaymiz).
    const enabled = await this.isAutoRefreshEnabled();
    if (!enabled) {
      this.log.warn(`refreshAll bloklandi — auto-refresh sozlamasi o'chirilgan (actor: ${actorId || 'cron'})`);
      return {
        ok: false,
        started: false,
        message: "DIDOX va Chamber so'rovlari o'chirilgan. Avval Settings'dan yoqing.",
      };
    }
    if (this.refreshAllRunning) {
      const since = this.refreshAllStartedAt;
      const mins = since ? Math.floor((Date.now() - since.getTime()) / 60000) : 0;
      const progressStr = this.refreshAllProgress
        ? ` (${this.refreshAllProgress.done}/${this.refreshAllProgress.total})`
        : '';
      this.log.warn(`refreshAll allaqachon ishlamoqda (${mins} daqiqadan beri)${progressStr} — yangi chaqiruv rad etildi`);
      return {
        ok: true,
        started: false,
        message: `Yangilash allaqachon ishlamoqda${progressStr} — ${mins} daqiqadan beri. Tugashini kuting.`,
        runningSince: since?.toISOString(),
        progress: this.refreshAllProgress || undefined,
      };
    }
    this.runRefreshAllInBackground(actorId).catch((e) => {
      this.log.error(`refreshAll background xato: ${e?.message || e}`);
    });
    // Activity log — manual yoki cron
    this.appendActivityLog({
      action: 'refresh_all_started',
      actorId: actorId || null,
      actorName: actorId ? null : 'cron',
      details: null,
    }).catch(() => {});
    return {
      ok: true,
      started: true,
      message: 'Yangilash fonda boshlandi — birozdan keyin sahifani yangilang',
    };
  }

  /** Joriy refreshAll holatini qaytaradi — UI badge uchun. */
  getRefreshAllStatus(): { running: boolean; startedAt: string | null; progress: { done: number; total: number } | null } {
    return {
      running: this.refreshAllRunning,
      startedAt: this.refreshAllStartedAt?.toISOString() || null,
      progress: this.refreshAllProgress,
    };
  }

  private async runRefreshAllInBackground(actorId?: string): Promise<void> {
    // Lock — bir vaqtning o'zida faqat bitta run bo'lsin.
    if (this.refreshAllRunning) {
      this.log.warn('runRefreshAllInBackground: allaqachon ishlamoqda, o\'tkazib yuborildi');
      return;
    }
    this.refreshAllRunning = true;
    this.refreshAllStartedAt = new Date();
    this.refreshAllProgress = { done: 0, total: 0 };

    try {
      // Faqat standart 9/14 raqamli INN'larga so'rov yuboramiz —
      // "kod0088", "null0004" kabi qo'lda kiritilgan kontragentlarga tegmaymiz.
      const all = await this.prisma.counterparty.findMany({
        where: { isActive: true },
        select: { inn: true, bankAccounts: true },
      });
      const standard = all.filter((cp) => isStandardInn(cp.inn));
      const skippedManual = all.length - standard.length;
      this.refreshAllProgress = { done: 0, total: standard.length };

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
        this.refreshAllProgress = { done: updated + failed, total: standard.length };
        await new Promise((r) => setTimeout(r, 200));
      }
      const durSec = Math.round((Date.now() - (this.refreshAllStartedAt?.getTime() || Date.now())) / 1000);
      this.log.log(
        `refreshAll tugadi: ${updated} yangilandi, ${failed} xato, ${skippedManual} qo'lda (jami ${all.length}, ${durSec}s)`,
      );
    } finally {
      // Lock'ni doim ozod qilamiz — exception bo'lsa ham keyingi cron ishlasin.
      this.refreshAllRunning = false;
      this.refreshAllStartedAt = null;
      this.refreshAllProgress = null;
    }
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
        // Hech narsa o'zgarmagan — faqat hisoblaymiz, ro'yxatga qo'shmaymiz
        // (3000+ "O'zgarish yo'q" qatorlar UI'ni og'irlashtirar edi)
        result.skipped++;
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

  // ═══════════════════════════════════════════════════════════════
  //   SETTINGS — Auto-refresh ON/OFF + Activity log
  //   (Setting model orqali — yangi schema kerak emas)
  // ═══════════════════════════════════════════════════════════════
  private static readonly SETTING_AUTO_REFRESH = 'counterparties.autoRefreshEnabled';
  private static readonly SETTING_ACTIVITY_LOG = 'counterparties.activityLog';
  private static readonly TRUNCATE_PASSWORD = '7779';
  private static readonly ACTIVITY_LOG_LIMIT = 1000;

  /** Auto-refresh yoqilganmi? (default: true) */
  async isAutoRefreshEnabled(): Promise<boolean> {
    const s = await this.prisma.setting.findUnique({
      where: { key: CounterpartiesService.SETTING_AUTO_REFRESH },
    });
    if (!s?.value) return true; // default ON
    return s.value === 'true';
  }

  /** Auto-refresh holatini o'zgartirish. */
  async setAutoRefresh(enabled: boolean, actor?: { id: string | null; name: string | null }): Promise<{ ok: true; enabled: boolean }> {
    await this.prisma.setting.upsert({
      where: { key: CounterpartiesService.SETTING_AUTO_REFRESH },
      create: {
        key: CounterpartiesService.SETTING_AUTO_REFRESH,
        value: enabled ? 'true' : 'false',
        updatedBy: actor?.name || actor?.id || 'system',
      },
      update: {
        value: enabled ? 'true' : 'false',
        updatedBy: actor?.name || actor?.id || 'system',
      },
    });
    await this.appendActivityLog({
      action: enabled ? 'auto_refresh_enabled' : 'auto_refresh_disabled',
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      details: { enabled },
    });
    return { ok: true, enabled };
  }

  /** Settings ma'lumotini qaytarish. */
  async getSettings(): Promise<{ autoRefreshEnabled: boolean }> {
    return { autoRefreshEnabled: await this.isAutoRefreshEnabled() };
  }

  /** Activity log entry qo'shish (oxirgi N qator saqlanadi). */
  async appendActivityLog(entry: {
    action: string;
    actorId: string | null;
    actorName: string | null;
    details?: any;
  }): Promise<void> {
    try {
      const cur = await this.prisma.setting.findUnique({
        where: { key: CounterpartiesService.SETTING_ACTIVITY_LOG },
      });
      let arr: any[] = [];
      try {
        arr = cur?.value ? JSON.parse(cur.value) : [];
        if (!Array.isArray(arr)) arr = [];
      } catch { arr = []; }

      arr.unshift({
        timestamp: new Date().toISOString(),
        action: entry.action,
        actorId: entry.actorId,
        actorName: entry.actorName,
        details: entry.details || null,
      });
      // Oxirgi N qator
      if (arr.length > CounterpartiesService.ACTIVITY_LOG_LIMIT) {
        arr = arr.slice(0, CounterpartiesService.ACTIVITY_LOG_LIMIT);
      }

      await this.prisma.setting.upsert({
        where: { key: CounterpartiesService.SETTING_ACTIVITY_LOG },
        create: {
          key: CounterpartiesService.SETTING_ACTIVITY_LOG,
          value: JSON.stringify(arr),
          updatedBy: entry.actorName || 'system',
        },
        update: {
          value: JSON.stringify(arr),
          updatedBy: entry.actorName || 'system',
        },
      });
    } catch (e: any) {
      this.log.warn(`Activity log yozish xato: ${e?.message}`);
    }
  }

  /**
   * Activity log o'qish — pagination + filter + search bilan.
   * Default: page=1, perPage=20, hech qanday filtr yo'q.
   */
  async getActivityLog(opts: {
    page?: number;
    perPage?: number;
    q?: string;                  // search action/actorName/details
    actorName?: string;          // aniq aktor bo'yicha (cron yoki email)
    action?: string;             // aniq action turi
  } = {}): Promise<{
    items: Array<{
      timestamp: string;
      action: string;
      actorId: string | null;
      actorName: string | null;
      details: any;
    }>;
    total: number;
    page: number;
    perPage: number;
    actors: string[];            // unique actor ro'yxati (filter UI uchun)
    actions: string[];            // unique action turlari (filter UI uchun)
  }> {
    const page = Math.max(1, Number(opts.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(opts.perPage) || 20));

    const cur = await this.prisma.setting.findUnique({
      where: { key: CounterpartiesService.SETTING_ACTIVITY_LOG },
    });
    let all: any[] = [];
    try {
      all = cur?.value ? JSON.parse(cur.value) : [];
      if (!Array.isArray(all)) all = [];
    } catch { all = []; }

    // Unique actors va actions — har doim to'liq ro'yxatdan (filter UI uchun)
    const actorsSet = new Set<string>();
    const actionsSet = new Set<string>();
    for (const e of all) {
      const a = e?.actorName || 'cron';
      actorsSet.add(a);
      if (e?.action) actionsSet.add(e.action);
    }
    const actors = [...actorsSet].sort();
    const actions = [...actionsSet].sort();

    // Filtr
    let filtered = all;
    if (opts.actorName) {
      const target = opts.actorName.trim();
      filtered = filtered.filter((e) => (e?.actorName || 'cron') === target);
    }
    if (opts.action) {
      filtered = filtered.filter((e) => e?.action === opts.action);
    }
    if (opts.q) {
      const q = opts.q.toLowerCase().trim();
      if (q) {
        filtered = filtered.filter((e) => {
          const hay = [
            e?.action || '',
            e?.actorName || '',
            e?.actorId || '',
            JSON.stringify(e?.details || {}),
          ].join(' ').toLowerCase();
          return hay.includes(q);
        });
      }
    }

    const total = filtered.length;
    const start = (page - 1) * perPage;
    const items = filtered.slice(start, start + perPage);

    return { items, total, page, perPage, actors, actions };
  }

  // ═══════════════════════════════════════════════════════════════
  //   XONTAMINOT SYNC — parallel loyihadan kontragentlar
  // ═══════════════════════════════════════════════════════════════

  private xontaminotSyncRunning = false;
  private xontaminotSyncStartedAt: Date | null = null;
  private xontaminotSyncProgress: { done: number; total: number } | null = null;

  // Xontaminot'dan kelgan kontragentlarni belgilash uchun sentinel
  private static readonly XONTAMINOT_ADDED_BY = '__xontaminot__';

  // Settings keys
  private static readonly SETTING_XT_AUTO_SYNC      = 'counterparties.xontaminot.autoSync';        // 'true'/'false'
  private static readonly SETTING_XT_INTERVAL_MIN   = 'counterparties.xontaminot.intervalMin';     // '60' (har soatda)
  private static readonly SETTING_XT_START_HOUR     = 'counterparties.xontaminot.startHour';       // '8'
  private static readonly SETTING_XT_END_HOUR       = 'counterparties.xontaminot.endHour';         // '22'
  private static readonly SETTING_XT_LAST_SYNC_AT   = 'counterparties.xontaminot.lastSyncAt';      // ISO string
  private static readonly SETTING_XT_LAST_SYNC_STATS = 'counterparties.xontaminot.lastSyncStats'; // JSON

  /**
   * Xontaminot loyihasidan kontragent ma'lumotlarini sinxronlash.
   *
   * Logika:
   *   - `taminotchilar` jadvalidan barcha INN'i bo'lganlarni o'qiymiz
   *   - INN bo'yicha upsert: agar bizda yo'q bo'lsa create, bor bo'lsa update
   *   - Update'da: faqat bo'sh maydonlarni to'ldiramiz (mavjud ma'lumotni
   *     ustidan yozmaymiz — xontaminot manba emas, faqat boyitish)
   *   - `isManual` belgisi tegmaydi
   *   - lastFetchedAt va `source` 'xontaminot' deb belgilanadi
   *
   * Test connection: GET /counterparties/_xontaminot/test
   */
  async syncFromXontaminot(actor?: { id: string | null; name: string | null }): Promise<{
    ok: boolean;
    started: boolean;
    message: string;
    runningSince?: string;
    progress?: { done: number; total: number };
  }> {
    if (!this.xontaminot.isConfigured()) {
      throw new BadRequestException(
        "XONTAMINOT_DATABASE_URL env sozlanmagan. Server .env'iga qo'shing.",
      );
    }
    if (this.xontaminotSyncRunning) {
      const since = this.xontaminotSyncStartedAt;
      const mins = since ? Math.floor((Date.now() - since.getTime()) / 60000) : 0;
      const progressStr = this.xontaminotSyncProgress
        ? ` (${this.xontaminotSyncProgress.done}/${this.xontaminotSyncProgress.total})`
        : '';
      return {
        ok: true,
        started: false,
        message: `Sinxronlash allaqachon ishlamoqda${progressStr} — ${mins} daqiqadan beri.`,
        runningSince: since?.toISOString(),
        progress: this.xontaminotSyncProgress || undefined,
      };
    }

    // Background'da ishga tushiramiz
    this.runXontaminotSyncInBackground(actor).catch((e) => {
      this.log.error(`Xontaminot sync background xato: ${e?.message || e}`);
    });
    this.appendActivityLog({
      action: 'xontaminot_sync_started',
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      details: null,
    }).catch(() => {});
    return {
      ok: true,
      started: true,
      message: 'Xontaminot sinxronlashi fonda boshlandi.',
    };
  }

  getXontaminotSyncStatus(): {
    running: boolean;
    startedAt: string | null;
    progress: { done: number; total: number } | null;
  } {
    return {
      running: this.xontaminotSyncRunning,
      startedAt: this.xontaminotSyncStartedAt?.toISOString() || null,
      progress: this.xontaminotSyncProgress,
    };
  }

  async testXontaminotConnection() {
    return this.xontaminot.testConnection();
  }

  private async runXontaminotSyncInBackground(actor?: { id: string | null; name: string | null }): Promise<void> {
    if (this.xontaminotSyncRunning) return;
    this.xontaminotSyncRunning = true;
    this.xontaminotSyncStartedAt = new Date();
    this.xontaminotSyncProgress = { done: 0, total: 0 };

    let created = 0;
    let updated = 0;
    let deleted = 0;
    let errors = 0;
    const startedAt = new Date();

    try {
      // 1) Xontaminot'dan barcha taminotchilarni o'qish
      const suppliers = await this.xontaminot.fetchAllSuppliers();
      const xontaminotInnSet = new Set(suppliers.map((s) => s.inn));
      this.xontaminotSyncProgress = { done: 0, total: suppliers.length };
      this.log.log(`Xontaminot MIRROR sync: ${suppliers.length} ta yozuv keldi`);

      // 2) Bizda allaqachon xontaminot'dan kelgan kontragentlarni topish
      // (addedBy = '__xontaminot__' belgisi orqali)
      const ourXontaminotRows = await this.prisma.counterparty.findMany({
        where: { addedBy: CounterpartiesService.XONTAMINOT_ADDED_BY },
        select: { inn: true },
      });
      const ourXontaminotInnSet = new Set(ourXontaminotRows.map((r) => r.inn));

      // 3) DELETE: bizda xontaminot'dan kelgan, lekin xontaminot'da endi yo'q
      // (MIRROR sync — manba o'chirsa, biz ham o'chiramiz)
      const toDelete = [...ourXontaminotInnSet].filter((inn) => !xontaminotInnSet.has(inn));
      if (toDelete.length > 0) {
        // Foreign key constraint — ManualTransaction bog'langan bo'lsa, avval uzamiz
        // (BU YERDA xavfsizroq yondashuv: agar manual tranzaksiya bog'langan
        //  bo'lsa, o'chirmaymiz)
        const safeToDelete: string[] = [];
        for (const inn of toDelete) {
          const linkedCount = await this.prisma.transaction.count({
            where: { manualCounterparty: { inn } },
          });
          if (linkedCount === 0) {
            safeToDelete.push(inn);
          } else {
            this.log.warn(`O'chirilmadi INN=${inn} — ${linkedCount} ta manual tranzaksiya bog'langan`);
          }
        }
        if (safeToDelete.length > 0) {
          // Avval history'larini o'chirish (FK constraint)
          await this.prisma.counterpartyHistory.deleteMany({
            where: { inn: { in: safeToDelete } },
          });
          const del = await this.prisma.counterparty.deleteMany({
            where: { inn: { in: safeToDelete } },
          });
          deleted = del.count;
          this.log.log(`Mirror sync — ${deleted} ta yozuv o'chirildi (xontaminot'dan ham o'chirilgan)`);
        }
      }

      // 4) Mavjud kontragentlarni olib mapping qilamiz (UPSERT uchun)
      const innList = suppliers.map((s) => s.inn);
      const existing = await this.prisma.counterparty.findMany({
        where: { inn: { in: innList } },
        select: {
          inn: true, name: true, director: true, phone: true, email: true,
          address: true, vatStatus: true, vatStatusCode: true, opf: true,
          rating: true, ratingType: true, ratingTitle: true, bankAccounts: true,
          directorPinfl: true, addedBy: true,
        },
      });
      const existingMap = new Map(existing.map((e) => [e.inn, e]));

      // 5) CREATE / UPDATE
      const CHUNK = 50;
      for (let i = 0; i < suppliers.length; i += CHUNK) {
        const batch = suppliers.slice(i, i + CHUNK);
        await Promise.all(batch.map(async (s) => {
          try {
            const ex = existingMap.get(s.inn);
            const bankAccounts = (s.bank && s.account)
              ? [{ account: s.account, bankName: s.bank, mfo: null, lastSeen: new Date().toISOString() }]
              : null;

            if (!ex) {
              // CREATE — xontaminot belgisi bilan
              await this.prisma.counterparty.create({
                data: {
                  inn: s.inn,
                  name: s.name || s.inn,
                  director: s.director,
                  directorPinfl: s.pinfl,
                  phone: s.phone,
                  email: s.email,
                  address: s.address,
                  vatStatus: s.vatStatus,
                  vatStatusCode: s.vatStatusCode,
                  opf: s.opf,
                  rating: s.rating,
                  ratingType: s.ratingType,
                  ratingTitle: s.ratingTitle,
                  bankAccounts: bankAccounts as any,
                  addedBy: CounterpartiesService.XONTAMINOT_ADDED_BY,
                  lastFetchedAt: new Date(),
                  notes: 'Xontaminot bazasidan import qilindi (mirror sync)',
                },
              });
              created++;
            } else if (ex.addedBy === CounterpartiesService.XONTAMINOT_ADDED_BY) {
              // UPDATE — xontaminot'dan kelganiga: barcha maydonlarni yangilaymiz
              // (chunki xontaminot manba — bizdagi qiymat bekor bo'ladi)
              const data: any = {
                name: s.name || ex.name,
                director: s.director,
                directorPinfl: s.pinfl,
                phone: s.phone,
                email: s.email,
                address: s.address,
                vatStatus: s.vatStatus,
                vatStatusCode: s.vatStatusCode,
                opf: s.opf,
                rating: s.rating,
                ratingType: s.ratingType,
                ratingTitle: s.ratingTitle,
                bankAccounts: bankAccounts as any,
                lastFetchedAt: new Date(),
              };
              await this.prisma.counterparty.update({
                where: { inn: s.inn },
                data,
              });
              updated++;
            } else {
              // UPDATE — bizdagi yozuv (DIDOX yoki qo'lda kiritilgan):
              // faqat BO'SH maydonlarni to'ldiramiz, ustidan yozmaymiz
              const data: any = {};
              if (!ex.director && s.director)         data.director = s.director;
              if (!ex.directorPinfl && s.pinfl)       data.directorPinfl = s.pinfl;
              if (!ex.phone && s.phone)               data.phone = s.phone;
              if (!ex.email && s.email)               data.email = s.email;
              if (!ex.address && s.address)           data.address = s.address;
              if (!ex.vatStatus && s.vatStatus)       data.vatStatus = s.vatStatus;
              if (!ex.vatStatusCode && s.vatStatusCode != null) data.vatStatusCode = s.vatStatusCode;
              if (!ex.opf && s.opf)                   data.opf = s.opf;
              if (ex.rating == null && s.rating != null) data.rating = s.rating;
              if (!ex.ratingType && s.ratingType)     data.ratingType = s.ratingType;
              if (!ex.ratingTitle && s.ratingTitle)   data.ratingTitle = s.ratingTitle;
              if ((!ex.bankAccounts || (Array.isArray(ex.bankAccounts) && ex.bankAccounts.length === 0)) && bankAccounts) {
                data.bankAccounts = bankAccounts;
              }

              if (Object.keys(data).length > 0) {
                data.lastFetchedAt = new Date();
                await this.prisma.counterparty.update({
                  where: { inn: s.inn },
                  data,
                });
                updated++;
              }
            }
          } catch (e: any) {
            errors++;
            this.log.warn(`Xontaminot upsert xato INN=${s.inn}: ${e?.message}`);
          } finally {
            if (this.xontaminotSyncProgress) {
              this.xontaminotSyncProgress.done++;
            }
          }
        }));
      }

      const durationSec = Math.round((Date.now() - startedAt.getTime()) / 1000);
      const stats = { fetched: suppliers.length, created, updated, deleted, errors, durationSec };

      this.log.log(
        `Xontaminot MIRROR sync yakunlandi: created=${created} updated=${updated} deleted=${deleted} errors=${errors} duration=${durationSec}s`,
      );

      // Settings'ga oxirgi sync vaqtini va statistikani saqlash
      await this.saveLastSyncInfo(startedAt.toISOString(), stats);

      await this.appendActivityLog({
        action: 'xontaminot_sync_completed',
        actorId: actor?.id || null,
        actorName: actor?.name || null,
        details: stats,
      });
    } catch (e: any) {
      this.log.error(`Xontaminot sync xato: ${e?.message}`);
      await this.appendActivityLog({
        action: 'xontaminot_sync_failed',
        actorId: actor?.id || null,
        actorName: actor?.name || null,
        details: { error: e?.message || String(e) },
      }).catch(() => {});
    } finally {
      this.xontaminotSyncRunning = false;
      this.xontaminotSyncStartedAt = null;
      this.xontaminotSyncProgress = null;
    }
  }

  // ─── XONTAMINOT SETTINGS (schedule + last sync info) ──────
  async getXontaminotSettings(): Promise<{
    autoSync: boolean;
    intervalMin: number;
    startHour: number;
    endHour: number;
    lastSyncAt: string | null;
    lastSyncStats: any;
    isConfigured: boolean;
  }> {
    const [auto, interval, start, end, lastSync, lastStats] = await Promise.all([
      this.prisma.setting.findUnique({ where: { key: CounterpartiesService.SETTING_XT_AUTO_SYNC } }),
      this.prisma.setting.findUnique({ where: { key: CounterpartiesService.SETTING_XT_INTERVAL_MIN } }),
      this.prisma.setting.findUnique({ where: { key: CounterpartiesService.SETTING_XT_START_HOUR } }),
      this.prisma.setting.findUnique({ where: { key: CounterpartiesService.SETTING_XT_END_HOUR } }),
      this.prisma.setting.findUnique({ where: { key: CounterpartiesService.SETTING_XT_LAST_SYNC_AT } }),
      this.prisma.setting.findUnique({ where: { key: CounterpartiesService.SETTING_XT_LAST_SYNC_STATS } }),
    ]);
    let stats: any = null;
    if (lastStats?.value) {
      try { stats = JSON.parse(lastStats.value); } catch {}
    }
    return {
      autoSync: auto?.value === 'true',
      intervalMin: Number(interval?.value) || 60,
      startHour: Number(start?.value) || 8,
      endHour: Number(end?.value) || 22,
      lastSyncAt: lastSync?.value || null,
      lastSyncStats: stats,
      isConfigured: this.xontaminot.isConfigured(),
    };
  }

  async setXontaminotSettings(
    s: { autoSync?: boolean; intervalMin?: number; startHour?: number; endHour?: number },
    actor?: { id: string | null; name: string | null },
  ): Promise<{ ok: true }> {
    const upserts: Promise<any>[] = [];
    const upd = actor?.name || 'system';
    if (s.autoSync !== undefined) {
      upserts.push(this.prisma.setting.upsert({
        where: { key: CounterpartiesService.SETTING_XT_AUTO_SYNC },
        create: { key: CounterpartiesService.SETTING_XT_AUTO_SYNC, value: s.autoSync ? 'true' : 'false', updatedBy: upd },
        update: { value: s.autoSync ? 'true' : 'false', updatedBy: upd },
      }));
    }
    if (s.intervalMin !== undefined) {
      const v = Math.max(5, Math.min(1440, Number(s.intervalMin) || 60));
      upserts.push(this.prisma.setting.upsert({
        where: { key: CounterpartiesService.SETTING_XT_INTERVAL_MIN },
        create: { key: CounterpartiesService.SETTING_XT_INTERVAL_MIN, value: String(v), updatedBy: upd },
        update: { value: String(v), updatedBy: upd },
      }));
    }
    if (s.startHour !== undefined) {
      const v = Math.max(0, Math.min(23, Number(s.startHour) || 0));
      upserts.push(this.prisma.setting.upsert({
        where: { key: CounterpartiesService.SETTING_XT_START_HOUR },
        create: { key: CounterpartiesService.SETTING_XT_START_HOUR, value: String(v), updatedBy: upd },
        update: { value: String(v), updatedBy: upd },
      }));
    }
    if (s.endHour !== undefined) {
      const v = Math.max(0, Math.min(23, Number(s.endHour) || 23));
      upserts.push(this.prisma.setting.upsert({
        where: { key: CounterpartiesService.SETTING_XT_END_HOUR },
        create: { key: CounterpartiesService.SETTING_XT_END_HOUR, value: String(v), updatedBy: upd },
        update: { value: String(v), updatedBy: upd },
      }));
    }
    await Promise.all(upserts);
    await this.appendActivityLog({
      action: 'xontaminot_settings_changed',
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      details: s,
    });
    return { ok: true };
  }

  private async saveLastSyncInfo(timestamp: string, stats: any): Promise<void> {
    try {
      await Promise.all([
        this.prisma.setting.upsert({
          where: { key: CounterpartiesService.SETTING_XT_LAST_SYNC_AT },
          create: { key: CounterpartiesService.SETTING_XT_LAST_SYNC_AT, value: timestamp, updatedBy: 'sync' },
          update: { value: timestamp, updatedBy: 'sync' },
        }),
        this.prisma.setting.upsert({
          where: { key: CounterpartiesService.SETTING_XT_LAST_SYNC_STATS },
          create: { key: CounterpartiesService.SETTING_XT_LAST_SYNC_STATS, value: JSON.stringify(stats), updatedBy: 'sync' },
          update: { value: JSON.stringify(stats), updatedBy: 'sync' },
        }),
      ]);
    } catch (e: any) {
      this.log.warn(`saveLastSyncInfo xato: ${e?.message}`);
    }
  }

  /** Cron tomonidan chaqiriladi — settings'ga ko'ra sync qilinishi kerakmi? */
  async shouldRunXontaminotCron(): Promise<boolean> {
    const s = await this.getXontaminotSettings();
    if (!s.autoSync) return false;
    if (!s.isConfigured) return false;

    // Toshkent vaqti (UTC+5)
    const now = new Date();
    const tashHour = (now.getUTCHours() + 5) % 24;

    if (s.startHour <= s.endHour) {
      if (tashHour < s.startHour || tashHour > s.endHour) return false;
    } else {
      // Tunda chiziq (masalan 22 → 6)
      if (tashHour < s.startHour && tashHour > s.endHour) return false;
    }

    // Interval tekshirish
    if (s.lastSyncAt) {
      const last = new Date(s.lastSyncAt).getTime();
      const diffMin = (Date.now() - last) / 60000;
      if (diffMin < s.intervalMin) return false;
    }

    return true;
  }

  /** Butun kontragentlar bazasini TOZALASH (parol bilan). */
  async truncateAll(password: string, actor?: { id: string | null; name: string | null }): Promise<{
    ok: true;
    deleted: { counterparties: number; history: number };
  }> {
    if (password !== CounterpartiesService.TRUNCATE_PASSWORD) {
      throw new BadRequestException("Noto'g'ri parol");
    }
    // Avval CounterpartyHistory tozalash (FK constraint sababli)
    const historyDel = await this.prisma.counterpartyHistory.deleteMany({});
    const cpDel = await this.prisma.counterparty.deleteMany({});
    this.log.warn(
      `Counterparty base TRUNCATED by ${actor?.name || actor?.id || 'unknown'} — ` +
      `${cpDel.count} kontragent, ${historyDel.count} history qatori o'chirildi`,
    );
    await this.appendActivityLog({
      action: 'truncated',
      actorId: actor?.id || null,
      actorName: actor?.name || null,
      details: {
        counterpartiesDeleted: cpDel.count,
        historyDeleted: historyDel.count,
      },
    });
    return {
      ok: true,
      deleted: {
        counterparties: cpDel.count,
        history: historyDel.count,
      },
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
