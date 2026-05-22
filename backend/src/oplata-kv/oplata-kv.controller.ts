import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { OplataKvService } from './oplata-kv.service';
import {
  CreateOplataKvDto, UpdateOplataKvDto, ListOplataKvDto,
} from './dto/oplata-kv.dto';

type AuthUser = { id?: string; email?: string; fullName?: string };

function actorFrom(u?: AuthUser) {
  // To'liq ism + email — audit log uchun aniq ma'lumot
  const parts: string[] = [];
  if (u?.fullName) parts.push(u.fullName);
  if (u?.email) parts.push(u.email);
  return {
    id: u?.id ?? null,
    name: parts.length > 0 ? parts.join(' · ') : null,
  };
}

/** Multer originalname'ni Latin-1 → UTF-8 ga to'g'ri o'tkazadi (kirill harflar uchun). */
function fixFileName(name?: string): string | undefined {
  if (!name) return name;
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}

@ApiTags('oplata-kv')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('oplata-kv')
export class OplataKvController {
  constructor(private readonly svc: OplataKvService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'ОплатыКв ro\'yxati (pagination + filter + sums)' })
  list(@Query() q: ListOplataKvDto) {
    return this.svc.list(q);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Filtr bo\'yicha barcha qatorlarni Excel sifatida yuklab olish' })
  async exportXlsx(@Query() q: ListOplataKvDto, @Res() res: Response) {
    const { buffer, filename } = await this.svc.exportXlsx(q);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get('export-json')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Filtr bo\'yicha JSON eksport' })
  async exportJson(@Query() q: ListOplataKvDto, @Res() res: Response) {
    const { buffer, filename } = await this.svc.exportJson(q);
    res.set({
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get('distinct')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Ustun uchun distinct qiymatlar (filter popover)' })
  distinct(
    @Query('column') column: string,
    @Query('search') search: string,
    @Query() q: ListOplataKvDto,
  ) {
    return this.svc.distinctValues(column, q, search);
  }

  @Get('by-contract')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: "Shartnoma bo'yicha to'lov tarixi (Akt Sverka)" })
  byContract(@Query('contractNo') contractNo: string) {
    return this.svc.findByContract(contractNo);
  }

  @Get('crm-sverka')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'OplatyKv vs CRM (Transactions) sverka — bitta shartnoma uchun' })
  crmSverka(@Query('contractNo') contractNo: string) {
    return this.svc.crmSverka(contractNo);
  }

  @Post('sync-from-transactions')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Tranzaksiyalardan auto-import — CLIENT/IN/contractNo > minDate" })
  async syncFromTx(
    @Body() body: { minDate?: string },
    @CurrentUser() user?: AuthUser,
  ) {
    let minDate: Date | null = null;
    if (body?.minDate) {
      minDate = new Date(body.minDate);
      if (isNaN(minDate.getTime())) throw new BadRequestException("Noto'g'ri sana");
    }
    return this.svc.syncFromTransactions({ minDate, actor: actorFrom(user) });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Bitta qatorni olish' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Qator tarixi (audit log)' })
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getHistory(id, limit ? Number(limit) : 100);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: 'Yangi qator qo\'shish' })
  create(@Body() body: CreateOplataKvDto, @CurrentUser() user?: AuthUser) {
    return this.svc.create(body, actorFrom(user));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: 'Qatorni tahrirlash (history\'ga avto yoziladi)' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateOplataKvDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.update(id, body, actorFrom(user));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: 'Qatorni o\'chirish (history saqlanadi)' })
  remove(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.svc.remove(id, actorFrom(user));
  }

  // ─── Import (2-bosqichli: preview + commit) ───────────────────────────────────────────────

  @Post('import/preview')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: "Excel'ni tekshirish (preview) — bazaga qo'shilmaydi",
    description: "Faylni o'qiydi, qatorlarni tekshiradi, dublikat ID'larni topadi. Natijani cache'da saqlaydi va previewId qaytaradi (30 daqiqa amal qiladi). Bazaga qo'shish uchun /import/commit chaqirilishi kerak.",
  })
  async importPreview(
    @UploadedFile() file: any,
    @CurrentUser() user?: AuthUser,
  ) {
    if (!file?.buffer) throw new BadRequestException('Excel fayl yuborilmadi');
    return this.svc.previewImport(file.buffer, actorFrom(user), fixFileName(file?.originalname));
  }

  @Post('import/commit')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({
    summary: "Preview tasdiqlash — cache'dagi qatorlarni bazaga qo'shadi",
    description: "previewImport qaytargan previewId bilan chaqiriladi. Cache'dan o'qib bulk insert qiladi.",
  })
  async importCommit(
    @Body() body: { previewId: string },
    @CurrentUser() user?: AuthUser,
  ) {
    if (!body?.previewId) throw new BadRequestException('previewId yuborilmadi');
    return this.svc.commitImport(body.previewId, actorFrom(user));
  }

  @Post('import/cancel')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Preview'ni bekor qilish (cache'dan o'chirish)" })
  async importCancel(@Body() body: { previewId: string }) {
    if (!body?.previewId) throw new BadRequestException('previewId yuborilmadi');
    return this.svc.cancelPreview(body.previewId);
  }

  @Post('import')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary: "Excel'dan ОплатыКв qatorlarini import qilish (1-bosqichli, eski usul)",
    description: "Eski usul — preview ko'rsatmasdan to'g'ridan-to'g'ri import. Yangi UI /import/preview + /import/commit ishlatadi.",
  })
  async importExcel(
    @UploadedFile() file: any,
    @CurrentUser() user?: AuthUser,
  ) {
    if (!file?.buffer) throw new BadRequestException('Excel fayl yuborilmadi');
    return this.svc.importExcel(file.buffer, actorFrom(user), fixFileName(file?.originalname));
  }

  @Delete('import-batch/:id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Import batch'ni va undagi barcha qatorlarni o'chirish" })
  async deleteImportBatch(@Param('id') id: string) {
    return this.svc.deleteImportBatch(id);
  }
}
