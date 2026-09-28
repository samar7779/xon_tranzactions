import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { ChekOrderService } from '../chek-order/chek-order.service';
import { GoogleExportService } from '../google-export/google-export.service';
import { AGENT_BRIDGE_KEY_ENV, isKeyConfigured } from './agent-bridge.guard';
import { parseSheetIds } from './agent-bridge.validation';
import {
  BridgeContractResult, BridgeCrmPart, BridgeExportItem, BridgeExportLastRun, BridgeExportsResponse,
  BridgeOplataPart, BridgePaymentCheckResponse, BridgeRunResponse, BridgeSheetPart,
} from './agent-bridge.types';

const ERR_MAX = 300;
const RUN_TRIGGERED_BY = 'manual:agent-bridge';

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: any): number | null => (v == null ? null : num(v));
const strOrNull = (v: any): string | null => (v == null ? null : String(v));
const cut = (v: any): string => String(v ?? '').slice(0, ERR_MAX);

/**
 * agent-bridge — `agents/` boti uchun MAVJUD mantiqni qayta ishlatuvchi yupqa qatlam.
 * Yangi solishtirish mantiqi YO'Q: payment-check = ChekOrderService.paymentCheck + resAllMatch
 * (panel bilan aynan bir xil), run = GoogleExportService.runAndLog (panel "Bajarish" bilan bir xil).
 * CRM'ga faqat o'qish (paymentCheck ichidagi crm.show / crm.paymentsByContract — GET).
 */
@Injectable()
export class AgentBridgeService implements OnModuleInit {
  private readonly log = new Logger(AgentBridgeService.name);
  // In-flight qulf — faqat ko'prik orqali boshlangan run'lar (panel/cron bilan himoya YO'Q,
  // panel "Bajarish" da ham shunday — mavjud xulq saqlanadi).
  private readonly running = new Set<string>();

  constructor(
    private readonly chekOrder: ChekOrderService,
    private readonly googleExport: GoogleExportService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // Kalit qiymati/uzunligi log'ga yozilmaydi — faqat holat.
    if (isKeyConfigured(this.config.get<string>(AGENT_BRIDGE_KEY_ENV))) {
      this.log.log('agent-bridge ochiq (faqat loopback, kalit bilan)');
    } else {
      this.log.log(`${AGENT_BRIDGE_KEY_ENV} sozlanmagan — ko'prik YOPIQ (hamma so'rov 403)`);
    }
  }

