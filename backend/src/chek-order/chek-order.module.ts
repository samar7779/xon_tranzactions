import { Module } from '@nestjs/common';
import { ChekOrderController } from './chek-order.controller';
import { ChekOrderService } from './chek-order.service';
import { SyncModule } from '../sync/sync.module';
import { CrmModule } from '../crm/crm.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';

@Module({
  imports: [SyncModule, CrmModule, OplataKvModule], // SettingsService + CrmService + OplataKvService (murojaat tuzatish)
  controllers: [ChekOrderController],
  providers: [ChekOrderService],
})
export class ChekOrderModule {}
