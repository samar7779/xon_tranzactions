import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { BankPwdController } from './bank-pwd.controller';
import { BankPwdService } from './bank-pwd.service';

@Module({
  imports: [SyncModule], // SettingsService (Prisma, Crypto, KapitalbankClient global)
  controllers: [BankPwdController],
  providers: [BankPwdService],
})
export class BankPwdModule {}
