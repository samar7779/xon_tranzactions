import { Module } from '@nestjs/common';
import { CategorizationModule } from '../categorization/categorization.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';
import { CorrectionModule } from '../correction/correction.module';
import { TrArizaService } from './tr-ariza.service';
import { TrMalumotService } from './tr-malumot.service';
import { TrSupportController } from './tr-support.controller';
import { TrSupportService } from './tr-support.service';

// TR Support: agent orqali to'lov tahrirlari (tarix + ortga qaytarish). agent-bridge ham ishlatadi.
@Module({
  imports: [CategorizationModule, OplataKvModule, CorrectionModule],
  controllers: [TrSupportController],
  providers: [TrSupportService, TrArizaService, TrMalumotService],
  exports: [TrSupportService, TrArizaService, TrMalumotService],
})
export class TrSupportModule {}
