import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CategorizationService } from './categorization.service';
import { PrismaService } from '../common/prisma/prisma.service';

@ApiTags('categorization')
@ApiBearerAuth()
@Controller('categorization')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CategorizationController {
  constructor(
    private svc: CategorizationService,
    private prisma: PrismaService,
  ) {}

  /**
   * Aloqa Bank manbasidan kelgan tranzaksiyalar — read-only. Edit/category/contract
   * tugmalari ulariga ishlamasligi kerak. Bu helper har bir mutatsiya endpoint'ida
   * chaqiriladi.
   */
  private async assertEditable(txId: string): Promise<void> {
    const tx = await this.prisma.transaction.findUnique({
      where: { id: txId },
      select: { source: true },
    });
    if (!tx) throw new BadRequestException('Tranzaksiya topilmadi');
    if (tx.source === 'ALOQA_BANK') {
      throw new BadRequestException(
        "Aloqa Bank Excel import qatorlarini tahrirlash mumkin emas (read-only)",
      );
    }
  }

  // ─── Kategoriyalar ro'yxati ────────────────────────────────────
  @Get('categories')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: 'Barcha kategoriyalar (2 darajali daraxt)' })
  async list() {
    const all = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const tops = all.filter((c) => !c.parentId);
    const subs = all.filter((c) => c.parentId);
    const tree = tops.map((t) => ({
      ...t,
      children: subs.filter((s) => s.parentId === t.id),
    }));
    return { ok: true, items: tree };
  }

  // ─── Bitta tranzaksiyani kategoriyalash (avto) ─────────────────
  @Post('transactions/:id/categorize')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Bitta tranzaksiyani avto-kategoriyalash (force=true bo\'lsa mavjudni ham qayta hisoblaydi)' })
  async categorizeOne(
    @Param('id') id: string,
    @Query('force') force: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.assertEditable(id);
    return this.svc.categorizeOne(id, { force: force === 'true', actor: 'manual', actorId: userId });
  }

  // ─── Qo'lda kategoriya qo'yish ─────────────────────────────────
  @Post('transactions/:id/set')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Tranzaksiyaga qo\'lda kategoriya qo\'yish (har doim ustidan yoziladi)' })
  async setManual(
    @Param('id') id: string,
    @Body() body: { categoryId: string | null; subcategoryId?: string | null },
    @CurrentUser('id') userId: string,
  ) {
    await this.assertEditable(id);
    return this.svc.setManual(id, body, userId);
  }

  // ─── Faqat shartnoma raqamini o'zgartirish ─────────────────────
  @Post('transactions/:id/set-contract')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Shartnoma raqamini qo\'lda o\'zgartirish (CRM\'da ham tasdiqlanadi)' })
  async setContract(
    @Param('id') id: string,
    @Body() body: { contractNumber: string | null },
    @CurrentUser('id') userId: string,
  ) {
    await this.assertEditable(id);
    return this.svc.setContract(id, body.contractNumber, userId);
  }

  // ─── Kontragentni qo'lda tanlash (Counterparty jadvalidan) ───
  @Post('transactions/:id/set-counterparty')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Tranzaksiyaga Counterparty\'ni qo\'lda biriktirish (INN avto-lookup ustidan)' })
  async setCounterparty(
    @Param('id') id: string,
    @Body() body: { counterpartyId: string | null },
    @CurrentUser('id') userId: string,
  ) {
    await this.assertEditable(id);
    return this.svc.setCounterparty(id, body.counterpartyId, userId);
  }

  // ─── Shartnomani qo'lda kiritish (CRM tekshirmasdan) ───
  @Post('transactions/:id/set-contract-manual')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Shartnoma raqamini qo\'lda kiritish (CRM tekshirmaydi)' })
  async setContractManual(
    @Param('id') id: string,
    @Body() body: { contractNumber: string | null },
    @CurrentUser('id') userId: string,
  ) {
    await this.assertEditable(id);
    return this.svc.setContractManual(id, body.contractNumber, userId);
  }

  // ─── Hammasini qayta hisoblash ─────────────────────────────────
  @Post('run-all')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Toplu kategoriyalash (faqat bo\'sh kategoriyali tranzaksiyalar)' })
  runAll(
    @Query('all') allFlag: string,
    @Query('limit') limit: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.runAll({
      onlyUncategorized: allFlag !== 'true',
      limit: limit ? Number(limit) : undefined,
      actorId: userId,
    });
  }

  @Get('run-all/status')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: 'Toplu kategoriyalash holati (running, progress)' })
  status() {
    return this.svc.getStatus();
  }

  // ─── XATO shartnomalarni qayta tekshirish (CRM cache refresh) ───
  @Post('recheck-xato')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({
    summary: "XATO shartnomalarni qayta tekshirish — uniq shartnomalarni CRM'dan qayta so'raydi",
    description:
      "Kategoriya/shartnoma raqamiga TEGMAYDI. Faqat CrmContract cache'ni yangilaydi. " +
      "Sana filtri: ?dateFrom=2026-01-01&dateTo=2026-04-30 — faqat shu oraliqdagi tx larning shartnomalari.",
  })
  recheckXato(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.svc.recheckXatoContracts({ dateFrom, dateTo });
  }

  @Post('recheck-xato/cancel')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: "Joriy qayta tekshirishni bekor qilish (joriy batch tugagandan keyin to'xtaydi)" })
  recheckXatoCancel() {
    return this.svc.cancelRecheck();
  }

  @Get('recheck-xato/status')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: 'Qayta tekshirish holati (progress + oxirgi 20 ta tuzatilgan)' })
  recheckStatus() {
    return this.svc.getRecheckStatus();
  }

  @Post('refresh-contract-cache')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({
    summary: "BITTA shartnomani CRM da DARHOL qayta tekshirish (cache o'chiriladi)",
    description: "User aniq shartnomani CRM da bor deb hisoblayotgan bo'lsa va sistema 'XATO' deyayotgan bo'lsa, cache stale bo'lishi mumkin. Bu endpoint cache o'chiradi va live CRM lookup qiladi.",
  })
  async refreshContractCache(@Body() body: { contractNumber: string }) {
    if (!body?.contractNumber) {
      throw new BadRequestException('contractNumber kerak');
    }
    return this.svc.refreshContractCache(body.contractNumber);
  }

  @Post('cleanup-contract-symbols')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({
    summary: "Eski qatorlardagi № va bo'shliqlarni Transaction.contractNumber dan tozalash",
    description: "DB dagi mavjud Transaction.contractNumber qiymatlarda № yoki bo'shliq bo'lsa olib tashlaydi. Yangi yozuvlar avtomatik tozalanadi.",
  })
  async cleanupContractSymbols() {
    return this.svc.cleanupContractNumberSymbols();
  }

  @Get('recheck-xato/fixed')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: "Tuzatilgan shartnomalar to'liq ro'yxati + tx ID lari" })
  recheckFixedList(
    @Query('limit') limit?: string,
    @Query('withTxIds') withTxIds?: string,
    @Query('maxTxPerContract') maxTxPerContract?: string,
  ) {
    return this.svc.getRecheckFixedList(
      limit ? Number(limit) : 5000,
      withTxIds !== 'false', // default true
      maxTxPerContract ? Number(maxTxPerContract) : 50,
    );
  }

  @Get('transactions/:id/history')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: 'Tranzaksiya kategoriya tarixi — kim qachon nimani o\'zgartirdi' })
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getHistory(id, limit ? Number(limit) : 50);
  }

  // ─── Schotchik backfill: eski noto'g'ri tasniflangan tranzaksiyalarni qayta tasniflash ───
  @Post('backfill-schotchik')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({
    summary: "Schotchik tranzaksiyalarini qayta tasniflash (DRY-RUN yoki APPLY)",
    description:
      "Eski (commit 2da4412 dan oldingi) noto'g'ri 'Взносы за квартиры' ga tushgan " +
      "счётчик / hisoblagich to'lovlarini topib, CLIENT_SCHETCHIK ('За счетчик') ga ko'chiradi. " +
      "Bog'langan OplataKv qatorlarini ham yangilaydi (sinxron). " +
      "Default — dryRun=true (tahlil natijasi). APPLY uchun: { dryRun: false }.",
  })
  backfillSchotchik(@Body() body: { dryRun?: boolean; dateFrom?: string; dateTo?: string }) {
    return this.svc.backfillSchotchik({
      dryRun: body?.dryRun !== false,
      dateFrom: body?.dateFrom,
      dateTo: body?.dateTo,
    });
  }
}
