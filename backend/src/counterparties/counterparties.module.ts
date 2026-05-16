import { Module } from '@nestjs/common';
import { CounterpartiesController } from './counterparties.controller';
import { CounterpartiesService } from './counterparties.service';
import { CounterpartiesCron } from './counterparties.cron';
import { DidoxService } from './didox.service';
import { ChamberService } from './chamber.service';

@Module({
  controllers: [CounterpartiesController],
  providers: [CounterpartiesService, DidoxService, ChamberService, CounterpartiesCron],
  exports: [CounterpartiesService, DidoxService, ChamberService],
})
export class CounterpartiesModule {}
