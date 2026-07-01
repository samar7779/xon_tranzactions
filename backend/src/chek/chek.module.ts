import { Module } from '@nestjs/common';
import { ChekController } from './chek.controller';
import { ChekService } from './chek.service';
import { CrmModule } from '../crm/crm.module';

@Module({
  imports: [CrmModule],
  controllers: [ChekController],
  providers: [ChekService],
})
export class ChekModule {}
