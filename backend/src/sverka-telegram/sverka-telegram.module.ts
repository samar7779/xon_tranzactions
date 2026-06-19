import { Module } from '@nestjs/common';
import { SverkaTelegramController } from './sverka-telegram.controller';
import { SverkaTelegramService } from './sverka-telegram.service';

@Module({
  controllers: [SverkaTelegramController],
  providers: [SverkaTelegramService],
  exports: [SverkaTelegramService],
})
export class SverkaTelegramModule {}
