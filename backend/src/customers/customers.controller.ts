import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  list(@Query('q') q?: string) { return this.svc.list({ q }); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_VIEW)
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  @ApiOperation({ summary: 'Yangi mijoz qo\'shish' })
  create(@Body() dto: CreateCustomerDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMERS_MANAGE)
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
