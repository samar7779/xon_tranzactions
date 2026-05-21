import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { OplataKvService } from './oplata-kv.service';
import {
  CreateOplataKvDto, UpdateOplataKvDto, ListOplataKvDto,
} from './dto/oplata-kv.dto';

type AuthUser = { id?: string; email?: string; fullName?: string };

function actorFrom(u?: AuthUser) {
  return {
    id: u?.id ?? null,
    name: u?.fullName || u?.email || null,
  };
}

@ApiTags('oplata-kv')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('oplata-kv')
export class OplataKvController {
  constructor(private readonly svc: OplataKvService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'ОплатыКв ro\'yxati (pagination + filter + sums)' })
  list(@Query() q: ListOplataKvDto) {
    return this.svc.list(q);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Bitta qatorni olish' })
  findOne(@Param('id') id: string) {
    return this.svc.findOne(id);
  }

  @Get(':id/history')
  @RequirePermissions(PERMISSIONS.OPLATAKV_VIEW)
  @ApiOperation({ summary: 'Qator tarixi (audit log)' })
  history(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.svc.getHistory(id, limit ? Number(limit) : 100);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: 'Yangi qator qo\'shish' })
  create(@Body() body: CreateOplataKvDto, @CurrentUser() user?: AuthUser) {
    return this.svc.create(body, actorFrom(user));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: 'Qatorni tahrirlash (history\'ga avto yoziladi)' })
  update(
    @Param('id') id: string,
    @Body() body: UpdateOplataKvDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.update(id, body, actorFrom(user));
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: 'Qatorni o\'chirish (history saqlanadi)' })
  remove(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.svc.remove(id, actorFrom(user));
  }

  // ─── Import ───────────────────────────────────────────────
  @Post('import')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: "Excel'dan ОплатыКв qatorlarini import qilish (dublikat ID skip)" })
  async importExcel(
    @UploadedFile() file: any,
    @CurrentUser() user?: AuthUser,
  ) {
    if (!file?.buffer) throw new BadRequestException('Excel fayl yuborilmadi');
    return this.svc.importExcel(file.buffer, actorFrom(user), file?.originalname);
  }

  @Delete('import-batch/:id')
  @RequirePermissions(PERMISSIONS.OPLATAKV_MANAGE)
  @ApiOperation({ summary: "Import batch'ni va undagi barcha qatorlarni o'chirish" })
  async deleteImportBatch(@Param('id') id: string) {
    return this.svc.deleteImportBatch(id);
  }
}
