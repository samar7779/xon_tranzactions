import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CreateChekDto, UpdateChekDto } from './dto/chek.dto';

type Actor = { id?: string | null; name?: string | null };

// Excel eksport uchun 4 tilli yorliqlar (frontend i18n bilan mos)
const EXPORT_LABELS: Record<string, any> = {
  uz: {
    sheet: 'Chek', date: 'Sana', contract: 'Shartnoma raqami', manager: 'Menejer', branch: 'Sotuv ofisi',
    object: 'Obyekt', vid: 'Shartnoma turi', kontrolyor: 'Kontrolyor', shtrafy: 'Jarima', prichina: 'Rad etish sababi', dobavil: 'Qo\'shdi',
    vidMap: { original: 'Original', ekzemplyar: 'Nusxa', original_fixed: 'Tuzatilgan original', ekzemplyar_fixed: 'Tuzatilgan nusxa' },
    kontrolyorMap: { prinyat: 'Qabul qilindi', otkaz: 'Rad etildi' },
  },
  uzc: {
    sheet: 'Чек', date: 'Сана', contract: 'Шартнома рақами', manager: 'Менежер', branch: 'Сотув офиси',
    object: 'Обект', vid: 'Шартнома тури', kontrolyor: 'Контролёр', shtrafy: 'Жарима', prichina: 'Рад этиш сабаби', dobavil: 'Қўшди',
    vidMap: { original: 'Оригинал', ekzemplyar: 'Нусха', original_fixed: 'Тузатилган оригинал', ekzemplyar_fixed: 'Тузатилган нусха' },
    kontrolyorMap: { prinyat: 'Қабул қилинди', otkaz: 'Рад этилди' },
  },
  ru: {
    sheet: 'Чек', date: 'Дата', contract: 'Номер договора', manager: 'Менеджер', branch: 'Сотув офис',
    object: 'Объект', vid: 'Вид договора', kontrolyor: 'Контролёр', shtrafy: 'Штрафы', prichina: 'Причина отказа', dobavil: 'Добавил',
    vidMap: { original: 'Оригинал', ekzemplyar: 'Экземпляр', original_fixed: 'Тугирланган Оригинал', ekzemplyar_fixed: 'Тугирланган Экземпляр' },
    kontrolyorMap: { prinyat: 'Принят', otkaz: 'Отказ' },
  },
  en: {
    sheet: 'Chek', date: 'Date', contract: 'Contract', manager: 'Manager', branch: 'Sales office',
    object: 'Object', vid: 'Contract type', kontrolyor: 'Controller', shtrafy: 'Penalty', prichina: 'Rejection reason', dobavil: 'Added by',
    vidMap: { original: 'Original', ekzemplyar: 'Copy', original_fixed: 'Corrected original', ekzemplyar_fixed: 'Corrected copy' },
    kontrolyorMap: { prinyat: 'Accepted', otkaz: 'Rejected' },
  },
};

