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
import { ChekOrderService } from './chek-order.service';
import {
  ListChekOrderDto, ManualCheckDto,
  AssistantChatDto, CreateTicketDto, UpdateTicketDto, ListTicketsDto,
  ResolveChatDto, ApplyCorrectionDto, LocateLinkDto,
} from './dto/chek-order.dto';

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

  // ─── AI yordamchi ───
  @Post('assistant/chat')
  @RequirePermissions(PERMISSIONS.CHEKORDER_ASSISTANT)
  @ApiOperation({ summary: 'AI yordamchi bilan suhbat (muammo aniqlash)' })
  assistantChat(@Body() body: AssistantChatDto, @CurrentUser() u?: AuthUser) {
    return this.svc.assistantChat(body || {}, actorFrom(u));
  }

  // ─── Murojaatlar (tickets) ───
  @Get('assignees')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: 'Mas\'ul tanlash uchun foydalanuvchilar' })
  assignees() {
    return this.svc.assignees();
  }

  @Post('tickets')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: 'Murojaat yaratish' })
  createTicket(@Body() body: CreateTicketDto, @CurrentUser() u?: AuthUser) {
    return this.svc.createTicket(body, actorFrom(u));
  }

  @Get('tickets')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: 'Murojaatlar ro\'yxati' })
  listTickets(@Query() q: ListTicketsDto, @CurrentUser() u?: AuthUser) {
    return this.svc.listTickets(q, actorFrom(u));
  }

  @Get('tickets/:id')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: 'Bitta murojaat' })
  getTicket(@Param('id') id: string) {
    return this.svc.getTicket(id);
  }

  @Patch('tickets/:id')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: 'Murojaatni yangilash (holat/mas\'ul/hal qilish)' })
  updateTicket(@Param('id') id: string, @Body() body: UpdateTicketDto, @CurrentUser() u?: AuthUser) {
    return this.svc.updateTicket(id, body, actorFrom(u));
  }

  @Delete('tickets/:id')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: 'Murojaatni o\'chirish' })
  removeTicket(@Param('id') id: string) {
    return this.svc.removeTicket(id);
  }

  // ─── Murojaatni hal qilish (to'lov taqsimotini tuzatish) ───
  @Get('tickets/:id/payment')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: "Murojaatga bog'langan to'lov + hozirgi taqsimoti" })
  ticketPayment(@Param('id') id: string) {
    return this.svc.ticketPaymentContext(id);
  }

  @Post('tickets/:id/resolve/chat')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: 'Tuzatuvchi agent bilan suhbat' })
  resolveChat(@Param('id') id: string, @Body() body: ResolveChatDto, @CurrentUser() u?: AuthUser) {
    return this.svc.resolveChat(id, body || {}, actorFrom(u));
  }

  @Post('tickets/:id/resolve/apply')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: "Tuzatishni qo'llash (ОплатыКв taqsimoti + murojaat Bajarildi)" })
  applyCorrection(@Param('id') id: string, @Body() body: ApplyCorrectionDto, @CurrentUser() u?: AuthUser) {
    return this.svc.applyCorrection(id, body, actorFrom(u));
  }

  // ─── To'lovni topish (not_found murojaatlar) ───
  @Post('tickets/:id/locate/chat')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: "Topuvchi agent — chek bo'yicha to'lovni qidiradi" })
  locateChat(@Param('id') id: string, @Body() body: ResolveChatDto, @CurrentUser() u?: AuthUser) {
    return this.svc.locateChat(id, body || {}, actorFrom(u));
  }

  @Post('tickets/:id/locate/link')
  @RequirePermissions(PERMISSIONS.CHEKORDER_TICKETS)
  @ApiOperation({ summary: "Topilgan to'lovni murojaatga bog'lash" })
  locateLink(@Param('id') id: string, @Body() body: LocateLinkDto, @CurrentUser() u?: AuthUser) {
    return this.svc.locateLink(id, body?.key, body?.contractNo, actorFrom(u));
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
