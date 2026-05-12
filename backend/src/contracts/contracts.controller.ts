import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContractsService } from './contracts.service';
import { CreateContractDto, UpdateContractDto } from './dto/contract.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly svc: ContractsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CONTRACTS_VIEW)
  list(@Query('customerId') customerId?: string, @Query('status') status?: string) {
    return this.svc.list({ customerId, status });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CONTRACTS_VIEW)
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @RequirePermissions(PERMISSIONS.CONTRACTS_MANAGE)
  @ApiOperation({ summary: 'Yangi shartnoma + bosqichlar' })
  create(@Body() dto: CreateContractDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CONTRACTS_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CONTRACTS_MANAGE)
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
