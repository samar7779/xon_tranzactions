import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { BankPwdService } from './bank-pwd.service';

type AuthUser = { email?: string; fullName?: string };

@ApiTags('bank-pwd')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bank-pwd')
export class BankPwdController {
  constructor(private readonly svc: BankPwdService) {}

  @Post('config')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Bank parol config (7779 bilan) — taxminiy parollar + Telegram' })
  getConfig(@Body() body: { password?: string }) {
    return this.svc.getConfig(body?.password);
  }

  @Post('save')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Taxminiy parollar + Telegram sozlamalarini saqlash (7779)' })
  save(@Body() body: any, @CurrentUser() u?: AuthUser) {
    return this.svc.saveConfig(body || {}, u?.email || u?.fullName);
  }

  @Post('try')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Xato bergan (yoki tanlangan) ulanish parolini taxminiylardan topib almashtirish (7779)' })
  try(@Body() body: { password?: string; credentialId?: string }) {
    return this.svc.tryCandidates(body || {});
  }
}
