import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmContractCacheService } from '../categorization/crm-contract-cache.service';
import { CrmService } from '../crm/crm.service';

type Actor = { id?: string | null; name?: string | null };

/** OplataKv.txType — "Взнос от имени клиента" (obyekt tushumiga kirmaydi). */
export const VZNOS_TX_TYPE = 'Взнос от имени клиента';

export interface VznosDto {
  contractNo: string;
  projectName?: string | null;
  contractDate?: string | null;
  contractValue?: number | null;
  fullName?: string | null;
  apartmentArea?: number | null;
  apartmentNo?: string | null;
  floor?: string | null;
  block?: string | null;
  terraceArea?: number | null;
  comment?: string | null;
}

@Injectable()
export class VznosService {
  private readonly log = new Logger(VznosService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly crmCache: CrmContractCacheService,
    private readonly crm: CrmService,
  ) {}

  /** Loyiha (obyekt) dropdown — OplataKv'dagi mavjud obyekt nomlari */
  async objects(): Promise<string[]> {
    const rows = await this.prisma.oplataKv.findMany({
      where: { object: { not: null } },
      select: { object: true },
      distinct: ['object'],
      take: 500,
    });
    return rows
      .map((r) => (r.object || '').trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'ru'));
  }

  /**
   * CRM lookup — qo'shishда prefill uchun. crm.show() to'liq detalни oladi
   * (MySQL extras + order_apartments deep struktura) va mumkin bo'lgan barcha
   * maydonlarni himoyalab (bir necha nomni sinab) ajratadi. Topilmaganlar bo'sh qoladi.
   */
  async crmLookup(contractNo: string) {
    const cn = (contractNo || '').trim().toUpperCase();
    if (!cn) throw new BadRequestException('Shartnoma raqami kerak');

    const basic = await this.crmCache.lookup(cn).catch(() => null);
    let detail: any = null;
    try {
      const res: any = await this.crm.show({ contract: cn });
      if (res?.ok) detail = res.detail;
    } catch { /* live API xato — basic bilan davom */ }

    // Apartment ma'lumotlari CRM detalда `info` obyektida:
    // info = { number, floor, rooms, area, balcony_area, block, ... }
    const info = detail?.info || {};
    const client = detail?.client || {};
    const pick = (...vals: any[]): any => {
      for (const v of vals) {
        if (v == null) continue;
        const s = String(v).trim();
        if (s !== '' && s !== '0' && !s.startsWith('0000-00-00')) return v;
      }
      return null;
    };
    const numOr = (...vals: any[]): number | null => {
      const v = pick(...vals);
      if (v == null) return null;
      const n = Number(String(v).replace(/[^\d.\-]/g, ''));
      return isNaN(n) || n === 0 ? null : n;
    };
    const objRaw = pick(info.object?.name, info.object, client.object_name, detail?.object_name, detail?.payment_detail?.company_name);
    const objName = objRaw && typeof objRaw === 'object' ? (objRaw.name || objRaw.uz || objRaw.ru || null) : objRaw;
    const dateRaw = pick(detail?.contract_date, detail?.date, detail?.order_date, detail?.created_at);

    return {
      ok: true,
      found: !!basic?.found || !!detail,
      contractNo: pick(detail?.contract, basic?.contractNo) || cn,
      fullName: basic?.customerName || pick(client.full_name_lotin, client.full_name_kirill, client.full_name) || null,
      projectName: objName || basic?.objectName || null,
      apartmentNo: pick(info.number, client.apartment_number, detail?.apartment_number, basic?.apartmentNumber)?.toString() || null,
      floor: pick(info.floor, client.floor)?.toString() || null,
      block: (() => { const b = pick(info.block, client.block); return b && typeof b === 'object' ? (b.name || b.uz || b.ru || null) : (b != null ? String(b) : null); })(),
      apartmentArea: numOr(info.area, info.total_area, info.square),
      terraceArea: numOr(info.balcony_area, info.terrace_area, info.terrace),
      contractDate: dateRaw ? String(dateRaw).slice(0, 10) : null,
      contractValue: numOr(detail?.price, detail?.total_price, detail?.amount, detail?.sum, detail?.total),
    };
  }

  /** contractNo → to'langan summa (OplataKv paymentAmount yig'indisi) */
  private async paidMap(contractNos: string[]): Promise<Map<string, number>> {
    const m = new Map<string, number>();
    const uniq = Array.from(new Set(contractNos.filter(Boolean)));
    if (uniq.length === 0) return m;
    const grouped = await (this.prisma.oplataKv.groupBy as any)({
      by: ['contractNo'],
      where: { contractNo: { in: uniq } },
      _sum: { paymentAmount: true },
    });
    for (const g of grouped) m.set(g.contractNo, Number(g._sum.paymentAmount || 0));
    return m;
  }

  async list(filters: { q?: string; project?: string; status?: string; page?: number; perPage?: number }) {
    const where: any = {};
    if (filters.status && filters.status !== 'all') where.status = filters.status;
    if (filters.project && filters.project !== 'all') where.projectName = filters.project;
    const q = filters.q?.trim();
    if (q) {
      where.OR = [
        { contractNo: { contains: q, mode: 'insensitive' } },
        { fullName: { contains: q, mode: 'insensitive' } },
        { projectName: { contains: q, mode: 'insensitive' } },
        { apartmentNo: { contains: q, mode: 'insensitive' } },
      ];
    }
    const page = Math.max(1, filters.page || 1);
    const perPage = Math.min(100, Math.max(1, filters.perPage || 20));
    const [items, total] = await Promise.all([
      this.prisma.vznosContract.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.vznosContract.count({ where }),
    ]);
    const paid = await this.paidMap(items.map((i) => i.contractNo));
    const rows = items.map((i) => {
      const p = paid.get(i.contractNo) || 0;
      const val = i.contractValue != null ? Number(i.contractValue) : null;
      return {
        ...i,
        contractValue: val,
        paid: p,
        remaining: val != null ? val - p : null,
      };
    });
    return { ok: true, items: rows, total, page, perPage };
  }

  /** Kartalar uchun statistika (faqat active shartnomalar) */
  async stats(filters: { project?: string }) {
    const where: any = { status: 'active' };
    if (filters.project && filters.project !== 'all') where.projectName = filters.project;
    const all = await this.prisma.vznosContract.findMany({ where, select: { contractNo: true, contractValue: true } });
    const paid = await this.paidMap(all.map((a) => a.contractNo));
    let totalValue = 0, totalPaid = 0;
    for (const a of all) {
      totalValue += a.contractValue != null ? Number(a.contractValue) : 0;
      totalPaid += paid.get(a.contractNo) || 0;
    }
    return {
      ok: true,
      count: all.length,
      totalValue,
      totalPaid,
      totalRemaining: Math.max(0, totalValue - totalPaid),
      paidPercent: totalValue > 0 ? Math.round((totalPaid / totalValue) * 1000) / 10 : 0,
    };
  }

  async create(dto: VznosDto, actor: Actor) {
    const cn = (dto.contractNo || '').trim().toUpperCase();
    if (!cn) throw new BadRequestException('Shartnoma raqami kerak');
    const existing = await this.prisma.vznosContract.findFirst({ where: { contractNo: cn, status: 'active' } });
    if (existing) throw new BadRequestException(`Bu shartnoma allaqachon ro'yxatda: ${cn}`);

    const crm = await this.crmCache.lookup(cn).catch(() => null);
    const created = await this.prisma.vznosContract.create({
      data: {
        contractNo: cn,
        projectName: dto.projectName || crm?.objectName || null,
        contractDate: dto.contractDate ? new Date(dto.contractDate) : null,
        contractValue: dto.contractValue != null ? (dto.contractValue as any) : null,
        fullName: dto.fullName || crm?.customerName || null,
        apartmentArea: dto.apartmentArea != null ? (dto.apartmentArea as any) : null,
        apartmentNo: dto.apartmentNo || crm?.apartmentNumber || null,
        floor: dto.floor || null,
        block: dto.block || null,
        terraceArea: dto.terraceArea != null ? (dto.terraceArea as any) : null,
        comment: dto.comment || null,
        inCrm: !!crm?.found,
        status: 'active',
        createdById: actor.id ?? null,
        createdByName: actor.name ?? null,
      },
    });

    // Mavjud mos to'lovlarni "Взнос от имени клиента" ga o'tkazamiz (obyekt tushumiga kirmasin)
    const recat = await this.recategorizePayments(cn);
    return { ok: true, id: created.id, recategorized: recat };
  }

  async update(id: string, dto: Partial<VznosDto>, actor: Actor) {
    const v = await this.prisma.vznosContract.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Topilmadi');
    const data: any = {};
    if (dto.projectName !== undefined) data.projectName = dto.projectName || null;
    if (dto.contractDate !== undefined) data.contractDate = dto.contractDate ? new Date(dto.contractDate) : null;
    if (dto.contractValue !== undefined) data.contractValue = dto.contractValue != null ? dto.contractValue : null;
    if (dto.fullName !== undefined) data.fullName = dto.fullName || null;
    if (dto.apartmentArea !== undefined) data.apartmentArea = dto.apartmentArea != null ? dto.apartmentArea : null;
    if (dto.apartmentNo !== undefined) data.apartmentNo = dto.apartmentNo || null;
    if (dto.floor !== undefined) data.floor = dto.floor || null;
    if (dto.block !== undefined) data.block = dto.block || null;
    if (dto.terraceArea !== undefined) data.terraceArea = dto.terraceArea != null ? dto.terraceArea : null;
    if (dto.comment !== undefined) data.comment = dto.comment || null;
    await this.prisma.vznosContract.update({ where: { id }, data });
    return { ok: true };
  }

  async remove(id: string, actor: Actor) {
    const v = await this.prisma.vznosContract.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Topilmadi');
    await this.prisma.vznosContract.delete({ where: { id } });
    this.log.log(`Vznos ${v.contractNo} o'chirildi (${actor.name})`);
    return { ok: true };
  }

  /** Bekor qilish → to'lovlarni boshqa (ro'yxatдаgi active) shartnomaga o'tkazish */
  async cancel(id: string, body: { transferToContractNo: string; reason?: string }, actor: Actor) {
    const v = await this.prisma.vznosContract.findUnique({ where: { id } });
    if (!v) throw new NotFoundException('Topilmadi');
    if (v.status === 'cancelled') throw new BadRequestException('Allaqachon bekor qilingan');
    const target = (body.transferToContractNo || '').trim().toUpperCase();
    if (!target) throw new BadRequestException("Qaysi shartnomaga o'tkazilishini kiriting");
    if (target === v.contractNo) throw new BadRequestException("O'ziga o'tkazib bo'lmaydi");
    const targetV = await this.prisma.vznosContract.findFirst({ where: { contractNo: target, status: 'active' } });
    if (!targetV) throw new BadRequestException(`Maqsadli shartnoma ro'yxatда (active) topilmadi: ${target}`);

    // To'lovlarni target'ga o'tkazamiz (contractNo reassign + "Взнос от имени клиента")
    const r = await this.prisma.oplataKv.updateMany({
      where: { contractNo: v.contractNo },
      data: { contractNo: target, txType: VZNOS_TX_TYPE },
    });
    await this.prisma.vznosContract.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledById: actor.id ?? null,
        cancelledByName: actor.name ?? null,
        cancelReason: (body.reason || '').trim() || null,
        transferToContractNo: target,
      },
    });
    this.log.log(`Vznos ${v.contractNo} bekor → ${target} (${r.count} to'lov, ${actor.name})`);
    return { ok: true, transferred: r.count, to: target };
  }

  /**
   * contractNo mos OplataKv qatorlarini "Взнос от имени клиента" ga o'tkazish +
   * manba tranzaksiyalarni XATO ro'yxatidan yashirish (Transaction.xatoHidden=true).
   * (OplataKv'да xatoHidden yo'q — XATO Transaction bo'yicha aniqlanadi.)
   */
  private async recategorizePayments(contractNo: string): Promise<number> {
    const rows = await this.prisma.oplataKv.findMany({
      where: { contractNo },
      select: { id: true, sourceTxId: true },
    });
    if (rows.length === 0) return 0;

    // 1) OplataKv.txType → "Взнос от имени клиента" (obyekt tushumiga kirmaydi)
    await this.prisma.oplataKv.updateMany({
      where: { contractNo },
      data: { txType: VZNOS_TX_TYPE },
    });

    // 2) Manba tranzaksiyalarni XATO ro'yxatidan yashiramiz (sourceTxId = tx id yoki externalId)
    const sourceKeys = Array.from(new Set(rows.map((r) => r.sourceTxId).filter((x): x is string => !!x)));
    if (sourceKeys.length > 0) {
      await this.prisma.transaction.updateMany({
        where: { OR: [{ id: { in: sourceKeys } }, { externalId: { in: sourceKeys } }] },
        data: { xatoHidden: true },
      });
    }
    return rows.length;
  }
}
