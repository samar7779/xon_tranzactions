import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { ContractsService } from '../contracts/contracts.service';
import { LinkPaymentsDto } from './dto/payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private contracts: ContractsService,
  ) {}

  async list(params?: { contractId?: string; customerId?: string; stageId?: string }) {
    const where: Prisma.PaymentWhereInput = {};
    if (params?.contractId) where.contractId = params.contractId;
    if (params?.stageId) where.stageId = params.stageId;
    if (params?.customerId) where.contract = { customerId: params.customerId };

    const items = await this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        transaction: { select: { id: true, txnDate: true, fromName: true, fromInn: true, amount: true, reference: true } },
        contract: { select: { id: true, number: true, title: true, customer: { select: { id: true, name: true } } } },
        stage: { select: { id: true, ordinal: true, title: true } },
      },
    });
    return { ok: true, items };
  }

  /**
   * Avto-match: bank tranzaksiyasi keladi, INN orqali mijoz topiladi,
   * shu mijozning eng eski ochiq bosqichlariga FIFO taqsimlanadi.
   */
  async autoMatch(transactionId: string, userId?: string) {
    const txn = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) return { ok: false, error: 'tranzaksiya topilmadi' };
    // Faqat kirimga e'tibor (chiqimni e'tiborsiz qoldiramiz)
    if (txn.direction !== 'IN') return { ok: false, error: 'not IN' };
    if (!txn.fromInn) return { ok: false, error: 'no INN' };
    // Allaqachon match qilingan bo'lsa, takror qilmaymiz
    if (txn.matchStatus === 'AUTO' || txn.matchStatus === 'MANUAL' || txn.matchStatus === 'PARTIAL') {
      return { ok: false, error: 'already matched' };
    }

    const customer = await this.prisma.customer.findUnique({ where: { inn: txn.fromInn } });
    if (!customer) {
      // INN topilmadi — UNMATCHED qoldiramiz
      return { ok: false, error: 'customer not found by INN' };
    }

    // Mijozning ochiq bosqichlari FIFO bo'yicha
    const stages = await this.prisma.contractStage.findMany({
      where: {
        contract: { customerId: customer.id, status: { in: ['ACTIVE', 'SUSPENDED'] } },
        status: { in: ['PENDING', 'PARTIAL', 'OVERDUE'] },
      },
      orderBy: [{ dueDate: 'asc' }, { contractId: 'asc' }, { ordinal: 'asc' }],
    });

    if (stages.length === 0) {
      // Mijoz topildi, lekin ochiq bosqich yo'q
      await this.prisma.transaction.update({
        where: { id: txn.id },
        data: { customerId: customer.id, matchStatus: 'UNMATCHED', matchedAt: new Date() },
      });
      return { ok: false, error: 'no open stages' };
    }

    let remaining = new Prisma.Decimal(txn.amount);
    const allocations: Array<{ stageId: string; amount: Prisma.Decimal }> = [];

    for (const stage of stages) {
      if (remaining.lte(0)) break;
      const owe = new Prisma.Decimal(stage.amount).sub(stage.paidAmount);
      if (owe.lte(0)) continue;
      const alloc = remaining.gte(owe) ? owe : remaining;
      allocations.push({ stageId: stage.id, amount: alloc });
      remaining = remaining.sub(alloc);
    }

    // Tranzaksiya summasidan ortiqcha qolsa — PARTIAL belgilanadi
    const status = remaining.lte(0) ? 'AUTO' : 'PARTIAL';

    await this.prisma.$transaction(async (tx) => {
      // Payment yozuvlari
      for (const a of allocations) {
        const stage = stages.find((s) => s.id === a.stageId)!;
        await tx.payment.create({
          data: {
            transactionId: txn.id,
            contractId: stage.contractId,
            stageId: a.stageId,
            amount: a.amount,
            source: 'AUTO',
            createdBy: userId,
          },
        });
      }
      // Tranzaksiyani belgilash
      await tx.transaction.update({
        where: { id: txn.id },
        data: {
          customerId: customer.id,
          matchStatus: status,
          matchedAt: new Date(),
        },
      });
    });

    // Stage va contract holatini qayta hisoblash
    for (const a of allocations) {
      await this.contracts.recalcStage(a.stageId);
    }
    const contractIds = new Set(allocations.map((a) => stages.find((s) => s.id === a.stageId)!.contractId));
    for (const cid of contractIds) {
      await this.contracts.recalcContract(cid);
    }

    return {
      ok: true,
      customer: { id: customer.id, name: customer.name },
      allocated: allocations.map((a) => ({ stageId: a.stageId, amount: a.amount.toString() })),
      remaining: remaining.toString(),
      status,
    };
  }

  /** Qo'lda biriktirish (admin) */
  async linkManual(dto: LinkPaymentsDto, userId?: string) {
    const txn = await this.prisma.transaction.findUnique({ where: { id: dto.transactionId } });
    if (!txn) throw new NotFoundException('Tranzaksiya topilmadi');
    if (txn.direction !== 'IN') throw new BadRequestException('Faqat kirim tranzaksiyani bog\'lash mumkin');

    // Sum check
    const totalAlloc = dto.allocations.reduce((s, a) => s + Number(a.amount), 0);
    if (totalAlloc > Number(txn.amount) + 0.01) {
      throw new BadRequestException(`Taqsimlangan summa (${totalAlloc}) tranzaksiya summasidan (${txn.amount}) ko'p`);
    }

    // Avval mavjud payment'larni o'chiramiz (re-allocate)
    const existing = await this.prisma.payment.findMany({ where: { transactionId: txn.id } });
    const affectedStages = new Set<string>();

    await this.prisma.$transaction(async (tx) => {
      if (existing.length > 0) {
        for (const e of existing) affectedStages.add(e.stageId);
        await tx.payment.deleteMany({ where: { transactionId: txn.id } });
      }
      // Yangi allocations
      for (const a of dto.allocations) {
        const stage = await tx.contractStage.findUnique({ where: { id: a.stageId } });
        if (!stage) throw new NotFoundException(`Bosqich topilmadi: ${a.stageId}`);
        await tx.payment.create({
          data: {
            transactionId: txn.id,
            contractId: stage.contractId,
            stageId: a.stageId,
            amount: a.amount,
            source: 'MANUAL',
            createdBy: userId,
            notes: dto.notes,
          },
        });
        affectedStages.add(a.stageId);
      }
      // Tranzaksiyani belgilash
      const fullyAllocated = totalAlloc >= Number(txn.amount) - 0.01;
      const firstStage = await tx.contractStage.findUnique({
        where: { id: dto.allocations[0].stageId },
        include: { contract: { select: { customerId: true } } },
      });
      await tx.transaction.update({
        where: { id: txn.id },
        data: {
          customerId: firstStage?.contract.customerId,
          matchStatus: fullyAllocated ? 'MANUAL' : 'PARTIAL',
          matchedAt: new Date(),
        },
      });
    });

    for (const sid of affectedStages) await this.contracts.recalcStage(sid);
    return { ok: true };
  }

  async unlink(transactionId: string) {
    const txn = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) throw new NotFoundException('Tranzaksiya topilmadi');
    const existing = await this.prisma.payment.findMany({ where: { transactionId } });
    const stageIds = existing.map((e) => e.stageId);

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.deleteMany({ where: { transactionId } });
      await tx.transaction.update({
        where: { id: transactionId },
        data: { matchStatus: 'UNMATCHED', customerId: null, matchedAt: null },
      });
    });
    for (const sid of stageIds) await this.contracts.recalcStage(sid);
    return { ok: true };
  }

  /** Tranzaksiyani billing'ga aloqasi yo'q deb belgilash */
  async ignore(transactionId: string) {
    const txn = await this.prisma.transaction.findUnique({ where: { id: transactionId } });
    if (!txn) throw new NotFoundException('Tranzaksiya topilmadi');
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { matchStatus: 'IGNORED', matchedAt: new Date() },
    });
    return { ok: true };
  }
}
