import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { PaymentsModule } from '../payments/payments.module';
import { CategorizationModule } from '../categorization/categorization.module';

@Module({
  imports: [PaymentsModule, CategorizationModule],
  providers: [SyncService],
  controllers: [SyncController],
  exports: [SyncService],
})
export class SyncModule {}
