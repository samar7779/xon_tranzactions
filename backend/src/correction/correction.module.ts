import { Module } from '@nestjs/common';
import { CorrectionController } from './correction.controller';
import { CorrectionService } from './correction.service';
import { CategorizationModule } from '../categorization/categorization.module';
import { AttachmentsModule } from '../attachments/attachments.module';

@Module({
  imports: [CategorizationModule, AttachmentsModule],
  controllers: [CorrectionController],
  providers: [CorrectionService],
  exports: [CorrectionService],
})
export class CorrectionModule {}
