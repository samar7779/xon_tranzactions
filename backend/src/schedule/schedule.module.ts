import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  imports: [CrmModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class PaymentScheduleModule {}
