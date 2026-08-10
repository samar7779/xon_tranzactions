import { Module } from '@nestjs/common';
import { VznosController } from './vznos.controller';
import { VznosService } from './vznos.service';
import { CategorizationModule } from '../categorization/categorization.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CategorizationModule, CrmModule], // CrmContractCacheService + CrmService uchun
  controllers: [VznosController],
  providers: [VznosService],
  exports: [VznosService],
})
export class VznosModule {}
