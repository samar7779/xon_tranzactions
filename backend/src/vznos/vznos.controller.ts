import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { VznosService, VznosDto } from './vznos.service';

const actorFrom = (u?: any) => ({ id: u?.id ?? null, name: u?.fullName || u?.email || null });

@ApiTags('vznos')
@ApiBearerAuth()
@Controller('vznos')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class VznosController {
  constructor(private svc: VznosService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.VZNOS_VIEW)
  @ApiOperation({ summary: '"Взнос от имени клиента" shartnomalar ro\'yxati (paid/qoldiq bilan)' })
  list(
    @Query('q') q?: string,
    @Query('project') project?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
  ) {
    return this.svc.list({ q, project, status, page: page ? Number(page) : 1 });
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.VZNOS_VIEW)
  @ApiOperation({ summary: 'Kartalar: shartnoma soni, umumiy qiymat, to\'langan, qoldiq' })
  stats(@Query('project') project?: string) {
    return this.svc.stats({ project });
  }

  @Get('objects')
  @RequirePermissions(PERMISSIONS.VZNOS_VIEW)
  @ApiOperation({ summary: 'Loyiha (obyekt) dropdown ro\'yxati' })
  objects() {
    return this.svc.objects();
  }

  @Get('crm-lookup')
  @RequirePermissions(PERMISSIONS.VZNOS_VIEW)
  @ApiOperation({ summary: 'Shartnomani CRM\'dan qidirish (qo\'shishда prefill)' })
  crmLookup(@Query('contractNo') contractNo: string) {
    return this.svc.crmLookup(contractNo);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.VZNOS_MANAGE)
  @ApiOperation({ summary: 'Yangi shartnoma qo\'shish (mavjud mos to\'lovlar "Взнос от имени клиента"ga o\'tadi)' })
  create(@Body() body: VznosDto, @CurrentUser() user?: any) {
    return this.svc.create(body, actorFrom(user));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.VZNOS_MANAGE)
  @ApiOperation({ summary: 'Shartnomani tahrirlash' })
  update(@Param('id') id: string, @Body() body: Partial<VznosDto>, @CurrentUser() user?: any) {
    return this.svc.update(id, body, actorFrom(user));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.VZNOS_MANAGE)
  @ApiOperation({ summary: 'Shartnomani o\'chirish' })
  remove(@Param('id') id: string, @CurrentUser() user?: any) {
    return this.svc.remove(id, actorFrom(user));
  }

  @Post(':id/cancel')
  @RequirePermissions(PERMISSIONS.VZNOS_MANAGE)
  @ApiOperation({ summary: 'Bekor qilish → to\'lovlarni boshqa (ro\'yxatдаgi) shartnomaga o\'tkazish' })
  cancel(
    @Param('id') id: string,
    @Body() body: { transferToContractNo: string; reason?: string },
    @CurrentUser() user?: any,
  ) {
    return this.svc.cancel(id, body, actorFrom(user));
  }
}
