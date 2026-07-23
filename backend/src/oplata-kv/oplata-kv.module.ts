import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OplataKvController } from './oplata-kv.controller';
import { OplataKvService } from './oplata-kv.service';
import { MemorialOrderService } from './memorial-order/memorial-order.service';
import { CrmModule } from '../crm/crm.module';
import { CategorizationModule } from '../categorization/categorization.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [
    CrmModule, CategorizationModule, SyncModule,
    HttpModule.register({ timeout: 30000 }),
  ],
  controllers: [OplataKvController],
  providers: [OplataKvService, MemorialOrderService],
  exports: [OplataKvService],
})
export class OplataKvModule {}
