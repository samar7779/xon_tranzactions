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

export interface ListQuery {
  page?: number;
  perPage?: number;
  q?: string;
  vatStatus?: string;
  minRating?: number;
  maxRating?: number;
  sortBy?: 'addedAt' | 'name' | 'rating' | 'lastFetchedAt';
  sortDir?: 'asc' | 'desc';
}

@Injectable()
export class CounterpartiesService {
  private readonly log = new Logger(CounterpartiesService.name);

  constructor(
    private prisma: PrismaService,
    private didox: DidoxService,
    private chamber: ChamberService,
  ) {}

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
    if (q.minRating != null || q.maxRating != null) {
      where.rating = {};
      if (q.minRating != null) where.rating.gte = Number(q.minRating);
      if (q.maxRating != null) where.rating.lte = Number(q.maxRating);
    }

    const sortBy = q.sortBy || 'addedAt';
    const sortDir = q.sortDir || 'desc';
    const [total, items] = await Promise.all([
      this.prisma.counterparty.count({ where }),
      this.prisma.counterparty.findMany({
        where,
        orderBy: { [sortBy]: sortDir },
        skip: (page - 1) * perPage,
        take: perPage,
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

    // Avto-yangilash holatini ham qaytaramiz
    return {
      ok: true,
      total, page, perPage,
      items: itemsWithAdmin,
      didoxConfigured: this.didox.isConfigured(),
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
    if (!/^\d{9}$|^\d{14}$/.test(inn)) {
      throw new BadRequestException("INN 9 yoki 14 raqamli bo'lishi kerak");
    }

    const existing = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (existing) throw new ConflictException(`INN ${inn} allaqachon mavjud`);

    // DIDOX (yoki Chamber fallback) bilan boyitish
    let data: Record<string, any> = {};
    let fetchError: string | null = null;
    try {
      const { company, chamber, bank, source } = await this.fetchEnrichment(inn);
      data = this.mapToRecord(company, chamber, bank);
      this.log.log(`Create ${inn}: enrichment manbasi = ${source}`);
    } catch (e: any) {
      fetchError = e?.message || String(e);
      this.log.warn(`Create ${inn}: enrichment xatosi — saqlaymiz, keyin sync qiladi: ${fetchError}`);
    }

    const created = await this.prisma.counterparty.create({
      data: {
        inn,
        name, // foydalanuvchi kiritgani — refresh'da o'zgarmaydi
        addedBy,
        ...data,
        lastFetchError: fetchError,
      },
    });
    return { ok: true, counterparty: created, didoxFetched: !fetchError };
  }

  /**
   * Bitta kontragentni yangilash (DIDOX/Chamber'dan qaytadan olish).
   * Name tegilmaydi.
   */
  async refresh(inn: string) {
    const existing = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (!existing) throw new NotFoundException('Kontragent topilmadi');

    try {
      const { company, chamber, bank, source } = await this.fetchEnrichment(inn);
      const updated = await this.prisma.counterparty.update({
        where: { inn },
        data: this.mapToRecord(company, chamber, bank, existing.bankAccounts as any[] | null),
      });
      this.log.log(`Refresh ${inn}: enrichment manbasi = ${source}`);
      return { ok: true, counterparty: updated, source };
    } catch (e: any) {
      await this.prisma.counterparty.update({
        where: { inn },
        data: { lastFetchError: e?.message || String(e), lastFetchedAt: new Date() },
      });
      throw e;
    }
  }

  async update(inn: string, dto: { name?: string; notes?: string; isActive?: boolean }) {
    const existing = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (!existing) throw new NotFoundException('Kontragent topilmadi');
    const data: any = {};
    if (dto.name !== undefined) data.name = String(dto.name).trim();
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.isActive !== undefined) data.isActive = !!dto.isActive;
    const updated = await this.prisma.counterparty.update({ where: { inn }, data });
    return { ok: true, counterparty: updated };
  }

  async remove(inn: string) {
    const existing = await this.prisma.counterparty.findUnique({ where: { inn } });
    if (!existing) throw new NotFoundException('Kontragent topilmadi');
    await this.prisma.counterparty.delete({ where: { inn } });
    return { ok: true, deleted: inn };
  }

  // ────────────────────────── Bulk / cron ──────────────────────────

  /**
   * Cron yangilashi — barcha kontragentlarni DIDOX'dan qayta olib yangilaydi.
   * Parallel emas, ketma-ket: DIDOX'ga ortiqcha bosim bo'lmasin.
   */
  async refreshAll(): Promise<{ total: number; updated: number; failed: number }> {
    const all = await this.prisma.counterparty.findMany({
      where: { isActive: true },
      select: { inn: true, bankAccounts: true },
    });
    let updated = 0, failed = 0;
    for (const cp of all) {
      try {
        const { company, chamber, bank } = await this.fetchEnrichment(cp.inn);
        await this.prisma.counterparty.update({
          where: { inn: cp.inn },
          data: this.mapToRecord(company, chamber, bank, cp.bankAccounts as any[] | null),
        });
        updated++;
      } catch (e: any) {
        failed++;
        try {
          await this.prisma.counterparty.update({
            where: { inn: cp.inn },
            data: { lastFetchError: e?.message || String(e), lastFetchedAt: new Date() },
          });
        } catch { /* ignore */ }
      }
      // Yengil zaxira — rate limit'ga tushmaslik uchun
      await new Promise((r) => setTimeout(r, 200));
    }
    this.log.log(`Cron refresh: ${updated} yangilandi, ${failed} xato (jami ${all.length})`);
    return { total: all.length, updated, failed };
  }

  // ────────────────────────── Import / Export ──────────────────────────

  /**
   * Excel'dan bulk import — har bir qator INN + Name.
   * Dublikat INN → skip. Natijani satr-satr qaytaradi.
   */
  async importExcel(buffer: Buffer, addedBy: string): Promise<{
    total: number; added: number; skipped: number; failed: number;
    rows: Array<{ inn: string; name?: string; status: 'added' | 'skipped' | 'failed'; reason?: string }>;
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
      total: rowsToProcess.length, added: 0, skipped: 0, failed: 0,
      rows: [] as Array<{ inn: string; name?: string; status: 'added' | 'skipped' | 'failed'; reason?: string }>,
    };

    for (const r of rowsToProcess) {
      if (!/^\d{9}$|^\d{14}$/.test(r.inn)) {
        result.failed++;
        result.rows.push({ inn: r.inn, name: r.name, status: 'failed', reason: 'INN noto\'g\'ri' });
        continue;
      }
      const exists = await this.prisma.counterparty.findUnique({ where: { inn: r.inn } });
      if (exists) {
        result.skipped++;
        result.rows.push({ inn: r.inn, name: r.name, status: 'skipped', reason: 'INN allaqachon mavjud' });
        continue;
      }
      const name = r.name || `INN ${r.inn}`;
      try {
        await this.create({ inn: r.inn, name }, addedBy);
        result.added++;
        result.rows.push({ inn: r.inn, name, status: 'added' });
      } catch (e: any) {
        result.failed++;
        result.rows.push({ inn: r.inn, name, status: 'failed', reason: e?.message || 'xato' });
      }
    }
    return result;
  }

  /** Excel eksport — filtr bo'yicha barcha kontragentlar */
  async exportExcel(q: ListQuery): Promise<{ buffer: Buffer; filename: string; count: number }> {
    const where: any = {};
    if (q.q) {
      where.OR = [
        { inn: { contains: q.q } },
        { name: { contains: q.q, mode: 'insensitive' } },
        { director: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    if (q.vatStatus) where.vatStatus = { contains: q.vatStatus };

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
