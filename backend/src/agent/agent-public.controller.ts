import { Body, Controller, Get, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AgentService } from './agent.service';

function parseAuth(raw?: string): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

/**
 * Public — login talab qilmaydi. Maxfiy kalit (?key=...) bilan himoyalangan.
 * Agent Telegram tugmasi ochadigan XATO ro'yxati sahifasi shu endpointdan oladi.
 */
@ApiTags('agent-public')
@Controller('agent')
export class AgentPublicController {
  constructor(private readonly svc: AgentService) {}

  @Get('xato-list')
  @ApiOperation({ summary: "Maxfiy kalit bilan XATO to'lovlar ro'yxati (public)" })
  xatoList(@Query('key') key: string) {
    return this.svc.getPublicXatoList(key || '');
  }

  @Get('crm-search')
  @ApiOperation({ summary: 'CRM shartnoma qidirish (biriktirish modali uchun)' })
  crmSearch(@Query('key') key: string, @Query('q') q: string) {
    return this.svc.crmSearch(key || '', q || '');
  }

  @Post('assign')
  @ApiOperation({ summary: "XATO to'lovga CRM shartnomani biriktirish" })
  assign(@Body() body: { key?: string; oplataKvId?: string; contractNo?: string; name?: string }) {
    return this.svc.assignContract(body?.key || '', body?.oplataKvId || '', body?.contractNo || '', body?.name);
  }

  // ─── Telegram login_url (chat_id whitelist) ───
  @Post('tg/list')
  @ApiOperation({ summary: 'Telegram auth bilan XATO ro\'yxati (whitelist)' })
  tgList(@Body() body: { auth?: Record<string, any> }) {
    return this.svc.tgList(body?.auth || {});
  }

  @Post('tg/search')
  @ApiOperation({ summary: 'Telegram auth bilan CRM qidirish' })
  tgSearch(@Body() body: { auth?: Record<string, any>; q?: string }) {
    return this.svc.tgCrmSearch(body?.auth || {}, body?.q || '');
  }

  @Post('tg/assign')
  @ApiOperation({ summary: 'Telegram auth bilan shartnoma biriktirish' })
  tgAssign(@Body() body: { auth?: Record<string, any>; oplataKvId?: string; contractNo?: string }) {
    return this.svc.tgAssign(body?.auth || {}, body?.oplataKvId || '', body?.contractNo || '');
  }

  // ─── Ariza + majburiy fayl bilan yuborish (multipart) ───
  @Post('tg/submit')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Telegram auth bilan ariza + fayl yuborish' })
  tgSubmit(@UploadedFile() file: any, @Body() body: { auth?: string; oplataKvId?: string; contractNo?: string }) {
    return this.svc.tgSubmitFile(parseAuth(body?.auth), body?.oplataKvId || '', body?.contractNo || '', file);
  }

  @Post('submit')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Maxfiy kalit bilan ariza + fayl yuborish' })
  submit(@UploadedFile() file: any, @Body() body: { key?: string; oplataKvId?: string; contractNo?: string }) {
    return this.svc.submitFile(body?.key || '', body?.oplataKvId || '', body?.contractNo || '', file);
  }

  // ─── Ariza faylini ko'rish (pending modal) ───
  @Post('tg/file')
  @ApiOperation({ summary: 'Telegram auth bilan ariza faylini ochish' })
  async tgFile(@Body() body: { auth?: string; attachmentId?: string }, @Res() res: Response) {
    const { stream, att } = await this.svc.tgFile(parseAuth(body?.auth), body?.attachmentId || '');
    res.set({
      'Content-Type': att.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
    });
    stream.pipe(res);
  }

  // ─── Arizalar ro'yxati (audit sub-tab) ───
  @Post('tg/arizalar')
  @ApiOperation({ summary: 'Telegram auth bilan arizalar ro\'yxati (audit)' })
  tgArizalar(@Body() body: { auth?: string; status?: string; q?: string; page?: number }) {
    return this.svc.tgArizaList(parseAuth(body?.auth), { status: body?.status, q: body?.q, page: body?.page });
  }

  @Post('arizalar')
  @ApiOperation({ summary: 'Maxfiy kalit bilan arizalar ro\'yxati (audit)' })
  arizalar(@Body() body: { key?: string; status?: string; q?: string; page?: number }) {
    return this.svc.arizaList(body?.key || '', { status: body?.status, q: body?.q, page: body?.page });
  }

  @Post('file')
  @ApiOperation({ summary: 'Maxfiy kalit bilan ariza faylini ochish' })
  async file(@Body() body: { key?: string; attachmentId?: string }, @Res() res: Response) {
    const { stream, att } = await this.svc.keyFile(body?.key || '', body?.attachmentId || '');
    res.set({
      'Content-Type': att.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
    });
    stream.pipe(res);
  }
}
