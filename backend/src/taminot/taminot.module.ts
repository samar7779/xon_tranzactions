import { Module } from '@nestjs/common';
import { TaminotService } from './taminot.service';
import { TaminotController } from './taminot.controller';

// Ta'minot ERP (xontaminot) — faqat O'QISH. Alohida pg ulanishi ishlatiladi
// (Prisma bitta bazaga bog'langan), ulanish satri: TAMINOT_DATABASE_URL.
@Module({
  providers: [TaminotService],
  controllers: [TaminotController],
  exports: [TaminotService],
})
export class TaminotModule {}
