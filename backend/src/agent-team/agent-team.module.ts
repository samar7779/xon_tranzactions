import { Module } from '@nestjs/common';
import { AgentTeamController } from './agent-team.controller';
import { AgentTeamService } from './agent-team.service';

/**
 * Agent Support — Telegram agentlar jamoasi (@TRanSupport_bot) kuzatuvi.
 * `agents` sxemasini faqat o'qiydi (yagona yozuv: agent_enabled_<nom>). PrismaModule global.
 */
@Module({
  controllers: [AgentTeamController],
  providers: [AgentTeamService],
})
export class AgentTeamModule {}
