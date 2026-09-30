import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentBridgeGuard } from './agent-bridge.guard';
import { AgentBridgeService } from './agent-bridge.service';
import { assertExportId, parseChekFind, parseContracts, parseCrmLookup } from './agent-bridge.validation';

/**
 * agent-bridge — `agents/` Python boti uchun ichki (loopback) HTTP ko'prik.
 *   GET  /api/agent-bridge/payment-check?contracts=A,B,C[&sheetIds=x,y]  — FAQAT O'QISH
 *   GET  /api/agent-bridge/exports                                      — FAQAT O'QISH
 *   GET  /api/agent-bridge/crm-lookup?id=<kompozit>[&date=&amount=]     — FAQAT O'QISH (CRM)
 *   GET  /api/agent-bridge/chek-find?order=<№>[&amount=&date=&account=&contract=] — FAQAT O'QISH
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

  // Shartnomasiz (XATO) bank to'lovi CRM'da qaysi shartnomada — panel «XATO → CRM» bilan bir xil match.
  @Get('crm-lookup')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  crmLookup(@Query('id') id: any, @Query('date') date?: any, @Query('amount') amount?: any) {
    const q = parseCrmLookup(id, date, amount);
    return this.svc.crmLookup(q.id, q.date, q.amount);
  }

  // Chek → tranzaksiya: panel «Chek order > Tekshirish» bilan bir xil matchOrder (saqlanmaydi).
  @Get('chek-find')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  chekFind(
    @Query('order') order: any, @Query('amount') amount?: any, @Query('date') date?: any,
    @Query('account') account?: any, @Query('contract') contract?: any,
  ) {
    return this.svc.chekFind(parseChekFind({ order, amount, date, account, contract }));
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
