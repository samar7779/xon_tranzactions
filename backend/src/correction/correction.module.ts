import { Module } from '@nestjs/common';
import { CorrectionController } from './correction.controller';
import { CorrectionService } from './correction.service';
import { AgentAiService } from './agent-ai.service';
import { CategorizationModule } from '../categorization/categorization.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { CrmModule } from '../crm/crm.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';

@Module({
  imports: [CategorizationModule, AttachmentsModule, CrmModule, OplataKvModule],
  controllers: [CorrectionController],
  providers: [CorrectionService, AgentAiService],
  exports: [CorrectionService, AgentAiService],
})
export class CorrectionModule {}
