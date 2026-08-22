import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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

  @Get('find-by-composite')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({
    summary: "Kompozit bank ID orqali CRM to'lovini topish (XATO to'lov shartnomasini aniqlash)",
    description:
      "?id=general_id_num_ddate_acc_ct_acc_dt_amount_sign — CRM payment-history'dan mos to'lovni topib " +
      "contract + purpose + external_id qaytaradi. matchedBy: general_id / num / sana+summa.",
  })
  findByComposite(@Query('id') id: string) {
    return this.svc.findByComposite(id);
  }

  @Post('match-composites')
  @RequirePermissions(PERMISSIONS.CRM_VIEW)
  @ApiOperation({
    summary: 'BATCH: kompozit ID ro\'yxati bo\'yicha CRM to\'lovlarni topish (XATO tuzatish moduli)',
    description:
      "{ ids: string[] } — har id uchun { id, crm: {contract, initialAmount, monthlyAmount, otherAmount, ...} | null }. " +
      'Sana bo\'yicha guruhlab tez qidiradi. Faqat aniq (external_id yadrosi) mos qaytadi.',
  })
  matchComposites(@Body() body: { items?: Array<{ id: string; purpose?: string }>; ids?: string[] }) {
    const items = Array.isArray(body?.items)
      ? body.items
      : (Array.isArray(body?.ids) ? body.ids.map((id) => ({ id })) : []);
    return this.svc.matchComposites(items);
  }
}
