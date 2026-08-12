import { Module } from '@nestjs/common';
import { ChekOrderController } from './chek-order.controller';
import { ChekOrderService } from './chek-order.service';
import { SyncModule } from '../sync/sync.module';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [SyncModule, CrmModule], // SettingsService + CrmService (PrismaService/CryptoService global)
  controllers: [ChekOrderController],
  providers: [ChekOrderService],
})
export class ChekOrderModule {}
