import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { LinkPaymentsDto } from './dto/payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PAYMENTS_VIEW)
  list(
    @Query('contractId') contractId?: string,
    @Query('customerId') customerId?: string,
    @Query('stageId') stageId?: string,
  ) {
    return this.svc.list({ contractId, customerId, stageId });
  }

  @Post('auto-match/:transactionId')
  @RequirePermissions(PERMISSIONS.PAYMENTS_MANAGE)
  @ApiOperation({ summary: 'Tranzaksiyani INN orqali avto-match qilish' })
  autoMatch(@Param('transactionId') id: string, @CurrentUser('id') userId: string) {
    return this.svc.autoMatch(id, userId);
  }

  @Post('link')
  @RequirePermissions(PERMISSIONS.PAYMENTS_MANAGE)
  @ApiOperation({ summary: 'Tranzaksiyani qo\'lda bosqichlarga taqsimlash' })
  link(@Body() dto: LinkPaymentsDto, @CurrentUser('id') userId: string) {
    return this.svc.linkManual(dto, userId);
  }

  @Delete('link/:transactionId')
  @RequirePermissions(PERMISSIONS.PAYMENTS_MANAGE)
  @ApiOperation({ summary: 'Tranzaksiyaning barcha bog\'lanishlarini olib tashlash' })
  unlink(@Param('transactionId') id: string) {
    return this.svc.unlink(id);
  }

  @Post('ignore/:transactionId')
  @RequirePermissions(PERMISSIONS.PAYMENTS_MANAGE)
  @ApiOperation({ summary: 'Tranzaksiyani billing\'ga aloqasi yo\'q deb belgilash' })
  ignore(@Param('transactionId') id: string) {
    return this.svc.ignore(id);
  }
}
