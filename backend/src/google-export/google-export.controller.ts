import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { GoogleExportService } from './google-export.service';
import { SaveExportConfigDto, RunExportDto } from './dto/google-export.dto';

type AuthUser = { id?: string; email?: string; fullName?: string };

function actorLabel(u?: AuthUser): string {
  const parts: string[] = [];
  if (u?.fullName) parts.push(u.fullName);
  if (u?.email) parts.push(u.email);
  return parts.join(' · ') || 'system';
}

@ApiTags('google-export')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('google-export')
export class GoogleExportController {
  constructor(private readonly svc: GoogleExportService) {}

  @Get('config')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Export konfiguratsiyasi + credential holati (private key qaytmaydi)' })
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  @RequirePermissions(PERMISSIONS.EXPORT_MANAGE)
  @ApiOperation({ summary: 'Export konfiguratsiyasini saqlash (sheet ID, tab, mapping, filtr)' })
  saveConfig(@Body() body: SaveExportConfigDto, @CurrentUser() user?: AuthUser) {
    return this.svc.saveConfig(body?.sheets || [], actorLabel(user));
  }

  @Post('test')
  @RequirePermissions(PERMISSIONS.EXPORT_VIEW)
  @ApiOperation({ summary: 'Service-account ulanishini + har jadvalga ruxsatni tekshirish' })
  test() {
    return this.svc.testConnection();
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.EXPORT_RUN)
  @ApiOperation({ summary: 'Bitta sheet uchun eksport (clear + yozish). To\'liq natija/xato qaytadi.' })
  run(@Body() body: RunExportDto) {
    return this.svc.run(body.target);
  }
}
