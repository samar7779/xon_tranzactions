import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankAccountsService } from './bank-accounts.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('bank-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly svc: BankAccountsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  @ApiOperation({ summary: 'Bank hisoblari ro\'yxati' })
  list(@Query('credentialId') credentialId?: string) { return this.svc.list(credentialId); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_VIEW)
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  @ApiOperation({ summary: 'Yangi hisob qo\'shish (sync uchun)' })
  create(@Body() dto: CreateAccountDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post('bulk')
  @RequirePermissions(PERMISSIONS.ACCOUNTS_MANAGE)
  @ApiOperation({ summary: "Ko'p hisoblarni bir vaqtda qo'shish (paste orqali)" })
  bulk(@Body() dto: {
    credentialId: string;
    branch: string;
    currency?: string;
    accounts: { accountNo: string; ownerName?: string }[];
  }) {
    return this.svc.bulkCreate(dto);
  }
}
