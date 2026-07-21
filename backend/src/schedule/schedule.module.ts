import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [CrmModule, OplataKvModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class PaymentScheduleModule {}
