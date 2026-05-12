import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';

@Injectable()
export class BanksService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.bank.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { credentials: true, accounts: true, transactions: true } },
      },
    });
    return { ok: true, items };
  }

  async get(id: string) {
    const bank = await this.prisma.bank.findUnique({
      where: { id },
      include: { credentials: { select: { id: true, label: true, isActive: true } } },
    });
    if (!bank) throw new NotFoundException('Bank topilmadi');
    return bank;
  }

  async create(dto: CreateBankDto) {
    const exists = await this.prisma.bank.findUnique({ where: { code: dto.code } });
    if (exists) throw new ConflictException('Bu kod bilan bank mavjud');
    const bank = await this.prisma.bank.create({ data: { ...dto } });
    return { ok: true, bank };
  }

  async update(id: string, dto: UpdateBankDto) {
    await this.get(id);
    const bank = await this.prisma.bank.update({ where: { id }, data: dto });
    return { ok: true, bank };
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.bank.delete({ where: { id } });
    return { ok: true };
  }
}
