import { Module } from '@nestjs/common';
import { CategorizationModule } from '../categorization/categorization.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';
import { CorrectionModule } from '../correction/correction.module';
import { TrArizaService } from './tr-ariza.service';
import { TrMalumotService } from './tr-malumot.service';
import { TrPerebroskaService } from './tr-perebroska.service';
import { TrTarixService } from './tr-tarix.service';
import { SyncModule } from '../sync/sync.module';
import { TrSupportController } from './tr-support.controller';
import { TrSupportService } from './tr-support.service';

// TR Support: agent orqali to'lov tahrirlari (tarix + ortga qaytarish). agent-bridge ham ishlatadi.
@Module({
  imports: [CategorizationModule, OplataKvModule, CorrectionModule, SyncModule],
  controllers: [TrSupportController],
  providers: [TrSupportService, TrArizaService, TrMalumotService, TrPerebroskaService, TrTarixService],
  exports: [TrSupportService, TrArizaService, TrMalumotService, TrPerebroskaService, TrTarixService],
})
export class TrSupportModule {}
