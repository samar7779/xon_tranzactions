import { Module } from '@nestjs/common';
import { CategorizationModule } from '../categorization/categorization.module';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';
import { TrSupportController } from './tr-support.controller';
import { TrSupportService } from './tr-support.service';

// TR Support: agent orqali to'lov tahrirlari (tarix + ortga qaytarish). agent-bridge ham ishlatadi.
@Module({
  imports: [CategorizationModule, OplataKvModule],
  controllers: [TrSupportController],
  providers: [TrSupportService],
  exports: [TrSupportService],
})
export class TrSupportModule {}
