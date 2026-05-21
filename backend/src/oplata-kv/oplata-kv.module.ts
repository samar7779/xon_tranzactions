import { Module } from '@nestjs/common';
import { OplataKvController } from './oplata-kv.controller';
import { OplataKvService } from './oplata-kv.service';

@Module({
  controllers: [OplataKvController],
  providers: [OplataKvService],
  exports: [OplataKvService],
})
export class OplataKvModule {}
