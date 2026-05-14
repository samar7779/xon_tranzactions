import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BanksService } from './banks.service';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('banks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('banks')
export class BanksController {
  constructor(private readonly svc: BanksService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.BANKS_VIEW)
  @ApiOperation({ summary: 'Banklar ro\'yxati' })
  list() { return this.svc.list(); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.BANKS_VIEW)
  @ApiOperation({ summary: 'Bitta bank' })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @RequirePermissions(PERMISSIONS.BANKS_MANAGE)
  @ApiOperation({ summary: 'Yangi bank qo\'shish' })
  create(@Body() dto: CreateBankDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.BANKS_MANAGE)
  @ApiOperation({ summary: 'Bankni tahrirlash' })
  update(@Param('id') id: string, @Body() dto: UpdateBankDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.BANKS_MANAGE)
  @ApiOperation({ summary: 'Bankni o\'chirish' })
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
