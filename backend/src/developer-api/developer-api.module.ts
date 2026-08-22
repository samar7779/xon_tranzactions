import { Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeyAdminController } from './api-key-admin.controller';
import { PublicApiController } from './public-api.controller';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { ApiLoggerInterceptor } from './interceptors/api-logger.interceptor';
import { CrmModule } from '../crm/crm.module';

/**
 * Tashqi tizim integratsiyasi uchun REST API:
 *   - Admin endpoint'lar (/api-keys/*) — admin panel uchun JWT+permission
 *   - Public endpoint'lar (/api/v1/*) — X-API-Key + X-API-Secret bilan
 */
@Module({
  imports: [CrmModule],
  controllers: [ApiKeyAdminController, PublicApiController],
  providers: [ApiKeyService, ApiKeyAuthGuard, ApiLoggerInterceptor],
  exports: [ApiKeyService],
})
export class DeveloperApiModule {}
