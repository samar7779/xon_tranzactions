import { Module } from '@nestjs/common';
import { CorrectionController } from './correction.controller';
import { CorrectionService } from './correction.service';
import { CategorizationModule } from '../categorization/categorization.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CategorizationModule, AttachmentsModule, CrmModule],
  controllers: [CorrectionController],
  providers: [CorrectionService],
  exports: [CorrectionService],
})
export class CorrectionModule {}
