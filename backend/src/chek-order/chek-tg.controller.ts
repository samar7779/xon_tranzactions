import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ChekTgService } from './chek-tg.service';

@ApiTags('chek-order-tg')
@Controller('chek-order/tg')
export class ChekTgController {
  constructor(private readonly svc: ChekTgService) {}

  // ── PUBLIC — Telegram Mini App auth (guard yo'q; imzo + guruh a'zoligi tekshiriladi) ──
  @Post('auth')
  @ApiOperation({ summary: 'Telegram Mini App — initData tekshirib guest token beradi' })
  auth(@Body() body: { initData?: string }) {
    return this.svc.auth(body?.initData || '');
  }

  // ── Sozlama — admin (chekorder:telegram) ──
  @Get('config')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CHEKORDER_TELEGRAM)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Telegram kirish sozlamasi (enabled/guruh/token bormi)' })
  getConfig() {
    return this.svc.getConfig();
  }

  @Post('config')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(PERMISSIONS.CHEKORDER_TELEGRAM)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Telegram kirish sozlamasini saqlash (bot token / guruh ID / yoqilgan)' })
  setConfig(@Body() body: { enabled?: boolean; botToken?: string; groupId?: string }) {
    return this.svc.setConfig(body || {});
  }
}
