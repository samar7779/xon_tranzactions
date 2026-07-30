import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { CorrectionBotController } from './correction-bot.controller';
import { CorrectionBotService } from './correction-bot.service';

@Module({
  imports: [SyncModule], // SettingsService uchun (CryptoService global)
  controllers: [CorrectionBotController],
  providers: [CorrectionBotService],
  exports: [CorrectionBotService],
})
export class CorrectionBotModule {}
