import { Module, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { KapitalbankClient } from './kapitalbank.client';

@Global()
@Module({
  imports: [HttpModule],
  providers: [KapitalbankClient],
  exports: [KapitalbankClient],
})
export class KapitalbankModule {}
