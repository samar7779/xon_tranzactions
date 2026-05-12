import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';

@Injectable()
export class ContractsService {
  constructor(private prisma: PrismaService) {}

  private async nextNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `SHRT-${year}-`;
    const last = await this.prisma.contract.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
    });
    let nextN = 1;
    if (last) {
      const match = last.number.match(/(\d+)$/);
      if (match) nextN = parseInt(match[1], 10) + 1;
    }
    return `${prefix}${String(nextN).padStart(4, '0')}`;
  }

  async list(params?: { customerId?: string; status?: string }) {
    const where: Prisma.ContractWhereInput = {};
    if (params?.customerId) where.customerId = params.customerId;
    if (params?.status) where.status = params.status as any;

    const items = await this.prisma.contract.findMany({
      where,
      orderBy: { signDate: 'desc' },
      include: {
        customer: { select: { id: true, name: true, inn: true } },
        _count: { select: { stages: true, payments: true } },
        stages: { select: { amount: true, paidAmount: true, status: true, dueDate: true } },
      },
    });

    return {
      ok: true,
      items: items.map((c) => {
        const paid = c.stages.reduce((acc, s) => acc.add(s.paidAmount), new Prisma.Decimal(0));
        const total = new Prisma.Decimal(c.totalAmount);
        return {
          ...c,
          paidTotal: paid.toString(),
          debt: total.sub(paid).toString(),
          progressPct: total.eq(0) ? 0 : paid.div(total).mul(100).toNumber(),
        };
      }),
    };
  }

  async get(id: string) {
    const c = await this.prisma.contract.findUnique({
      where: { id },
      include: {
        customer: true,
        stages: {
          orderBy: { ordinal: 'asc' },
          include: {
            payments: {
              include: {
                transaction: { select: { id: true, txnDate: true, fromName: true, fromInn: true, amount: true, reference: true } },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
    if (!c) throw new NotFoundException('Shartnoma topilmadi');
    const paid = c.stages.reduce((acc, s) => acc.add(s.paidAmount), new Prisma.Decimal(0));
    const total = new Prisma.Decimal(c.totalAmount);
    return {
      ...c,
      paidTotal: paid.toString(),
      debt: total.sub(paid).toString(),
      progressPct: total.eq(0) ? 0 : paid.div(total).mul(100).toNumber(),
    };
  }

  async create(dto: CreateContractDto) {
    const customer = await this.prisma.customer.findUnique({ where: { id: dto.customerId } });
    if (!customer) throw new NotFoundException('Mijoz topilmadi');

    // Bosqichlar summasi shartnoma summasi bilan mos kelishi kerak
    const stagesSum = dto.stages.reduce((s, st) => s + Number(st.amount), 0);
    if (Math.abs(stagesSum - Number(dto.totalAmount)) > 0.01) {
      throw new BadRequestException(
        `Bosqichlar summasi (${stagesSum}) shartnoma summasiga (${dto.totalAmount}) teng emas`,
      );
    }

    let number = dto.number || (await this.nextNumber());
    const dup = await this.prisma.contract.findUnique({ where: { number } });
    if (dup) throw new ConflictException(`Shartnoma raqami band: ${number}`);

    const contract = await this.prisma.contract.create({
      data: {
        number,
        customerId: dto.customerId,
        title: dto.title,
        description: dto.description,
        projectAddress: dto.projectAddress,
        totalAmount: dto.totalAmount,
        currency: dto.currency || 'UZS',
        signDate: new Date(dto.signDate),
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        status: (dto.status as any) || 'ACTIVE',
        notes: dto.notes,
        stages: {
          create: dto.stages.map((s, i) => ({
            ordinal: i + 1,
            title: s.title,
            amount: s.amount,
            percentage: s.percentage,
            dueDate: s.dueDate ? new Date(s.dueDate) : null,
            notes: s.notes,
          })),
        },
      },
      include: { stages: true, customer: true },
    });
    return { ok: true, contract };
  }

  async update(id: string, dto: UpdateContractDto) {
    const exists = await this.prisma.contract.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Shartnoma topilmadi');
    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.projectAddress !== undefined) data.projectAddress = dto.projectAddress;
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.notes !== undefined) data.notes = dto.notes;
    const contract = await this.prisma.contract.update({ where: { id }, data });
    return { ok: true, contract };
  }

  async remove(id: string) {
    const c = await this.prisma.contract.findUnique({
      where: { id },
      include: { _count: { select: { payments: true } } },
    });
    if (!c) throw new NotFoundException('Shartnoma topilmadi');
    if (c._count.payments > 0) {
      throw new ConflictException(`Bu shartnomaga ${c._count.payments} ta to'lov bog'langan — bekor qiling, lekin o'chirib bo'lmaydi`);
    }
    await this.prisma.contract.delete({ where: { id } });
    return { ok: true };
  }

  /** Bosqichlar holatini qayta hisoblash (Payment'lar yangilanganda) */
  async recalcStage(stageId: string) {
    const stage = await this.prisma.contractStage.findUnique({
      where: { id: stageId },
      include: { payments: { select: { amount: true } } },
    });
    if (!stage) return;
    const paid = stage.payments.reduce((acc, p) => acc.add(p.amount), new Prisma.Decimal(0));
    const amount = new Prisma.Decimal(stage.amount);
    let status: 'PENDING' | 'PARTIAL' | 'PAID' | 'OVERDUE' = 'PENDING';
    if (paid.eq(0)) {
      status = stage.dueDate && stage.dueDate < new Date() ? 'OVERDUE' : 'PENDING';
    } else if (paid.lt(amount)) {
      status = 'PARTIAL';
    } else {
      status = 'PAID';
    }
    await this.prisma.contractStage.update({
      where: { id: stageId },
      data: {
        paidAmount: paid,
        status,
        paidAt: status === 'PAID' ? new Date() : null,
      },
    });
  }

  /** Shartnoma holatini ham qayta hisoblash */
  async recalcContract(contractId: string) {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
      include: { stages: true },
    });
    if (!contract) return;
    if (contract.stages.every((s) => s.status === 'PAID')) {
      await this.prisma.contract.update({
        where: { id: contractId },
        data: { status: 'COMPLETED' },
      });
    }
  }
}
