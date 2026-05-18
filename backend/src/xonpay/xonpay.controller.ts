import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
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
  @ApiOperation({ summary: "XonPay sync — CRM dan to'lovlarni olib DB ga yozadi" })
  startSync(@Query('limit') limit?: string) {
    return this.svc.startSync({ limit: limit ? Number(limit) : undefined });
  }

  @Post('sync/cancel')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  cancelSync() {
    return this.svc.cancelSync();
  }

  @Get('sync/status')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  syncStatus() {
    return this.svc.getSyncStatus();
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
