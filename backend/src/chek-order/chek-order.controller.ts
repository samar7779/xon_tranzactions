import {
  BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Res,
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
import { ChekOrderService } from './chek-order.service';
import { ListChekOrderDto, ManualCheckDto } from './dto/chek-order.dto';

type AuthUser = { id?: string; email?: string; fullName?: string };

function actorFrom(u?: AuthUser) {
  const parts: string[] = [];
  if (u?.fullName) parts.push(u.fullName);
  if (u?.email) parts.push(u.email);
  return { id: u?.id ?? null, name: parts.length ? parts.join(' · ') : null };
}

function fixFileName(name?: string): string | undefined {
  if (!name) return name;
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch { return name; }
}

@ApiTags('chek-order')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('chek-order')
export class ChekOrderController {
  constructor(private readonly svc: ChekOrderService) {}

  @Post('analyze')
  @RequirePermissions(PERMISSIONS.CHEKORDER_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: "Memorial order surat/PDF — agent o'qib, tranzaksiyada bor-yo'qligini tekshiradi" })
  async analyze(@UploadedFile() file: any, @CurrentUser() u?: AuthUser) {
    if (!file?.buffer) throw new BadRequestException('Hujjat (file) majburiy');
    return this.svc.analyzeFile({
      buffer: file.buffer,
      originalname: fixFileName(file.originalname) || 'order',
      mimetype: file.mimetype || 'application/octet-stream',
      size: file.size,
    }, actorFrom(u));
  }

  @Post('manual')
  @RequirePermissions(PERMISSIONS.CHEKORDER_MANAGE)
  @ApiOperation({ summary: "Qo'lда order raqam(lar)ini tranzaksiyada tekshirish" })
  async manual(@Body() body: ManualCheckDto, @CurrentUser() u?: AuthUser) {
    return this.svc.checkManual(body?.orderNos || '', actorFrom(u));
  }

  @Get()
  @RequirePermissions(PERMISSIONS.CHEKORDER_HISTORY)
  @ApiOperation({ summary: 'Chek order tarixi (Tarix sub-tab)' })
  list(@Query() q: ListChekOrderDto) {
    return this.svc.list(q);
  }

  @Get('contract-info')
  @RequirePermissions(PERMISSIONS.CHEKORDER_VIEW)
  @ApiOperation({ summary: 'Shartnoma CRM ma\'lumoti — mijoz/obyekt/xonadon/qiymat/qoldiq' })
  contractInfo(@Query('contract') contract: string) {
    return this.svc.contractInfo(contract);
  }

  @Get('crm-suggest')
  @RequirePermissions(PERMISSIONS.CHEKORDER_VIEW)
  @ApiOperation({ summary: 'Shartnoma raqami avtomatik takliflari (CRM)' })
  crmSuggest(@Query('q') q: string) {
    return this.svc.crmSuggest(q);
  }

  @Get('contract-payments')
  @RequirePermissions(PERMISSIONS.CHEKORDER_VIEW)
  @ApiOperation({ summary: 'Shartnoma bo\'yicha tranzaksiya (to\'lov)lar' })
  contractPayments(@Query('contract') contract: string) {
    return this.svc.contractPayments(contract);
  }

  @Get('batch/:batchId')
  @RequirePermissions(PERMISSIONS.CHEKORDER_VIEW)
  @ApiOperation({ summary: 'Bitta yuklash (batch) natijalari' })
  getBatch(@Param('batchId') batchId: string) {
    return this.svc.getBatch(batchId);
  }

  @Get(':id/file')
  @RequirePermissions(PERMISSIONS.CHEKORDER_VIEW)
  @ApiOperation({ summary: 'Yuklangan order faylini olish' })
  async getFile(@Param('id') id: string, @Res() res: Response) {
    const { buffer, mime, name } = await this.svc.getFile(id);
    res.set({
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${encodeURIComponent(name)}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CHEKORDER_VIEW)
  @ApiOperation({ summary: 'Bitta chek order yozuvi' })
  getOne(@Param('id') id: string) {
    return this.svc.getOne(id);
  }

  @Delete()
  @RequirePermissions(PERMISSIONS.CHEKORDER_MANAGE)
  @ApiOperation({ summary: "Butun tarixni o'chirish" })
  clearAll() {
    return this.svc.clearAll();
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CHEKORDER_MANAGE)
  @ApiOperation({ summary: "Chek order yozuvini o'chirish" })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
