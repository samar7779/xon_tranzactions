import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { CategorizationService } from '../categorization/categorization.service';
import { TaminotService } from '../taminot/taminot.service';
import { KategoriyaAiService } from './kategoriya-ai.service';

/** Bosqich nomlari — DB'da ham, web'da ham shu satrlar ishlatiladi. */
export const BOSQICHLAR = ['qoidalar', 'schotchik', 'minfin', 'taminot', 'ai'] as const;
export type Bosqich = (typeof BOSQICHLAR)[number];

/**
 * KATEGORIYA AGENTI (orkestrator).
 *
 * Ilgari panelda 4 ta alohida tugma bor edi va ularni to'g'ri tartibda qo'lda
 * bosish kerak edi. Tartib muhim: ta'minot moddasi faqat kategoriya qo'yilgandan
 * keyin ma'noga ega, minfin tozalash esa qoidalardan KEYIN ishlashi kerak.
 * Endi bitta oqim:
 *
 *   1. qoidalar  — shartnoma → CLIENT → MINFIN → BANK → SALARY → LOAN → TRANSFER
 *   2. schotchik — счётчик to'lovlarini oylikka o'tkazish
 *   3. minfin    — izohdagi "НДС" tufayli xato qo'yilgan soliq kategoriyasini tozalash
 *   4. ta'minot  — xontaminot ERP'dan modda + obyekt + shartnoma (FAQAT O'QISH)
 *   5. ai        — 1-4 hal qilmagan QOLDIQNI sub-agent o'ylab chiqaradi
 *
 * Har ishga tushirish `kategoriya_agent_runs` ga yoziladi, AI qarorlari
 * `kategoriya_agent_qarorlar` ga — web'da kuzatish va loglar uchun.
 */
@Injectable()
export class KategoriyaAgentService {
  private readonly log = new Logger(KategoriyaAgentService.name);

  /** Bir vaqtda bitta oqim — ikki marta bosilsa ikkinchisi rad etiladi. */
  private ishlayapti = false;
  private joriyRunId: string | null = null;
  /** Bekor qilish so'rovi (joriy bosqich tugagach to'xtaydi). */
  private toxtatish = false;

