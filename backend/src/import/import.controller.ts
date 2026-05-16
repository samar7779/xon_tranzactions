import {
  BadRequestException, Body, Controller, Post, UploadedFile,
  UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ImportService } from './import.service';

@ApiTags('import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('import')
export class ImportController {
  constructor(private readonly svc: ImportService) {}

  @Post('transactions')
  @RequirePermissions(PERMISSIONS.SYNC_RUN)
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: "Excel'dan tranzaksiyalarni qo'lda import qilish (rus sarlavhalar)" })
  async importTransactions(
    @UploadedFile() file: any,
    @CurrentUser('email') email?: string,
  ) {
    if (!file?.buffer) throw new BadRequestException('Excel fayl yuborilmadi');
    return this.svc.importExcel(file.buffer, email);
  }
}
