import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Mijoz uchun jami statistikasi:
   * - jami shartnomalar summasi
   * - kelgan to'lovlar summasi
   * - qoldiq qarz
   */
  private async customerStats(customerId: string) {
    const contracts = await this.prisma.contract.findMany({
      where: { customerId, status: { not: 'CANCELLED' } },
      select: { totalAmount: true },
    });
    const payments = await this.prisma.payment.findMany({
      where: { contract: { customerId } },
      select: { amount: true },
    });
    const totalContracts = contracts.reduce((acc, c) => acc.add(c.totalAmount), new Prisma.Decimal(0));
    const totalPaid = payments.reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0));
    const debt = totalContracts.sub(totalPaid);
    return {
      contractsTotal: totalContracts.toString(),
      paidTotal: totalPaid.toString(),
      debt: debt.toString(),
      contractsCount: contracts.length,
    };
  }

  async list(params?: { q?: string }) {
    const where: Prisma.CustomerWhereInput = {};
    if (params?.q) {
      where.OR = [
        { name: { contains: params.q, mode: 'insensitive' } },
        { shortName: { contains: params.q, mode: 'insensitive' } },
        { inn: { contains: params.q } },
        { phone: { contains: params.q } },
      ];
    }
    const items = await this.prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { contracts: true, transactions: true } },
      },
    });
    // Har biriga stats qo'shamiz
    const enriched = await Promise.all(
      items.map(async (c) => ({ ...c, stats: await this.customerStats(c.id) })),
    );
    return { ok: true, items: enriched };
  }

  async get(id: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        contracts: {
          orderBy: { signDate: 'desc' },
          include: {
            _count: { select: { stages: true, payments: true } },
            stages: { select: { id: true, ordinal: true, title: true, amount: true, paidAmount: true, status: true, dueDate: true } },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Mijoz topilmadi');
    const stats = await this.customerStats(id);
    return { ...c, stats };
  }

  /** INN bo'yicha mijoz topish (sync auto-match uchun) */
  async findByInn(inn: string) {
    if (!inn) return null;
    return this.prisma.customer.findUnique({ where: { inn } });
  }

  async create(dto: CreateCustomerDto) {
    if (dto.inn) {
      const exists = await this.prisma.customer.findUnique({ where: { inn: dto.inn } });
      if (exists) throw new ConflictException(`Bu INN bilan mijoz mavjud: ${exists.name}`);
    }
    const customer = await this.prisma.customer.create({ data: { ...dto } as any });
    return { ok: true, customer };
  }

  async update(id: string, dto: UpdateCustomerDto) {
    const exists = await this.prisma.customer.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Mijoz topilmadi');
    if (dto.inn && dto.inn !== exists.inn) {
      const dup = await this.prisma.customer.findUnique({ where: { inn: dto.inn } });
      if (dup) throw new ConflictException(`Bu INN bilan mijoz mavjud: ${dup.name}`);
    }
    const customer = await this.prisma.customer.update({ where: { id }, data: dto as any });
    return { ok: true, customer };
  }

  async remove(id: string) {
    const c = await this.prisma.customer.findUnique({
      where: { id },
      include: { _count: { select: { contracts: true } } },
    });
    if (!c) throw new NotFoundException('Mijoz topilmadi');
    if (c._count.contracts > 0) {
      // Soft: deactivate o'rniga o'chiramiz
      throw new ConflictException(`Bu mijozda ${c._count.contracts} ta shartnoma bor — avval ularni bekor qiling`);
    }
    await this.prisma.customer.delete({ where: { id } });
    return { ok: true };
  }
}
