import { Module } from '@nestjs/common';
import { CounterpartiesController } from './counterparties.controller';
import { CounterpartiesService } from './counterparties.service';
import { CounterpartiesCron } from './counterparties.cron';
import { DidoxService } from './didox.service';

@Module({
  controllers: [CounterpartiesController],
  providers: [CounterpartiesService, DidoxService, CounterpartiesCron],
  exports: [CounterpartiesService, DidoxService],
})
export class CounterpartiesModule {}
