import { Module } from '@nestjs/common';
import { ChekOrderController } from './chek-order.controller';
import { ChekOrderService } from './chek-order.service';
import { ChekTgController } from './chek-tg.controller';
import { ChekTgService } from './chek-tg.service';
import { SyncModule } from '../sync/sync.module';
import { CrmModule } from '../crm/crm.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';

@Module({
  imports: [SyncModule, CrmModule, OplataKvModule], // SettingsService + CrmService + OplataKvService; JwtService global (AuthModule)
  controllers: [ChekOrderController, ChekTgController],
  providers: [ChekOrderService, ChekTgService],
})
export class ChekOrderModule {}
