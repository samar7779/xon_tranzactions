import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AgentBridgeGuard } from './agent-bridge.guard';
import { AgentBridgeService } from './agent-bridge.service';
import {
  assertExportId, parseArizaFind, parseArizaId, parseArizaSubmit, parseChekFind, parseContracts, parseCrmLookup,
  parseFiltr, parseHisob, parsePerebroskaFayl, parsePerebroskaYarat, parseTxApply, parseTxChoice, parseTxRef,
} from './agent-bridge.validation';

/**
 * agent-bridge — `agents/` Python boti uchun ichki (loopback) HTTP ko'prik.
 *   GET  /api/agent-bridge/payment-check?contracts=A,B,C[&sheetIds=x,y]  — FAQAT O'QISH
 *   GET  /api/agent-bridge/exports                                      — FAQAT O'QISH
 *   GET  /api/agent-bridge/crm-lookup?id=<kompozit>[&date=&amount=]     — FAQAT O'QISH (CRM)
 *   GET  /api/agent-bridge/chek-find?order=<№>[&amount=&date=&account=&contract=] — FAQAT O'QISH
 *   GET  /api/agent-bridge/tx-edit/options?tx=<ID>                      — FAQAT O'QISH (variantlar)
 *   GET  /api/agent-bridge/tx-edit/preview?tx=&kontragent=&kategoriya=&shartnoma= — FAQAT O'QISH (tekshiruv)
 *   POST /api/agent-bridge/tx-edit/apply                                — TAHRIRLAYDI (egasi [Ha] bosgach)
 *   GET  /api/agent-bridge/xato-ariza/find?tx=|summa=&sana=[&hisob=&shartnoma=] — FAQAT O'QISH
 *   POST /api/agent-bridge/xato-ariza/submit                            — ARIZA yuboradi (egasi [Ha] bosgach)
 *   GET  /api/agent-bridge/xato-ariza/status?id=                         — FAQAT O'QISH (AI natijasi)
 *   GET  /api/agent-bridge/hisob?raqam=<16-25 xona>                      — FAQAT O'QISH (hisob raqam ma'lumoti)
 *   GET  /api/agent-bridge/xato-royxat[?filtr=]                         — FAQAT O'QISH (XATO ro'yxati .xlsx, base64)
 *   POST /api/agent-bridge/perebroska/tahlil                             — AI Переброска arizani o'qiydi (DB'ga yozmaydi)
 *   POST /api/agent-bridge/perebroska/yarat                              — Переброска YARATADI (egasi tasdig'idan keyin)
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

  // AI Переброска: panel "AI Переброска" bilan bir xil tahlil (AI chaqiradi — POST, kam limit).
  @Post('perebroska/tahlil')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  perebroskaTahlil(@Body() body: any) {
    return this.svc.perebroskaTahlil(parsePerebroskaFayl(body));
  }

  // Переброска yaratish: panelda xodim "Yaratish" bosgandek (createPerereboska qoidalari bilan).
  @Post('perebroska/yarat')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  perebroskaYarat(@Body() body: any) {
    return this.svc.perebroskaYarat(parsePerebroskaYarat(body));
  }

  // Hisob raqam bo'yicha: egasi, MFO/bank, INN, korxona, bizning hisobmi, to'lovlar statistikasi.
  @Get('hisob')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  hisob(@Query('raqam') raqam: any) {
    return this.svc.hisob(parseHisob(raqam));
  }

  // XATO to'lovlar ro'yxati (xato-list bilan bir xil) — Excel fayl, bot Telegram'ga hujjat qilib yuboradi.
  @Get('xato-royxat')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  xatoRoyxat(@Query('filtr') filtr?: any) {
    return this.svc.xatoRoyxat(parseFiltr(filtr));
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

  // TR Support: to'lov ustunlarini tahrirlash (Kontragent, Kategoriya, Shartnoma). Yozish faqat apply'da.
  @Get('tx-edit/options')
  txEditOptions(@Query('tx') tx: any) {
    return this.svc.txEditOptions(parseTxRef(tx));
  }

  @Get('tx-edit/preview')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  txEditPreview(@Query('tx') tx: any, @Query('kontragent') k?: any, @Query('kategoriya') c?: any, @Query('shartnoma') s?: any) {
    return this.svc.txEditPreview(parseTxRef(tx), parseTxChoice({ kontragent: k, kategoriya: c, shartnoma: s }));
  }

  // Bot faqat egasi Telegram'da [Ha] bosgandan keyin chaqiradi. Global AuditInterceptor yozadi.
  @Post('tx-edit/apply')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  txEditApply(@Body() body: any) {
    return this.svc.txEditApply(parseTxApply(body));
  }

  // XATO to'lovga ariza: XATO sahifasidagi "Shartnoma biriktirish" bilan bir xil (createRequestWithFile + AI).
  @Get('xato-ariza/find')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  arizaFind(@Query('tx') tx?: any, @Query('summa') summa?: any, @Query('sana') sana?: any,
    @Query('hisob') hisob?: any, @Query('shartnoma') shartnoma?: any) {
    return this.svc.arizaFind(parseArizaFind({ tx, summa, sana, hisob, shartnoma }));
  }

  @Post('xato-ariza/submit')
  @HttpCode(200)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  arizaSubmit(@Body() body: any) {
    return this.svc.arizaSubmit(parseArizaSubmit(body));
  }

  @Get('xato-ariza/status')
  arizaStatus(@Query('id') id: any) {
    return this.svc.arizaStatus(parseArizaId(id));
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
