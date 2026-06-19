import { Module } from '@nestjs/common';
import { CounterpartiesController } from './counterparties.controller';
import { CounterpartiesService } from './counterparties.service';
import { CounterpartiesCron } from './counterparties.cron';
import { DidoxService } from './didox.service';
import { ChamberService } from './chamber.service';
import { XontaminotService } from './xontaminot.service';

@Module({
  controllers: [CounterpartiesController],
  providers: [CounterpartiesService, DidoxService, ChamberService, CounterpartiesCron, XontaminotService],
  exports: [CounterpartiesService, DidoxService, ChamberService],
})
export class CounterpartiesModule {}
