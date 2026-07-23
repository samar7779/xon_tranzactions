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
  @ApiOperation({ summary: 'Agent sozlamasi — bot token, guruh, sana, interval, ish soati' })
  saveConfig(
    @Body() body: {
      botToken?: string; groupId?: string; enabled?: boolean; dateFrom?: string | null;
      intervalMin?: number; workStart?: string; workEnd?: string; maxPerRun?: number;
    },
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.saveConfig(body || {}, actorLabel(user));
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  @ApiOperation({ summary: "Agentni hozir ishga tushirish (XATO to'lovlarni guruhga)" })
  run(@Body() body: { limit?: number }) {
    return this.svc.runOnce({ limit: body?.limit });
  }
}
