import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KategoriyaAgentService } from './kategoriya-agent.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('kategoriya-agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('kategoriya-agent')
export class KategoriyaAgentController {
  constructor(private readonly svc: KategoriyaAgentService) {}

  @Get('holat')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({
    summary: 'Agent holati (ishlayaptimi, bilim fayli, AI kaliti, oxirgi yurish)',
  })
  holat() {
    return this.svc.holat();
  }

  @Get('runs')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: "Oxirgi ishga tushirishlar ro'yxati" })
  runs(@Query('limit') limit?: string) {
    return this.svc.royxat(limit ? Number(limit) : 20);
  }

  @Get('runs/:id')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: 'Bitta yurish: bosqichlar natijasi + AI qarorlari (loglar)' })
  bitta(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.bitta(id, limit ? Number(limit) : 300);
  }

  @Post('run')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({
    summary: "Agentni qo'lda ishga tushirish (5 bosqich ketma-ket)",
    description:
      '1) qoidalar 2) schotchik 3) minfin tozalash 4) ta\'minot 5) AI qoldiq. ' +
      "Fonda ishlaydi — javob darhol qaytadi, holatni /holat dan kuzatiladi. " +
      "dryRun=true bo'lsa hech narsa yozilmaydi. Ta'minot bazasiga faqat o'qish so'rovi boradi.",
  })
  run(
    @Body() body: {
      dateFrom?: string; dateTo?: string;
      dryRun?: boolean; rematch?: boolean; aiYoq?: boolean;
    },
    @CurrentUser('id') userId: string,
  ) {
    return this.svc.boshla({
      dateFrom: body?.dateFrom,
      dateTo: body?.dateTo,
      dryRun: body?.dryRun === true,
      rematch: body?.rematch === true,
      aiYoq: body?.aiYoq === true,
      trigger: 'manual',
      userId,
    });
  }

  @Post('stop')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: "Joriy yurishni to'xtatish (bosqich tugagach)" })
  stop() {
    return this.svc.toxtat();
  }
}
