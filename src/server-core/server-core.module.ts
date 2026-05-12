import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ServerCoreService } from './server-core.service';

@Module({
  imports: [HttpModule],
  providers: [ServerCoreService],
  exports: [ServerCoreService],
})
export class ServerCoreModule {}
