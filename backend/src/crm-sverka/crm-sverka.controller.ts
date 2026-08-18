import { Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CrmSverkaService, SverkaFilters } from './crm-sverka.service';

type AuthUser = { id?: string; email?: string; fullName?: string };

/** "a,b,c" → ['a','b','c'] (bo'sh → undefined) */
function list(csv?: string): string[] | undefined {
  if (!csv) return undefined;
  const arr = csv.split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : undefined;
}

function filtersFrom(q: any): SverkaFilters {
  return {
    q: q.q || undefined,
    methods: list(q.methods),
    ourMethods: list(q.ourMethods),
    crmStatuses: list(q.crmStatuses),
    objects: list(q.objects),
    rowStatuses: list(q.rowStatuses),
    dateFrom: q.dateFrom || undefined,
    dateTo: q.dateTo || undefined,
    minDiff: q.minDiff ? Number(q.minDiff) : undefined,
    sort: q.sort || undefined,
    page: q.page ? Number(q.page) : undefined,
    perPage: q.perPage ? Number(q.perPage) : undefined,
  };
}

@ApiTags('crm-sverka')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('crm-sverka')
export class CrmSverkaController {
  constructor(private readonly svc: CrmSverkaService) {}

  @Post('run')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_CRM_RUN)
  @ApiOperation({
    summary: "CRM'dan jonli tortib sverka qilish (fonda ishlaydi — status bilan kuzatiladi)",
  })
  run(@CurrentUser() user?: AuthUser) {
    const name = [user?.fullName, user?.email].filter(Boolean).join(' · ') || null;
    return this.svc.start(name);
  }

  @Get('status')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_CRM_VIEW)
  @ApiOperation({ summary: 'Jonli tortish holati (progress) + snapshot meta' })
  status() {
    return this.svc.status();
  }

  @Get('result')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_CRM_VIEW)
  @ApiOperation({
    summary: 'Shartnoma kesimidagi sverka natijasi — KPI + ro\'yxat + facet (filtr) qiymatlari',
  })
  result(@Query() q: any) {
    return this.svc.result(filtersFrom(q));
  }

  @Get('facets')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_CRM_VIEW)
  @ApiOperation({ summary: "Filtr paneli qiymatlari (to'lov usuli / status / obyekt)" })
  facets() {
    return this.svc.facets();
  }

  @Get('contract')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_CRM_VIEW)
  @ApiOperation({
    summary: "Bitta shartnoma — to'lovma-to'lov juftlash (aniq / sana siljigan / summa farqi / faqat bir tomonda)",
  })
  contract(@Query('contractNo') contractNo: string, @Query() q: any) {
    return this.svc.contractDetail(contractNo, filtersFrom(q), q.tolDays ? Number(q.tolDays) : 3);
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_CRM_VIEW)
  @ApiOperation({ summary: 'Filtrlangan natijani Excel (.xlsx) sifatida yuklab olish' })
  async exportXlsx(@Query() q: any, @Res() res: Response) {
    const { buffer, filename } = await this.svc.exportXlsx(filtersFrom(q));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }
}
