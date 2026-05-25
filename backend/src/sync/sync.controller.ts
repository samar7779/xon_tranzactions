import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { SettingsService } from './settings.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sync')
export class SyncController {
  constructor(
    private readonly svc: SyncService,
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('settings')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  @ApiOperation({ summary: 'Sync sozlamalari' })
  async getSettings() {
    const syncMinDate = await this.settings.getSyncMinDate();
    const oplatykvTxMinDate = await this.settings.getOplatyKvTxMinDate();
    return {
      ok: true,
      syncMinDate: syncMinDate ? syncMinDate.toISOString().slice(0, 10) : null,
      oplatykvTxMinDate: oplatykvTxMinDate ? oplatykvTxMinDate.toISOString().slice(0, 10) : null,
      oplatykvAutoSyncMinutes: await this.settings.getOplatyKvAutoSyncMinutes(),
      oplatykvDayStart:        await this.settings.getOplatyKvDayStart(),
      oplatykvDayEnd:          await this.settings.getOplatyKvDayEnd(),
      oplatykvNightStart:      await this.settings.getOplatyKvNightStart(),
      oplatykvNightEnd:        await this.settings.getOplatyKvNightEnd(),
      oplatykvAutoXatoCleanup: await this.settings.getOplatyKvAutoXatoCleanup(),
    };
  }

  @Patch('settings')
  @RequirePermissions(PERMISSIONS.SYNC_RUN)
  @ApiOperation({ summary: 'Sync sozlamalarini saqlash' })
  async setSettings(
    @Body() body: {
      syncMinDate?: string | null;
      oplatykvTxMinDate?: string | null;
      oplatykvAutoSyncMinutes?: number | null;
      oplatykvDayStart?: string;
      oplatykvDayEnd?: string;
      oplatykvNightStart?: string;
      oplatykvNightEnd?: string;
      oplatykvAutoXatoCleanup?: boolean;
    },
    @CurrentUser('email') email?: string,
  ) {
    if (body.syncMinDate !== undefined) await this.settings.setSyncMinDate(body.syncMinDate || null, email);
    if (body.oplatykvTxMinDate !== undefined) await this.settings.setOplatyKvTxMinDate(body.oplatykvTxMinDate || null, email);
    if (body.oplatykvAutoSyncMinutes !== undefined) await this.settings.setOplatyKvAutoSyncMinutes(body.oplatykvAutoSyncMinutes || null, email);
    if (body.oplatykvDayStart !== undefined || body.oplatykvDayEnd !== undefined ||
        body.oplatykvNightStart !== undefined || body.oplatykvNightEnd !== undefined) {
      await this.settings.setOplatyKvTimeWindows({
        dayStart: body.oplatykvDayStart,
        dayEnd: body.oplatykvDayEnd,
        nightStart: body.oplatykvNightStart,
        nightEnd: body.oplatykvNightEnd,
      }, email);
    }
    if (body.oplatykvAutoXatoCleanup !== undefined) {
      await this.settings.setOplatyKvAutoXatoCleanup(body.oplatykvAutoXatoCleanup, email);
    }
    return this.getSettings();
  }

  @Post('account/:id')
  @RequirePermissions(PERMISSIONS.SYNC_RUN)
  @ApiOperation({ summary: 'Bitta hisob bo\'yicha manual sync ishga tushirish' })
  async runAccount(@Param('id') id: string) {
    const acc = await this.prisma.bankAccount.findUnique({ where: { id } });
    if (!acc) return { ok: false, error: 'Hisob topilmadi' };
    try {
      return await this.svc.syncAccount(acc.credentialId, acc.id);
    } catch (e: any) {
      // Bank API yoki tarmoq xatosi — 500 emas, javob qaytaramiz
      return {
        ok: false,
        error: e?.message?.slice(0, 500) || 'Noma\'lum sync xatosi',
        fetched: 0,
        saved: 0,
        errors: 1,
      };
    }
  }

  @Post('run-all')
  @RequirePermissions(PERMISSIONS.SYNC_RUN)
  @ApiOperation({ summary: 'Barcha faol hisoblarni sync qilish (fonda, intervalga qaramay)' })
  async runAll() {
    // 100+ hisob uzoq davom etadi — fonda ishga tushiramiz, javobni kutmaymiz
    // force=true — bank intervaliga qaramay hammasi sync qilinadi
    this.svc.tick(true).catch(() => {});
    const accounts = await this.prisma.bankAccount.count({ where: { syncEnabled: true } });
    return { ok: true, started: true, accounts };
  }

  @Post('backfill')
  @RequirePermissions(PERMISSIONS.SYNC_RUN)
  @ApiOperation({ summary: 'Eski tarixni yuklash — sana oralig\'i bo\'yicha (fonda)' })
  async backfill(@Body() body: {
    scope: 'all' | 'bank' | 'account';
    bankId?: string;
    accountId?: string;
    dateFrom: string;
    dateTo: string;
  }) {
    if (!body?.dateFrom || !body?.dateTo) {
      return { ok: false, error: 'dateFrom va dateTo kerak' };
    }
    const { accounts, dates, syncMinDate, originalFromCount, clampedCount } =
      await this.svc.resolveBackfillTargets(body);
    if (accounts.length === 0) {
      return { ok: false, error: 'Sync yoqilgan hisob topilmadi' };
    }
    // Hamma kunlar syncMinDate'dan oldin bo'lsa
    if (dates.length === 0 && originalFromCount > 0 && syncMinDate) {
      const minStr = syncMinDate.toISOString().slice(0, 10);
      return {
        ok: false,
        error: `Tanlangan sana oralig'i to'liq sync chegarasidan (${minStr}) oldin. Sync sozlamalaridan chegarani o'zgartiring.`,
        syncMinDate: minStr,
        clampedAll: true,
      };
    }
    if (dates.length === 0) {
      return { ok: false, error: 'Sana oralig\'i noto\'g\'ri' };
    }
    const startedAt = new Date().toISOString();
    // Fonda ishga tushiramiz — uzoq davom etadi
    this.svc.runBackfill(accounts, dates).catch(() => {});

    // Ogohlantirish — agar ba'zi kunlar chetga surilgan bo'lsa
    let warning: string | null = null;
    if (clampedCount > 0 && syncMinDate) {
      const minStr = syncMinDate.toISOString().slice(0, 10);
      const firstKept = dates[0];
      warning = `Sync chegarasi (${minStr}) tufayli ${clampedCount} ta kun o'tkazib yuborildi. Sync ${firstKept} dan boshlab boshlanadi.`;
    }
    // dd.MM.yyyy → yyyy-MM-dd
    const toIso = (ddMmYyyy: string): string => {
      const m = ddMmYyyy.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : ddMmYyyy;
    };
    return {
      ok: true,
      started: true,
      accounts: accounts.length,
      days: dates.length,
      startedAt,
      warning,
      syncMinDate: syncMinDate ? syncMinDate.toISOString().slice(0, 10) : null,
      clampedDays: clampedCount,
      requestedFrom: body.dateFrom,
      requestedTo: body.dateTo,
      actualFrom: dates.length > 0 ? toIso(dates[0]) : null,
      actualTo: dates.length > 0 ? toIso(dates[dates.length - 1]) : null,
    };
  }

  @Get('backfill/status')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  @ApiOperation({ summary: 'Backfill jarayoni holati — berilgan vaqtdan keyingi loglar' })
  async backfillStatus(@Query('since') since?: string) {
    const where: any = { source: { contains: 'backfill' } };
    if (since) where.startedAt = { gte: new Date(since) };
    const items = await this.prisma.syncLog.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: 500,
    });
    return { ok: true, items };
  }

  @Get('logs')
  @RequirePermissions(PERMISSIONS.SYNC_VIEW)
  @ApiOperation({ summary: 'Sync log tarixi' })
  async logs(@Query('limit') limit?: string) {
    const take = Math.min(Number(limit) || 50, 200);
    const items = await this.prisma.syncLog.findMany({
      orderBy: { startedAt: 'desc' },
      take,
    });
    return { ok: true, items };
  }
}
