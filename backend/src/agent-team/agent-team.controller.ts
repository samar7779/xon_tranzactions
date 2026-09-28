import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { AgentTeamService } from './agent-team.service';
import type {
  AgentTeamAgents,
  AgentTeamChat,
  AgentTeamFactsSection,
  AgentTeamHealth,
  AgentTeamMemoryFile,
  AgentTeamMemoryFiles,
  AgentTeamMemoryLog,
  AgentTeamOverview,
  AgentTeamPlans,
  AgentTeamPromises,
  AgentTeamRun,
  AgentTeamRuns,
  AgentTeamSettings,
  AgentTeamTasks,
  ToggleAgentResponse,
} from './agent-team.types';

type AuthUser = { id?: string; email?: string; fullName?: string };
function actorLabel(u?: AuthUser): string {
  const parts: string[] = [];
  if (u?.fullName) parts.push(u.fullName);
  if (u?.email) parts.push(u.email);
  return parts.join(' · ') || 'system';
}

/**
 * Agent Support (@TRanSupport_bot jamoasi) — kuzatuv API.
 * GET'lar AGENT_VIEW, yagona yozuv (agentni yoqish/o'chirish) AGENT_MANAGE.
 * Support REJA tasdig'i ([Ha]/[Yo'q]) bu API'da YO'Q — faqat Telegram'da.
 */
@ApiTags('agent-team')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agent-team')
export class AgentTeamController {
  constructor(private readonly svc: AgentTeamService) {}

  @Get('overview')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Agentlar jamoasi umumiy holati (bot, bugun, kutilayotganlar, salomatlik)' })
  overview(): Promise<AgentTeamOverview> {
    return this.svc.overview();
  }

  @Get('agents')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: "Har agent: yoqilgan, model, bugun/7 kun statistikasi, oxirgi xato" })
  agents(): Promise<AgentTeamAgents> {
    return this.svc.agents();
  }

  @Put('agents/:name/enabled')
  @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  @ApiOperation({ summary: "Agentni yoqish/o'chirish (agents.kv_store agent_enabled_<nom> = '1' | '0')" })
  setEnabled(
    @Param('name') name: string,
    @Body() body: { enabled?: unknown },
    @CurrentUser() user?: AuthUser,
  ): Promise<ToggleAgentResponse> {
    return this.svc.setAgentEnabled(name, body, actorLabel(user));
  }

  @Get('runs')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Agent chaqiruvlari (agent_runs) — filtr + paginatsiya' })
  runs(
    @Query('agent') agent?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AgentTeamRuns> {
    return this.svc.runs({ agent, status, source, from, to, q, page, perPage });
  }

  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Bitta agent chaqiruvi' })
  run(@Param('id') id: string): Promise<AgentTeamRun> {
    return this.svc.run(id);
  }

  @Get('chat')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Leader suhbati (agent_chat_log) — kursor bilan' })
  chat(
    @Query('role') role?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('forward') forward?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ): Promise<AgentTeamChat> {
    return this.svc.chat({ role, q, from, to, forward, before, limit });
  }

  @Get('tasks')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Agent vazifalari (agent_tasks)' })
  tasks(
    @Query('status') status?: string,
    @Query('agent') agent?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AgentTeamTasks> {
    return this.svc.tasks({ status, agent, q, page, perPage });
  }

  @Get('promises')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: "Leader va'dalari (agent_promises)" })
  promises(@Query('status') status?: string, @Query('limit') limit?: string): Promise<AgentTeamPromises> {
    return this.svc.promises({ status, limit });
  }

  @Get('plans')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: "Support REJA: kutilayotganlar, ijro holati, tarix (tasdiq faqat Telegram'da)" })
  plans(): Promise<AgentTeamPlans> {
    return this.svc.plans();
  }

  @Get('memory/log')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Xotiraga yozuvlar logi (agent_memory) + tasdiq kutayotganlar' })
  memoryLog(
    @Query('source') source?: string,
    @Query('agent') agent?: string,
    @Query('result') result?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ): Promise<AgentTeamMemoryLog> {
    return this.svc.memoryLog({ source, agent, result, q, page, perPage });
  }

  @Get('memory/files')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: "agents/memory fayllari ro'yxati (oq ro'yxat)" })
  memoryFiles(): Promise<AgentTeamMemoryFiles> {
    return this.svc.memoryFiles();
  }

  @Get('memory/file')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: "Xotira fayli mazmuni (faqat oq ro'yxat nomi, <=256 KB)" })
  memoryFile(@Query('name') name?: string): Promise<AgentTeamMemoryFile> {
    return this.svc.memoryFile(name);
  }

  @Get('health')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Checker salomatlik tekshiruvlari, ogohlantirishlar, Facts, holat kalitlari' })
  health(): Promise<AgentTeamHealth> {
    return this.svc.health();
  }

  @Get('facts/section')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: "support_facts.json bo'limi" })
  factsSection(@Query('key') key?: string): Promise<AgentTeamFactsSection> {
    return this.svc.factsSection(key);
  }

  @Get('settings')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Bot sozlamalari (faqat o\'qish; sir qiymatlari qaytmaydi)' })
  settings(): Promise<AgentTeamSettings> {
    return this.svc.settings();
  }
}
