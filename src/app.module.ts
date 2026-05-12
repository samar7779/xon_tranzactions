import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma/prisma.module';
import { TransactionsModule } from './transactions/transactions.module';
import { ServerCoreModule } from './server-core/server-core.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    TransactionsModule,
    ServerCoreModule,
  ],
})
export class AppModule {}
