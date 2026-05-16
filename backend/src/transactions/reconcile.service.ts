import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';

const DAY_MS = 86_400_000;
const MAX_DAYS = 92;
// 1 so'mgacha farq — yaxlitlash xatosi deb hisoblanadi, "mos" sanaladi
const EPSILON = 1;

/**
 * Hisob sverkasi (reconciliation).
 *
 * Bankdan sana oralig'i uchun: ochilish/yopilish saldosi + debet/kredit oborotini
 * oladi (GetDoc1C, kunma-kun). Bizning DB'dagi tranzaksiya summalari bilan
 * solishtiradi — yetishmayotgan yoki ortiqcha yozuvlarni aniqlaydi.
 *
 * Birliklar: bank API tiyin qaytaradi (×100), bizning DB so'mda saqlaydi.
 */
@Injectable()
export class ReconcileService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
  ) {}

  async reconcile(accountId: string, dateFrom: string, dateTo: string) {
    if (!accountId) throw new BadRequestException('accountId kerak');
    if (!dateFrom || !dateTo) throw new BadRequestException('dateFrom va dateTo kerak');

    const account = await this.prisma.bankAccount.findUnique({
      where: { id: accountId },
      include: { bank: true, credential: { include: { bank: true } } },
    });
    if (!account) throw new NotFoundException('Hisob topilmadi');

    const cred = account.credential;
    if (!cred) throw new BadRequestException('Hisobga bank ulanishi biriktirilmagan');
    const bank = cred.bank;
    if (bank.apiKind !== 'KAPITALBANK_V3') {
      throw new BadRequestException('Sverka hozircha faqat KAPITALBANK_V3 banklar uchun');
    }
    if (!bank.apiBaseUrl) throw new BadRequestException('Bank API manzili sozlanmagan');

    // Sana stringlari (YYYY-MM-DD) Tashkent kunlari sifatida talqin qilinadi
    const from = new Date(`${dateFrom}T00:00:00+05:00`);
    const to   = new Date(`${dateTo}T00:00:00+05:00`);
    const days = Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
    if (days < 1) throw new BadRequestException("dateFrom dateTo dan keyin bo'lmasligi kerak");
    if (days > MAX_DAYS) throw new BadRequestException(`Davr ${MAX_DAYS} kundan oshmasligi kerak`);

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;

    // ── Bankdan kunma-kun: ochilish/yopilish saldosi + oborotlar ──
    let saldoInTiyin: number | null = null;   // birinchi muvaffaqiyatli kun
    let saldoOutTiyin: number | null = null;  // oxirgi muvaffaqiyatli kun
    let totalDebitTiyin = 0;
    let totalCreditTiyin = 0;
    let failedDays = 0;
    let lastError: any = null;

    for (let i = 0; i < days; i++) {
      const day = new Date(from.getTime() + i * DAY_MS);
      const dateStr = this.fmtDate(day);
      try {
        const result = await this.kb.getDoc1C({
          baseUrl: bank.apiBaseUrl,
          login,
          password,
          branch: account.branch,
          account: account.accountNo,
          date: dateStr,
          useProxy: cred.useProxy === true,
        });
        if (saldoInTiyin === null && result?.saldo_in != null) {
          saldoInTiyin = Number(result.saldo_in);
        }
        if (result?.saldo_out != null) saldoOutTiyin = Number(result.saldo_out);
        if (result?.total_debit != null) totalDebitTiyin += Number(result.total_debit);
        if (result?.total_credit != null) totalCreditTiyin += Number(result.total_credit);
      } catch (e: any) {
        // Dam olish/non-operatsion kunlar xato berishi mumkin — o'tkazib yuboramiz
        failedDays++;
        lastError = e;
      }
    }
    if (failedDays === days) {
      throw new BadRequestException(
        `Bankdan ma'lumot olinmadi: ${lastError?.message || "noma'lum xato"}`,
      );
    }

    // tiyin → so'm
    const bankOpening = (saldoInTiyin ?? 0) / 100;
    const bankClosing = (saldoOutTiyin ?? 0) / 100;
    const bankDebit = totalDebitTiyin / 100;    // chiqim oboroti
    const bankCredit = totalCreditTiyin / 100;  // kirim oboroti

    // ── Bizning DB: shu hisob, shu oraliqdagi tranzaksiya summalari ──
    const start = new Date(`${dateFrom}T00:00:00+05:00`);
    const end   = new Date(`${dateTo}T23:59:59.999+05:00`);
    const grouped = await this.prisma.transaction.groupBy({
      by: ['direction'],
      where: { accountId, txnDate: { gte: start, lte: end } },
      _sum: { amount: true },
      _count: true,
    });
    let dbInflow = 0, dbOutflow = 0, dbInCount = 0, dbOutCount = 0;
    for (const g of grouped) {
      if (g.direction === 'IN') {
        dbInflow = Number(g._sum.amount || 0);
        dbInCount = g._count;
      } else if (g.direction === 'OUT') {
        dbOutflow = Number(g._sum.amount || 0);
        dbOutCount = g._count;
      }
    }

    // ── Solishtirish ──
    const creditDiff = bankCredit - dbInflow;   // bank kirim oboroti − bizdagi kirim
    const debitDiff = bankDebit - dbOutflow;    // bank chiqim oboroti − bizdagi chiqim
    const computedClosing = bankOpening + dbInflow - dbOutflow;
    const formulaDiff = bankClosing - computedClosing;

    const ok =
      Math.abs(creditDiff) < EPSILON &&
      Math.abs(debitDiff) < EPSILON &&
      Math.abs(formulaDiff) < EPSILON;

    return {
      ok: true,
      accountId,
      accountNo: account.accountNo,
      ownerName: account.ownerName,
      bankName: bank.name,
      dateFrom,
      dateTo,
      partial: failedDays > 0,
      failedDays,
      bank: {
        opening: bankOpening,
        closing: bankClosing,
        debit: bankDebit,
        credit: bankCredit,
      },
      db: {
        inflow: dbInflow,
        outflow: dbOutflow,
        inCount: dbInCount,
        outCount: dbOutCount,
      },
      diff: {
        credit: creditDiff,
        debit: debitDiff,
        formula: formulaDiff,
        computedClosing,
      },
      status: ok ? 'ok' : 'mismatch',
    };
  }

  private fmtDate(d: Date): string {
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
  }
}
