import { Body, Controller, Get, Param, Post, Query, Res, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { TransactionsService } from './transactions.service';
import { StatementService } from './statement.service';
import { ReconcileService } from './reconcile.service';
import { InspectorService } from './inspector.service';
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
    private readonly inspectorSvc: InspectorService,
  ) {}

  @Post('inspect-id')
  @ApiOperation({ summary: "Composite ID'ni parse qilib, bankdan o'sha tranzaksiyani so'raydi (DB tekshirilmaydi)" })
  inspectId(@Body() body: { id: string }) {
    return this.inspectorSvc.lookupFromBank(body?.id);
  }

  @Post('parse-ids-excel')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: "Excel A ustunidan composite ID'larni o'qib chiqaradi (toplam tekshirish uchun)" })
  async parseIdsExcel(@UploadedFile() file: any) {
    if (!file?.buffer) throw new BadRequestException('Excel fayl yuborilmadi');
    const ids = await this.inspectorSvc.parseIdsFromExcel(file.buffer);
    return { ok: true, ids };
  }

  @Post('export-inspect-results')
  @ApiOperation({ summary: 'ID Inspector bulk natijalarini Excel sifatida yuklab olish' })
  async exportInspectResults(
    @Body() body: { results: Array<{ id: string; result?: any; error?: string }> },
    @Res() res: Response,
  ) {
    if (!Array.isArray(body?.results) || body.results.length === 0) {
      throw new BadRequestException("Natijalar bo'sh");
    }
    const { buffer, filename } = await this.inspectorSvc.exportResultsToXlsx(body.results);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get()
  @ApiOperation({ summary: "Tranzaksiyalar ro'yxati (filter + pagination)" })
  list(@Query() q: ListTransactionsDto) {
    return this.svc.list(q);
  }

  @Get('distinct')
  @ApiOperation({ summary: "Ustun bo'yicha distinct qiymatlar (Google Sheets filter uchun)" })
  distinct(
    @Query('column') column: string,
    @Query('search') search: string | undefined,
    @Query() q: ListTransactionsDto,
  ) {
    return this.svc.distinctValues(column, q, search);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistika: jami, IN/OUT, banklar bo\'yicha (categoryCode/bankId/accountId/direction bilan filterlash mumkin)' })
  stats(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('categoryCode') categoryCode?: string,
    @Query('bankId') bankId?: string,
    @Query('accountId') accountId?: string,
    @Query('direction') direction?: string,
  ) {
    return this.svc.stats(from, to, categoryCode, bankId, accountId, direction);
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

  @Get('reconcile/today')
  @ApiOperation({ summary: "Barcha aktiv hisoblar uchun bugungi sverka (farq summasi bo'yicha sortlangan)" })
  reconcileToday(@Query('date') date?: string) {
    return this.reconcileSvc.reconcileToday(date);
  }

  @Post('reconcile/diagnose')
  @ApiOperation({ summary: 'Farq sababini topish — bankdagi va DB dagi tranzaksiyalarni taqqoslab, yetishmayotgan/ortiqcha yozuvlarni qaytaradi' })
  diagnose(@Body() body: { accountId: string; date: string }) {
    return this.reconcileSvc.diagnoseDay(body?.accountId, body?.date);
  }

  @Post('reconcile/fix-missing')
  @ApiOperation({ summary: "Bankda bor lekin DB da yo'q tranzaksiyani qayta sync qilib DB ga qo'shadi" })
  fixMissing(@Body() body: { accountId: string; b2Id?: string; generalId?: string; date: string }) {
    return this.reconcileSvc.fixMissing(body?.accountId, body?.b2Id, body?.generalId, body?.date);
  }

  @Post('reconcile/fix-all-missing')
  @ApiOperation({ summary: "Bir nechta yo'qolgan tranzaksiyalarni bitta zaprosda DB ga qo'shadi" })
  fixAllMissing(@Body() body: {
    accountId: string;
    date: string;
    items: Array<{ b2Id?: string; generalId?: string }>;
  }) {
    return this.reconcileSvc.fixAllMissing(body?.accountId, body?.date, body?.items || []);
  }

  @Post('reconcile/fix-tx-date')
  @ApiOperation({
    summary: "Bitta tx'ning sanasini tuzatish (foydalanuvchi tasdiqi bilan)",
    description: "Sverka diagnose'da 'boshqa sanada bor' deb topilgan tx uchun ishlatiladi. Faqat txnDate tegadi, boshqa hech narsa o'zgarmaydi.",
  })
  fixTxDate(@Body() body: { txId: string; newDate: string }) {
    return this.reconcileSvc.fixTxDate(body?.txId, body?.newDate);
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
