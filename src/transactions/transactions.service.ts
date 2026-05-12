import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';

@Injectable()
export class TransactionsService {
  constructor(private prisma: PrismaService) {}

  async list(query: ListTransactionsDto) {
    const { page = 1, perPage = 50, type, status, direction, bankId, dateFrom, dateTo, q } = query;
    const where: any = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (direction) where.direction = direction;
    if (bankId) where.bankId = bankId;
    if (dateFrom || dateTo) {
      where.txnDate = {};
      if (dateFrom) where.txnDate.gte = new Date(dateFrom);
      if (dateTo) where.txnDate.lte = new Date(dateTo);
    }
    if (q) {
      where.OR = [
        { description: { contains: q, mode: 'insensitive' } },
        { fromName: { contains: q, mode: 'insensitive' } },
        { toName: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [total, items] = await Promise.all([
      this.prisma.transaction.count({ where }),
      this.prisma.transaction.findMany({
        where,
        orderBy: { txnDate: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: { bank: true, category: true },
      }),
    ]);

    return { ok: true, total, page, perPage, items };
  }

  async findOne(id: string) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: { bank: true, category: true },
    });
  }

  async stats(dateFrom?: string, dateTo?: string) {
    const where: any = {};
    if (dateFrom || dateTo) {
      where.txnDate = {};
      if (dateFrom) where.txnDate.gte = new Date(dateFrom);
      if (dateTo) where.txnDate.lte = new Date(dateTo);
    }
    const [grouped, total] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['direction', 'status'],
        where,
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.transaction.count({ where }),
    ]);
    return { ok: true, total, groups: grouped };
  }
}
