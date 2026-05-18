import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AttachmentsService } from './attachments.service';

@ApiTags('attachments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('transactions/:txId/attachments')
export class AttachmentsController {
  constructor(private readonly svc: AttachmentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Tranzaksiyaning biriktirilgan fayllari' })
  list(@Param('txId') txId: string) {
    return this.svc.list(txId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Fayl biriktirish (PDF/DOCX/Image, max 25MB)' })
  async upload(
    @Param('txId') txId: string,
    @UploadedFile() file: any,
    @Body() body: { type?: string; contractNumber?: string; notes?: string },
    @CurrentUser('email') email?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Fayl yuborilmadi');
    return this.svc.upload(txId, file, {
      type: body?.type,
      contractNumber: body?.contractNumber || null,
      notes: body?.notes || null,
      uploadedBy: email || null,
    });
  }

  @Get(':attId/download')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_VIEW)
  @ApiOperation({ summary: 'Faylni yuklab olish' })
  async download(
    @Param('txId') txId: string,
    @Param('attId') attId: string,
    @Res() res: Response,
  ) {
    const { stream, att } = await this.svc.getFile(txId, attId);
    res.set({
      'Content-Type': att.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      'Content-Length': String(att.fileSize),
    });
    stream.pipe(res);
  }

  @Delete(':attId')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: 'Faylni o\'chirish (diskdan + DB + Telegram xabar)' })
  delete(
    @Param('txId') txId: string,
    @Param('attId') attId: string,
    @CurrentUser('email') email?: string,
  ) {
    return this.svc.delete(txId, attId, email);
  }
}
