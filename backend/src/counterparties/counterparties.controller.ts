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

  @Get(':inn')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_VIEW)
  @ApiOperation({ summary: 'Bitta kontragent' })
  getOne(@Param('inn') inn: string) {
    return this.svc.getOne(inn);
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
  refresh(@Param('inn') inn: string) {
    return this.svc.refresh(inn);
  }

  @Patch(':inn')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({ summary: 'Qo\'lda tahrirlash (name / notes / isActive)' })
  update(@Param('inn') inn: string, @Body() body: { name?: string; notes?: string; isActive?: boolean }) {
    return this.svc.update(inn, body);
  }

  @Delete(':inn')
  @RequirePermissions(PERMISSIONS.COUNTERPARTIES_MANAGE)
  @ApiOperation({ summary: 'O\'chirish' })
  remove(@Param('inn') inn: string) {
    return this.svc.remove(inn);
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
  refreshAll() {
    return this.svc.refreshAll();
  }
}
