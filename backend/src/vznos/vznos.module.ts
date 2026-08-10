import { Module } from '@nestjs/common';
import { VznosController } from './vznos.controller';
import { VznosService } from './vznos.service';
import { CategorizationModule } from '../categorization/categorization.module';

@Module({
  imports: [CategorizationModule], // CrmContractCacheService uchun
  controllers: [VznosController],
  providers: [VznosService],
  exports: [VznosService],
})
export class VznosModule {}
