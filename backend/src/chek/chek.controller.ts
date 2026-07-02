import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { ChekService } from './chek.service';
import { CreateChekDto, UpdateChekDto } from './dto/chek.dto';

type AuthUser = { id?: string; email?: string; fullName?: string };

function actorFrom(u?: AuthUser) {
  const parts: string[] = [];
  if (u?.fullName) parts.push(u.fullName);
  if (u?.email) parts.push(u.email);
  return { id: u?.id ?? null, name: parts.length > 0 ? parts.join(' · ') : null };
}

@ApiTags('chek')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('chek')
export class ChekController {
  constructor(private readonly svc: ChekService) {}

  // ─── Baza tab ───
  @Get('crm-lookup')
  @RequirePermissions(PERMISSIONS.CHEK_BAZA)
  @ApiOperation({ summary: 'Shartnoma bo\'yicha CRM meta (menejer / sotuv ofisi / obyekt)' })
  crmLookup(@Query('contract') contract: string) {
    return this.svc.crmLookup(contract);
  }

  @Get('crm-search')
  @RequirePermissions(PERMISSIONS.CHEK_BAZA)
  @ApiOperation({ summary: 'Shartnoma autocomplete (jonli qidiruv)' })
  crmSearch(@Query('contract') contract: string) {
    return this.svc.crmSearch(contract);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CHEK_BAZA)
  @ApiOperation({ summary: 'Yangi chek yozuvi qo\'shish' })
  create(@Body() dto: CreateChekDto, @CurrentUser() user?: AuthUser) {
    return this.svc.create(dto, actorFrom(user));
  }

  // ─── Tarix tab ───
  @Get()
  @RequirePermissions(PERMISSIONS.CHEK_TARIX)
  @ApiOperation({ summary: 'Chek yozuvlari ro\'yxati (tarix)' })
  list(
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
  ) {
    return this.svc.list({
      q,
      page: page ? Number(page) : undefined,
      perPage: perPage ? Number(perPage) : undefined,
    });
  }

  @Get('export')
  @RequirePermissions(PERMISSIONS.CHEK_TARIX)
  @ApiOperation({ summary: 'Filtrlangan ma\'lumotni Excel (.xlsx) sifatida yuklab olish' })
  async exportXlsx(@Query() q: any, @Res() res: Response) {
    const { buffer, filename } = await this.svc.exportXlsx(q);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.CHEK_TARIX)
  getOne(@Param('id') id: string) {
    return this.svc.getOne(id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CHEK_TARIX)
  @ApiOperation({ summary: 'Chek yozuvini tahrirlash' })
  update(@Param('id') id: string, @Body() dto: UpdateChekDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.CHEK_TARIX)
  @ApiOperation({ summary: 'Chek yozuvini o\'chirish' })
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
