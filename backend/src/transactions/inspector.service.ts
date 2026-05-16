import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';
import { KbDoc1CItem } from '../integrations/kapitalbank/types';

/**
 * Bitta tranzaksiya ID'sini parse qilib, bankdan o'sha kun GetDoc1C'ni
 * so'rab, mos yozuvni topadi.
 *
 * Kompozit ID format (sync.service makeCompositeId bilan teng):
 *   [IP_]{general_id}_{num}_{ddate}_{acc_ct}_{acc_dt}_{amount}_{sign}
 *
 * sign='+' bo'lsa — bizning hisob acc_dt (sync paytida shunday yozilgan),
 * '-' bo'lsa — acc_ct.
 */
@Injectable()
export class InspectorService {
  private readonly log = new Logger(InspectorService.name);

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private kb: KapitalbankClient,
  ) {}

  /** Composite ID'ni komponentlarga ajratish. */
  parseId(rawId: string): {
    bankPrefix: 'IP' | null;
    generalId: string;
    num: string;
    ddate: string;
    accCt: string;
    accDt: string;
    amountTiyin: string;
    sign: '+' | '-';
    ourAccount: string;
  } {
    if (!rawId || typeof rawId !== 'string') {
      throw new BadRequestException("ID bo'sh");
    }
    let id = rawId.trim();
    let bankPrefix: 'IP' | null = null;
    if (id.startsWith('IP_')) {
      bankPrefix = 'IP';
      id = id.slice(3);
    }
    const parts = id.split('_');
    if (parts.length < 7) {
      throw new BadRequestException(
        `ID format noto'g'ri (kutilgan 7 ta qism, kelgan ${parts.length}): ${rawId}`,
      );
    }
    const [generalId, num, ddate, accCt, accDt, amountTiyin, sign] = parts;
    if (sign !== '+' && sign !== '-') {
      throw new BadRequestException(`Sign noto'g'ri ("${sign}") — '+' yoki '-' bo'lishi kerak`);
    }
    return {
      bankPrefix,
      generalId,
      num,
      ddate,
      accCt,
      accDt,
      amountTiyin,
      sign,
      ourAccount: sign === '+' ? accDt : accCt,
    };
  }

  /**
   * ID bo'yicha bankka so'rov yuborib, mos yozuvni topadi.
   * Faqat bank API natijasi qaytariladi (DB tekshirilmaydi).
   */
  async lookupFromBank(rawId: string) {
    const parsed = this.parseId(rawId);

    // Bizning DB'dan account topamiz (credentials kerak)
    const account = await this.prisma.bankAccount.findFirst({
      where: { accountNo: parsed.ourAccount },
      include: { bank: true, credential: { include: { bank: true } } },
    });
    if (!account) {
      throw new NotFoundException(
        `Bizning DB'da ${parsed.ourAccount} hisobi topilmadi — bankdan ham so'ray olmaymiz`,
      );
    }
    const cred = account.credential;
    if (!cred) {
      throw new BadRequestException(
        `${parsed.ourAccount} hisobiga bank ulanishi biriktirilmagan`,
      );
    }
    const bank = cred.bank;
    if (bank.apiKind !== 'KAPITALBANK_V3') {
      throw new BadRequestException(
        `Hozircha faqat KAPITALBANK_V3 banklar uchun — bu ${bank.apiKind}`,
      );
    }
    if (!bank.apiBaseUrl) {
      throw new BadRequestException("Bank API URL'i sozlanmagan");
    }

    const password = this.crypto.decrypt(cred.passwordEnc);
    const login = (cred.loginPrefix || '') + cred.loginName;

    // ── Bankdan o'sha kunni so'raymiz ──
    let items: KbDoc1CItem[] = [];
    let bankError: string | null = null;
    let saldoIn: number | null = null;
    let saldoOut: number | null = null;
    try {
      const result = await this.kb.getDoc1C({
        baseUrl: bank.apiBaseUrl,
        login,
        password,
        branch: account.branch,
        account: account.accountNo,
        date: parsed.ddate,
        useProxy: cred.useProxy === true,
      });
      items = result?.content || [];
      saldoIn = result?.saldo_in ?? null;
      saldoOut = result?.saldo_out ?? null;
    } catch (e: any) {
      bankError = e?.message || 'Noma\'lum bank xatosi';
    }

    // Mos yozuvni topish — avval general_id bo'yicha, keyin num bo'yicha
    const matchByGeneralId = items.find((it) => it.general_id === parsed.generalId);
    const matchByNum = matchByGeneralId
      ? null
      : items.find(
          (it) => String(it.num) === parsed.num && it.ddate === parsed.ddate,
        );
    const matchByAmount = matchByGeneralId || matchByNum
      ? null
      : items.find(
          (it) =>
            String(it.amount) === parsed.amountTiyin &&
            it.acc_ct === parsed.accCt &&
            it.acc_dt === parsed.accDt,
        );

    const found = matchByGeneralId || matchByNum || matchByAmount || null;
    const matchedBy = matchByGeneralId
      ? 'general_id'
      : matchByNum
      ? 'num'
      : matchByAmount
      ? 'amount+accounts'
      : null;

    return {
      ok: true,
      id: rawId,
      parsed: {
        generalId: parsed.generalId,
        num: parsed.num,
        ddate: parsed.ddate,
        accCt: parsed.accCt,
        accDt: parsed.accDt,
        amountSom: Number(parsed.amountTiyin) / 100,
        direction: parsed.sign === '+' ? 'OUT (chiqim)' : 'IN (kirim)',
        ourAccount: parsed.ourAccount,
      },
      account: {
        id: account.id,
        accountNo: account.accountNo,
        ownerName: account.ownerName,
        branch: account.branch,
        bank: { code: account.bank?.code, name: account.bank?.name },
      },
      bankError,
      bankResponse: {
        totalItemsThatDay: items.length,
        saldoInSom: saldoIn != null ? Number(saldoIn) / 100 : null,
        saldoOutSom: saldoOut != null ? Number(saldoOut) / 100 : null,
        matchedBy,
        item: found,
      },
    };
  }
}
