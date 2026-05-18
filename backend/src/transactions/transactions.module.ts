import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { StatementService } from './statement.service';
import { ReconcileService } from './reconcile.service';
import { InspectorService } from './inspector.service';
import { TransactionsController } from './transactions.controller';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, StatementService, ReconcileService, InspectorService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
