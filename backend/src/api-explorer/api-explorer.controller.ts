import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';

// dd.MM.yyyy ↔ Date helpers
function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}
function parseDate(s?: string): Date | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) {
    // ISO YYYY-MM-DD ham qabul qilamiz
    const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return null;
  }
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

class TestLoginDto {
  @IsString() baseUrl!: string;
  @IsString() login!: string;
  @IsString() password!: string;
  @IsOptional() @IsString() smsCode?: string;
  @IsOptional() @IsBoolean() useProxy?: boolean;
}

class FetchTxnsDto {
  @IsString() baseUrl!: string;
  @IsString() login!: string;
  @IsString() password!: string;
  @IsString() branch!: string;
  @IsString() account!: string;
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsBoolean() useProxy?: boolean;
}

class GetAccDto {
  @IsString() baseUrl!: string;
  @IsString() login!: string;
  @IsString() password!: string;
  @IsString() branch!: string;
  @IsString() account!: string;
  @IsOptional() @IsBoolean() useProxy?: boolean;
}

/**
 * API Explorer — bank API'lardan keladigan TO'LIQ raw javobni qaytaradi.
 * Frontend'da JSON viewer ko'rsatish uchun.
 *
 * Faqat SUPERADMIN/ADMIN — chunki credential'larni qabul qiladi.
 */
@ApiTags('api-explorer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN', 'ADMIN')
@Controller('api-explorer')
export class ApiExplorerController {
  constructor(private kb: KapitalbankClient) {}

  /** APILogin tekshirish — clients/accounts ro'yxatini qaytaradi */
  @Post('kapitalbank/login')
  @ApiOperation({ summary: 'APILogin so\'rovi (bank24.uz protocol: KapitalBank/Ipak Yo\'li/Hayot)' })
  async login(@Body() body: TestLoginDto) {
    const t0 = Date.now();
    try {
      const result = await this.kb.apiLogin({
        baseUrl: body.baseUrl,
        login: body.login,
        password: body.password,
        smsCode: body.smsCode,
        useProxy: body.useProxy,
      });
      return {
        ok: true,
        durationMs: Date.now() - t0,
        result,
        // Klient uchun foydali summary
        summary: {
          login: result.login,
          sid: result.sid,
          clientsCount: result.clients?.length || 0,
          totalAccounts: (result.clients || []).reduce((s, c) => s + (c.accounts?.length || 0), 0),
          inn: result.clients?.[0]?.inn,
          name: result.clients?.[0]?.name,
        },
      };
    } catch (e: any) {
      return { ok: false, durationMs: Date.now() - t0, error: e?.message || String(e) };
    }
  }

