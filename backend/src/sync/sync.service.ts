import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';
import { KbDoc1CItem } from '../integrations/kapitalbank/types';
import { PaymentsService } from '../payments/payments.service';
import { TxnDirection, TxnStatus, TxnType, Prisma } from '@prisma/client';
import { format, parse, subDays } from 'date-fns';

// Bank javobining ma'lum (mapped) fieldlari — Python kodingiz bilan moslangan.
// Bu set'da bo'lmagan har qanday field rawExtra JSON'iga tushadi.
const KNOWN_FIELDS = new Set([
  'time', 'input_date', 'input_time', 'client_id', 'num', 'branch',
  'general_id', 'b2_id', 'uniq', 'ddate', 'vdate', 'stime',
  'mfo_dt', 'acc_dt', 'name_dt', 'inn_dt',
  'mfo_ct', 'acc_ct', 'name_ct', 'inn_ct',
  'purpose', 'purp_code', 'amount', 'dtype', 'state', 'dir',
  'err', 'err_msg', 'anor',
]);

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private readonly daysBack: number;
  private readonly tgToken: string;
  private readonly tgChat: string;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
    private payments: PaymentsService,
    config: ConfigService,
  ) {
    this.daysBack = Number(config.get<string>('TXN_SYNC_DAYS_BACK', '1'));
    this.tgToken = config.get<string>('TG_BOT_TOKEN', '');
    this.tgChat = config.get<string>('DEPLOY_NOTIFY_CHAT', '');
  }

  /** Telegram'ga xabar yuborish (sync xatolari uchun) */
  private async sendTelegram(text: string) {
    if (!this.tgToken || !this.tgChat) return;
    try {
      await fetch(`https://api.telegram.org/bot${this.tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: this.tgChat, parse_mode: 'HTML', text }),
      });
    } catch (e: any) {
      this.logger.warn(`Telegram yuborishda xato: ${e?.message}`);
    }
  }

  /**
   * Composite tranzaksiya ID — Python kodi formatiga to'liq mos:
   *   {general_id}_{num}_{ddate}_{acc_ct}_{acc_dt}_{amount}_{sign}
   * sign = '+' agar bizning hisob acc_dt bo'lsa (chiqim), aks holda '-'
   */
  private makeCompositeId(item: KbDoc1CItem, ourAccount: string): string {
    const sign = item.acc_dt === ourAccount ? '+' : '-';
    return [
      item.general_id || 'no_general_id',
      String(item.num || 'no_num'),
      item.ddate || 'no_date',
      item.acc_ct || 'no_acc_ct',
      item.acc_dt || 'no_acc_dt',
      item.amount != null ? String(item.amount) : 'no_amount',
      sign,
    ].join('_');
  }

  /** Bank javobida bizga noma'lum fieldlar — rawExtra'ga */
  private extractRawExtra(item: any): Prisma.InputJsonValue | null {
    const extra: Record<string, any> = {};
    for (const [k, v] of Object.entries(item)) {
      if (!KNOWN_FIELDS.has(k)) extra[k] = v;
    }
    return Object.keys(extra).length > 0 ? extra : null;
  }

  /**
   * Cron har 5 daqiqada (default) — barcha faol credentiallar bo'yicha sync.
   * Eski stuck sid'larni ham tozalaydi (#60101 oldini oladi).
   */
  @Cron(process.env.TXN_SYNC_CRON || '*/5 * * * *')
  async tick() {
    // Muddati o'tgan sid'larni tozalash
    await this.prisma.bankCredential.updateMany({
      where: { sid: { not: null }, sidExpiresAt: { lt: new Date() } },
      data: { sid: null, sidExpiresAt: null },
    });

    const creds = await this.prisma.bankCredential.findMany({
      where: { isActive: true, bank: { apiKind: 'KAPITALBANK_V3', isActive: true } },
      include: { bank: true, accounts: { where: { syncEnabled: true } } },
    });
    if (creds.length === 0) {
      this.logger.debug('Faol bank credential yo\'q — sync o\'tkazib yuborildi');
      return;
    }

    const okList: string[] = [];
    const failList: { account: string; owner: string; error: string }[] = [];
    let totalSaved = 0;

    for (const c of creds) {
      for (const acc of c.accounts) {
        try {
          const r = await this.syncAccount(c.id, acc.id);
          okList.push(acc.accountNo);
          totalSaved += r.saved || 0;
        } catch (e: any) {
          const errMsg = e?.message?.slice(0, 150) || 'Noma\'lum xato';
          this.logger.warn(`Sync xato (acc ${acc.accountNo}): ${errMsg}`);
          failList.push({
            account: acc.accountNo,
            owner: acc.ownerName || '—',
            error: errMsg,
          });
        }
      }
    }

    // Telegram xulosa — faqat xato bo'lsa yoki yangi tranzaksiya kelsa
    if (failList.length > 0 || totalSaved > 0) {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      let msg = `🔄 <b>Sync xulosa</b> — ${okList.length} ✅ / ${failList.length} ❌`;
      if (totalSaved > 0) msg += `\n💾 ${totalSaved} ta yangi tranzaksiya`;
      if (failList.length > 0) {
        msg += `\n\n<b>Xato hisoblar:</b>`;
        for (const f of failList.slice(0, 15)) {
          msg += `\n• <code>${f.account}</code> ${esc(f.owner)}\n  ⚠️ ${esc(f.error)}`;
        }
        if (failList.length > 15) msg += `\n… va yana ${failList.length - 15} ta`;
      }
      await this.sendTelegram(msg);
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

    // Source'da hisob raqami ko'rsatiladi — qaysi hisobda xato bo'lganini aniqlash uchun
    const log = await this.prisma.syncLog.create({
      data: {
        source: `${acc.accountNo}${acc.ownerName ? ' · ' + acc.ownerName : ''}`,
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

    let latestSaldoOut: number | null = null;
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
          // sid o'tkazib yubormaymiz — har so'rovda yangi Basic Auth (#60101 'Session expired' xatosini oldini oladi)
          useProxy: cred.useProxy === true,
        });
        const items = result?.content || [];
        fetched += items.length;
        // i=0 (bugungi kun) saldo_out — eng oxirgi qoldiq
        if (i === 0 && result?.saldo_out != null) {
          latestSaldoOut = Number(result.saldo_out);
        }
        for (const item of items) {
          try {
            const ok = await this.upsertOne(item, acc.id, acc.accountNo, cred.bankId);
            if (ok) saved++;
          } catch (e: any) {
            errors++;
            this.logger.warn(`Upsert xato (${item.b2_id || item.general_id}): ${e?.message?.slice(0, 200)}`);
          }
        }
      }

      // Qoldiqni ham yangilash: GetDoc1C dan saldo_out (yopuvchi qoldiq) — tiyin → so'm
      let balanceSom: Prisma.Decimal | undefined;
      if (latestSaldoOut != null) {
        balanceSom = new Prisma.Decimal(latestSaldoOut / 100);
      }
      // GetAcc1C ni faqat saldo_out bo'lmasa va xato bo'lsa ham sync to'xtamasin
      if (balanceSom === undefined) {
        try {
          const accInfo = await this.kb.getAcc1C({
            baseUrl: cred.bank.apiBaseUrl!,
            login,
            password,
            branch: acc.branch,
            account: acc.accountNo,
            useProxy: cred.useProxy === true,
          });
          const found = (accInfo || []).find((a: any) => a.account === acc.accountNo);
          if (found && found.s_out != null) {
            balanceSom = new Prisma.Decimal(Number(found.s_out) / 100);
          }
        } catch (e: any) {
          this.logger.warn(`GetAcc1C qoldiq olishda xato (jiddiy emas): ${e?.message}`);
        }
      }

      await this.prisma.bankAccount.update({
        where: { id: acc.id },
        data: {
          lastSyncedAt: new Date(),
          ...(balanceSom !== undefined ? { balance: balanceSom } : {}),
        },
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
   * externalId = composite (Python kodi formati):
   *   {general_id}_{num}_{ddate}_{acc_ct}_{acc_dt}_{amount}_{sign}
   *
   * Barcha 29 field saqlanadi (alohida column'lar) + bilmagan fieldlar rawExtra JSON'ga.
   * Hech qanday ma'lumot yo'qolmaydi.
   */
  private async upsertOne(
    item: KbDoc1CItem,
    accountId: string,
    accountNo: string,
    bankId: string,
  ): Promise<boolean> {
    if (!item.general_id && !item.b2_id) return false;

    const externalId = this.makeCompositeId(item, accountNo);

    // Mavjudligini tekshirish: yangi composite ID yoki eski format (b2_id/general_id)
    const existing = await this.prisma.transaction.findFirst({
      where: {
        OR: [
          { externalId },
          { externalId: item.b2_id || undefined },
          { externalId: item.general_id || undefined },
          { bankB2Id: item.b2_id || undefined },
        ],
      },
    });
    if (existing) return false;

    // Sanalar
    const txnDate = this.parseKbDate(item.ddate) || new Date();
    const valueDate = this.parseKbDate(item.vdate);
    const inputAt = this.parseKbDateTime(item.input_date, item.input_time);

    // Yo'nalish: PDF §9.7: 1 chiqim, 2 kirim
    const direction: TxnDirection = item.dir === 2 ? 'IN' : 'OUT';

    // Holat: PDF §9.1 (1 introduced, 2 approved, 3 proved, 6 deleted, 16 deferred)
    const status: TxnStatus =
      item.state === 3 ? 'COMPLETED'
        : item.state === 6 ? 'CANCELLED'
        : item.state === 16 ? 'PENDING'
        : 'COMPLETED';

    const type: TxnType = this.guessType(item.purp_code, item.dtype);
    const amountSom = new Prisma.Decimal((item.amount ?? 0) / 100);

    const rawExtra = this.extractRawExtra(item);

    const created = await this.prisma.transaction.create({
      data: {
        externalId,
        type,
        status,
        direction,
        amount: amountSom,
        currency: 'UZS',

        // Yuboruvchi
        fromMfo: item.mfo_dt,
        fromAccount: item.acc_dt,
        fromName: item.name_dt,
        fromInn: item.inn_dt,

        // Qabul qiluvchi
        toMfo: item.mfo_ct,
        toAccount: item.acc_ct,
        toName: item.name_ct,
        toInn: item.inn_ct,

        // Tafsilot
        description: item.purpose,
        reference: item.uniq || null,
        purposeCode: item.purp_code,
        docNumber: item.num,
        docType: item.dtype,

        // Bank ID'lari (alohida column)
        bankGeneralId: item.general_id,
        bankB2Id: item.b2_id,

        // Bank ichki
        bankClientId: item.client_id != null ? String(item.client_id) : null,
        bankBranch: item.branch,

        // Vaqtlar (qo'shimcha)
        valueDate,
        operationTime: item.time,
        settlementTime: item.stime,
        inputAt,

        // Anor va xato
        isAnor: item.anor === 1,
        bankErrCode: item.err,
        bankErrMsg: item.err_msg,

        // Raw va ekstra
        metadata: item as any,
        rawExtra: rawExtra as any,

        // Bog'lanish
        bankId,
        accountId,
        txnDate,
      },
    });

    // Billing avto-match: faqat kirim tranzaksiya uchun, INN orqali mijoz qidirib
    if (direction === 'IN' && item.inn_dt) {
      try {
        const r = await this.payments.autoMatch(created.id);
        if (r.ok) {
          this.logger.log(`💰 Auto-match: ${item.inn_dt} → ${(r as any).customer?.name}`);
        }
      } catch (e: any) {
        this.logger.warn(`Auto-match xato (${created.id}): ${e?.message}`);
      }
    }
    return true;
  }

  /** "dd.MM.yyyy" → Date */
  private parseKbDate(s?: string): Date | null {
    if (!s) return null;
    try {
      return parse(s, 'dd.MM.yyyy', new Date());
    } catch {
      return null;
    }
  }

  /** "dd.MM.yyyy" + "HH:mm:ss" → Date */
  private parseKbDateTime(d?: string, t?: string): Date | null {
    if (!d) return null;
    try {
      const dateStr = t ? `${d} ${t}` : d;
      const fmt = t ? 'dd.MM.yyyy HH:mm:ss' : 'dd.MM.yyyy';
      return parse(dateStr, fmt, new Date());
    } catch {
      return null;
    }
  }

  private guessType(purpCode?: string, dtype?: string): TxnType {
    // PDF §9.6 dtype: 01,35 — to'lov; 16 — SWIFT; 97 — karta; 98 — kazna; 99 — byudjet
    if (dtype === '99') return 'TAX';
    if (dtype === '98') return 'TAX';
    if (dtype === '97') return 'PAYMENT';
    if (purpCode === '00634') return 'SALARY';
    if (dtype === '21' || dtype === '01' || dtype === '35') return 'TRANSFER';
    return 'OTHER';
  }
}
