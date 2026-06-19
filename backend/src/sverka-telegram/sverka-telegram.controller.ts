import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../auth/permissions';
import { SverkaTelegramService, ChatRole } from './sverka-telegram.service';

@ApiTags('sverka-telegram')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sverka-telegram')
export class SverkaTelegramController {
  constructor(private svc: SverkaTelegramService) {}

  // ─── Parol tekshiruvi ─────────────────────────────────────
  @Post('verify-password')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_VIEW)
  @ApiOperation({ summary: 'Sverka Telegram boshqaruvi uchun parol tekshirish' })
  async verifyPassword(@Body() body: { password: string }) {
    const ok = await this.svc.verifyPassword(body?.password || '');
    return { ok };
  }

  // ─── Chat ID boshqaruvi ───────────────────────────────────
  @Get('chats')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({ summary: 'Telegram chat ID lar ro\'yxati' })
  getChats() {
    return this.svc.getChats();
  }

  @Post('chats')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({ summary: 'Chat ID qo\'shish yoki yangilash' })
  async addChat(
    @Body() body: { chatId: string; role: ChatRole; name?: string },
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
  ) {
    return this.svc.addChat(body, { id: userId, name: email });
  }

  @Delete('chats/:chatId')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({ summary: 'Chat ID o\'chirish' })
  async removeChat(
    @Param('chatId') chatId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
  ) {
    return this.svc.removeChat(chatId, { id: userId, name: email });
  }

  // ─── Bot token ───────────────────────────────────────────
  @Get('bot-token')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({ summary: 'Bot token (qisqartirilgan ko\'rinishda)' })
  async getBotToken() {
    const token = await this.svc.getBotToken();
    // Maskalash: faqat birinchi va oxirgi 6 belgini ko'rsatamiz
    const masked = token.length > 12
      ? `${token.slice(0, 8)}...${token.slice(-6)}`
      : token;
    return { token, masked };
  }

  @Post('bot-token')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({ summary: 'Bot tokenni yangilash' })
  async setBotToken(
    @Body() body: { token: string },
    @CurrentUser('email') email: string,
  ) {
    return this.svc.setBotToken(body?.token || '', { name: email });
  }

  // ─── Tarix ───────────────────────────────────────────────
  @Get('history')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_VIEW)
  @ApiOperation({ summary: 'Telegram va Sverka amallar tarixi (pagination + filter)' })
  async getHistory(
    @Query('page') page?: string,
    @Query('perPage') perPage?: string,
    @Query('q') q?: string,
    @Query('actorName') actorName?: string,
    @Query('source') source?: 'web' | 'telegram',
  ) {
    const result = await this.svc.getHistory({
      page: page ? Number(page) : 1,
      perPage: perPage ? Number(perPage) : 20,
      q: q || undefined,
      actorName: actorName || undefined,
      source: source || undefined,
    });
    return { ok: true, ...result };
  }

  // ─── Test notification ───────────────────────────────────
  @Post('test')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({ summary: 'Test xabarnomasi yuborish (barcha chatlarga)' })
  async test(@CurrentUser('email') email: string) {
    return this.svc.sendTestNotification({ name: email });
  }

  @Post('reset-notified')
  @RequirePermissions(PERMISSIONS.TRANSACTIONS_SVERKA_FIX)
  @ApiOperation({
    summary: 'Notified set\'ni tozalash — keyingi sverka\'da barcha farqlarga xabar yuboriladi',
    description: 'Test, yangi chat qo\'shilgach yoki xato bilan yuborilmagan xabarlarni qayta yuborish uchun.',
  })
  async resetNotified(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') email: string,
  ) {
    return this.svc.resetNotifiedToday({ id: userId, name: email });
  }
}
