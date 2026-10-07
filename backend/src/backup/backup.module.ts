import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { BackupController } from './backup.controller';

/**
 * To'liq loyiha backup moduli — har kuni 21:00 (Toshkent) baza + kod + fayllarni
 * ZIP qilib Telegram arxiv kanaliga yuboradi. PrismaModule global (inject tayyor).
 */
@Module({
  providers: [BackupService],
  controllers: [BackupController],
  exports: [BackupService],
})
export class BackupModule {}
