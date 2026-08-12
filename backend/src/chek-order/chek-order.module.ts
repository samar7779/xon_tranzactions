import { Module } from '@nestjs/common';
import { ChekOrderController } from './chek-order.controller';
import { ChekOrderService } from './chek-order.service';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [SyncModule], // SettingsService uchun (PrismaService/CryptoService global)
  controllers: [ChekOrderController],
  providers: [ChekOrderService],
})
export class ChekOrderModule {}
