import { Module } from '@nestjs/common';
import { GoogleExportController } from './google-export.controller';
import { GoogleExportService } from './google-export.service';
import { OplataKvModule } from '../oplata-kv/oplata-kv.module';
import { SyncModule } from '../sync/sync.module';

@Module({
  imports: [OplataKvModule, SyncModule],
  controllers: [GoogleExportController],
  providers: [GoogleExportService],
  exports: [GoogleExportService],
})
export class GoogleExportModule {}
