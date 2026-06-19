import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { StatementService } from './statement.service';
import { ReconcileService } from './reconcile.service';
import { InspectorService } from './inspector.service';
import { TransactionsController } from './transactions.controller';
import { SyncModule } from '../sync/sync.module';
import { SverkaTelegramModule } from '../sverka-telegram/sverka-telegram.module';

@Module({
  imports: [SyncModule, SverkaTelegramModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, StatementService, ReconcileService, InspectorService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
