import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';
import { CrmModule } from '../crm/crm.module';
import { CorrectionBotController } from './correction-bot.controller';
import { CorrectionBotService } from './correction-bot.service';
import { CorrectionBotRunnerService } from './correction-bot-runner.service';

@Module({
  imports: [SyncModule, OplataKvModule, CrmModule], // Settings + assign + CRM qidiruv (Crypto global)
  controllers: [CorrectionBotController],
  providers: [CorrectionBotService, CorrectionBotRunnerService],
  exports: [CorrectionBotService],
})
export class CorrectionBotModule {}
