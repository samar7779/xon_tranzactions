import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { TrSupportService } from './tr-support.service';

/**
 * Panel: Tranzaksiyalar > Klient · XATO shartnoma > "TR Support" tabi (kirish kodi bilan).
 *   POST unlock                 — kodni tekshiradi
 *   GET  edits                  — agent orqali qilingan tahrirlar (header x-tr-support-code)
 *   POST edits/:id/rollback     — tahrirni ortga qaytarish + OplatyKv sync (qo'lda tahrir ruxsati kerak)
 */
@ApiTags('tr-support')
@ApiBearerAuth()
@Controller('tr-support')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TrSupportController {
  constructor(private readonly svc: TrSupportService) {}

  @Post('unlock')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  unlock(@Body() body: { code?: string }) {
    this.svc.checkCode(body?.code);
    return { ok: true };
  }

  @Get('edits')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  list(
    @Headers('x-tr-support-code') code: string,
    @Query('page') page?: string, @Query('perPage') perPage?: string, @Query('q') q?: string,
  ) {
    this.svc.checkCode(code);
    return this.svc.list({ page: Number(page) || 1, perPage: Number(perPage) || 30, q });
  }

  @Post('edits/:id/rollback')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  rollback(
    @Param('id') id: string,
    @Body() body: { code?: string; note?: string },
    @CurrentUser() user: any,
  ) {
    this.svc.checkCode(body?.code);
    const who = String(user?.fullName || user?.email || 'panel').slice(0, 120);
    return this.svc.rollback(id, who, body?.note || null);
  }
}
