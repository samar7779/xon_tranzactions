import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { StatementService } from './statement.service';
import { ReconcileService } from './reconcile.service';
import { InspectorService } from './inspector.service';
import { TransactionsController } from './transactions.controller';

@Module({
  controllers: [TransactionsController],
  providers: [TransactionsService, StatementService, ReconcileService, InspectorService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
