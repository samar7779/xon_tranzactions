import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiKeyService } from './api-key.service';
import { API_SCOPE_CATALOG } from './api-scopes';

/**
 * Admin panel uchun /api-keys/* endpoint'lari. Login + permission talab qiladi.
 * Public /api/v1/* endpoint'lariga aralashmaydi.
 */
@ApiTags('developer-api · admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api-keys')
export class ApiKeyAdminController {
  constructor(private readonly svc: ApiKeyService) {}

  @Get('scopes')
  @RequirePermissions(PERMISSIONS.API_KEYS_VIEW)
  @ApiOperation({ summary: "Mavjud API scope'lar (UI tanlovi uchun)" })
  scopes() {
    return { ok: true, scopes: API_SCOPE_CATALOG };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.API_KEYS_VIEW)
  @ApiOperation({ summary: 'API kalitlar ro\'yxati' })
  list() {
    return this.svc.list();
  }

  @Get('stats')
  @RequirePermissions(PERMISSIONS.API_KEYS_VIEW)
  @ApiOperation({ summary: 'Umumiy foydalanish statistikasi (yoki apiKeyId bo\'yicha)' })
  stats(@Query('apiKeyId') apiKeyId?: string) {
    return this.svc.stats(apiKeyId);
  }

  @Get('logs')
  @RequirePermissions(PERMISSIONS.API_KEYS_VIEW)
  @ApiOperation({ summary: "So'rovlar log'i (filter + pagination)" })
  logs(
    @Query('apiKeyId') apiKeyId?: string,
    @Query('statusCode') statusCode?: string,
    @Query('method') method?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.svc.listLogs({
      apiKeyId,
      statusCode: statusCode ? Number(statusCode) : undefined,
      method,
      page: page ? Number(page) : undefined,
      perPage: perPage ? Number(perPage) : undefined,
    });
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.API_KEYS_VIEW)
  @ApiOperation({ summary: 'Bitta API kalit tafsiloti' })
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.API_KEYS_MANAGE)
  @ApiOperation({
    summary: 'Yangi API kalit yaratish — javobda secret bir marta qaytariladi',
  })
  create(
    @Body() body: {
      name: string;
      description?: string;
      scopes: string[];
      expiresAt?: string | null;
      allowedIps?: string[];
    },
    @CurrentUser('id') userId?: string,
    @CurrentUser('email') email?: string,
  ) {
    return this.svc.create({ ...body, createdById: userId, createdByEmail: email });
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.API_KEYS_MANAGE)
  @ApiOperation({ summary: 'API kalit tafsilotlarini tahrirlash' })
  update(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      description?: string | null;
      scopes?: string[];
      expiresAt?: string | null;
      allowedIps?: string[];
      isActive?: boolean;
    },
  ) {
    return this.svc.update(id, body);
  }

  @Post(':id/revoke')
  @RequirePermissions(PERMISSIONS.API_KEYS_MANAGE)
  @ApiOperation({ summary: 'API kalitni bekor qilish (isActive=false)' })
  revoke(@Param('id') id: string, @Body() body: { reason?: string }) {
    return this.svc.revoke(id, body?.reason);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.API_KEYS_MANAGE)
  @ApiOperation({ summary: "API kalitni butunlay o'chirish (log apiKeyId=null bo'ladi)" })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
