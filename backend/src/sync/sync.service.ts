import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';
import { KbDoc1CItem } from '../integrations/kapitalbank/types';
import { TxnDirection, TxnStatus, TxnType, Prisma } from '@prisma/client';
import { format, parse, subDays } from 'date-fns';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly daysBack: number;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
    config: ConfigService,
  ) {
    this.daysBack = Number(config.get<string>('TXN_SYNC_DAYS_BACK', '1'));
  }

  /**
   * Cron har 5 daqiqada (default) — barcha faol credentiallar bo'yicha sync.
   * .env TXN_SYNC_CRON orqali boshqariladi.
   */
  @Cron(process.env.TXN_SYNC_CRON || '*/5 * * * *')
  async tick() {
    const creds = await this.prisma.bankCredential.findMany({
      where: { isActive: true, bank: { apiKind: 'KAPITALBANK_V3', isActive: true } },
      include: { bank: true, accounts: { where: { syncEnabled: true } } },
    });
    if (creds.length === 0) {
      this.logger.debug('Faol bank credential yo\'q — sync o\'tkazib yuborildi');
      return;
    }
    for (const c of creds) {
      for (const acc of c.accounts) {
        await this.syncAccount(c.id, acc.id).catch((e) =>
          this.logger.warn(`Sync xato (acc ${acc.accountNo}): ${e?.message}`),
        );
      }
    }
  }

  /** Bitta hisob bo'yicha sync (manual yoki cron'dan chaqiriladi). */
  async syncAccount(credentialId: string, accountId: string) {
    const cred = await this.prisma.bankCredential.findUnique({
      where: { id: credentialId },
      include: { bank: true },
    });
    if (!cred) throw new Error('Credential topilmadi');
    const acc = await this.prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new Error('Hisob topilmadi');
    if (cred.bank.apiKind !== 'KAPITALBANK_V3') {
      throw new Error('Hozircha faqat KAPITALBANK_V3 qo\'llab-quvvatlanadi');
    }

    const log = await this.prisma.syncLog.create({
      data: {
        source: `kb:${cred.id}`,
        accountId: acc.id,
        status: 'RUNNING',
      },
    });
    const t0 = Date.now();
    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;

    let fetched = 0;
    let saved = 0;
    let errors = 0;
    let errorMessage: string | null = null;

    try {
      for (let i = 0; i < Math.max(1, this.daysBack); i++) {
        const day = subDays(new Date(), i);
        const dateStr = format(day, 'dd.MM.yyyy');
        const result = await this.kb.getDoc1C({
          baseUrl: cred.bank.apiBaseUrl!,
          login,
          password,
          branch: acc.branch,
          account: acc.accountNo,
          date: dateStr,
          sid: cred.sid && cred.sidExpiresAt && cred.sidExpiresAt > new Date() ? cred.sid : undefined,
        });
        const items = result?.content || [];
        fetched += items.length;
        for (const item of items) {
          try {
            const ok = await this.upsertOne(item, acc.id, cred.bankId);
            if (ok) saved++;
          } catch (e: any) {
            errors++;
            this.logger.warn(`Upsert xato (${item.b2_id || item.general_id}): ${e?.message?.slice(0, 200)}`);
          }
        }
      }
      await this.prisma.bankAccount.update({
        where: { id: acc.id },
        data: { lastSyncedAt: new Date() },
      });
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: errors > 0 ? 'PARTIAL' : 'SUCCESS',
          fetched, saved, errors,
          finishedAt: new Date(),
          durationMs: Date.now() - t0,
        },
      });
      this.logger.log(`✓ ${acc.branch}/${acc.accountNo}: ${fetched} olindi, ${saved} saqlandi`);
    } catch (e: any) {
      errorMessage = e?.message?.slice(0, 500) || 'Noma\'lum xato';
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          fetched, saved, errors,
          errorMessage,
          finishedAt: new Date(),
          durationMs: Date.now() - t0,
        },
      });
      this.logger.error(`✗ Sync xato ${acc.branch}/${acc.accountNo}: ${errorMessage}`);
      throw e;
    }
    return { ok: true, fetched, saved, errors };
  }

  /**
   * KapitalBank doc → bizning Transaction modeli.
   * b2_id (bank bo'yicha noyob) externalId sifatida ishlatiladi.
   * Sumalar tiyin (10^-2) — amount Decimal(18,2) ga olib o'tamiz.
   */
  private async upsertOne(item: KbDoc1CItem, accountId: string, bankId: string): Promise<boolean> {
    const externalId = item.b2_id || item.general_id;
    if (!externalId) return false;

    // Ikkilanma yozuvni tekshiramiz
    const existing = await this.prisma.transaction.findUnique({ where: { externalId } });
    if (existing) return false;

    // sana
    const txnDate = this.parseKbDate(item.ddate) || new Date();
    // yo'nalish — PDF §9.7: 1 chiqim, 2 kirim
    const direction: TxnDirection = item.dir === 2 ? 'IN' : 'OUT';
    // status — PDF §9.1 (1 introduced, 2 approved, 3 proved, 6 deleted, 16 deferred)
    const status: TxnStatus = item.state === 3
      ? 'COMPLETED'
      : item.state === 6 ? 'CANCELLED'
      : item.state === 16 ? 'PENDING'
      : 'COMPLETED';
    // tur — purpose_code yoki dtype'dan taxminiy
    const type: TxnType = this.guessType(item.purp_code, item.dtype);
    // tiyin → so'm (amount Decimal)
    const amountSom = new Prisma.Decimal((item.amount ?? 0) / 100);

    await this.prisma.transaction.create({
      data: {
        externalId,
        type,
        status,
        direction,
        amount: amountSom,
        currency: 'UZS',
        fromMfo: item.mfo_dt,
        fromAccount: item.acc_dt,
        fromName: item.name_dt,
        fromInn: item.inn_dt,
        toMfo: item.mfo_ct,
        toAccount: item.acc_ct,
        toName: item.name_ct,
        toInn: item.inn_ct,
        description: item.purpose,
        reference: item.uniq || null,
        purposeCode: item.purp_code,
        docNumber: item.num,
        docType: item.dtype,
        metadata: item as any,
        bankId,
        accountId,
        txnDate,
      },
    });
    return true;
  }

  private parseKbDate(s?: string): Date | null {
    if (!s) return null;
    try {
      return parse(s, 'dd.MM.yyyy', new Date());
    } catch {
      return null;
    }
  }

  private guessType(purpCode?: string, dtype?: string): TxnType {
    // PDF §9.6 dtype: 01,35 — to'lov; 16 — SWIFT; 97 — karta; 98 — kazna; 99 — byudjet
    if (dtype === '99') return 'TAX';
    if (dtype === '98') return 'TAX';
    if (dtype === '97') return 'PAYMENT';
    // Zarplata kodi taxminan 00634
    if (purpCode === '00634') return 'SALARY';
    if (dtype === '21' || dtype === '01' || dtype === '35') return 'TRANSFER';
    return 'OTHER';
  }
}
