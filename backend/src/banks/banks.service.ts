import { Injectable, NotFoundException, ConflictException, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';

// Boshlang'ich banklar — O'zbekiston bo'yicha barcha asosiy banklar
// Aktiv = API integratsiyasi ishlaydi va sync uchun ishlatish mumkin
// Aktiv emas = ko'rinadi lekin tanlash uchun yopiq (integratsiya kelajakda)
const DEFAULT_BANKS = [
  // Aktiv — bank24.uz protokoli (KapitalBank V3 oilasi)
  { code: 'KAPITALBANK',  name: 'Kapitalbank',           apiBaseUrl: process.env.KAPITALBANK_API_URL || 'https://m.bank24.uz:2713/Mobile.svc',  apiKind: 'KAPITALBANK_V3' as const, isActive: true },
  { code: 'IPAK_YULI',    name: "Ipak Yo'li banki",      apiBaseUrl: 'https://mb.ipakyulibank.uz:2713/Mobile.svc',                              apiKind: 'KAPITALBANK_V3' as const, isActive: true },

  // Aktiv emas — kelajakda integratsiya bo'ladi
  { code: 'NBU',          name: 'NBU — Milliy bank',     apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'HAMKORBANK',   name: 'Hamkorbank',            apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'ASAKABANK',    name: 'Asaka Bank',            apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'IPOTEKA',      name: 'Ipoteka Bank',          apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'AGROBANK',     name: 'Agrobank',              apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'XALQ_BANK',    name: 'Xalq banki',            apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'MIKROKREDIT',  name: 'Mikrokreditbank',       apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'TURONBANK',    name: 'Turonbank',             apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'UZPSB',        name: 'UzPSB — Sanoat Qurilish bank', apiBaseUrl: null, apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'ALOQABANK',    name: 'Aloqabank',             apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'TRUSTBANK',    name: 'Trustbank',             apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'UNIVERSAL',    name: 'Universal Bank',        apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'DAVRBANK',     name: 'Davrbank',              apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'ANORBANK',     name: 'Anorbank',              apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'TBC',          name: 'TBC Bank',              apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'TENGE',        name: 'Tenge Bank',            apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'HAYOT',        name: 'Hayot Bank',            apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'ASIA_ALLIANCE', name: 'Asia Alliance Bank',   apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'GARANT',       name: 'Garant Bank',           apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'KDB',          name: 'KDB Bank Uzbekistan',   apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'SADERAT',      name: 'Saderat Bank',          apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'OFB',          name: 'OFB — Orient Finans',   apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'INFINBANK',    name: 'Infinbank',             apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'ZIRAAT',       name: 'Ziraat Bank Uzbekistan', apiBaseUrl: null, apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'CAPITAL_BANK', name: 'Capital Bank',          apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
  { code: 'YANGI_BANK',   name: 'Yangi Bank',            apiBaseUrl: null,  apiKind: 'KAPITALBANK_V3' as const, isActive: false },
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
    let updated = 0;
    for (const b of DEFAULT_BANKS) {
      const existing = await this.prisma.bank.findUnique({ where: { code: b.code } });
      if (!existing) {
        await this.prisma.bank.create({ data: b });
        added++;
        this.logger.log(`✓ Bank qo'shildi: ${b.name}`);
      } else if (existing.isActive !== b.isActive) {
        // Aktivlik holatini yangilash — faqat credentiallar yo'q bo'lsa
        const credCount = await this.prisma.bankCredential.count({
          where: { bankId: existing.id },
        });
        if (credCount === 0) {
          await this.prisma.bank.update({
            where: { code: b.code },
            data: { isActive: b.isActive },
          });
          updated++;
        }
      }
    }
    if (added > 0 || updated > 0) {
      this.logger.log(`🏦 Banks bootstrap: ${added} qo'shildi, ${updated} yangilandi`);
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
