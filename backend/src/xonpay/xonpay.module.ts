import { Module } from '@nestjs/common';
import { XonpayController } from './xonpay.controller';
import { XonpayService } from './xonpay.service';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CrmModule],
  controllers: [XonpayController],
  providers: [XonpayService],
  exports: [XonpayService],
})
export class XonpayModule {}
