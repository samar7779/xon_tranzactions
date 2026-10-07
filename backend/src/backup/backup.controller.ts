import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { BackupService } from './backup.service';

@ApiTags('backup')
@Controller('backup')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SYSTEM_DEPLOY)
@ApiBearerAuth()
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get('config')
  @ApiOperation({ summary: 'Backup sozlamalari (token MASKALANGAN) + holat' })
  config() {
    return this.backup.getConfigForApi();
  }

  @Post('config')
  @ApiOperation({ summary: 'Backup sozlamalarini saqlash (token bo\'sh kelsa o\'zgarmaydi)' })
  async saveConfig(
    @Body() body: { enabled?: boolean; times?: string; botToken?: string; chatId?: string },
    @Req() req: any,
  ) {
    const who = req?.user?.username || req?.user?.email || 'admin';
    await this.backup.setConfig(body || {}, who);
    return this.backup.getConfigForApi();
  }

  @Get('status')
  @ApiOperation({ summary: 'Backup holati (oxirgi natija, hajm, bo\'laklar)' })
  status() {
    return this.backup.getStatus();
  }

  @Post('run')
  @ApiOperation({ summary: 'Backup\'ni darhol ishga tushirish (qo\'lda)' })
  run() {
    // Fonda ishlaydi — so'rov darrov qaytadi (katta backup uzoq davom etishi mumkin).
    this.backup.runBackup('manual').catch(() => { /* status ichida yoziladi */ });
    return { ok: true, message: "Backup boshlandi — holatni /backup/status dan kuzating", status: this.backup.getStatus() };
  }
}
