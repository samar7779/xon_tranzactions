import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [OplataKvModule, SyncModule],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
