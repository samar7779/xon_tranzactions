import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ScheduleService } from './schedule.service';

type AuthUser = { id?: string; email?: string; fullName?: string };

@ApiTags('schedule')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schedule')
export class ScheduleController {
  constructor(private readonly svc: ScheduleService) {}

  @Get('by-object')
  @RequirePermissions(PERMISSIONS.SCHEDULE_VIEW)
  @ApiOperation({ summary: 'Plan bo\'yicha to\'lov — obyekt kesimida (tushishi kerak vs tushgan)' })
  byObject(
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('kind') kind?: string,
  ) {
    return this.svc.byObject({ from, to, kind });
  }

  @Get('sync-status')
  @RequirePermissions(PERMISSIONS.SCHEDULE_VIEW)
  @ApiOperation({ summary: 'To\'lov jadvali sync holati' })
  status() {
    return this.svc.status();
  }

  @Post('sync')
  @RequirePermissions(PERMISSIONS.SCHEDULE_SYNC)
  @ApiOperation({ summary: 'CRM\'dan to\'lov jadvalini sync qilish (fon)' })
  sync(@CurrentUser() u?: AuthUser) {
    const actor = [u?.fullName, u?.email].filter(Boolean).join(' · ') || null;
    return this.svc.startSync(actor);
  }

  @Post('sync/stop')
  @RequirePermissions(PERMISSIONS.SCHEDULE_SYNC)
  @ApiOperation({ summary: 'Davom etayotgan sync\'ni to\'xtatish' })
  stop() {
    return this.svc.stopSync();
  }
}
