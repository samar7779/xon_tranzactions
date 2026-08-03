import { Body, Controller, Get, Post, Put, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ShmitdService } from './shmitd.service';

type AuthUser = { email?: string; fullName?: string };

@ApiTags('shmitd')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('shmitd')
export class ShmitdController {
  constructor(private readonly svc: ShmitdService) {}

  @Get('config')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'SHMITD sozlamasi (token qaytmaydi)' })
  getConfig() { return this.svc.getConfig(); }

  @Put('config')
  @RequirePermissions(PERMISSIONS.EXPORT_MANAGE)
  @ApiOperation({ summary: 'SHMITD sozlamasi — token, guruh, sheet, jadval' })
  saveConfig(@Body() body: any, @CurrentUser() user?: AuthUser) {
    return this.svc.saveConfig(body || {}, user?.email || user?.fullName);
  }

  @Post('send')
  @RequirePermissions(PERMISSIONS.EXPORT_RUN)
  @ApiOperation({ summary: 'Hozir jo\'natish (Google Sheet → HTML → Telegram guruh)' })
  send(@CurrentUser() user?: AuthUser) {
    return this.svc.sendNow(`manual:${user?.email || 'admin'}`);
  }

  @Get('history')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Jo\'natish tarixi (paginatsiya + sana qidiruv)' })
  history(@Query('page') page?: string, @Query('perPage') perPage?: string, @Query('date') date?: string) {
    return this.svc.history({ page: Number(page), perPage: Number(perPage), date });
  }

  @Get('history/:id/html')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Saqlangan hisobot HTML (brauzerda ochish)' })
  async html(@Param('id') id: string, @Res() res: Response) {
    const r = await this.svc.getHtml(id);
    if (!r.ok) { res.status(404).json({ ok: false, error: r.error }); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(r.html);
  }
}