  /** GetDoc1C — to'liq raw response (sana oralig'i, kunma-kun aylanadi) */
  @Post('kapitalbank/transactions')
  @ApiOperation({ summary: 'GetDoc1C — sana oralig\'i bo\'yicha tranzaksiyalar (raw JSON)' })
  async transactions(@Body() body: FetchTxnsDto) {
    const t0 = Date.now();
    const today = new Date();
    const todayStr = formatDate(today);

    // Sana oraliig'i — eski `date` field'i ham qo'llab-quvvatlanadi (bitta kun = from/to bir xil)
    const dateFrom = body.dateFrom || body.date || todayStr;
    const dateTo = body.dateTo || body.date || dateFrom;

    const fromD = parseDate(dateFrom);
    const toD = parseDate(dateTo);
    if (!fromD || !toD) {
      return { ok: false, durationMs: Date.now() - t0, error: 'Sana noto\'g\'ri formatda (kerak: dd.MM.yyyy)' };
    }
    if (toD < fromD) {
      return { ok: false, durationMs: Date.now() - t0, error: 'Tugash sanasi boshlanish sanasidan oldin bo\'lmasligi kerak' };
    }
    // Maksimal 31 kun — bank API yuklanmasligi uchun
    const dayDiff = Math.floor((toD.getTime() - fromD.getTime()) / 86400000) + 1;
    if (dayDiff > 31) {
      return { ok: false, durationMs: Date.now() - t0, error: `Oralig'i ${dayDiff} kun — maksimal 31 kun ruxsat etilgan` };
    }

    const branch = body.branch.padStart(5, '0');

    // Har kun uchun chaqirib, natijalarni birlashtiramiz
    const allItems: any[] = [];
    const perDay: { date: string; count: number; credit: number; debit: number; error?: string }[] = [];
    let totalCredit = 0, totalDebit = 0;
    let firstSaldoIn: number | undefined, lastSaldoOut: number | undefined;
    let firstOperDay: string | undefined;

    for (let d = new Date(fromD); d <= toD; d.setDate(d.getDate() + 1)) {
      const dStr = formatDate(d);
      try {
        const result = await this.kb.getDoc1C({
          baseUrl: body.baseUrl,
          login: body.login,
          password: body.password,
          branch,
          account: body.account,
          date: dStr,
          useProxy: body.useProxy,
        });
        const items = result?.content || [];
        allItems.push(...items);
        const dayCredit = Number(result?.total_credit || 0);
        const dayDebit = Number(result?.total_debit || 0);
        totalCredit += dayCredit;
        totalDebit += dayDebit;
        if (firstSaldoIn === undefined) firstSaldoIn = Number(result?.saldo_in || 0);
        lastSaldoOut = Number(result?.saldo_out || 0);
        if (!firstOperDay) firstOperDay = result?.oper_day;
        perDay.push({ date: dStr, count: items.length, credit: dayCredit, debit: dayDebit });
      } catch (e: any) {
        perDay.push({ date: dStr, count: 0, credit: 0, debit: 0, error: e?.message || String(e) });
      }
    }

    const fieldsInFirstItem = allItems.length > 0 ? Object.keys(allItems[0]).sort() : [];
    const fieldsSaved = [
      'b2_id', 'general_id', 'ddate', 'dir', 'state',
      'amount', 'mfo_dt', 'acc_dt', 'name_dt', 'inn_dt',
      'mfo_ct', 'acc_ct', 'name_ct', 'inn_ct', 'purpose',
      'purp_code', 'num', 'dtype', 'uniq',
    ];
    const fieldsNotSaved = fieldsInFirstItem.filter((f) => !fieldsSaved.includes(f));

    return {
      ok: true,
      durationMs: Date.now() - t0,
      dateFrom, dateTo, days: dayDiff,
      result: {
        content: allItems,
        total_debit: totalDebit,
        total_credit: totalCredit,
        saldo_in: firstSaldoIn,
        saldo_out: lastSaldoOut,
        oper_day: firstOperDay,
      },
      perDay,
      summary: {
        itemsCount: allItems.length,
        totalCredit,
        totalDebit,
        saldoIn: firstSaldoIn,
        saldoOut: lastSaldoOut,
        operDay: firstOperDay,
        fieldsInFirstItem,
        fieldsSaved,
        fieldsNotSaved,
      },
    };
  }

  /** GetAcc1C — hisob saldo va oborot */
  @Post('kapitalbank/account')
  @ApiOperation({ summary: 'GetAcc1C — hisob saldo va oborot (raw)' })
  async account(@Body() body: GetAccDto) {
    const t0 = Date.now();
    try {
      const result = await this.kb.getAcc1C({
        baseUrl: body.baseUrl,
        login: body.login,
        password: body.password,
        branch: body.branch.padStart(5, '0'),
        account: body.account,
        useProxy: body.useProxy,
      });
      return {
        ok: true,
        durationMs: Date.now() - t0,
        result,
        summary: {
          accountsFound: result?.length || 0,
          fieldsInFirst: result?.[0] ? Object.keys(result[0]).sort() : [],
        },
      };
    } catch (e: any) {
      return { ok: false, durationMs: Date.now() - t0, error: e?.message || String(e) };
    }
  }
}
