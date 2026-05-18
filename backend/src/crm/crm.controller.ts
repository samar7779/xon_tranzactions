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

  @Get('payment-history')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({
    summary: "XonSaroy CRM bulk to'lovlar ro'yxati (paginatsiya)",
    description:
      "?page=1&limit=5000 — bulk endpoint, /client/payment-history/excel ga proxy. " +
      "Console test uchun. Har payment'da payment_method bor (XonPay/Bank/...) — filtr asoslari.",
  })
  paymentHistory(@Query('page') page?: string, @Query('limit') limit?: string) {
    return this.svc.getPaymentHistory(page ? Number(page) : 1, limit ? Number(limit) : 5000);
  }
}
