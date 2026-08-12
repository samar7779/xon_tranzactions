import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

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
import { VznosModule } from './vznos/vznos.module';
import { ChekOrderModule } from './chek-order/chek-order.module';
import { GoogleExportModule } from './google-export/google-export.module';
import { AgentModule } from './agent/agent.module';
import { DeveloperApiModule } from './developer-api/developer-api.module';
import { ChekModule } from './chek/chek.module';
import { CorrectionModule } from './correction/correction.module';
import { CorrectionBotModule } from './correction-bot/correction-bot.module';
import { ShmitdModule } from './shmitd/shmitd.module';
import { BankPwdModule } from './bank-pwd/bank-pwd.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    // FIX (A1): brute-force/DoS himoyasi — global limit (mijoz IP bo'yicha, trust proxy bilan).
    // Limit generous (jonli admin ishlatishni buzmasin), lekin brute-force (mingga) bloklanadi.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),

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
    VznosModule,
    ChekOrderModule,
    ImportModule,
    AttachmentsModule,
    XonpayModule,
    OplataKvModule,
    GoogleExportModule,
    AgentModule,
    CorrectionBotModule,
    ShmitdModule,
    BankPwdModule,
    DeveloperApiModule,
    ChekModule,
    CorrectionModule,
  ],
  providers: [
    // FIX (A1): ThrottlerGuard'ni GLOBAL bog'laymiz — avval ThrottlerModule sozlangan-u,
    // APP_GUARD sifatida ulanmagan edi (throttling o'lik edi). Endi barcha route himoyalangan.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
