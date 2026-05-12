import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BanksService } from './banks.service';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('banks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('banks')
export class BanksController {
  constructor(private readonly svc: BanksService) {}

  @Get()
  @ApiOperation({ summary: 'Banklar ro\'yxati' })
  list() { return this.svc.list(); }

  @Get(':id')
  @ApiOperation({ summary: 'Bitta bank' })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @UseGuards(RolesGuard) @Roles('SUPERADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Yangi bank qo\'shish' })
  create(@Body() dto: CreateBankDto) { return this.svc.create(dto); }

  @Patch(':id')
  @UseGuards(RolesGuard) @Roles('SUPERADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Bankni tahrirlash' })
  update(@Param('id') id: string, @Body() dto: UpdateBankDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(RolesGuard) @Roles('SUPERADMIN')
  @ApiOperation({ summary: 'Bankni o\'chirish' })
  remove(@Param('id') id: string) { return this.svc.remove(id); }
}
