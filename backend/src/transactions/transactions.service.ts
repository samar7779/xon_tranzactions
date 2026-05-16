import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

// YYYY-MM-DD ko'rinishidagi sana — Tashkent kunining boshi/oxiri (UTC+5)
// Filtrlash bu yerda bo'lishi shart, aks holda foydalanuvchi tanlagan sana
// UTC sifatida talqin qilinib, kun 5 soatga "siljiydi".
const parseDayStartTashkent = (d: string) => new Date(`${d}T00:00:00+05:00`);
const parseDayEndTashkent   = (d: string) => new Date(`${d}T23:59:59.999+05:00`);

export interface ExportFilters {
  q?: string;
  direction?: string;
  bankId?: string;
  accountId?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  status?: string;
  matchStatus?: string;
}

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  async list(query: ListTransactionsDto) {
    const { page = 1, perPage = 50, type, status, direction, bankId, accountId, dateFrom, dateTo, q } = query;
    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (direction) where.direction = direction;
    if (bankId) where.bankId = bankId;
    if (accountId) where.accountId = accountId;
    if (dateFrom || dateTo) {
      where.txnDate = {};
      if (dateFrom) where.txnDate.gte = parseDayStartTashkent(dateFrom);
      if (dateTo) where.txnDate.lte = parseDayEndTashkent(dateTo);
    }
    if (q) {
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { fromName: { contains: q, mode: 'insensitive' } },
        { toName: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
        { fromAccount: { contains: q } },
        { toAccount: { contains: q } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { txnDate: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          bank: { select: { id: true, code: true, name: true } },
          account: {
            select: {
              id: true, branch: true, accountNo: true, ownerName: true,
              bank: { select: { id: true, code: true, name: true } },
            },
          },
          category: true,
          subcategory: true,
        },
      }),
    ]);

    return { ok: true, total, page, perPage, items };
  }

  /**
   * Hisob raqami bo'yicha tranzaksiyalar sonini olish (cleanup oldidan ko'rsatish uchun).
   */
  async countByAccountNo(accountNo: string) {
    const acc = await this.prisma.bankAccount.findFirst({
      where: { accountNo },
      select: {
        id: true, accountNo: true, ownerName: true, branch: true, balance: true, currency: true,
        bank: { select: { id: true, code: true, name: true } },
      },
    });
    if (!acc) return { ok: false, error: 'Bunday hisob raqami topilmadi' };
    const [count, payments, lastTxn, firstTxn] = await Promise.all([
      this.prisma.transaction.count({ where: { accountId: acc.id } }),
      this.prisma.payment.count({ where: { transaction: { accountId: acc.id } } }),
      this.prisma.transaction.findFirst({
        where: { accountId: acc.id },
        orderBy: { txnDate: 'desc' },
        select: { txnDate: true },
      }),
      this.prisma.transaction.findFirst({
        where: { accountId: acc.id },
        orderBy: { txnDate: 'asc' },
        select: { txnDate: true },
      }),
    ]);
    return {
      ok: true,
      account: acc,
      count,
      paymentsCount: payments,
      firstTxnDate: firstTxn?.txnDate || null,
      lastTxnDate: lastTxn?.txnDate || null,
    };
  }

  /**
   * Hisob raqami bo'yicha barcha tranzaksiyalarni o'chirish.
   * Bog'liq Payment yozuvlarini ham birga o'chiradi (avval).
   * Hisob raqamining o'zi DB'dan o'chmaydi — faqat tranzaksiyalar.
   */
  async deleteByAccountNo(accountNo: string) {
    const acc = await this.prisma.bankAccount.findFirst({
      where: { accountNo },
      select: { id: true, accountNo: true, ownerName: true, branch: true },
    });
    if (!acc) return { ok: false, error: 'Bunday hisob raqami topilmadi' };

    // Bog'liq payment'larni avval o'chiramiz (FK cascade'siz)
    const txnIds = await this.prisma.transaction.findMany({
      where: { accountId: acc.id },
      select: { id: true },
    });
    const ids = txnIds.map((t) => t.id);
    if (ids.length === 0) {
      return { ok: true, deleted: 0, account: acc };
    }
    await this.prisma.payment.deleteMany({ where: { transactionId: { in: ids } } });
    const res = await this.prisma.transaction.deleteMany({ where: { accountId: acc.id } });
    // Hisob qoldig'ini tiklash (foydalanuvchi keyingi sync'da o'qiydi)
    await this.prisma.bankAccount.update({
      where: { id: acc.id },
      data: { balance: null, lastSyncedAt: null },
    });
    return { ok: true, deleted: res.count, account: acc };
  }

  async findOne(idOrExternal: string) {
    // Ichki id yoki bank bergan kompozit externalId bo'yicha qidiramiz
    return this.prisma.transaction.findFirst({
      where: { OR: [{ id: idOrExternal }, { externalId: idOrExternal }] },
      include: {
        bank: true,
        account: true,
        category: true,
        subcategory: true,
      },
    });
  }

  /**
   * Kunma-kun kirim/chiqim — dashboard diagrammasi uchun.
   * Sana oralig'i berilmasa — oxirgi 30 kun. bankId/accountId bilan filtrlanadi.
   * Har bir kun to'ldiriladi (tranzaksiyasiz kunlar ham 0 bilan), grafik uzluksiz bo'lishi uchun.
   */
  async daily(from?: string, to?: string, bankId?: string, accountId?: string) {
    // Tashkent kuni asosida ishlaymiz — backend serveri qaysi TZ'da bo'lishidan qat'i nazar
    const TZ_OFFSET_MS = 5 * 60 * 60 * 1000; // UTC+5
    const tashkentToday = (() => {
      const d = new Date(Date.now() + TZ_OFFSET_MS);
      return d.toISOString().slice(0, 10);
    })();
    const endStr = to || tashkentToday;
    const startStr = from || (() => {
      const d = new Date(`${endStr}T00:00:00+05:00`);
      d.setUTCDate(d.getUTCDate() - 29);
      return d.toISOString().slice(0, 10);
    })();

    const start = new Date(`${startStr}T00:00:00+05:00`);
    const end   = new Date(`${endStr}T23:59:59.999+05:00`);

    const where: any = { txnDate: { gte: start, lte: end } };
    if (bankId) where.bankId = bankId;
    if (accountId) where.accountId = accountId;

    const txns = await this.prisma.transaction.findMany({
      where,
      select: { txnDate: true, direction: true, amount: true },
    });

    // Bucket key — Tashkent kun (YYYY-MM-DD), UTC emas
    const toTashkentKey = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);

    const map = new Map<string, { inflow: number; outflow: number; count: number }>();
    for (const t of txns) {
      const key = toTashkentKey(t.txnDate);
      const e = map.get(key) || { inflow: 0, outflow: 0, count: 0 };
      const amt = Number(t.amount);
      if (t.direction === 'IN') e.inflow += amt;
      else e.outflow += amt;
      e.count += 1;
      map.set(key, e);
    }

    const days: { date: string; inflow: number; outflow: number; net: number; count: number }[] = [];
    let cursor = new Date(`${startStr}T00:00:00+05:00`);
    const limit = new Date(`${endStr}T00:00:00+05:00`);
    while (cursor <= limit) {
      const key = toTashkentKey(cursor);
      const e = map.get(key) || { inflow: 0, outflow: 0, count: 0 };
      days.push({ date: key, inflow: e.inflow, outflow: e.outflow, net: e.inflow - e.outflow, count: e.count });
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }

    const totalIn = days.reduce((s, d) => s + d.inflow, 0);
    const totalOut = days.reduce((s, d) => s + d.outflow, 0);
    return { ok: true, from: startStr, to: endStr, totalIn, totalOut, net: totalIn - totalOut, days };
  }

  /**
   * Tranzaksiyalarni filtr bo'yicha Excel qilib eksport — sahifalanmagan,
   * barcha mos yozuvlar (xavfsizlik uchun 50 000 ta bilan cheklangan).
   */
  async exportXlsx(filters: ExportFilters) {
    const where: any = {};
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    if (filters.direction) where.direction = filters.direction;
    if (filters.bankId) where.bankId = filters.bankId;
    if (filters.accountId) where.accountId = filters.accountId;
    if (filters.matchStatus) where.matchStatus = filters.matchStatus;
    if (filters.dateFrom || filters.dateTo) {
      where.txnDate = {};
      if (filters.dateFrom) where.txnDate.gte = parseDayStartTashkent(filters.dateFrom);
      if (filters.dateTo) where.txnDate.lte = parseDayEndTashkent(filters.dateTo);
    }
    if (filters.q) {
      where.OR = [
        { description: { contains: filters.q, mode: 'insensitive' } },
        { fromName: { contains: filters.q, mode: 'insensitive' } },
        { toName: { contains: filters.q, mode: 'insensitive' } },
        { reference: { contains: filters.q, mode: 'insensitive' } },
        { fromAccount: { contains: filters.q } },
        { toAccount: { contains: filters.q } },
      ];
    }

    const items = await this.prisma.transaction.findMany({
      where,
      orderBy: { txnDate: 'desc' },
      take: 50000,
      include: {
        bank: { select: { name: true } },
        account: {
          select: {
            accountNo: true, ownerName: true,
            bank: { select: { name: true } },
          },
        },
      },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('Tranzaksiyalar');

    ws.columns = [
      { header: 'Bank nomi', key: 'bank', width: 22 },
      { header: 'Hisob raqami', key: 'accountNo', width: 26 },
      { header: 'Hisob nomi', key: 'accountName', width: 32 },
      { header: 'Yuboruvchi nomi', key: 'fromName', width: 32 },
      { header: "Yo'nalish", key: 'direction', width: 12 },
      { header: 'Summa', key: 'amount', width: 18 },
      { header: "Izoh (to'lov maqsadi)", key: 'description', width: 50 },
      { header: 'Tranzaksiya ID', key: 'externalId', width: 30 },
    ];

    // Sarlavha qatorini bezash
    const headRow = ws.getRow(1);
    headRow.font = { bold: true, size: 10 };
    headRow.height = 22;
    headRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    for (const it of items) {
      const row = ws.addRow({
        bank: it.bank?.name || it.account?.bank?.name || '',
        accountNo: it.account?.accountNo || '',
        accountName: it.account?.ownerName || '',
        fromName: it.fromName || '',
        direction: it.direction === 'IN' ? 'Kirim' : 'Chiqim',
        amount: Number(it.amount),
        description: it.description || '',
        externalId: it.externalId || it.id,
      });
      row.font = { size: 9 };
      row.getCell('amount').numFmt = '#,##0.00';
      row.getCell('amount').font = {
        size: 9,
        color: { argb: it.direction === 'IN' ? 'FF047857' : 'FFBE123C' },
      };
    }

    const raw = await wb.xlsx.writeBuffer();
    const buffer: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const filename = `tranzaksiyalar_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { buffer, filename, count: items.length };
  }

  async stats(dateFrom?: string, dateTo?: string) {
    const where: any = {};
    if (dateFrom || dateTo) {
      where.txnDate = {};
      if (dateFrom) where.txnDate.gte = parseDayStartTashkent(dateFrom);
      if (dateTo) where.txnDate.lte = parseDayEndTashkent(dateTo);
    }
    const [grouped, total, byBank] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['direction', 'status'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.groupBy({
        by: ['bankId', 'direction'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
    ]);
    return { ok: true, total, groups: grouped, byBank };
  }
}
