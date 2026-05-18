import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { XonpayService } from './xonpay.service';

@ApiTags('xonpay')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('xonpay')
export class XonpayController {
  constructor(private svc: XonpayService) {}

  // ── SYNC ──
  @Post('sync')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({ summary: "XonPay sync — CRM dan to'lovlarni olib DB ga yozadi (qo'lda)" })
  startSync(
    @Query('limit') limit?: string,
    @Query('noSkip') noSkip?: string,
    @CurrentUser() user?: { id?: string; email?: string; fullName?: string },
  ) {
    return this.svc.startSync({
      limit: limit ? Number(limit) : undefined,
      trigger: 'manual',
      actorId: user?.id,
      actorEmail: user?.email,
      actorName: user?.fullName,
      noSkip: noSkip === 'true',
    });
  }

  @Post('sync/cancel')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  cancelSync() {
    return this.svc.cancelSync();
  }

  @Post('sync/history/:logId/cancel')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({ summary: "Sync tarixidan ma'lum bir running entry'ni bekor qilish (orphan ham)" })
  cancelSyncById(@Param('logId') logId: string) {
    return this.svc.cancelSyncById(logId);
  }

  @Get('sync/status')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  syncStatus() {
    return this.svc.getSyncStatus();
  }

  @Get('cron/info')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({ summary: 'Avtomatik cron sync ma\'lumotlari (07:00-23:00 har soat)' })
  cronInfo() {
    return this.svc.getCronInfo();
  }

  @Get('sync/history')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({ summary: 'Sync tarixi — filterlar bilan (q, status, dateFrom, dateTo)' })
  syncHistory(
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.svc.getSyncHistory({
      limit: limit ? Number(limit) : 50,
      q,
      status,
      dateFrom,
      dateTo,
    });
  }

  @Post('admin/fix-date-shift')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({
    summary: "TZ bug fix: barcha datePaid ga +1 kun qoshish (FAQAT BIR MARTA!)",
    description: "Eski parseDate UTC bo'lganidan keyin sana 1 kun kam yozilgan edi. Bu endpoint bir marta chaqirilib, hammasi tuzatiladi.",
  })
  fixDateShift() {
    return this.svc.fixDateShift();
  }

  // ── MATCH ──
  @Post('match-all')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({ summary: 'Bulk match — barcha (yoki faqat matched bo\'lmaganlar)' })
  matchAll(@Query('onlyUnmatched') onlyUnmatched?: string) {
    return this.svc.startMatchAll({ onlyUnmatched: onlyUnmatched !== 'false' });
  }

  @Get('match/status')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  matchStatus() {
    return this.svc.getMatchStatus();
  }

  @Post(':externalId/recheck')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  recheck(@Param('externalId') externalId: string) {
    return this.svc.recheckOne(externalId);
  }

  // ── LIST / STATS ──
  @Get()
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  list(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('matched') matched?: 'all' | 'matched' | 'unmatched',
    @Query('q') q?: string,
    @Query('contract') contract?: string,
  ) {
    return this.svc.list({
      page: page ? Number(page) : 1,
      perPage: perPage ? Number(perPage) : 50,
      dateFrom,
      dateTo,
      matched: matched || 'all',
      q,
      contract,
    });
  }

  @Get('stats/daily')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({ summary: "Kunlik statistika — jami / topilgan / qolgan" })
  dailyStats(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.svc.dailyStats({ dateFrom, dateTo });
  }
}
