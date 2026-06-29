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

  @Get('by-object')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: "Obyektlar bo'yicha to'lovlar yig'indisi (dashboard hisoboti)" })
  byObject(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('mode') mode?: 'normal' | 'refund',
  ) {
    return this.svc.byObject({ dateFrom, dateTo, mode });
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

  @Get('crm-lookup')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Form auto-fill — shartnoma raqami bo\'yicha mijoz va obyekt nomi' })
  crmLookup(@Query('contractNo') contractNo: string) {
    return this.svc.crmLookupForForm(contractNo);
  }

  // ═══ ПЕРЕБРОСКА ═══
  @Get('contract-balance')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Shartnoma qoldig\'i (Перереброска uchun)' })
  contractBalance(@Query('contractNo') contractNo: string) {
    return this.svc.contractBalance(contractNo);
  }

  @Post('perereboska')
  @RequirePermissions(PERMISSIONS.OPLATAKV_CREATE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Переброска yaratish — shartnomadan shartnomaga pul o\'tkazma' })
  async createPerereboska(
    @UploadedFile() file: any,
    @Body() body: {
      fromContractNo: string;
      amount: string | number;
      date: string;
      destinations: string; // JSON string [{ contractNo, amount }]
      note?: string;
    },
    @CurrentUser() user?: AuthUser,
  ) {
    if (!file?.buffer) throw new BadRequestException('Hujjat (file) majburiy');
    let destinations: Array<{ contractNo: string; amount: number }> = [];
    try {
      const parsed = typeof body.destinations === 'string'
        ? JSON.parse(body.destinations)
        : body.destinations;
      destinations = (parsed || []).map((d: any) => ({
        contractNo: String(d.contractNo || ''),
        amount: Number(d.amount),
      }));
    } catch {
      throw new BadRequestException("destinations JSON noto'g'ri");
    }
    return this.svc.createPerereboska({
      fromContractNo: body.fromContractNo,
      amount: Number(body.amount),
      date: body.date,
      destinations,
      note: body.note,
      file: {
        buffer: file.buffer,
        originalname: fixFileName(file.originalname) || 'file',
        mimetype: file.mimetype || 'application/octet-stream',
        size: file.size,
      },
      actor: actorFrom(user),
    });
  }

  @Delete('perereboska/:groupId')
  @RequirePermissions(PERMISSIONS.OPLATAKV_DELETE)
  @ApiOperation({ summary: 'Перереброска guruh\'ini o\'chirish (barcha qatorlar + file)' })
  deletePerereboska(@Param('groupId') groupId: string, @CurrentUser() user?: AuthUser) {
    return this.svc.deletePerereboskaGroup(groupId, actorFrom(user));
  }

  @Get('perereboska/:groupId/file')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Перереброска hujjatini yuklab olish' })
  async downloadPerereboskaFile(
    @Param('groupId') groupId: string,
    @Res() res: Response,
  ) {
    const info = await this.svc.getPerereboskaFile(groupId);
    const { createReadStream } = await import('fs');
    res.set({
      'Content-Type': info.fileMime,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(info.fileName)}`,
      'Content-Length': String(info.fileSize),
    });
    createReadStream(info.filePath).pipe(res);
  }

  // ═══ ZIP EXPORT — Arizalar / Перереброска ═══
  @Get('export/arizas-zip')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Barcha ariza fayllarini ZIP qilib yuklab berish' })
  async exportArizasZip(@Res() res: Response) {
    try {
      await this.svc.exportArizasZip(res);
    } catch (e: any) {
      console.error('[exportArizasZip] xato:', e?.stack || e?.message || e);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: e?.message || 'ZIP yaratishda xato' });
      }
    }
  }

  @Get('export/perereboski-zip')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Barcha Перереброска fayllarini ZIP qilib yuklab berish' })
  async exportPerereboskiZip(@Res() res: Response) {
    try {
      await this.svc.exportPerereboskiZip(res);
    } catch (e: any) {
      console.error('[exportPerereboskiZip] xato:', e?.stack || e?.message || e);
      if (!res.headersSent) {
        res.status(500).json({ ok: false, error: e?.message || 'ZIP yaratishda xato' });
      }
    }
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

  @Get('last-sync-info')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: "Oxirgi tx-manba sync vaqti — UI'da ko'rsatish uchun" })
  async lastSyncInfo() {
    return this.svc.getLastSyncInfo();
  }

  @Get('object-mappings')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: "Obyekt nomi mapping ro'yxati (CRM -> OplatyKv)" })
  listObjectMappings() {
    return this.svc.listObjectMappings();
  }

  @Post('object-mappings')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Yangi obyekt mapping qo'shish" })
  createObjectMapping(
    @Body() body: { crmName: string; oplataName: string },
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.createObjectMapping(body.crmName, body.oplataName, actorFrom(user));
  }

  @Delete('object-mappings/:id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Mapping o'chirish" })
  deleteObjectMapping(@Param('id') id: string) {
    return this.svc.deleteObjectMapping(id);
  }

  @Post('fill-objects')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Tranzaksiya-manba qatorlarda yo'q obyektlarni CRM dan to'ldirish" })
  async fillObjects(
    @Body() body: { limit?: number },
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.fillMissingObjects({ limit: body?.limit, actor: actorFrom(user) });
  }

  @Get('unsplit-contracts')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: "CRM topilgan, lekin to'lovi split bo'lmagan shartnomalar (split kerak)" })
  unsplitContracts() {
    return this.svc.unsplitContracts();
  }

  @Post('split-installments')
  @RequirePermissions(PERMISSIONS.OPLATAKV_SPLIT)
  @ApiOperation({ summary: "paymentAmount'ni 1-vznos/oylik'ga ajratish (CRM asosida). contractNo berilsa faqat shu shartnoma." })
  async splitInstallments(
    @Body() body: { limit?: number; contractNo?: string },
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.splitInstallments({ limit: body?.limit, contractNo: body?.contractNo, actor: actorFrom(user) });
  }

  @Post('cleanup-xato-splits')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "XATO shartnomalardan 1-vznos/oylik split qiymatlarini darhol tozalash" })
  async cleanupXatoSplits() {
    const cleaned = await this.svc.cleanupSplitsForXatoContracts();
    return { ok: true, cleaned };
  }

  @Get('debug-xato-splits')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "DIAGNOSTIC: XATO split rowlarining BEFORE/AFTER holati + sample" })
  async debugXatoSplits() {
    return this.svc.debugXatoSplits();
  }

  @Get('bg-status')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: "Background job (fill+split) holati — modal poll qiladi" })
  async bgStatus() {
    return this.svc.getBgStatus();
  }

  @Get('debug-sync-diff')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "DIAGNOSTIC: Tx vs OplatyKv ortasidagi farq tahlili" })
  async debugSyncDiff(@Query('dateFrom') dateFrom?: string, @Query('dateTo') dateTo?: string) {
    return this.svc.debugSyncDiff({ dateFrom, dateTo });
  }

  @Post(':id/split')
  @RequirePermissions(PERMISSIONS.OPLATAKV_SPLIT)
  @ApiOperation({ summary: "Bitta qator uchun split — faqat shu qator qayta hisoblanadi (boshqalarga tegmaydi)" })
  async splitOne(
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.splitSingleRow(id, actorFrom(user));
  }

  @Delete('cleanup-xato-contracts')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Tx-manba qatorlardan CRM da topilmaganlarni o'chirish (XATO cleanup)" })
  async cleanupXato(@CurrentUser() user?: AuthUser) {
    return this.svc.cleanupXatoContracts({ actor: actorFrom(user) });
  }

  @Delete('cleanup-tx-source')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Tranzaksiya-manba (sourceTxId) qatorlarni o'chirish — optional date range" })
  async cleanupTxSource(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.cleanupTxSource({
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      actor: actorFrom(user),
    });
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
