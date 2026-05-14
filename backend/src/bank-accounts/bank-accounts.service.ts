import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';

@Injectable()
export class BankAccountsService {
  constructor(private prisma: PrismaService) {}

  // Barcha hisoblarni Excel'ga: hisob raqami, bank nomi, MFO, hisob nomi
  async exportXlsx(): Promise<{ buffer: Buffer; filename: string }> {
    const items = await this.prisma.bankAccount.findMany({
      orderBy: [{ accountNo: 'asc' }],
      include: { bank: { select: { name: true } } },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Xon Tranzaksiyalar';
    wb.created = new Date();
    const ws = wb.addWorksheet('Hisoblar');
    ws.columns = [
      { header: 'Hisob raqami', key: 'accountNo', width: 26 },
      { header: 'Bank nomi', key: 'bankName', width: 24 },
      { header: 'MFO', key: 'branch', width: 10 },
      { header: 'Hisob nomi', key: 'ownerName', width: 44 },
    ];
    const headRow = ws.getRow(1);
    headRow.font = { bold: true, size: 11 };
    headRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
    headRow.eachCell((c) => {
      c.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    for (const a of items) {
      const row = ws.addRow({
        accountNo: a.accountNo,
        bankName: a.bank?.name || '',
        branch: a.branch,
        ownerName: a.ownerName || '',
      });
      row.eachCell((c) => {
        c.font = { size: 10 };
        c.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      });
    }

    const raw = await wb.xlsx.writeBuffer();
    const buffer: Buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    const filename = `hisoblar_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return { buffer, filename };
  }

  async list(credentialId?: string) {
    const items = await this.prisma.bankAccount.findMany({
      where: credentialId ? { credentialId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        bank: { select: { id: true, code: true, name: true } },
        credential: { select: { id: true, label: true } },
        _count: { select: { transactions: true } },
      },
    });
    return { ok: true, items };
  }

  async get(id: string) {
    const acc = await this.prisma.bankAccount.findUnique({
      where: { id },
      include: { bank: true, credential: { select: { id: true, label: true } } },
    });
    if (!acc) throw new NotFoundException('Hisob topilmadi');
    return acc;
  }

  async create(dto: CreateAccountDto) {
    const cred = await this.prisma.bankCredential.findUnique({ where: { id: dto.credentialId } });
    if (!cred) throw new NotFoundException('Credential topilmadi');
    const dup = await this.prisma.bankAccount.findUnique({
      where: { branch_accountNo: { branch: dto.branch, accountNo: dto.accountNo } },
    });
    if (dup) throw new ConflictException('Bu hisob allaqachon qo\'shilgan');
    const acc = await this.prisma.bankAccount.create({
      data: {
        credentialId: dto.credentialId,
        bankId: cred.bankId,
        branch: dto.branch,
        accountNo: dto.accountNo,
        ownerName: dto.ownerName,
        currency: dto.currency || 'UZS',
        syncEnabled: dto.syncEnabled ?? true,
      },
    });
    return { ok: true, account: acc };
  }

  async update(id: string, dto: UpdateAccountDto) {
    await this.get(id);
    const acc = await this.prisma.bankAccount.update({
      where: { id },
      data: {
        ownerName: dto.ownerName,
        currency: dto.currency,
        syncEnabled: dto.syncEnabled,
      },
    });
    return { ok: true, account: acc };
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.bankAccount.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Ko'p hisoblarni bir vaqtda qo'shish.
   * Mavjud bo'lganlari skip qilinadi (duplicate xato chiqarmaydi).
   */
  async bulkCreate(dto: {
    credentialId: string;
    branch?: string;
    currency?: string;
    // Har bir hisob o'z branch/currency'sini ham olib kelishi mumkin (API Explorer uchun)
    accounts: { accountNo: string; ownerName?: string; branch?: string; currency?: string }[];
  }) {
    const cred = await this.prisma.bankCredential.findUnique({ where: { id: dto.credentialId } });
    if (!cred) throw new NotFoundException('Credential topilmadi');

    const defBranch = dto.branch || '';
    const defCurrency = dto.currency || 'UZS';

    let added = 0;
    let skipped = 0;
    const errors: { accountNo: string; error: string }[] = [];

    for (const a of dto.accounts) {
      const accountNo = (a.accountNo || '').replace(/\D/g, '');
      if (accountNo.length !== 20) {
        errors.push({ accountNo: a.accountNo, error: '20 belgi bo\'lishi kerak' });
        continue;
      }
      const branch = (a.branch || defBranch || '').padStart(5, '0');
      const currency = a.currency || defCurrency;
      try {
        const existing = await this.prisma.bankAccount.findUnique({
          where: { branch_accountNo: { branch, accountNo } },
        });
        if (existing) {
          skipped++;
          continue;
        }
        await this.prisma.bankAccount.create({
          data: {
            credentialId: dto.credentialId,
            bankId: cred.bankId,
            branch,
            accountNo,
            ownerName: a.ownerName?.trim() || null,
            currency,
            syncEnabled: true,
          },
        });
        added++;
      } catch (e: any) {
        errors.push({ accountNo: a.accountNo, error: e?.message?.slice(0, 100) || 'xato' });
      }
    }

    return { ok: true, added, skipped, errors, total: dto.accounts.length };
  }
}
