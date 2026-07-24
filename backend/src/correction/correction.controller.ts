import {
  BadRequestException, Body, Controller, Get, Param, Post, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CorrectionService } from './correction.service';

/**
 * XATO to'lovni to'g'rilash arizalari — tasdiqlovchi xodim uchun.
 * (Yuborish agent-public orqali; bu yerda ko'rish/tasdiqlash/rad etish.)
 */
@ApiTags('correction')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('correction')
export class CorrectionController {
  constructor(private readonly svc: CorrectionService) {}

  @Get('stats')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Ariza statistikasi (kutilmoqda / tasdiqlangan)' })
  stats() {
    return this.svc.stats();
  }

  @Get('pending')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Kutilayotgan arizalar' })
  pending(@Query('q') q?: string, @Query('page') page?: string, @Query('perPage') perPage?: string) {
    return this.svc.listPending({ q, page: Number(page) || 1, perPage: Number(perPage) || 50 });
  }

  @Get('approved')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Tasdiqlangan arizalar (audit + filtrlar)' })
  approved(
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actor') actor?: string,
    @Query('flow') flow?: 'all' | 'in' | 'out',
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.svc.listApproved({ q, from, to, actor, flow, page: Number(page) || 1, perPage: Number(perPage) || 50 });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Ariza yuborish (asosiy app ichidan)' })
  create(
    @Body() body: { txId?: string; oplataKvId?: string; contractNo?: string; note?: string },
    @CurrentUser('id') userId?: string,
    @CurrentUser('email') email?: string,
  ) {
    return this.svc.createRequest({
      txId: body?.txId || null,
      oplataKvId: body?.oplataKvId || null,
      proposedContractNo: body?.contractNo || null,
      note: body?.note || null,
      source: 'app',
      submittedByName: email || 'app',
      submittedById: userId || null,
    });
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Arizani tasdiqlash — ariza fayl + shartnoma + kategoriya' })
  async approve(
    @Param('id') id: string,
    @UploadedFile() file: any,
    @Body() body: { contractNo?: string; categoryId?: string; subCategoryId?: string },
    @CurrentUser('id') userId: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Ariza fayli majburiy');
    return this.svc.approve(id, file, {
      contractNo: body?.contractNo || null,
      categoryId: body?.categoryId || null,
      subCategoryId: body?.subCategoryId || null,
      actorId: userId,
    });
  }

  @Post(':id/reject')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Arizani rad etish' })
  reject(@Param('id') id: string, @Body() body: { reason?: string }, @CurrentUser('id') userId: string) {
    return this.svc.reject(id, body?.reason || '', userId);
  }

  @Post('hide')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: "To'lovni XATO ro'yxatidan yashirish / qaytarish" })
  hide(@Body() body: { txId?: string; hidden?: boolean }, @CurrentUser('id') userId: string) {
    if (!body?.txId) throw new BadRequestException("To'lov ko'rsatilmagan");
    return this.svc.setHidden(body.txId, body?.hidden !== false, userId);
  }

  @Post('direct')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: "To'g'ridan-to'g'ri to'g'rilash (raw XATO'dan) — yaratadi + tasdiqlaydi" })
  async direct(
    @UploadedFile() file: any,
    @Body() body: { txId?: string; contractNo?: string; categoryId?: string; subCategoryId?: string },
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email?: string,
  ) {
    if (!body?.txId) throw new BadRequestException("To'lov ko'rsatilmagan");
    if (!file?.buffer) throw new BadRequestException('Ariza fayli majburiy');
    return this.svc.directCorrect(body.txId, file, {
      contractNo: body?.contractNo || null,
      categoryId: body?.categoryId || null,
      subCategoryId: body?.subCategoryId || null,
      actorId: userId,
      actorEmail: email || null,
    });
  }
}