  // ───────────────────────── payment-check (FAQAT O'QISH) ─────────────────────────
  async paymentCheck(contracts: string[], sheetIdsRaw: unknown): Promise<BridgePaymentCheckResponse> {
    const t0 = Date.now();
    const all = await this.googleExport.listSheetSources();
    const payable = all.filter((s) => s.hasPayColumns);

    const wanted = parseSheetIds(sheetIdsRaw);
    let sheetIds: string[];
    if (wanted === null) {
      sheetIds = payable.map((s) => s.id); // standart: ulangan barcha to'lov ustunli sheetlar
    } else {
      for (const id of wanted) {
        if (!payable.some((s) => s.id === id)) {
          throw new BadRequestException("sheetIds: noma'lum yoki to'lov ustunlari yo'q sheet");
        }
      }
      sheetIds = wanted;
    }

    // MAVJUD metod — panel bilan aynan bir xil parametrlar (ОплатыКв + CRM + tanlangan sheetlar).
    const r: any = await this.chekOrder.paymentCheck(contracts.join(','), { oplata: true, crm: true, sheetIds });

    // paymentCheckExport bilan bir xil tuzilish: 'oplata', 'crm', 'sheet:<id>'.
    const srcKeys = ['oplata', 'crm', ...sheetIds.map((id) => `sheet:${id}`)];
    const results: BridgeContractResult[] = (r?.results || []).map((res: any) => ({
      contract: String(res.contract),
      allMatch: this.chekOrder.resAllMatch(res, srcKeys),
      oplata: this.pickOplata(res.oplata),
      crm: this.pickCrm(res.crm),
      sheets: (res.sheets || []).map((s: any) => this.pickSheet(s)),
    }));

    this.log.log(`payment-check ${contracts.join(',')} · sheets=${sheetIds.length} · ${Date.now() - t0}ms`);
    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      sources: {
        oplata: true,
        crm: true,
        sheets: sheetIds.map((id) => ({ id, name: payable.find((s) => s.id === id)?.name ?? id })),
      },
      results,
    };
  }

  private pickOplata(o: any): BridgeOplataPart {
    return {
      ok: true,
      initial: num(o?.initial),
      monthly: num(o?.monthly),
      total: num(o?.total),
      count: num(o?.count),
      payments: (Array.isArray(o?.payments) ? o.payments : []).map((p: any) => ({
        date: strOrNull(p?.date),
        first: num(p?.first),
        monthly: num(p?.monthly),
        total: num(p?.total),
      })),
    };
  }

  private pickCrm(c: any): BridgeCrmPart {
    if (!c || !c.found) {
      const out: BridgeCrmPart = { ok: false, found: false };
      if (c?.error) out.error = cut(c.error);
      return out;
    }
    const out: BridgeCrmPart = {
      ok: true,
      found: true,
      price: numOrNull(c.price),
      initialPlan: numOrNull(c.initialPlan),
      monthlyPlan: numOrNull(c.monthlyPlan),
      initial: num(c.initial),
      monthly: num(c.monthly),
      total: num(c.total),
      remaining: numOrNull(c.remaining),
      count: num(c.count),
      payments: (Array.isArray(c.payments) ? c.payments : []).map((p: any) => ({
        date: strOrNull(p?.date),
        amount: num(p?.amount),
        kind: p?.kind === 'initial' ? 'initial' : 'monthly',
        type: strOrNull(p?.type),
      })),
    };
    if (c.viaPaymentHistory === true) out.viaPaymentHistory = true;
    return out;
  }

  private pickSheet(s: any): BridgeSheetPart {
    const out: BridgeSheetPart = {
      id: String(s?.id ?? ''),
      name: String(s?.name ?? ''),
      ok: !!s?.ok,
      available: !!s?.available,
      initial: num(s?.initial),
      monthly: num(s?.monthly),
      total: num(s?.total),
      matchedRows: num(s?.matchedRows),
      rowsScanned: num(s?.rowsScanned),
      payments: (Array.isArray(s?.payments) ? s.payments : []).map((p: any) => ({
        row: num(p?.row),
        first: num(p?.first),
        monthly: num(p?.monthly),
        total: num(p?.total),
      })),
    };
    if (s?.reason != null) out.reason = cut(s.reason);
    return out;
  }

  // ───────────────────────── exports ro'yxati (FAQAT O'QISH) ─────────────────────────
  async listExports(): Promise<BridgeExportsResponse> {
    const [cfg, sheets, sources] = await Promise.all([
      this.googleExport.getConfig(),
      this.googleExport.getRawConfig(),
      this.googleExport.listSheetSources(),
    ]);

    // getCronLogs EMAS (distinct xotirada) — har sheet uchun indeksli findFirst.
    const lastRuns = await Promise.all(
      sheets.map((s) =>
        this.prisma.exportCronLog.findFirst({
          where: { sheetId: s.id },
          orderBy: { startedAt: 'desc' },
          select: { startedAt: true, mode: true, status: true, rowsWritten: true, durationMs: true, triggeredBy: true, error: true },
        }),
      ),
    );

    const items: BridgeExportItem[] = sheets.map((s, i) => ({
      id: String(s.id),
      name: String(s.name ?? ''),
      source: s.source === 'transaction' ? 'transaction' : 'oplatakv',
      tabName: String(s.tabName ?? ''),
      writeMode: s.writeMode === 'upsert' ? 'upsert' : 'replace',
      hasPayColumns: !!sources.find((x) => x.id === s.id)?.hasPayColumns,
      cron: { enabled: !!s.cron?.enabled, everyMinutes: numOrNull(s.cron?.everyMinutes) },
      lastRun: this.pickLastRun(lastRuns[i]),
    }));

    return { ok: true, credentialsAvailable: !!cfg?.credentials?.available, items };
  }

  private pickLastRun(l: any): BridgeExportLastRun | null {
    if (!l) return null;
    return {
      startedAt: l.startedAt instanceof Date ? l.startedAt.toISOString() : String(l.startedAt),
      mode: l.mode === 'cron' ? 'cron' : 'manual',
      status: l.status === 'ok' ? 'ok' : 'error',
      rowsWritten: num(l.rowsWritten),
      durationMs: num(l.durationMs),
      triggeredBy: strOrNull(l.triggeredBy),
      error: l.error == null ? null : cut(l.error),
    };
  }

  // ───────────────────────── run (Google Sheets'ga YOZADI) ─────────────────────────
  async runExport(id: string): Promise<BridgeRunResponse> {
    // Target FAQAT saqlangan konfiguratsiyadan (cron bilan bir xil manba) — mijoz kiritgan hech narsa ishlatilmaydi.
    const target = (await this.googleExport.getRawConfig()).find((s) => s.id === id);
    if (!target) throw new NotFoundException('Eksport topilmadi');

    if (this.running.has(id)) throw new ConflictException('Bu eksport hozir ishlayapti');
    this.running.add(id);
    const t0 = Date.now();
    try {
      // MAVJUD metod — panel "Bajarish" bilan bir xil yo'l (run + ExportCronLog yozuvi).
      const r: any = await this.googleExport.runAndLog(target, 'manual', RUN_TRIGGERED_BY);
      this.log.log(`agent-bridge run "${target.name}" → ${r?.ok ? `OK ${r.rowsWritten}` : `XATO ${cut(r?.error)}`}`);

      if (r?.ok) {
        return {
          ok: true,
          sheet: { id: String(target.id), name: String(target.name ?? ''), tabName: String(target.tabName ?? '') },
          writeMode: r.writeMode === 'upsert' ? 'upsert' : 'replace',
          rowsFetched: num(r.rowsFetched),
          rowsWritten: num(r.rowsWritten),
          writtenRange: strOrNull(r.writtenRange),
          dateFrom: strOrNull(r.dateFrom),
          dateTo: String(r.dateTo ?? ''),
          durationMs: r.durationMs != null ? num(r.durationMs) : Date.now() - t0,
        };
      }
      return {
        ok: false,
        sheet: { id: String(target.id), name: String(target.name ?? '') },
        step: String(r?.step ?? 'unknown'),
        error: cut(r?.error ?? "Noma'lum xato"),
        // run() auth/validate xatolarida durationMs qaytarmaydi → o'z taymerimiz.
        durationMs: r?.durationMs != null ? num(r.durationMs) : Date.now() - t0,
      };
    } finally {
      this.running.delete(id);
    }
  }
}
