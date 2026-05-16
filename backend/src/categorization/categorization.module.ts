import { Module } from '@nestjs/common';
import { CategorizationController } from './categorization.controller';
import { CategorizationService } from './categorization.service';
import { CrmContractCacheService } from './crm-contract-cache.service';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CrmModule],
  controllers: [CategorizationController],
  providers: [CategorizationService, CrmContractCacheService],
  exports: [CategorizationService, CrmContractCacheService],
})
export class CategorizationModule {}
