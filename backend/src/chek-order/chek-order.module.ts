import { Module } from '@nestjs/common';
import { ChekOrderController } from './chek-order.controller';
import { ChekOrderService } from './chek-order.service';
import { ChekTgController } from './chek-tg.controller';
import { ChekTgService } from './chek-tg.service';
import { SyncModule } from '../sync/sync.module';
import { CrmModule } from '../crm/crm.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';
import { GoogleExportModule } from '../google-export/google-export.module';

@Module({
  imports: [SyncModule, CrmModule, OplataKvModule, GoogleExportModule], // SettingsService + CrmService + OplataKvService + GoogleExportService (Chek payment sheet o'qish)
  controllers: [ChekOrderController, ChekTgController],
  providers: [ChekOrderService, ChekTgService],
})
export class ChekOrderModule {}
