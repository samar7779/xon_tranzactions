import { Module } from '@nestjs/common';
import { OplataKvController } from './oplata-kv.controller';
import { OplataKvService } from './oplata-kv.service';
import { CrmModule } from '../crm/crm.module';
import { CategorizationModule } from '../categorization/categorization.module';

@Module({
  imports: [CrmModule, CategorizationModule],
  controllers: [OplataKvController],
  providers: [OplataKvService],
  exports: [OplataKvService],
})
export class OplataKvModule {}
