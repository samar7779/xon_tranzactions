import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SettingsService } from './settings.service';
import { SyncController } from './sync.controller';
import { PaymentsModule } from '../payments/payments.module';
import { CategorizationModule } from '../categorization/categorization.module';

@Module({
  imports: [PaymentsModule, CategorizationModule],
  providers: [SyncService, SettingsService],
  controllers: [SyncController],
  exports: [SyncService, SettingsService],
})
export class SyncModule {}
