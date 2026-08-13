import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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

  // ── PUBLIC — Login Widget uchun ochiq config (bot username, yoqilganmi) ──
  @Get('public-config')
  @ApiOperation({ summary: 'Login Widget uchun ochiq config (sir emas)' })
  publicConfig() {
    return this.svc.publicConfig();
  }

  // ── PUBLIC — Telegram Login Widget orqali kirish (web tugma) ──
  @Post('login')
  @ApiOperation({ summary: 'Telegram Login Widget — imzo + guruh a\'zoligini tekshirib guest token beradi' })
  login(@Body() body: { authData?: any }) {
    return this.svc.loginWidget(body?.authData || {});
  }

  // ── PUBLIC — Bot webhook (/start → guruh tekshir → shaxsiy havola) ──
  @Post('webhook/:secret')
  @ApiOperation({ summary: 'Telegram bot webhook (deep-link /start)' })
  webhook(@Param('secret') secret: string, @Body() body: any) {
    return this.svc.handleWebhook(secret, body);
  }

  // ── PUBLIC — Shaxsiy havoladagi tokenni guest JWT'ga almashtirish ──
  @Post('redeem')
  @ApiOperation({ summary: 'Bir martalik kirish tokenini guest token\'ga almashtiradi' })
  redeem(@Body() body: { token?: string }) {
    return this.svc.redeemToken(body?.token || '');
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
