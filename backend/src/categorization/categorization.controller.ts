import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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
  categorizeOne(
    @Param('id') id: string,
    @Query('force') force: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.categorizeOne(id, { force: force === 'true', actor: 'manual', actorId: userId });
  }

  // ─── Qo'lda kategoriya qo'yish ─────────────────────────────────
  @Post('transactions/:id/set')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Tranzaksiyaga qo\'lda kategoriya qo\'yish (har doim ustidan yoziladi)' })
  setManual(
    @Param('id') id: string,
    @Body() body: { categoryId: string | null; subcategoryId?: string | null },
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.setManual(id, body, userId);
  }

  // ─── Faqat shartnoma raqamini o'zgartirish ─────────────────────
  @Post('transactions/:id/set-contract')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Shartnoma raqamini qo\'lda o\'zgartirish (CRM\'da ham tasdiqlanadi)' })
  setContract(
    @Param('id') id: string,
    @Body() body: { contractNumber: string | null },
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.setContract(id, body.contractNumber, userId);
  }

  // ─── Kontragentni qo'lda tanlash (Counterparty jadvalidan) ───
  @Post('transactions/:id/set-counterparty')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Tranzaksiyaga Counterparty\'ni qo\'lda biriktirish (INN avto-lookup ustidan)' })
  setCounterparty(
    @Param('id') id: string,
    @Body() body: { counterpartyId: string | null },
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.setCounterparty(id, body.counterpartyId, userId);
  }

  // ─── Shartnomani qo'lda kiritish (CRM tekshirmasdan) ───
  @Post('transactions/:id/set-contract-manual')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Shartnoma raqamini qo\'lda kiritish (CRM tekshirmaydi)' })
  setContractManual(
    @Param('id') id: string,
    @Body() body: { contractNumber: string | null },
    @CurrentUser('id') userId: string,
  ) {
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
      'Yangi natija topilsa, sahifa yangilangach contractStatus avtomatik verified bo\'ladi.',
  })
  recheckXato() {
    return this.svc.recheckXatoContracts();
  }

  @Get('recheck-xato/status')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: 'Qayta tekshirish holati (progress + oxirgi 20 ta tuzatilgan)' })
  recheckStatus() {
    return this.svc.getRecheckStatus();
  }

  @Get('recheck-xato/fixed')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: "Tuzatilgan shartnomalar to'liq ro'yxati (txCount bilan)" })
  recheckFixedList(@Query('limit') limit?: string) {
    return this.svc.getRecheckFixedList(limit ? Number(limit) : 5000);
  }

  @Get('transactions/:id/history')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: 'Tranzaksiya kategoriya tarixi — kim qachon nimani o\'zgartirdi' })
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getHistory(id, limit ? Number(limit) : 50);
  }
}
