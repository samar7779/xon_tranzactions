import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { CrmSverkaController } from './crm-sverka.controller';
import { CrmSverkaService } from './crm-sverka.service';

@Module({
  imports: [CrmModule],
  controllers: [CrmSverkaController],
  providers: [CrmSverkaService],
  exports: [CrmSverkaService],
})
export class CrmSverkaModule {}
