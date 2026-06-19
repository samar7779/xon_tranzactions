import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CounterpartiesService, ListQuery } from './counterparties.service';

@ApiTags('counterparties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('counterparties')
export class CounterpartiesController {
  constructor(private readonly svc: CounterpartiesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_VIEW)
  @ApiOperation({ summary: 'Kontragentlar ro\'yxati (pagination + filter)' })
  list(@Query() q: ListQuery) {
    return this.svc.list(q);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_VIEW)
  @ApiOperation({ summary: 'Excel eksport (filtr bo\'yicha)' })
  async export(@Res() res: Response, @Query() q: ListQuery) {
    const { buffer, filename } = await this.svc.exportExcel(q);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  // ─── Settings + activity log + truncate (':inn' route'dan OLDIN bo'lishi kerak, aks holda Express _settings ni inn deb tushunadi) ───
  @Get('_settings')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_VIEW)
  @ApiOperation({ summary: 'Kontragentlar sozlamalari (auto-refresh holati)' })
  getSettings() {
    return this.svc.getSettings();
  }

  @Get('_activity-log')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_VIEW)
  @ApiOperation({ summary: 'Faoliyat tarixi — pagination + filter + search' })
  async getActivityLog(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('q') q?: string,
    @Query('actorName') actorName?: string,
    @Query('action') action?: string,
  ) {
    const result = await this.svc.getActivityLog({
      page: page ? Number(page) : 1,
      perPage: perPage ? Number(perPage) : 20,
      q: q || undefined,
      actorName: actorName || undefined,
      action: action || undefined,
    });
    return { ok: true, ...result };
  }

  @Post('_settings/auto-refresh')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({ summary: 'Auto-refresh ON/OFF (cron ham shu sozlamani tekshiradi)' })
  async setAutoRefresh(
    @Body() body: { enabled: boolean },
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
  ) {
    return this.svc.setAutoRefresh(!!body?.enabled, { id: userId, name: email });
  }

  @Post('_truncate')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({
    summary: "Butun kontragentlar bazasini TOZALASH (DANGER)",
    description: "Barcha kontragent yozuvlari va ularning tarixini o'chiradi. Parol talab qilinadi (body.password).",
  })
  async truncate(
    @Body() body: { password: string },
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
  ) {
    if (!body?.password) {
      throw new BadRequestException('Parol kerak');
    }
    return this.svc.truncateAll(body.password, { id: userId, name: email });
  }

  @Get(':inn')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_VIEW)
  @ApiOperation({ summary: 'Bitta kontragent' })
  getOne(@Param('inn') inn: string) {
    return this.svc.getOne(inn);
  }

  @Get(':inn/history')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_VIEW)
  @ApiOperation({ summary: 'Kontragent tarixi — kim qachon qo\'shgan/tahrirlagan' })
  history(@Param('inn') inn: string, @Query('limit') limit?: string) {
    return this.svc.getHistory(inn, limit ? Number(limit) : 50);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({ summary: 'Yangi kontragent (INN + Name; qolgani DIDOX\'dan)' })
  create(@Body() body: { inn: string; name: string }, @CurrentUser('id') userId: string) {
    return this.svc.create(body, userId);
  }

  @Post(':inn/refresh')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({ summary: 'DIDOX\'dan qaytadan olib yangilash (name tegilmaydi)' })
  refresh(@Param('inn') inn: string, @CurrentUser('id') userId: string) {
    return this.svc.refresh(inn, userId);
  }

  @Patch(':inn')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({ summary: 'Qo\'lda tahrirlash — barcha maydonlar (PINFL/qo\'lda yozilgan kontragentlar uchun)' })
  update(@Param('inn') inn: string, @Body() body: any, @CurrentUser('id') userId: string) {
    return this.svc.update(inn, body, userId);
  }

  @Delete(':inn')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({ summary: 'O\'chirish' })
  remove(@Param('inn') inn: string, @CurrentUser('id') userId: string) {
    return this.svc.remove(inn, userId);
  }

  @Post('import')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Excel import — A:INN, B:Nom (dublikat skip)' })
  async import(@UploadedFile() file: any, @CurrentUser('id') userId: string) {
    if (!file?.buffer) throw new BadRequestException('Excel fayl yuborilmadi');
    return this.svc.importExcel(file.buffer, userId);
  }

  @Post('refresh-all')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({ summary: 'Hammasini qo\'lda yangilash (cron\'ga teng)' })
  refreshAll(@CurrentUser('id') userId: string) {
    return this.svc.refreshAll(userId);
  }

  @Get('refresh-all/status')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_VIEW)
  @ApiOperation({ summary: 'refreshAll holati — ishlamoqdami, qachondan beri, qancha bajarildi' })
  refreshAllStatus() {
    return this.svc.getRefreshAllStatus();
  }
}
