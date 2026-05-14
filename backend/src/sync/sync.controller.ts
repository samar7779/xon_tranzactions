import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sync')
export class SyncController {
  constructor(
    private readonly svc: SyncService,
    private readonly prisma: PrismaService,
  ) {}

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
  @ApiOperation({ summary: 'Barcha faol hisoblarni sync qilish (fonda)' })
  async runAll() {
    // 100+ hisob uzoq davom etadi — fonda ishga tushiramiz, javobni kutmaymiz
    this.svc.tick().catch(() => {});
    const accounts = await this.prisma.bankAccount.count({ where: { syncEnabled: true } });
    return { ok: true, started: true, accounts };
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
