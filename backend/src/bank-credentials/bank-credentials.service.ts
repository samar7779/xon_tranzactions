import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CreateCredentialDto, UpdateCredentialDto } from './dto/credential.dto';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';

@Injectable()
export class BankCredentialsService {
  private readonly logger = new Logger(BankCredentialsService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
  ) {}

  private mask(c: any) {
    const { passwordEnc, ...rest } = c;
    return rest;
  }

  async list(bankId?: string) {
    const items = await this.prisma.bankCredential.findMany({
      where: bankId ? { bankId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        bank: { select: { id: true, code: true, name: true, apiKind: true, apiBaseUrl: true } },
        _count: { select: { accounts: true } },
      },
    });
    return { ok: true, items: items.map((c) => this.mask(c)) };
  }

  async get(id: string) {
    const c = await this.prisma.bankCredential.findUnique({
      where: { id },
      include: {
        bank: true,
        accounts: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!c) throw new NotFoundException('Credential topilmadi');
    return this.mask(c);
  }

  async create(dto: CreateCredentialDto) {
    const bank = await this.prisma.bank.findUnique({ where: { id: dto.bankId } });
    if (!bank) throw new NotFoundException('Bank topilmadi');
    const passwordEnc = this.crypto.encrypt(dto.password);
    const cred = await this.prisma.bankCredential.create({
      data: {
        bankId: dto.bankId,
        label: dto.label,
        loginPrefix: dto.loginPrefix,
        loginName: dto.loginName,
        passwordEnc,
        clientIdExt: dto.clientIdExt,
        branch: dto.branch,
        authMode: dto.authMode || 'IP_WHITELIST',
        isActive: dto.isActive ?? true,
        useProxy: dto.useProxy ?? false,
      },
    });
    return { ok: true, credential: this.mask(cred) };
  }

  async update(id: string, dto: UpdateCredentialDto) {
    const exists = await this.prisma.bankCredential.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('Credential topilmadi');
    const data: any = {};
    if (dto.bankId !== undefined) data.bankId = dto.bankId;
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.loginPrefix !== undefined) data.loginPrefix = dto.loginPrefix;
    if (dto.loginName !== undefined) data.loginName = dto.loginName;
    if (dto.password !== undefined) data.passwordEnc = this.crypto.encrypt(dto.password);
    if (dto.clientIdExt !== undefined) data.clientIdExt = dto.clientIdExt;
    if (dto.branch !== undefined) data.branch = dto.branch;
    if (dto.authMode !== undefined) data.authMode = dto.authMode;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.useProxy !== undefined) data.useProxy = dto.useProxy;
    const cred = await this.prisma.bankCredential.update({ where: { id }, data });
    return { ok: true, credential: this.mask(cred) };
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.bankCredential.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Test: credential bilan bankka APILogin chaqirib ko'rish.
   * KapitalBank V3 uchun. Muvaffaqiyat bo'lsa clientIdExt ham auto-fill qilinadi.
   */
  async testConnection(id: string) {
    const c = await this.prisma.bankCredential.findUnique({
      where: { id },
      include: { bank: true },
    });
    if (!c) throw new NotFoundException('Credential topilmadi');
    if (c.bank.apiKind !== 'KAPITALBANK_V3') {
      throw new BadRequestException('Hozircha faqat KAPITALBANK_V3 qo\'llab-quvvatlanadi');
    }
    const password = this.crypto.decrypt(c.passwordEnc);
    const login = (c.loginPrefix || '') + c.loginName;
    try {
      const result = await this.kb.apiLogin({
        baseUrl: c.bank.apiBaseUrl!,
        login,
        password,
        useProxy: c.useProxy === true,
      });
      const updates: any = {
        lastVerifiedAt: new Date(),
        lastError: null,
      };
      if (result?.sid) {
        updates.sid = result.sid;
        // SID muddati taxminan 1 soat — biz konservativ 30 daqiqa qo'yamiz
        updates.sidExpiresAt = new Date(Date.now() + 30 * 60 * 1000);
      }
      // birinchi client'ning id'sini saqlab qo'yamiz (agar topilsa)
      const firstClient = result?.clients?.[0];
      if (firstClient?.id) {
        updates.clientIdExt = String(firstClient.id);
        if (firstClient.branch && !c.branch) updates.branch = firstClient.branch;
      }
      await this.prisma.bankCredential.update({ where: { id }, data: updates });
      return {
        ok: true,
        clients: (result?.clients || []).map((cl: any) => ({
          id: cl.id,
          branch: cl.branch,
          code: cl.code,
          name: cl.name,
          inn: cl.inn,
          accounts: (cl.accounts || []).map((a: any) => ({
            aid: a.aid, branch: a.branch, account: a.account,
            name: a.name, val: a.val, s_out: a.s_out, state: a.state,
          })),
        })),
      };
    } catch (e: any) {
      const msg = e?.message?.slice(0, 500) || 'Noma\'lum xato';
      await this.prisma.bankCredential.update({
        where: { id },
        data: { lastError: msg, lastVerifiedAt: new Date() },
      });
      throw new BadRequestException(`Bankga ulanib bo'lmadi: ${msg}`);
    }
  }

  /** Faqat ichki ishlatish uchun — sync service'ga parolni dekriptlangan holda berish. */
  async loadDecrypted(id: string) {
    const c = await this.prisma.bankCredential.findUnique({
      where: { id },
      include: { bank: true },
    });
    if (!c) throw new NotFoundException('Credential topilmadi');
    return { ...c, password: this.crypto.decrypt(c.passwordEnc) };
  }

  /**
   * Parolni ochiq holda qaytaradi (admin recovery uchun).
   * Faqat SUPERADMIN chaqira oladi (RBAC controller'da tekshiriladi).
   * Log'ga yoziladi.
   */
  async revealPassword(id: string) {
    const c = await this.prisma.bankCredential.findUnique({
      where: { id },
      include: { bank: { select: { name: true, code: true } } },
    });
    if (!c) throw new NotFoundException('Credential topilmadi');
    const password = this.crypto.decrypt(c.passwordEnc);
    this.logger.warn(`🔓 Parol ochildi: credential=${c.id} (${c.label}, bank=${c.bank.code})`);
    return {
      ok: true,
      label: c.label,
      bank: c.bank.name,
      loginFull: (c.loginPrefix || '') + c.loginName,
      branch: c.branch,
      password,
    };
  }
}
