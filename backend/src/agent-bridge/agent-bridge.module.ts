import { Module } from '@nestjs/common';
import { ChekOrderModule } from '../chek-order/chek-order.module';
import { GoogleExportModule } from '../google-export/google-export.module';
import { AgentBridgeController } from './agent-bridge.controller';
import { AgentBridgeGuard } from './agent-bridge.guard';
import { AgentBridgeService } from './agent-bridge.service';

// agents/ boti uchun ichki ko'prik. ChekOrderService/GoogleExportService IMPORT orqali olinadi
// (o'zini providers'ga qo'shish TAQIQ — ikkinchi nusxa bo'lib qoladi). PrismaService/ConfigService global.
@Module({
  imports: [ChekOrderModule, GoogleExportModule],
  controllers: [AgentBridgeController],
  providers: [AgentBridgeService, AgentBridgeGuard],
})
export class AgentBridgeModule {}