  private static readonly BILIM_YOL = 'agents/knowledge/kategoriya.md';
  /** AI bosqichida bir yurishda ko'rib chiqiladigan eng ko'p to'lov. */
  private static readonly AI_LIMIT = Number(process.env.KATEGORIYA_AI_LIMIT || 200);
  /** Bir diagnostika chaqiruvida nechta to'lov (servis chegarasi 2000). */
  private static readonly QOIDA_SAHIFA = 2000;
  /** Eng ko'p nechta sahifa — cheksiz aylanishdan himoya. */
  private static readonly QOIDA_MAX_SAHIFA = 50;
  /**
   * AI chaqiruvlarining KUNLIK chegarasi.
   *
   * ⚠️ Setup token Python agentlar (leader / support / checker / teacher) bilan
   * BIR XIL obunani ishlatadi. Agar bu agent kvotani yeb qo'ysa, ular ishlay
   * olmay qoladi. Shuning uchun o'z chegaramizni qo'yamiz va unga yetganda
   * to'xtaymiz — qolgan to'lovlar ertaga ko'riladi.
   */
  private static readonly AI_KUNLIK_CAP = Number(process.env.KATEGORIYA_AI_KUNLIK_CAP || 30);
  /** Paketlar orasidagi pauza — obunaga portlash bo'lib urilmaslik uchun. */
  private static readonly AI_PAUZA_MS = Number(process.env.KATEGORIYA_AI_PAUZA_MS || 1500);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cat: CategorizationService,
    private readonly taminot: TaminotService,
    private readonly ai: KategoriyaAiService,
  ) {}

  // ───────────────────────────── boshqarish ─────────────────────────────

  async boshla(opts: {
    dateFrom?: string;
    dateTo?: string;
    dryRun?: boolean;
    rematch?: boolean;
    aiYoq?: boolean;
    trigger?: 'manual' | 'cron';
    userId?: string | null;
  }): Promise<{ ok: boolean; started: boolean; runId?: string; message: string }> {
    if (this.ishlayapti) {
      return {
        ok: true, started: false, runId: this.joriyRunId || undefined,
        message: 'Agent allaqachon ishlamoqda — tugashini kutib turing.',
      };
    }
    const dateFrom = opts.dateFrom || '2026-05-01';
    const run = await this.prisma.kategoriyaAgentRun.create({
      data: {
        status: 'running',
        trigger: opts.trigger === 'cron' ? 'cron' : 'manual',
        dryRun: opts.dryRun === true,
        dateFrom,
        dateTo: opts.dateTo || null,
        userId: opts.userId || null,
        bosqich: 'qoidalar',
        stages: {},
      },
    });

    this.ishlayapti = true;
    this.joriyRunId = run.id;
    this.toxtatish = false;

    // Fonda ishlaydi — HTTP so'rov kutib qolmaydi (oqim daqiqalar davom etadi).
    this.oqim(run.id, { ...opts, dateFrom })
      .catch(async (e) => {
        this.log.error(`kategoriya agent oqimi yiqildi: ${e?.message || e}`);
        await this.prisma.kategoriyaAgentRun.update({
          where: { id: run.id },
          data: { status: 'error', error: String(e?.message || e).slice(0, 4000), finishedAt: new Date() },
        }).catch(() => undefined);
      })
      .finally(() => {
        this.ishlayapti = false;
        this.joriyRunId = null;
      });

    return { ok: true, started: true, runId: run.id, message: 'Agent fonda boshlandi.' };
  }

  toxtat(): { ok: true; message: string } {
    if (!this.ishlayapti) return { ok: true, message: 'Agent ishlamayapti.' };
    this.toxtatish = true;
    return { ok: true, message: "To'xtatish so'raldi — joriy bosqich tugagach to'xtaydi." };
  }

  async holat() {
    const oxirgi = await this.prisma.kategoriyaAgentRun.findFirst({
      orderBy: { startedAt: 'desc' },
    });
    return {
      ishlayapti: this.ishlayapti,
      runId: this.joriyRunId,
      bilimBor: fs.existsSync(this.bilimYoli()),
      ai: await this.ai.tayyorlik(),
      aiKunlik: { ishlatilgan: await this.bugungiChaqiriq(), chegara: KategoriyaAgentService.AI_KUNLIK_CAP },
      oxirgi: oxirgi ? this.runXulosa(oxirgi) : null,
    };
  }

  async royxat(limit = 20) {
    const rows = await this.prisma.kategoriyaAgentRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    return { ok: true, rows: rows.map((r) => this.runXulosa(r)) };
  }

  async bitta(id: string, qarorLimit = 300) {
    const run = await this.prisma.kategoriyaAgentRun.findUnique({ where: { id } });
    if (!run) return { ok: false as const, error: 'Topilmadi' };
    const qarorlar = await this.prisma.kategoriyaAgentQaror.findMany({
      where: { runId: id },
      orderBy: { createdAt: 'asc' },
      take: Math.min(2000, Math.max(1, qarorLimit)),
    });
    return {
      ok: true as const,
      run: this.runXulosa(run),
      qarorlar: qarorlar.map((q) => ({
        id: q.id,
        transactionId: q.transactionId,
        bosqich: q.bosqich,
        sana: q.sana,
        summa: q.summa ? String(q.summa) : null,
        kontragent: q.kontragent,
        categoryCode: q.categoryCode,
        modda: q.modda,
        obyekt: q.obyekt,
        shartnoma: q.shartnoma,
        shartnomaSana: q.shartnomaSana,
        ishonch: q.ishonch,
        qoyildi: q.qoyildi,
        sabab: q.sabab,
      })),
    };
  }

  /**
   * Bugun (Toshkent kuni) nechta AI chaqiruvi qilindi.
   * Faqat O'ZIMIZNING jadvaldan sanaladi — `agents` sxemasiga tegilmaydi.
   */
  private async bugungiChaqiriq(): Promise<number> {
    const bugun = new Date();
    const tosh = new Date(bugun.getTime() + 5 * 3600_000).toISOString().slice(0, 10);
    const agg = await this.prisma.kategoriyaAgentRun.aggregate({
      _sum: { aiChaqiriq: true },
      where: { startedAt: { gte: new Date(`${tosh}T00:00:00+05:00`) } },
    }).catch(() => null);
    return agg?._sum?.aiChaqiriq || 0;
  }

  private runXulosa(r: any) {
    return {
      id: r.id,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      status: r.status,
      trigger: r.trigger,
      dryRun: r.dryRun,
      dateFrom: r.dateFrom,
      dateTo: r.dateTo,
      bosqich: r.bosqich,
      stages: r.stages || {},
      aiSoralgan: r.aiSoralgan,
      aiQoyilgan: r.aiQoyilgan,
      aiChaqiriq: r.aiChaqiriq,
      error: r.error,
    };
  }

  // ───────────────────────────── oqim ─────────────────────────────

  private async oqim(runId: string, opts: {
    dateFrom: string; dateTo?: string; dryRun?: boolean; rematch?: boolean;
    aiYoq?: boolean; userId?: string | null;
  }): Promise<void> {
    const stages: Record<string, any> = {};
    const dryRun = opts.dryRun === true;

    const bosqichYoz = async (b: Bosqich, natija: any) => {
      stages[b] = natija;
      await this.prisma.kategoriyaAgentRun.update({
        where: { id: runId },
        data: { bosqich: b, stages },
      }).catch(() => undefined);
    };

    // ── 1) QOIDALAR ──
    //
    // ⚠️ Panel'dagi "Kategoriyalash" tugmasi (runAll) BUTUN tarixni oladi:
    // sharti `categoryId = null YOKI contractNumber = null`, bu esa deyarli
    // hamma tranzaksiyaga to'g'ri keladi (358 000+). Uni agent oqimi ichida
    // kutib o'tirish mumkin emas — soatlab davom etadi va qolgan bosqichlar
    // eskirgan ma'lumot ustida ishlaydi.
    //
    // Shuning uchun agent SANA ORALIG'I bo'yicha ishlaydi: `diagnoseCategorize`
    // faqat kategoriyasizlarni (categoryId = null) oladi va har biri uchun
    // SABABNI qaytaradi. Butun tarixni qayta hisoblash kerak bo'lsa — eski
    // "Kategoriyalash" tugmasi joyida turibdi.
    try {
      await bosqichYoz('qoidalar', await this.qoidalarBosqichi(opts.dateFrom, opts.dateTo, dryRun, opts.userId || null));
    } catch (e: any) {
      await bosqichYoz('qoidalar', { ok: false, error: String(e?.message || e).slice(0, 500) });
    }
    if (this.toxtatish) return this.yakunla(runId, stages, 'stopped');

    // ── 2) SCHOTCHIK ──
    try {
      const r2 = await this.cat.backfillSchotchik({ dryRun, dateFrom: opts.dateFrom, dateTo: opts.dateTo });
      await bosqichYoz('schotchik', { ok: r2.ok, stats: r2.stats });
    } catch (e: any) {
      await bosqichYoz('schotchik', { ok: false, error: String(e?.message || e).slice(0, 500) });
    }
    if (this.toxtatish) return this.yakunla(runId, stages, 'stopped');

    // ── 3) МИНФИН TOZALASH ──
    try {
      const r3 = await this.cat.fixMinfinCategory({
        dateFrom: opts.dateFrom, dryRun, actorId: opts.userId || undefined,
      });
      await bosqichYoz('minfin', { ok: r3.ok, scanned: r3.scanned, ...this.sonlar(r3) });
    } catch (e: any) {
      await bosqichYoz('minfin', { ok: false, error: String(e?.message || e).slice(0, 500) });
    }
    if (this.toxtatish) return this.yakunla(runId, stages, 'stopped');

    // ── 4) TA'MINOT (faqat o'qish) ──
    try {
      const r4 = await this.taminot.matchTransactions({
        dateFrom: opts.dateFrom, dateTo: opts.dateTo, dryRun, rematch: opts.rematch === true,
      });
      await bosqichYoz('taminot', {
        ok: r4.ok, scanned: r4.scanned, alreadyLinked: r4.alreadyLinked,
        matched: r4.matched, ambiguous: r4.ambiguous, notFound: r4.notFound,
        shiftRad: r4.shiftRad, cleared: r4.cleared,
        byArticle: r4.byArticle.slice(0, 10),
        reasons: r4.reasons.slice(0, 8),
      });
    } catch (e: any) {
      await bosqichYoz('taminot', { ok: false, error: String(e?.message || e).slice(0, 500) });
    }
    if (this.toxtatish) return this.yakunla(runId, stages, 'stopped');

    // ── 5) AI — qoldiq ──
    if (opts.aiYoq === true) {
      await bosqichYoz('ai', { ok: true, otkazildi: "so'rovda o'chirilgan" });
    } else {
      try {
        const r5 = await this.aiBosqich(runId, opts.dateFrom, opts.dateTo, dryRun, opts.userId || null);
        await bosqichYoz('ai', r5);
      } catch (e: any) {
        await bosqichYoz('ai', { ok: false, error: String(e?.message || e).slice(0, 500) });
      }
    }

    await this.yakunla(runId, stages, 'ok');
  }

  /** Natija obyektidan sonli maydonlarni xulosaga ko'chiradi (jadval juda uzun bo'lmasin). */
  private sonlar(o: any): Record<string, number> {
    const chiq: Record<string, number> = {};
    for (const [k, v] of Object.entries(o || {})) {
      if (typeof v === 'number' && k !== 'scanned') chiq[k] = v;
    }
    return chiq;
  }

  private async yakunla(runId: string, stages: Record<string, any>, status: string) {
    await this.prisma.kategoriyaAgentRun.update({
      where: { id: runId },
      data: { status, stages, finishedAt: new Date(), bosqich: null },
    }).catch(() => undefined);
  }

  /**
   * 1-bosqich: sana oralig'idagi KATEGORIYASIZ to'lovlarga qoidalarni qo'llaydi.
   *
   * `diagnoseCategorize` sahifama-sahifa chaqiriladi (bir chaqiruv 2000 tagacha).
   * U kategoriyalagan qator `categoryId = null` shartidan chiqadi, shuning uchun
   * keyingi chaqiruv o'z-o'zidan qolganlarni oladi. Ilgarilash to'xtasa
   * (hech biri kategoriyalanmasa) — qolganlari qoidaga tushmaydi, chiqamiz.
   */
  private async qoidalarBosqichi(
    dateFrom: string, dateTo: string | undefined, dryRun: boolean, userId: string | null,
  ): Promise<any> {
    const where = {
      categoryId: null,
      txnDate: {
        gte: new Date(`${dateFrom}T00:00:00+05:00`),
        ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+05:00`) } : {}),
      },
    };
    const boshida = await this.prisma.transaction.count({ where });

    if (dryRun) {
      // Sinovda yozmaymiz — diagnoseCategorize DB'ga yozadi.
      return {
        ok: true, dryRun: true, kategoriyasiz: boshida,
        izoh: "sinov — qoidalar qo'llanmadi, haqiqiy yurishda qo'llanadi",
      };
    }

    let qoyildi = 0;
    let korildi = 0;
    const sabablar = new Map<string, number>();

    for (let sahifa = 0; sahifa < KategoriyaAgentService.QOIDA_MAX_SAHIFA; sahifa++) {
      if (this.toxtatish) break;
      const r = await this.cat.diagnoseCategorize({
        dateFrom, dateTo, limit: KategoriyaAgentService.QOIDA_SAHIFA, actorId: userId || undefined,
      });
      korildi += r.total;
      qoyildi += r.categorized;
      for (const row of r.rows || []) {
        if (row.categoryCode) continue;
        const k = String(row.reason || "sabab yo'q").slice(0, 120);
        sabablar.set(k, (sabablar.get(k) || 0) + 1);
      }
      // Ilgarilash yo'q yoki hammasi ko'rildi — to'xtaymiz.
      if (r.total === 0 || r.categorized === 0) break;
    }

    const qolgan = await this.prisma.transaction.count({ where });
    return {
      ok: true,
      kategoriyasiz: boshida,
      korildi,
      qoyildi,
      qolgan,
      reasons: Array.from(sabablar.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
    };
  }

  // ───────────────────────────── AI bosqichi ─────────────────────────────

  private bilimYoli(): string {
    return process.env.KATEGORIYA_BILIM_YOL
      || path.resolve(process.cwd(), '..', KategoriyaAgentService.BILIM_YOL);
  }

  private bilimOqi(): string {
    const yol = this.bilimYoli();
    try {
      return fs.readFileSync(yol, 'utf8');
    } catch {
      this.log.warn(`bilim fayli o'qilmadi: ${yol}`);
      return '';
    }
  }

  /**
   * 1-4 bosqich hal qilmagan to'lovlar: CHIQIM, kategoriyasiz YOKI moddasiz.
   * Mijoz to'lovlari (CLIENT) umuman olinmaydi — ular ОплатыКв mantiqiga tegishli.
   */
  private async aiBosqich(
    runId: string, dateFrom: string, dateTo: string | undefined, dryRun: boolean, userId: string | null,
  ) {
    const bilim = this.bilimOqi();
    if (!bilim.trim()) {
      return { ok: false, error: `bilim fayli yo'q: ${KategoriyaAgentService.BILIM_YOL}` };
    }

    const qoldiq = await this.prisma.transaction.findMany({
      where: {
        txnDate: {
          gte: new Date(`${dateFrom}T00:00:00+05:00`),
          ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+05:00`) } : {}),
        },
        direction: 'OUT',
        NOT: { category: { code: 'CLIENT' } },
        OR: [{ categoryId: null }, { erpArticle: null }],
      },
      select: {
        id: true, txnDate: true, amount: true, direction: true,
        fromName: true, toName: true, description: true,
        contractNumber: true, fromAccount: true, toAccount: true,
      },
      orderBy: { txnDate: 'desc' },
      take: KategoriyaAgentService.AI_LIMIT,
    });

    if (qoldiq.length === 0) return { ok: true, qoldiq: 0, soralgan: 0, qoyilgan: 0, past: 0 };

    const kategoriyalar = await this.prisma.category.findMany({
      where: { parentId: null },
      select: { id: true, code: true, name: true },
      orderBy: { sortOrder: 'asc' },
    });
    const kodMap = new Map(kategoriyalar.map((c) => [c.code, c.id]));

    // Kunlik chegara — qolgan joy. Python agentlarga kvota qoldirish uchun.
    const ishlatilgan = await this.bugungiChaqiriq();
    const qolganJoy = KategoriyaAgentService.AI_KUNLIK_CAP - ishlatilgan;
    if (qolganJoy <= 0) {
      return {
        ok: true, qoldiq: qoldiq.length, soralgan: 0, qoyilgan: 0, past: 0,
        chegara: `kunlik chegara tugadi (${ishlatilgan}/${KategoriyaAgentService.AI_KUNLIK_CAP}) — ertaga davom etadi`,
      };
    }

    let soralgan = 0, qoyilgan = 0, past = 0, xato = 0, chaqiriq = 0;
    let limitUrildi = false;
    const xatolar: string[] = [];

    for (let i = 0; i < qoldiq.length; i += KategoriyaAiService.PAKET) {
      if (this.toxtatish) break;
      if (chaqiriq >= qolganJoy) break; // kunlik chegara
      // Portlash bo'lib urilmaslik uchun paketlar orasida pauza.
      if (chaqiriq > 0) await new Promise((r) => setTimeout(r, KategoriyaAgentService.AI_PAUZA_MS));
      const paket = qoldiq.slice(i, i + KategoriyaAiService.PAKET);
      const javob = await this.ai.qaror(
        bilim,
        paket.map((t) => ({
          id: t.id,
          sana: t.txnDate.toISOString().slice(0, 10),
          summa: String(t.amount),
          yonalish: t.direction,
          kontragent: (t.direction === 'IN' ? t.fromName : t.toName) || '',
          izoh: String(t.description || '').slice(0, 500),
          shartnoma: t.contractNumber,
          hisob: t.direction === 'IN' ? t.toAccount : t.fromAccount,
        })),
        kategoriyalar.map((c) => ({ code: c.code, name: c.name })),
      );
      soralgan += paket.length;
      chaqiriq++;

      if (!javob.ok) {
        xato++;
        if (xatolar.length < 5) xatolar.push(javob.error || 'nomalum xato');
        // Obuna chegarasi — DARHOL to'xtaymiz. Python agentlar ham shu tokenda
        // ishlaydi, davom etsak ularni ham to'sib qo'yamiz.
        if (javob.limit) {
          limitUrildi = true;
          this.log.warn("AI obuna chegarasi — bosqich to'xtatildi, agentlarga joy qoldirildi");
          break;
        }
        // Ketma-ket xato bo'lsa to'xtaymiz — davom etish befoyda.
        if (xato >= 3) break;
        continue;
      }

      const paketMap = new Map(paket.map((t) => [t.id, t]));
      for (const q of javob.qarorlar) {
        const tx = paketMap.get(q.id);
        if (!tx) continue; // model o'zidan id to'qib chiqargan — tashlab ketamiz
        const yetarli = q.ishonch >= KategoriyaAiService.MIN_ISHONCH
          && !!q.categoryCode && kodMap.has(q.categoryCode);
        if (!yetarli) past++;

        let yozildi = false;
        if (yetarli && !dryRun) {
          try {
            await this.cat.setManual(tx.id, { categoryId: kodMap.get(q.categoryCode!)! }, userId, 'Kategoriya agenti');
            if (q.modda || q.obyekt) {
              await this.prisma.transaction.update({
                where: { id: tx.id },
                data: {
                  ...(q.modda ? { erpArticle: q.modda.slice(0, 255) } : {}),
                  ...(q.obyekt ? { erpObject: q.obyekt.slice(0, 255) } : {}),
                },
              });
            }
            yozildi = true;
            qoyilgan++;
          } catch (e: any) {
            if (xatolar.length < 5) xatolar.push(`yozish: ${String(e?.message || e).slice(0, 120)}`);
          }
        } else if (yetarli && dryRun) {
          qoyilgan++;
        }

        await this.prisma.kategoriyaAgentQaror.create({
          data: {
            runId,
            transactionId: tx.id,
            bosqich: 'ai',
            summa: tx.amount,
            sana: tx.txnDate.toISOString().slice(0, 10),
            kontragent: ((tx.direction === 'IN' ? tx.fromName : tx.toName) || '').slice(0, 255),
            categoryCode: q.categoryCode,
            modda: q.modda,
            obyekt: q.obyekt,
            shartnoma: q.shartnoma,
            shartnomaSana: q.shartnomaSana,
            ishonch: q.ishonch,
            qoyildi: yozildi || (yetarli && dryRun),
            sabab: q.sabab,
          },
        }).catch(() => undefined);
      }

      await this.prisma.kategoriyaAgentRun.update({
        where: { id: runId },
        data: { aiSoralgan: soralgan, aiQoyilgan: qoyilgan, aiChaqiriq: chaqiriq },
      }).catch(() => undefined);
    }

    // Chaqiriq soni oxirida ham yoziladi — paket xato bo'lib yuqoridagi
    // yangilanishga yetib bormagan holat uchun (kunlik hisob to'g'ri qolsin).
    await this.prisma.kategoriyaAgentRun.update({
      where: { id: runId },
      data: { aiChaqiriq: chaqiriq },
    }).catch(() => undefined);

    return {
      ok: xato < 3 && !limitUrildi,
      qoldiq: qoldiq.length,
      soralgan, qoyilgan, past,
      chaqiriq,
      kunlik: `${ishlatilgan + chaqiriq}/${KategoriyaAgentService.AI_KUNLIK_CAP}`,
      paketXato: xato,
      ...(limitUrildi ? { chegara: "obuna chegarasi — to'xtatildi, agentlarga joy qoldirildi" } : {}),
      ...(xatolar.length ? { xatolar } : {}),
    };
  }
}
