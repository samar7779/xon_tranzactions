import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { TransactionsService } from './transactions.service';
import { StatementService } from './statement.service';
import { ReconcileService } from './reconcile.service';
import { ListTransactionsDto } from './dto/list-transactions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly svc: TransactionsService,
    private readonly statementSvc: StatementService,
    private readonly reconcileSvc: ReconcileService,
  ) {}

  @Get()
  @ApiOperation({ summary: "Tranzaksiyalar ro'yxati (filter + pagination)" })
  list(@Query() q: ListTransactionsDto) {
    return this.svc.list(q);
  }

  @Get('distinct')
  @ApiOperation({ summary: "Ustun bo'yicha distinct qiymatlar (Google Sheets filter uchun)" })
  distinct(@Query('column') column: string, @Query() q: ListTransactionsDto) {
    return this.svc.distinctValues(column, q);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistika: jami, IN/OUT, banklar bo\'yicha' })
  stats(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.stats(from, to);
  }

  @Get('daily')
  @ApiOperation({ summary: 'Kunma-kun kirim/chiqim (diagramma uchun, bank/hisob filtri bilan)' })
  daily(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('bankId') bankId?: string,
    @Query('accountId') accountId?: string,
  ) {
    return this.svc.daily(from, to, bankId, accountId);
  }

  @Post('reconcile')
  @ApiOperation({ summary: "Hisob sverkasi — bank qoldig'i va oborotini DB bilan solishtiradi" })
  reconcile(@Body() body: { accountId: string; dateFrom: string; dateTo: string }) {
    return this.reconcileSvc.reconcile(body?.accountId, body?.dateFrom, body?.dateTo);
  }

  @Get('export')
  @ApiOperation({ summary: "Tranzaksiyalarni filtr bo'yicha Excel qilib yuklab olish" })
  async export(
    @Res() res: Response,
    @Query('q') q?: string,
    @Query('direction') direction?: string,
    @Query('bankId') bankId?: string,
    @Query('accountId') accountId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('matchStatus') matchStatus?: string,
  ) {
    const { buffer, filename } = await this.svc.exportXlsx({
      q, direction, bankId, accountId, dateFrom, dateTo, type, status, matchStatus,
    });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get('statement')
  @ApiOperation({ summary: "Bank vipiskasi — Excel (hisob + sana oralig'i)" })
  async statement(
    @Query('accountId') accountId: string,
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Res() res: Response,
  ) {
    const { buffer, filename } = await this.statementSvc.build(accountId, dateFrom, dateTo);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Bitta tranzaksiya tafsilot' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Get('count-by-account/:accountNo')
  @UseGuards(RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Hisob raqami bo\'yicha tranzaksiyalar soni (cleanup oldidan tasdiq uchun)' })
  countByAccount(@Param('accountNo') accountNo: string) {
    return this.svc.countByAccountNo(accountNo);
  }

  @Post('cleanup-by-account')
  @UseGuards(RolesGuard)
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Hisob raqami bo\'yicha barcha tranzaksiyalarni o\'chirish (faqat SUPERADMIN)' })
  async cleanupByAccount(@Body() body: { accountNo: string; confirm: string }) {
    if (!body?.accountNo) return { ok: false, error: 'accountNo kerak' };
    if (body?.confirm !== body?.accountNo) {
      return { ok: false, error: 'Tasdiq matni hisob raqamiga teng emas' };
    }
    return this.svc.deleteByAccountNo(body.accountNo);
  }
}
