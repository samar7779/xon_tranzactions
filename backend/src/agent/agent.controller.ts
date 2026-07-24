import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { AgentService } from './agent.service';

type AuthUser = { id?: string; email?: string; fullName?: string };
function actorLabel(u?: AuthUser): string {
  const parts: string[] = [];
  if (u?.fullName) parts.push(u.fullName);
  if (u?.email) parts.push(u.email);
  return parts.join(' · ') || 'system';
}

@ApiTags('agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agent')
export class AgentController {
  constructor(private readonly svc: AgentService) {}

  @Get('config')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Agent sozlamasi + holati (bot token qaytmaydi)' })
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  @ApiOperation({ summary: 'Agent sozlamasi — bot token, guruh, sana, kunlik vaqt' })
  saveConfig(
    @Body() body: {
      botToken?: string; groupId?: string; enabled?: boolean; dateFrom?: string | null; dailyTime?: string;
      aiKey?: string; aiModel?: string; aiEnabled?: boolean;
    },
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.saveConfig(body || {}, actorLabel(user));
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  @ApiOperation({ summary: "Agentni hozir ishga tushirish (kunlik digest'ni jo'natish)" })
  run() {
    return this.svc.runOnce();
  }

  @Post('ai/run')
  @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  @ApiOperation({ summary: 'AI agentni kutilayotgan arizalarga ishga tushirish' })
  aiRun(@Body() body: { limit?: number }) {
    return this.svc.runAiAgent(Number(body?.limit) || 20);
  }
}
