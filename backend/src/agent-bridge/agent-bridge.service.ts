import {
  BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma/prisma.service';
import { ChekOrderService } from '../chek-order/chek-order.service';
import { CrmService } from '../crm/crm.service';
import { TrSupportService } from '../tr-support/tr-support.service';
import { TrArizaService } from '../tr-support/tr-ariza.service';
import { TrMalumotService } from '../tr-support/tr-malumot.service';
import { GoogleExportService } from '../google-export/google-export.service';
import { AGENT_BRIDGE_KEY_ENV, isKeyConfigured } from './agent-bridge.guard';
import { parseSheetIds } from './agent-bridge.validation';
import {
  BridgeChekFindResponse, BridgeContractResult, BridgeCrmLookupResponse, BridgeCrmLookupRow, BridgeCrmPart, BridgeExportItem, BridgeExportLastRun, BridgeExportsResponse,
  BridgeOplataPart, BridgePaymentCheckResponse, BridgeRunResponse, BridgeSheetPart,
  BridgeTxApply, BridgeTxChange, BridgeTxOptions, BridgeTxPreview, BridgeTxView, BridgeTxXato,
  BridgeArizaFind, BridgeArizaStatus, BridgeArizaSubmit,
} from './agent-bridge.types';

const ERR_MAX = 300;
const RUN_TRIGGERED_BY = 'manual:agent-bridge';

const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: any): number | null => (v == null ? null : num(v));
// Sozlama ro'yxati (string yoki son massiv) -> tozalangan satrlar; massiv bo'lmasa bo'sh
const strList = (v: any): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 200) : [];
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
    private readonly crm: CrmService,
    private readonly trSupport: TrSupportService,
    private readonly trAriza: TrArizaService,
    private readonly trMalumot: TrMalumotService,
  ) {}

  // ───────────────────────── hisob / xato-royxat (faqat o'qish) ─────────────────────────
  hisob(raqam: string) {
    return this.trMalumot.hisob(raqam);
  }

  xatoRoyxat(filtr: string | null) {
    return this.trMalumot.xatoFayl(filtr);
  }

  onModuleInit(): void {
    // Kalit qiymati/uzunligi log'ga yozilmaydi — faqat holat.
    if (isKeyConfigured(this.config.get<string>(AGENT_BRIDGE_KEY_ENV))) {
      this.log.log('agent-bridge ochiq (faqat loopback, kalit bilan)');
    } else {
      this.log.log(`${AGENT_BRIDGE_KEY_ENV} sozlanmagan — ko'prik YOPIQ (hamma so'rov 403)`);
    }
  }

  // ───────────────────────── xato-ariza (TR Support) ─────────────────────────
  async arizaFind(q: { tx: string | null; summa: number | null; sana: string | null; hisob: string | null; shartnoma: string | null }): Promise<BridgeArizaFind> {
    const r = await this.trAriza.find(q);
    return {
      ok: true, hisobMos: r.hisobMos, aiName: cut(r.aiName),
      crm: r.crm ? { contract: r.crm.contract, found: r.crm.found, customerName: strOrNull(r.crm.customerName), objectName: strOrNull(r.crm.objectName) } : null,
      candidates: r.candidates.slice(0, 20).map((c) => ({
        oplataKvId: c.oplataKvId, txId: strOrNull(c.txId), date: strOrNull(c.date), amount: c.amount != null ? num(c.amount) : null,
        contractNo: strOrNull(c.contractNo), client: strOrNull(c.client), purpose: c.purpose != null ? String(c.purpose).slice(0, 300) : null,
        toAccount: strOrNull(c.toAccount), fromAccount: strOrNull(c.fromAccount), direction: strOrNull(c.direction),
        pending: c.pending ? { by: strOrNull(c.pending.by), at: strOrNull(c.pending.at), contract: strOrNull(c.pending.contract) } : null,
      })),
    };
  }

  async arizaSubmit(b: { oplataKvId: string; contractNo: string; fayl: string; yubordi: string }): Promise<BridgeArizaSubmit> {
    const r = await this.trAriza.submit(b);
    return { ok: true, id: String(r.id), alreadyPending: !!r.alreadyPending, contract: String(r.contract), aiEnabled: !!r.aiEnabled, aiName: cut(r.aiName) };
  }

  async arizaStatus(id: string): Promise<BridgeArizaStatus> {
    const r = await this.trAriza.status(id);
    return {
      ok: true, id: r.id, status: String(r.status), agentState: strOrNull(r.agentState), agentReason: r.agentReason != null ? cut(r.agentReason) : null,
      reviewedBy: strOrNull(r.reviewedBy), reviewedByType: strOrNull(r.reviewedByType), rejectReason: r.rejectReason != null ? cut(r.rejectReason) : null,
      contract: strOrNull(r.contract), reviewedAt: strOrNull(r.reviewedAt), aiName: cut(r.aiName),
    };
  }

  // ───────────────────────── tx-edit (TR Support) ─────────────────────────
  private pickTx(t: any): BridgeTxView | null {
    if (!t) return null;
    const kv = (x: any) => (x ? { code: String(x.code), name: String(x.name) } : null);
    return {
      id: String(t.id), externalId: strOrNull(t.externalId), date: strOrNull(t.date), amount: num(t.amount),
      direction: strOrNull(t.direction), editable: !!t.editable,
      description: t.description != null ? String(t.description).slice(0, 300) : null,
      kontragent: kv(t.kontragent), kategoriya: kv(t.kategoriya),
      shartnoma: strOrNull(t.shartnoma), isContractManual: !!t.isContractManual,
    };
  }

  private pickXato(x: any): BridgeTxXato | null {
    if (!x) return null;
    return {
      inList: !!x.inList, contractNo: strOrNull(x.contractNo), pending: !!x.pending, pendingBy: strOrNull(x.pendingBy),
      pendingAt: strOrNull(x.pendingAt), pendingContract: strOrNull(x.pendingContract),
      xabar: x.xabar != null ? cut(x.xabar) : null,
    };
  }

  private pickChanges(cs: any[]): BridgeTxChange[] {
    return (cs || []).map((c) => ({ field: c.field, from: strOrNull(c.from), to: strOrNull(c.to) }));
  }

  async txEditOptions(tx: string): Promise<BridgeTxOptions> {
    const r = await this.trSupport.options(tx);
    return {
      ok: true, tx: this.pickTx(r.tx), xato: this.pickXato(r.xato),
      kontragentlar: r.tree.map((t) => ({
        code: t.code, name: t.name, kategoriyalar: t.children.map((c) => ({ code: c.code, name: c.name })),
      })),
    };
  }

  async txEditPreview(tx: string, choice: { kontragent: string | null; kategoriya: string | null; shartnoma: string | null }): Promise<BridgeTxPreview> {
    const p = await this.trSupport.preview(tx, choice);
    return {
      ok: true, valid: p.valid, errors: p.errors.map(cut), tx: this.pickTx(p.tx), changes: this.pickChanges(p.changes),
      xato: this.pickXato(p.xato),
      harf: p.harf ? { from: p.harf.from, to: p.harf.to } : null,
      ulash: p.ulash ? { from: p.ulash.from, to: p.ulash.to, obyekt: p.ulash.obyekt ?? null } : null,
      xatoQoladi: !!p.xatoQoladi,
      crm: p.crm ? { contract: p.crm.contract, found: p.crm.found, customerName: p.crm.customerName, objectName: p.crm.objectName } : null,
    };
  }

  async txEditApply(b: {
    items: Array<{ tx: string; kontragent: string | null; kategoriya: string | null; shartnoma: string | null }>;
    approvedBy: string; comment: string | null;
  }): Promise<BridgeTxApply> {
    const r = await this.trSupport.apply(b.items, { approvedBy: b.approvedBy, comment: b.comment, requestedBy: 'Telegram egasi (TR Support bot)' });
    return {
      ok: true, batchId: r.batchId,
      results: r.results.map((x) => ({
        tx: x.tx, id: x.id || null, status: x.status, errors: (x.errors || []).map(cut), changes: this.pickChanges(x.changes),
        oplataKv: typeof x.oplataKv === 'boolean' ? x.oplataKv : null,
        okv: x.okv ? { contractNo: strOrNull(x.okv.contractNo), client: strOrNull(x.okv.client), object: strOrNull(x.okv.object) } : null,
        crm: x.crm ? { customerName: strOrNull(x.crm.customerName), objectName: strOrNull(x.crm.objectName) } : null,
      })),
      sync: r.sync ? {
        ok: !!r.sync.ok, added: r.sync.added, updated: r.sync.updated, skipped: r.sync.skipped,
        ...(r.sync.error ? { error: cut(r.sync.error) } : {}),
      } : null,
    };
  }

  // ───────────────────────── chek-find (FAQAT O'QISH) ─────────────────────────
  /** Chek ma'lumoti → tranzaksiya (ChekOrderService.findForAgent = matchOrder; natija saqlanmaydi). */
  async chekFind(o: {
    orderNo: string; amount: number | null; date: string | null; recipientAccount: string | null; contractNo: string | null;
  }): Promise<BridgeChekFindResponse> {
    const r: any = await this.chekOrder.findForAgent({
      orderNo: o.orderNo, amount: o.amount, date: o.date, recipientAccount: o.recipientAccount, contractNo: o.contractNo,
    });
    const t = r?.matchedTx;
    const c = r?.conditions;
    const b = (v: any): boolean | null => (v === true ? true : v === false ? false : null);
    return {
      ok: true,
      result: r?.result === 'found' || r?.result === 'mismatch' ? r.result : 'not_found',
      conditions: c ? { order: b(c.order), account: b(c.account), date: b(c.date), amount: b(c.amount), contract: b(c.contract) } : null,
      tx: t ? {
        id: String(t.id),
        externalId: strOrNull(t.externalId),
        direction: strOrNull(t.direction),
        amount: num(t.amount),
        txnDate: t.txnDate ? new Date(t.txnDate).toISOString() : null,
        docNumber: strOrNull(t.docNumber),
        contractNumber: strOrNull(t.contractNumber),
        fromName: strOrNull(t.fromName),
        description: t.description != null ? String(t.description).slice(0, 300) : null,
      } : null,
    };
  }

  // ───────────────────────── crm-lookup (FAQAT O'QISH) ─────────────────────────
  /** Shartnomasiz bank to'lovi CRM'da: CrmService.lookupForAgent (panel «XATO → CRM» match'i + transaction_id). */
  async crmLookup(id: string, date: string | null, amount: number | null): Promise<BridgeCrmLookupResponse> {
    const t0 = Date.now();
    try {
      const r: any = await this.crm.lookupForAgent(id, date, amount);
      if (!r?.ok) return { ok: false, error: cut(r?.error || 'CRM javob bermadi') };
      const pick = (p: any): BridgeCrmLookupRow => ({
        contract: String(p?.contract ?? '').trim(),
        date: String(p?.date ?? '').slice(0, 10),
        amount: num(p?.amount),
        initialAmount: num(p?.initialAmount), monthlyAmount: num(p?.monthlyAmount), otherAmount: num(p?.otherAmount),
        object: strOrNull(p?.object),
        client: strOrNull(p?.client),
        externalId: String(p?.externalId ?? '').slice(0, 255),
      });
      const exact = (r.exact || []).slice(0, 5).map(pick);
      const sameAmount = (r.sameAmount || []).slice(0, 5).map(pick);
      this.log.log(`crm-lookup · exact=${exact.length} same=${sameAmount.length} via=${r.via ?? '-'} · ${Date.now() - t0}ms`);
      return {
        ok: true,
        via: r.via === 'sana' || r.via === 'transaction_id' ? r.via : null,
        checkedDate: r.checkedDate ? String(r.checkedDate).slice(0, 10) : null,
        exact, sameAmount,
      };
    } catch (e: any) {
      this.log.warn(`crm-lookup xato: ${e?.message}`);
      return { ok: false, error: cut(e?.message || 'CRM qidiruvi yiqildi') };
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
        externalId: strOrNull(p?.externalId),       // Внешний ID: XonPay UUID yoki bank kompoziti
        method: strOrNull(p?.method),               // Способ: masalan "Xon Pay"
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
      cron: {
        enabled: !!s.cron?.enabled,
        everyMinutes: numOrNull(s.cron?.everyMinutes),
        hourFrom: numOrNull(s.cron?.hourFrom),
        hourTo: numOrNull(s.cron?.hourTo),
        days: strList(s.cron?.days).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
      },
      dateFrom: s.dateFrom ? String(s.dateFrom).slice(0, 10) : null,
      filter: {
        objects: strList(s.filter?.objects),
        categories: strList(s.filter?.categories),
        txTypes: strList(s.filter?.txTypes),
        accounts: strList(s.filter?.accounts),
        amountSign: s.filter?.amountSign === 'pos' || s.filter?.amountSign === 'neg' ? s.filter.amountSign : null,
      },
      keyField: s.keyField ? String(s.keyField) : null,
      fields: (s.columns || []).map((c) => String(c?.field ?? '')).filter(Boolean),
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
