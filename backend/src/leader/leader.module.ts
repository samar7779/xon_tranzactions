import { Module } from '@nestjs/common';
import { LeaderConfigService } from './leader-config.service';
import { LeaderClaudeService } from './leader-claude.service';
import { LeaderTelegramApi } from './leader-telegram.api';
import { LeaderMemoryService } from './leader-memory.service';
import { LeaderFactsService } from './leader-facts.service';
import { LeaderCodeToolsService } from './leader-code-tools.service';
import { LeaderHealthService } from './leader-health.service';
import { LeaderAlertService } from './leader-alert.service';
import { LeaderOrchestratorService } from './leader-orchestrator.service';
import { LeaderBotService } from './leader-bot.service';

/**
 * Leader agentlar jamoasi (alohida Telegram bot, faqat egasi uchun).
 * v1: faqat ko'radi va tahlil qiladi — yozish faqat leader_* jadvallariga.
 * PrismaService/CryptoService global; @Cron uchun ScheduleModule AppModule'da.
 * Boshqa modul servislari (DeployService va h.k.) ModuleRef orqali olinadi — modul importi YO'Q.
 */
@Module({
  providers: [
    LeaderConfigService,
    LeaderClaudeService,
    LeaderTelegramApi,
    LeaderMemoryService,
    LeaderFactsService,
    LeaderCodeToolsService,
    LeaderHealthService,
    LeaderAlertService,
    LeaderOrchestratorService,
    LeaderBotService,
  ],
})
export class LeaderModule {}
