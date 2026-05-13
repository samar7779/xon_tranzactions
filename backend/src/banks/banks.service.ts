import { Injectable, NotFoundException, ConflictException, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';

// Boshlang'ich banklar — bank24.uz protokoli oilasi
const DEFAULT_BANKS = [
  {
    code: 'KAPITALBANK',
    name: 'Kapitalbank',
    apiBaseUrl: process.env.KAPITALBANK_API_URL || 'https://m.bank24.uz:2713/Mobile.svc',
    apiKind: 'KAPITALBANK_V3' as const,
  },
  {
    code: 'IPAK_YULI',
    name: "Ipak Yo'li banki",
    apiBaseUrl: 'https://mb.ipakyulibank.uz:2713/Mobile.svc',
    apiKind: 'KAPITALBANK_V3' as const,
  },
];

@Injectable()
export class BanksService implements OnModuleInit {
  private readonly logger = new Logger(BanksService.name);
  constructor(private prisma: PrismaService) {}

  /**
   * Backend startup'da boshlang'ich banklarni DB'ga qo'shamiz (agar yo'q bo'lsa).
   * Bu seed-ni har deploy'da qo'lda ishga tushirish shart bo'lmasligi uchun.
   */
  async onModuleInit() {
    let added = 0;
    for (const b of DEFAULT_BANKS) {
      const existing = await this.prisma.bank.findUnique({ where: { code: b.code } });
      if (!existing) {
        await this.prisma.bank.create({ data: b });
        added++;
        this.logger.log(`✓ Bank qo'shildi: ${b.name}`);
      }
    }
    if (added > 0) {
      this.logger.log(`🏦 Banks bootstrap: ${added} ta yangi bank qo'shildi`);
    }

    // Hayot Bank vaqtincha kerakmas — agar mavjud bo'lsa va credentiallar yo'q bo'lsa o'chiramiz
    const hayot = await this.prisma.bank.findUnique({
      where: { code: 'HAYOT' },
      include: { _count: { select: { credentials: true, accounts: true } } },
    });
    if (hayot && hayot._count.credentials === 0 && hayot._count.accounts === 0) {
      await this.prisma.bank.delete({ where: { id: hayot.id } });
      this.logger.log(`🗑 Hayot Bank o'chirildi (kerakmas)`);
    }
  }

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
