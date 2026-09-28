import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentBridgeGuard } from './agent-bridge.guard';
import { AgentBridgeService } from './agent-bridge.service';
import { assertExportId, parseContracts } from './agent-bridge.validation';

/**
 * agent-bridge — `agents/` Python boti uchun ichki (loopback) HTTP ko'prik.
 *   GET  /api/agent-bridge/payment-check?contracts=A,B,C[&sheetIds=x,y]  — FAQAT O'QISH
 *   GET  /api/agent-bridge/exports                                      — FAQAT O'QISH
 *   POST /api/agent-bridge/exports/:id/run                              — Google Sheets'ga YOZADI
 *        (bot faqat egasi Telegram'da [Ha] bosgandan keyin chaqiradi)
 *
 * JWT/rol YO'Q (JWT loyihada global emas — bu controller'ga qo'yilmaydi), o'rniga class-level
 * AgentBridgeGuard (kalit + proxy-header yo'qligi + loopback) — PublicApiController + ApiKeyAuthGuard
 * naqshi. Global ThrottlerGuard SAQLANADI (qattiqroq limitlar @Throttle bilan).
 * POST global AuditInterceptor'ga tushadi (guard req.user = agent-bridge qo'yadi).
 */
@ApiExcludeController()
@UseGuards(AgentBridgeGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('agent-bridge')
export class AgentBridgeController {
  constructor(private readonly svc: AgentBridgeService) {}

  // `any` — Express `?contracts=a&contracts=b` ni massiv qiladi; parseContracts string bo'lmaganini 400 bilan rad etadi.
  @Get('payment-check')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  paymentCheck(@Query('contracts') contracts: any, @Query('sheetIds') sheetIds?: any) {
    return this.svc.paymentCheck(parseContracts(contracts), sheetIds); // sheetIds servisda ro'yxatga qarshi tekshiriladi
  }

  @Get('exports')
  listExports() {
    return this.svc.listExports();
  }

  // @Body() YO'Q — run faqat SAQLANGAN konfiguratsiya bilan ishlaydi, bot target yubora olmaydi.
  @Post('exports/:id/run')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  runExport(@Param('id') id: string) {
    return this.svc.runExport(assertExportId(id));
  }
}
