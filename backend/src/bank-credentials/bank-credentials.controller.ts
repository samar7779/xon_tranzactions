import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BankCredentialsService } from './bank-credentials.service';
import { CreateCredentialDto, UpdateCredentialDto } from './dto/credential.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('bank-credentials')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bank-credentials')
export class BankCredentialsController {
  constructor(private readonly svc: BankCredentialsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CREDENTIALS_VIEW)
  @ApiOperation({ summary: 'Bank credentiallar ro\'yxati' })
  list(@Query('bankId') bankId?: string) { return this.svc.list(bankId); }

  @Get('auth-issues')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_VIEW)
  @ApiOperation({ summary: 'Hozir login/parol xatoligi bergan bank credentiallari (oxirgi FAILED sync log auth pattern bilan)' })
  authIssues() { return this.svc.listAuthIssues(); }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_VIEW)
  @ApiOperation({ summary: 'Bitta credential' })
  get(@Param('id') id: string) { return this.svc.get(id); }

  @Post()
  @RequirePermissions(PERMISSIONS.CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Yangi bank credential qo\'shish (parol shifrlanadi)' })
  create(@Body() dto: CreateCredentialDto) { return this.svc.create(dto); }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Credentialni tahrirlash' })
  update(@Param('id') id: string, @Body() dto: UpdateCredentialDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Credentialni o\'chirish' })
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  @Post(':id/test')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_TEST)
  @ApiOperation({ summary: 'Bankga ulanishni tekshirish (APILogin chaqirilad)' })
  test(@Param('id') id: string) { return this.svc.testConnection(id); }

  @Get(':id/reveal-password')
  @RequirePermissions(PERMISSIONS.CREDENTIALS_MANAGE)
  @ApiOperation({ summary: "Parolni ochiq holda ko'rsatish" })
  reveal(@Param('id') id: string) { return this.svc.revealPassword(id); }
}
