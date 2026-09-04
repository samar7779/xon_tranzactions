import { Module, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HamkorbankClient } from './hamkorbank.client';

// @Global — KapitalbankModule kabi, har joyda inject qilinadi (sync, inspector, ...).
@Global()
@Module({
  imports: [HttpModule],
  providers: [HamkorbankClient],
  exports: [HamkorbankClient],
})
export class HamkorbankModule {}
