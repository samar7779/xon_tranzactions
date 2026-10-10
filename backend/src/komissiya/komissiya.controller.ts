import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KomissiyaService } from './komissiya.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('komissiya')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('komissiya')
export class KomissiyaController {
  constructor(private readonly svc: KomissiyaService) {}

  @Get('firmalar')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({
    summary: "Firma → obyekt ro'yxati (mavjud ma'lumotdan taklif bilan)",
    description:
      "Har firma uchun: nechta komissiya, to'lovlaridagi hukmron obyekt va nechta " +
      "xil obyekt bor. obyektXil = 1 bo'lsa firma zakazchik, ko'p bo'lsa genpodryad.",
  })
  firmalar() {
    return this.svc.firmalar();
  }

  @Post('firmalar')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: "Firma → obyekt yozuvlarini saqlash" })
  firmalarSaqla(@Body() body: { items: Array<{ firma: string; obyekt?: string | null; genpodryad?: boolean }> }) {
    return this.svc.firmalarSaqla(body?.items || []);
  }

  @Post('obyekt-toldir')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({
    summary: "Bank komissiyalariga obyekt qo'yish",
    description:
      "1-qoida: firma zakazchik bo'lsa — uning obyekti. 2-qoida: genpodryad bo'lsa — " +
      "izohdagi «За документ №N S=summa» orqali asl to'lovning obyekti. " +
      "dryRun standart true — hech narsa yozilmaydi.",
  })
  obyektToldir(@Body() body: { dateFrom?: string; dateTo?: string; dryRun?: boolean; force?: boolean; limit?: number }) {
    return this.svc.obyektToldir({
      dateFrom: body?.dateFrom,
      dateTo: body?.dateTo,
      dryRun: body?.dryRun !== false,
      force: body?.force === true,
      limit: body?.limit,
    });
  }
}
