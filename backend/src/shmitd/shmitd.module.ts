import { Module } from '@nestjs/common';
import { SyncModule } from '../sync/sync.module';
import { ShmitdController } from './shmitd.controller';
import { ShmitdService } from './shmitd.service';

@Module({
  imports: [SyncModule], // SettingsService (Prisma, Crypto, Config global)
  controllers: [ShmitdController],
  providers: [ShmitdService],
})
export class ShmitdModule {}
