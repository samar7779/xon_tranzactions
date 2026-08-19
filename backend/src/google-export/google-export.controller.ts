import { Body, Controller, Delete, Get, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { GoogleExportService } from './google-export.service';
import { RunExportDto } from './dto/google-export.dto';

type AuthUser = { id?: string; email?: string; fullName?: string };

function actorLabel(u?: AuthUser): string {
  const parts: string[] = [];
  if (u?.fullName) parts.push(u.fullName);
  if (u?.email) parts.push(u.email);
  return parts.join(' · ') || 'system';
}

@ApiTags('google-export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('google-export')
export class GoogleExportController {
  constructor(private readonly svc: GoogleExportService) {}

  @Get('config')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Export konfiguratsiyasi + credential holati (private key qaytmaydi)' })
  getConfig() {
    return this.svc.getConfig();
  }

  @Get('distinct-filters')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Filtr dropdownlari uchun mavjud Объект/Тип qiymatlari' })
  distinctFilters() {
    return this.svc.distinctFilters();
  }

  @Get('upsert-keys')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Upsert rejimida oxirgi yozilgan kalitlar (ID) ro\'yxati' })
  getUpsertKeys(@Query('sheetId') sheetId: string) {
    return this.svc.getUpsertKeys(sheetId);
  }

  @Put('config')
  @RequirePermissions(PERMISSIONS.EXPORT_MANAGE)
  @ApiOperation({ summary: 'Export konfiguratsiyasini saqlash (sheet ID, tab, mapping, filtr)' })
  // MUHIM: `body`ni `any` deb olamiz — global ValidationPipe (whitelist+transform)
  // Object/any metatype'ni TEKSHIRMAYDI, shuning uchun sheet ichidagi nested `filter`
  // (va columns/cron) QIRQILMAY to'liq o'tadi. DTO turi bilan (SaveExportConfigDto)
  // pipe nested `filter`ni yo'q qilardi → filtr "saqlanmaydi" bug'i shundan edi.
  saveConfig(@Body() body: any, @CurrentUser() user?: AuthUser) {
    return this.svc.saveConfig(Array.isArray(body?.sheets) ? body.sheets : [], actorLabel(user));
  }

  @Post('credentials')
  @RequirePermissions(PERMISSIONS.EXPORT_MANAGE)
  @ApiOperation({ summary: 'Service-account JSON\'ni (UI paste) shifrlab saqlash' })
  saveCredentials(@Body() body: { json: string }, @CurrentUser() user?: AuthUser) {
    return this.svc.saveCredentials(body?.json || '', actorLabel(user));
  }

  @Delete('credentials')
  @RequirePermissions(PERMISSIONS.EXPORT_MANAGE)
  @ApiOperation({ summary: 'Saqlangan service-account credentialни o\'chirish' })
  clearCredentials(@CurrentUser() user?: AuthUser) {
    return this.svc.clearCredentials(actorLabel(user));
  }

  @Post('test')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Service-account ulanishini + har jadvalga ruxsatni tekshirish' })
  test() {
    return this.svc.testConnection();
  }

  @Post('preview-count')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Filtr bilan nechta qator mos kelishini oldindan ko\'rish (Sheets\'ga yozmasdan)' })
  previewCount(@Body() body: RunExportDto) {
    return this.svc.previewCount(body.target);
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.EXPORT_RUN)
  @ApiOperation({ summary: 'Bitta sheet uchun eksport (clear + yozish). To\'liq natija/xato qaytadi.' })
  run(@Body() body: RunExportDto, @CurrentUser() user?: AuthUser) {
    return this.svc.runAndLog(body.target, 'manual', `manual:${actorLabel(user)}`);
  }

  @Get('cron/logs')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Cron/qo\'lda ishga tushishlar tarixi (paginatsiya + sana/ish/status filtri)' })
  cronLogs(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sheetId') sheetId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
  ) {
    return this.svc.getCronLogs({
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 20,
      sheetId, dateFrom, dateTo, status,
    });
  }

  @Get('download')
  @RequirePermissions(PERMISSIONS.EXPORT_DOWNLOAD)
  @ApiOperation({ summary: "Ma'lumotni fayl sifatida yuklab olish (dataset + format)" })
  async download(
    @Query('dataset') dataset: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const { buffer, filename, contentType } = await this.svc.downloadData(
      dataset || 'oplatykv',
      format || 'json',
    );
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  // ═══ AUTSOURCING ═══
  @Get('autsourcing/config')
  @RequirePermissions(PERMISSIONS.EXPORT_AUTSOURCING)
  @ApiOperation({ summary: 'Autsoursing sozlama holati (bot token qaytmaydi)' })
  autsConfig() {
    return this.svc.getAutsourcingConfig();
  }

  @Put('autsourcing/config')
  @RequirePermissions(PERMISSIONS.EXPORT_AUTSOURCING)
  @ApiOperation({ summary: 'Autsoursing sozlamasi — bot token (shifrlanadi) + guruh ID + ustunlar' })
  autsSave(
    @Body() body: {
      botToken?: string; groupId?: string; columns?: string[];
      contracts?: string[]; dateFrom?: string | null;
      cronEnabled?: boolean; cronTime?: string;
    },
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.saveAutsourcingConfig(body || {}, actorLabel(user));
  }

  @Post('autsourcing/send')
  @RequirePermissions(PERMISSIONS.EXPORT_AUTSOURCING)
  @ApiOperation({ summary: "Shartnomalar Excel'ini Telegram guruhga jo'natish" })
  autsSend(@Body() body: { contracts?: string[]; columns?: string[]; dateFrom?: string | null }) {
    return this.svc.sendAutsourcing(body?.contracts || [], body?.columns || [], body?.dateFrom || null);
  }
}
