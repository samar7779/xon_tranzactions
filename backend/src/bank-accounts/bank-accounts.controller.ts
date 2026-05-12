import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankAccountsService } from './bank-accounts.service';
import { CreateAccountDto, UpdateAccountDto } from './dto/account.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('bank-accounts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bank-accounts')
export class BankAccountsController {
  constructor(private readonly svc: BankAccountsService) {}

  @Get()
  @Roles('SUPERADMIN', 'ADMIN', 'VIEWER')
  @ApiOperation({ summary: 'Bank hisoblari ro\'yxati' })
  list(@Query('credentialId') credentialId?: string) { return this.svc.list(credentialId); }

  @Get(':id')
  @Roles('SUPERADMIN', 'ADMIN', 'VIEWER')
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @Roles('SUPERADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Yangi hisob qo\'shish (sync uchun)' })
  create(@Body() dto: CreateAccountDto) { return this.svc.create(dto); }

  @Patch(':id')
  @Roles('SUPERADMIN', 'ADMIN')
  update(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPERADMIN', 'ADMIN')
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
