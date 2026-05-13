import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankCredentialsService } from './bank-credentials.service';
import { CreateCredentialDto, UpdateCredentialDto } from './dto/credential.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('bank-credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('bank-credentials')
export class BankCredentialsController {
  constructor(private readonly svc: BankCredentialsService) {}

  @Get()
  @Roles('SUPERADMIN', 'ADMIN', 'VIEWER')
  @ApiOperation({ summary: 'Bank credentiallar ro\'yxati' })
  list(@Query('bankId') bankId?: string) { return this.svc.list(bankId); }

  @Get(':id')
  @Roles('SUPERADMIN', 'ADMIN', 'VIEWER')
  @ApiOperation({ summary: 'Bitta credential' })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @Roles('SUPERADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Yangi bank credential qo\'shish (parol shifrlanadi)' })
  create(@Body() dto: CreateCredentialDto) { return this.svc.create(dto); }

  @Patch(':id')
  @Roles('SUPERADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Credentialni tahrirlash' })
  update(@Param('id') id: string, @Body() dto: UpdateCredentialDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @Roles('SUPERADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Credentialni o\'chirish' })
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post(':id/test')
  @Roles('SUPERADMIN', 'ADMIN')
  @ApiOperation({ summary: 'Bankga ulanishni tekshirish (APILogin chaqirilad)' })
  test(@Param('id') id: string) { return this.svc.testConnection(id); }

  @Get(':id/reveal-password')
  @Roles('SUPERADMIN')
  @ApiOperation({ summary: "Parolni ochiq holda ko'rsatish (faqat SUPERADMIN)" })
  reveal(@Param('id') id: string) { return this.svc.revealPassword(id); }
}
