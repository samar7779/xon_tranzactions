import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('sync')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('sync')
export class SyncController {
  constructor(
    private readonly svc: SyncService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('account/:id')
  @Roles('SUPERADMIN', 'ADMIN')
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

  @Get('logs')
  @Roles('SUPERADMIN', 'ADMIN', 'VIEWER')
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
