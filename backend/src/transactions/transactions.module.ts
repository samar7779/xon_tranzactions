import { Module } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { StatementService } from './statement.service';
import { ReconcileService } from './reconcile.service';
import { SverkaAgentService } from './sverka-agent.service';
import { InspectorService } from './inspector.service';
import { TransactionsController } from './transactions.controller';
import { SyncModule } from '../sync/sync.module';
import { SverkaTelegramModule } from '../sverka-telegram/sverka-telegram.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';

@Module({
  // OplataKvModule — o'chirilgan to'lovni tiklaganda ОплатыКв'ga qayta qo'shish uchun
  imports: [SyncModule, SverkaTelegramModule, OplataKvModule],
  controllers: [TransactionsController],
  providers: [TransactionsService, StatementService, ReconcileService, SverkaAgentService, InspectorService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
