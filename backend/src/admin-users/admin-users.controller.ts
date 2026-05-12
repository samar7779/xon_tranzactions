import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminUsersService } from './admin-users.service';
import { CreateAdminDto, UpdateAdminDto } from './dto/create-admin.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('admin-users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPERADMIN')
@Controller('admin-users')
export class AdminUsersController {
  constructor(private readonly svc: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Adminlar ro\'yxati (faqat SUPERADMIN)' })
  list() { return this.svc.list(); }

  @Post()
  @ApiOperation({ summary: 'Yangi admin qo\'shish' })
  create(@Body() dto: CreateAdminDto) { return this.svc.create(dto); }

  @Patch(':id')
  @ApiOperation({ summary: 'Adminni tahrirlash' })
  update(@Param('id') id: string, @Body() dto: UpdateAdminDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Adminni o\'chirish' })
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
