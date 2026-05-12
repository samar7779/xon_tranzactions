import { Module } from '@nestjs/common';
import { BankCredentialsService } from './bank-credentials.service';
import { BankCredentialsController } from './bank-credentials.controller';
import { KapitalbankModule } from '../integrations/kapitalbank/kapitalbank.module';

@Module({
  imports: [KapitalbankModule],
  providers: [BankCredentialsService],
  controllers: [BankCredentialsController],
  exports: [BankCredentialsService],
})
export class BankCredentialsModule {}
