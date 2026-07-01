import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';
import { CreateChekDto, UpdateChekDto } from './dto/chek.dto';

type Actor = { id?: string | null; name?: string | null };

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
