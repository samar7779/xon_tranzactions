import { Controller, Get, Query } from '@nestjs/common';
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
}
