import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TaminotService } from './taminot.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { PERMISSIONS } from '../auth/permissions';

@ApiTags('taminot')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('taminot')
export class TaminotController {
  constructor(private readonly svc: TaminotService) {}

  @Get('ping')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({ summary: "Ta'minot bazasiga ulanishni tekshirish (faqat o'qish)" })
  ping() {
    return this.svc.ping();
  }

  @Get('cron')
  @RequirePermissions(PERMISSIONS.CATEGORIES_VIEW)
  @ApiOperation({
    summary: "Avtomat moslashtirish holati (jadval, oxirgi natija)",
    description: "Kuniga 3 marta (08:00 / 14:00 / 20:00, Toshkent) o'z-o'zidan ishlaydi.",
  })
  cron() {
    return this.svc.cronHolati();
  }

  @Post('cron/run')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({ summary: "Avtomat moslashtirishni qo'lda hoziroq ishga tushirish" })
  async cronRun() {
    await this.svc.cronMoslashtirish();
    return this.svc.cronHolati();
  }

  @Post('match')
  @RequirePermissions(PERMISSIONS.CATEGORIES_MANAGE)
  @ApiOperation({
    summary: "Tranzaksiyalarni ta'minot to'lovlariga bog'lash (kontragent / modda / shartnoma)",
    description:
      "Kalit: summa aniq + sana ±2 kun + (shartnoma tokeni yoki yetkazib beruvchi nomi). " +
      "Mijoz (CLIENT) to'lovlari chetlab o'tiladi. dryRun standart true — hech narsa yozilmaydi. " +
      "Ta'minot bazasiga FAQAT o'qish so'rovi yuboriladi.",
  })
  match(@Body() body: { dateFrom?: string; dateTo?: string; dryRun?: boolean; rematch?: boolean; limit?: number }) {
    return this.svc.matchTransactions({
      dateFrom: body?.dateFrom,
      dateTo: body?.dateTo,
      dryRun: body?.dryRun !== false,
      rematch: body?.rematch === true,
      limit: body?.limit,
    });
  }
}
