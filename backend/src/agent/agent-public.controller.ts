import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentService } from './agent.service';

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
}