/** BigInt → number (jarima summasi kichik — xavfsiz) va Date → ISO */
function serialize(row: any) {
  if (!row) return row;
  return {
    ...row,
    shtrafy: row.shtrafy == null ? null : Number(row.shtrafy),
    data: row.data instanceof Date ? row.data.toISOString().slice(0, 10) : row.data,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

@Injectable()
export class ChekService {
  constructor(private prisma: PrismaService, private crm: CrmService) {}

  /** CRM'dan menejer / sotuv ofisi / obyekt (Baza tab — shartnoma kiritilganda) */
  async crmLookup(contract: string) {
    return this.crm.getContractMeta(contract);
  }

  /** Baza tab — jonli autocomplete (shartnoma yozganda moslar) */
  async crmSearch(contract: string) {
    return this.crm.searchContracts(contract, 8);
  }

  async create(dto: CreateChekDto, actor: Actor) {
    const contract = dto.contractNumber?.trim();
    if (!contract) throw new BadRequestException('Shartnoma raqami kerak');

    const row = await this.prisma.chekDog.create({
      data: {
        contractNumber: contract,
        manager: dto.manager || null,
        managerPhone: dto.managerPhone || null,
        branchName: dto.branchName || null,
        objectName: dto.objectName || null,
        data: new Date(dto.data),
        vidDogovora: dto.vidDogovora,
        kontrolyor: dto.kontrolyor,
        prichinaOtkaza: dto.prichinaOtkaza || null,
        shtrafy: dto.shtrafy != null ? BigInt(dto.shtrafy) : null,
        dobavilId: actor?.id || null,
        dobavilName: actor?.name || null,
      },
    });
    return { ok: true, item: serialize(row) };
  }

  /** Tarix tab — ro'yxat (qidiruv + paginatsiya) */
  async list(opts: { q?: string; page?: number; perPage?: number }) {
    const page = Math.max(1, opts.page || 1);
    const perPage = Math.min(200, Math.max(1, opts.perPage || 50));
    const q = opts.q?.trim();

    // Faqat shartnoma raqami bo'yicha qidiruv
    const where = q
      ? { contractNumber: { contains: q, mode: 'insensitive' as const } }
      : {};

    const [rows, total] = await Promise.all([
      this.prisma.chekDog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.chekDog.count({ where }),
    ]);

    return {
      ok: true,
      total,
      page,
      perPage,
      items: rows.map(serialize),
    };
  }

  /** Filtrlangan ma'lumotni Excel (.xlsx) sifatida eksport */
  async exportXlsx(filters: {
    q?: string; manager?: string; branch?: string; object?: string;
    kontrolyor?: string; dateFrom?: string; dateTo?: string; lang?: string;
  }): Promise<{ buffer: Buffer; filename: string }> {
    const where: any = {};
    if (filters.q?.trim()) where.contractNumber = { contains: filters.q.trim(), mode: 'insensitive' };
    if (filters.manager) where.manager = filters.manager;
    if (filters.branch) where.branchName = filters.branch;
    if (filters.object) where.objectName = filters.object;
    if (filters.kontrolyor) where.kontrolyor = filters.kontrolyor;
    if (filters.dateFrom || filters.dateTo) {
      where.data = {};
      if (filters.dateFrom) where.data.gte = new Date(filters.dateFrom);
      if (filters.dateTo) where.data.lte = new Date(filters.dateTo);
    }

    const items = await this.prisma.chekDog.findMany({ where, orderBy: { createdAt: 'desc' } });
    const L = EXPORT_LABELS[filters.lang || 'ru'] || EXPORT_LABELS.ru;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet(L.sheet);
    ws.columns = [
      { header: L.date, key: 'data', width: 12 },
      { header: L.contract, key: 'contract', width: 18 },
      { header: L.manager, key: 'manager', width: 26 },
      { header: L.branch, key: 'branch', width: 18 },
      { header: L.object, key: 'object', width: 24 },
      { header: L.vid, key: 'vid', width: 20 },
      { header: L.kontrolyor, key: 'kontrolyor', width: 16 },
      { header: L.shtrafy, key: 'shtrafy', width: 14 },
      { header: L.prichina, key: 'prichina', width: 30 },
      { header: L.dobavil, key: 'dobavil', width: 26 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).alignment = { vertical: 'middle' };

    for (const it of items) {
      const raw = it.data instanceof Date ? it.data.toISOString().slice(0, 10) : String(it.data).slice(0, 10);
      const [y, m, dd] = raw.split('-');
      ws.addRow({
        data: dd && m && y ? `${dd}.${m}.${y}` : raw,
        contract: it.contractNumber,
        manager: it.manager || '',
        branch: it.branchName || '',
        object: it.objectName || '',
        vid: L.vidMap[it.vidDogovora] || it.vidDogovora,
        kontrolyor: L.kontrolyorMap[it.kontrolyor] || it.kontrolyor,
        shtrafy: it.shtrafy != null ? Number(it.shtrafy) : '',
        prichina: it.prichinaOtkaza || '',
        dobavil: it.dobavilName || '',
      });
    }

    const arrayBuffer = await wb.xlsx.writeBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const ts = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `chek_${ts}.xlsx` };
  }

  async getOne(id: string) {
    const row = await this.prisma.chekDog.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Topilmadi');
    return { ok: true, item: serialize(row) };
  }

  async update(id: string, dto: UpdateChekDto) {
    const exists = await this.prisma.chekDog.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Topilmadi');

    const data: any = {};
    if (dto.contractNumber !== undefined) data.contractNumber = dto.contractNumber.trim();
    if (dto.manager !== undefined) data.manager = dto.manager || null;
    if (dto.managerPhone !== undefined) data.managerPhone = dto.managerPhone || null;
    if (dto.branchName !== undefined) data.branchName = dto.branchName || null;
    if (dto.objectName !== undefined) data.objectName = dto.objectName || null;
    if (dto.data !== undefined) data.data = new Date(dto.data);
    if (dto.vidDogovora !== undefined) data.vidDogovora = dto.vidDogovora;
    if (dto.kontrolyor !== undefined) data.kontrolyor = dto.kontrolyor;
    if (dto.prichinaOtkaza !== undefined) data.prichinaOtkaza = dto.prichinaOtkaza || null;
    if (dto.shtrafy !== undefined) data.shtrafy = dto.shtrafy != null ? BigInt(dto.shtrafy) : null;
    if (dto.tgSend !== undefined) data.tgSend = dto.tgSend;

    const row = await this.prisma.chekDog.update({ where: { id }, data });
    return { ok: true, item: serialize(row) };
  }

  async remove(id: string) {
    const exists = await this.prisma.chekDog.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Topilmadi');
    await this.prisma.chekDog.delete({ where: { id } });
    return { ok: true };
  }
}
