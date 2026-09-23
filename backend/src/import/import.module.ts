import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { CategorizationModule } from '../categorization/categorization.module';

@Module({
  imports: [CategorizationModule], // Hamkor vipiska importidan keyin avto-kategoriyalash uchun
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
