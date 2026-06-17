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
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { SyncService } from '../sync/sync.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly svc: TransactionsService,
    private readonly statementSvc: StatementService,
    private readonly reconcileSvc: ReconcileService,
    private readonly inspectorSvc: InspectorService,
    private readonly syncSvc: SyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('inspect-id')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: "Composite ID'ni parse qilib, bankdan o'sha tranzaksiyani so'raydi (DB tekshirilmaydi)" })
  inspectId(@Body() body: { id: string }) {
    return this.inspectorSvc.lookupFromBank(body?.id);
  }

  @Post('parse-ids-excel')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: "Excel A ustunidan composite ID'larni o'qib chiqaradi (toplam tekshirish uchun)" })
  async parseIdsExcel(@UploadedFile() file: any) {
    if (!file?.buffer) throw new BadRequestException('Excel fayl yuborilmadi');
    const ids = await this.inspectorSvc.parseIdsFromExcel(file.buffer);
    return { ok: true, ids };
  }

  @Post('export-inspect-results')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
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
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: "Tranzaksiyalar ro'yxati (filter + pagination)" })
  list(@Query() q: ListTransactionsDto) {
    return this.svc.list(q);
  }

  @Get('distinct')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: "Ustun bo'yicha distinct qiymatlar (Google Sheets filter uchun)" })
  distinct(
    @Query('column') column: string,
    @Query('search') search: string | undefined,
    @Query() q: ListTransactionsDto,
  ) {
    return this.svc.distinctValues(column, q, search);
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Statistika: jami, IN/OUT, banklar bo\'yicha (sana, bank, direction + Google Sheets stilidagi kolonna filterlari)' })
  stats(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('categoryCode') categoryCode?: string,
    @Query('bankId') bankId?: string,
    @Query('accountId') accountId?: string,
    @Query('direction') direction?: string,
    @Query('q') q?: string,
    @Query('bankIds') bankIds?: string,
    @Query('accountIds') accountIds?: string,
    @Query('categoryIds') categoryIds?: string,
    @Query('subcategoryIds') subcategoryIds?: string,
    @Query('directions') directions?: string,
    @Query('contractStatuses') contractStatuses?: string,
    @Query('contractSources') contractSources?: string,
    @Query('hisobNomi') hisobNomi?: string,
    @Query('batchId') batchId?: string,
    @Query('sources') sources?: string,
  ) {
    return this.svc.stats({
      from, to, categoryCode, bankId, accountId, direction, q,
      bankIds, accountIds, categoryIds, subcategoryIds, directions,
      contractStatuses, contractSources, hisobNomi, batchId, sources,
    });
  }

  @Get('daily')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Kunma-kun kirim/chiqim (diagramma uchun, bank/hisob/kategoriya filtri bilan)' })
  daily(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('bankId') bankId?: string,
    @Query('accountId') accountId?: string,
    @Query('categoryCode') categoryCode?: string,
  ) {
    return this.svc.daily(from, to, bankId, accountId, categoryCode);
  }

  @Post('reconcile')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_VIEW)
  @ApiOperation({ summary: "Hisob sverkasi — bank qoldig'i va oborotini DB bilan solishtiradi (withSync=true bo'lsa avval sync qilinadi)" })
  reconcile(@Body() body: { accountId: string; dateFrom: string; dateTo: string; withSync?: boolean }) {
    return this.reconcileSvc.reconcile(body?.accountId, body?.dateFrom, body?.dateTo, {
      withSync: !!body?.withSync,
    });
  }

  @Get('reconcile/today')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_VIEW)
  @ApiOperation({ summary: "Barcha aktiv hisoblar uchun bugungi sverka. syncMismatched=true bo'lsa farqli hisoblar uchun avto-sync+qayta sverka qiladi (smart 2-pass)" })
  reconcileToday(
    @Query('date') date?: string,
    @Query('syncMismatched') syncMismatched?: string,
  ) {
    return this.reconcileSvc.reconcileToday(date, {
      syncMismatched: syncMismatched === 'true',
    });
  }

  @Post('reconcile/diagnose')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_VIEW)
  @ApiOperation({ summary: 'Farq sababini topish — bankdagi va DB dagi tranzaksiyalarni taqqoslab, yetishmayotgan/ortiqcha yozuvlarni qaytaradi' })
  diagnose(@Body() body: { accountId: string; date: string }) {
    return this.reconcileSvc.diagnoseDay(body?.accountId, body?.date);
  }

  @Post('reconcile/fix-missing')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({ summary: "Bankda bor lekin DB da yo'q tranzaksiyani qayta sync qilib DB ga qo'shadi" })
  fixMissing(@Body() body: { accountId: string; b2Id?: string; generalId?: string; date: string }) {
    return this.reconcileSvc.fixMissing(body?.accountId, body?.b2Id, body?.generalId, body?.date);
  }

  @Post('reconcile/fix-all-missing')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({ summary: "Bir nechta yo'qolgan tranzaksiyalarni bitta zaprosda DB ga qo'shadi" })
  fixAllMissing(@Body() body: {
    accountId: string;
    date: string;
    items: Array<{ b2Id?: string; generalId?: string }>;
  }) {
    return this.reconcileSvc.fixAllMissing(body?.accountId, body?.date, body?.items || []);
  }

  @Post('reconcile/fix-tx-date')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({
    summary: "Bitta tx'ning sanasini tuzatish (foydalanuvchi tasdiqi bilan)",
    description: "Sverka diagnose'da 'boshqa sanada bor' deb topilgan tx uchun ishlatiladi. Faqat txnDate tegadi, boshqa hech narsa o'zgarmaydi.",
  })
  fixTxDate(
    @Body() body: { txId: string; newDate: string },
    @CurrentUser('email') email?: string,
  ) {
    return this.reconcileSvc.fixTxDate(body?.txId, body?.newDate, email ? `manual:${email}` : 'manual');
  }

  @Post('reconcile/fix-all-tx-date')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({
    summary: "Bir nechta tx'ning sanalarini birdaniga tuzatish (bulk)",
    description: "Faqat txnDate UPDATE, boshqa fieldlar tegmaydi. Har biri uchun natija (updated/skipped/error) qaytadi.",
  })
  fixAllTxDate(
    @Body() body: { items: Array<{ txId: string; newDate: string }> },
    @CurrentUser('email') email?: string,
  ) {
    return this.reconcileSvc.fixAllTxDate(body?.items || [], email ? `manual:${email}` : 'manual');
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_EXPORT)
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
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIPISKA_VIEW)
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

  // ─── CHANGED TRANSACTIONS (re-verify history) ───────────────────────

  @Get('changes/list')
  @RequirePermissions(PERMISSIONS.CHANGED_TXN_VIEW)
  @ApiOperation({ summary: "O'chirilgan / o'zgartirilgan tranzaksiyalar ro'yxati (filterlar bilan)" })
  async listChanges(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('accountId') accountId?: string,
    @Query('changeType') changeType?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    const where: any = {};
    if (accountId) where.accountId = accountId;
    if (changeType === 'DELETED' || changeType === 'EDITED') where.changeType = changeType;
    if (dateFrom || dateTo) {
      where.detectedAt = {};
      if (dateFrom) where.detectedAt.gte = new Date(`${dateFrom}T00:00:00Z`);
      if (dateTo) where.detectedAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
    }
    if (q && q.trim()) {
      const term = q.trim();
      where.OR = [
        { externalId: { contains: term, mode: 'insensitive' } },
        { contractNumber: { contains: term, mode: 'insensitive' } },
        { accountNoSnap: { contains: term, mode: 'insensitive' } },
        { bankNameSnap: { contains: term, mode: 'insensitive' } },
      ];
    }
    const pageN = Math.max(1, Number(page) || 1);
    const perPageN = Math.min(200, Math.max(10, Number(perPage) || 50));
    // Aktiv filter ostida turli statistikalar — KPI cards uchun
    const whereDeleted = { ...where, changeType: 'DELETED' as const };
    const whereEdited = { ...where, changeType: 'EDITED' as const };
    const [total, totalDeleted, totalEdited, items] = await Promise.all([
      this.prisma.transactionChangeLog.count({ where }),
      this.prisma.transactionChangeLog.count({ where: whereDeleted }),
      this.prisma.transactionChangeLog.count({ where: whereEdited }),
      this.prisma.transactionChangeLog.findMany({
        where,
        orderBy: { detectedAt: 'desc' },
        skip: (pageN - 1) * perPageN,
        take: perPageN,
      }),
    ]);
    // Account info bilan boyitish
    const accIds = Array.from(new Set(items.map((i) => i.accountId).filter((x): x is string => !!x)));
    const accounts = accIds.length > 0
      ? await this.prisma.bankAccount.findMany({
          where: { id: { in: accIds } },
          include: { bank: true },
        })
      : [];
    const accMap = new Map(accounts.map((a) => [a.id, a]));
    return {
      ok: true,
      total,
      totals: { deleted: totalDeleted, edited: totalEdited },
      page: pageN,
      perPage: perPageN,
      items: items.map((it) => ({
        ...it,
        account: it.accountId ? accMap.get(it.accountId) : null,
      })),
    };
  }

  @Post('changes/check')
  @RequirePermissions(PERMISSIONS.CHANGED_TXN_CHECK)
  @ApiOperation({ summary: "Qo'lda re-verify ishga tushirish (sana oralig'i)" })
  async checkChanges(
    @Body() body: { accountId?: string; dateFrom: string; dateTo: string },
    @CurrentUser('email') email?: string,
  ) {
    if (!body?.dateFrom || !body?.dateTo) {
      throw new BadRequestException('dateFrom va dateTo majburiy');
    }
    return this.syncSvc.manualCheckChanges({
      accountId: body.accountId,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      actor: email ? `manual:${email}` : 'manual',
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
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
