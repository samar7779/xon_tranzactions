import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuditService } from './audit.service';

@ApiTags('audit')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('my-activity')
  @ApiOperation({ summary: "Joriy foydalanuvchining amallar tarixi + statistika (profil > Xavfsizlik)" })
  async myActivity(@CurrentUser('id') userId: string, @Query('limit') limit?: string) {
    const [actions, stats] = await Promise.all([
      this.audit.recentForUser(userId, limit ? Number(limit) : 30),
      this.audit.statsForUser(userId),
    ]);
    return { ok: true, actions, stats };
  }
}
