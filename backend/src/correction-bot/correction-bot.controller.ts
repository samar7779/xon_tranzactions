import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CorrectionBotService } from './correction-bot.service';

type AuthUser = { id?: string; email?: string; fullName?: string };
function actorLabel(u?: AuthUser): string {
  const parts: string[] = [];
  if (u?.fullName) parts.push(u.fullName);
  if (u?.email) parts.push(u.email);
  return parts.join(' · ') || 'system';
}

@ApiTags('correction-bot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('correction-bot')
export class CorrectionBotController {
  constructor(private readonly svc: CorrectionBotService) {}

  @Get('config')
  @RequirePermissions(PERMISSIONS.AGENT_VIEW)
  @ApiOperation({ summary: 'Tuzatish bot sozlamasi (bot token qaytmaydi)' })
  getConfig() {
    return this.svc.getConfig();
  }

  @Put('config')
  @RequirePermissions(PERMISSIONS.AGENT_MANAGE)
  @ApiOperation({ summary: 'Tuzatish bot sozlamasi — token, guruh, whitelist, yoqish' })
  saveConfig(
    @Body() body: { botToken?: string; groupId?: string; enabled?: boolean; whitelist?: Array<{ id: string; name: string }> },
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.saveConfig(body || {}, actorLabel(user));
  }
}
