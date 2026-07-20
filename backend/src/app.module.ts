import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { AdminUsersModule } from './admin-users/admin-users.module';
import { RolesModule } from './roles/roles.module';
import { BanksModule } from './banks/banks.module';
import { BankCredentialsModule } from './bank-credentials/bank-credentials.module';
import { BankAccountsModule } from './bank-accounts/bank-accounts.module';
import { TransactionsModule } from './transactions/transactions.module';
import { KapitalbankModule } from './integrations/kapitalbank/kapitalbank.module';
import { SyncModule } from './sync/sync.module';
import { DeployModule } from './deploy/deploy.module';
import { CustomersModule } from './customers/customers.module';
import { ContractsModule } from './contracts/contracts.module';
import { PaymentsModule } from './payments/payments.module';
import { ApiExplorerModule } from './api-explorer/api-explorer.module';
import { CrmModule } from './crm/crm.module';
import { CounterpartiesModule } from './counterparties/counterparties.module';
import { SverkaTelegramModule } from './sverka-telegram/sverka-telegram.module';
import { CategorizationModule } from './categorization/categorization.module';
import { ImportModule } from './import/import.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { XonpayModule } from './xonpay/xonpay.module';
import { OplataKvModule } from './oplata-kv/oplata-kv.module';
import { PaymentScheduleModule } from './schedule/schedule.module';
import { GoogleExportModule } from './google-export/google-export.module';
import { DeveloperApiModule } from './developer-api/developer-api.module';
import { ChekModule } from './chek/chek.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

    PrismaModule,
    CryptoModule,
    KapitalbankModule,

    AuthModule,
    AdminUsersModule,
    RolesModule,

    BanksModule,
    BankCredentialsModule,
    BankAccountsModule,
    TransactionsModule,

    // Billing
    CustomersModule,
    ContractsModule,
    PaymentsModule,

    SyncModule,
    DeployModule,
    ApiExplorerModule,
    CrmModule,
    CounterpartiesModule,
    SverkaTelegramModule,
    CategorizationModule,
    ImportModule,
    AttachmentsModule,
    XonpayModule,
    OplataKvModule,
    PaymentScheduleModule,
    GoogleExportModule,
    DeveloperApiModule,
    ChekModule,
  ],
})
export class AppModule {}
