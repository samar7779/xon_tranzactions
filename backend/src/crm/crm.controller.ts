import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CrmService } from './crm.service';

@ApiTags('crm')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('crm')
export class CrmController {
  constructor(private readonly svc: CrmService) {}

  @Get('search')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({ summary: 'Shartnoma raqami bo\'yicha qidiruv (XonSaroy CRM)' })
  search(@Query('contract') contract: string, @Query('perPage') perPage?: string) {
    return this.svc.search(contract, perPage ? Number(perPage) : 20);
  }

  @Get('show')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({ summary: 'Bitta shartnoma tafsiloti (XonSaroy CRM)' })
  show(@Query('contract') contract?: string, @Query('id') id?: string) {
    return this.svc.show({ contract, id });
  }
}
