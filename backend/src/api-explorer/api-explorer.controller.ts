import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { KapitalbankClient } from '../integrations/kapitalbank/kapitalbank.client';

class TestLoginDto {
  @IsString() baseUrl!: string;
  @IsString() login!: string;
  @IsString() password!: string;
  @IsOptional() @IsString() smsCode?: string;
}

class FetchTxnsDto {
  @IsString() baseUrl!: string;
  @IsString() login!: string;
  @IsString() password!: string;
  @IsString() branch!: string;
  @IsString() account!: string;
  @IsOptional() @IsString() date?: string; // dd.MM.yyyy — bugungi default
}

class GetAccDto {
  @IsString() baseUrl!: string;
  @IsString() login!: string;
  @IsString() password!: string;
  @IsString() branch!: string;
  @IsString() account!: string;
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

  /** GetDoc1C — to'liq raw response */
  @Post('kapitalbank/transactions')
  @ApiOperation({ summary: 'GetDoc1C — kun bo\'yicha tranzaksiyalar (raw JSON)' })
  async transactions(@Body() body: FetchTxnsDto) {
    const t0 = Date.now();
    const today = new Date();
    const date = body.date || `${String(today.getDate()).padStart(2, '0')}.${String(today.getMonth() + 1).padStart(2, '0')}.${today.getFullYear()}`;
    try {
      const result = await this.kb.getDoc1C({
        baseUrl: body.baseUrl,
        login: body.login,
        password: body.password,
        branch: body.branch,
        account: body.account,
        date,
      });
      const items = result?.content || [];
      // Birinchi tranzaksiya — barcha mavjud field'larini ro'yxatlash
      const fieldsInFirstItem = items.length > 0 ? Object.keys(items[0]).sort() : [];
      // BIZ HOZIRDA SAQLAB OLAYOTGAN field'lar (sync.service.ts ga qarang)
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
        date,
        result,
        summary: {
          itemsCount: items.length,
          totalCredit: result?.total_credit,
          totalDebit: result?.total_debit,
          saldoIn: result?.saldo_in,
          saldoOut: result?.saldo_out,
          operDay: result?.oper_day,
          isFinal: result?.fin === 1,
          fieldsInFirstItem,
          fieldsSaved,
          fieldsNotSaved,
        },
      };
    } catch (e: any) {
      return { ok: false, durationMs: Date.now() - t0, error: e?.message || String(e), date };
    }
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
        branch: body.branch,
        account: body.account,
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
