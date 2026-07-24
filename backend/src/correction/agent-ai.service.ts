import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CorrectionService } from './correction.service';

/**
 * AI Agent — ariza tuzatish so'rovlarini avtomat tekshiradi (Claude vision).
 *
 * Ish tartibi (foydalanuvchi o'rgatgan qoidalar):
 *  1. Ariza faylini o'qiydi (rasm/PDF).
 *  2. OBYEKT qoidasi: shartnomadagi raqamlardan keyingi 3 harf = obyekt.
 *     To'lovni bir obyektdan boshqasiga o'tkazib bo'lmaydi. Taklif shartnoma
 *     obyekti ≠ maqsaddagi shartnoma obyekti bo'lsa → xodimga qoldiradi.
 *  3. Ariza faylida yozilgan shartnoma taklif bilan mos kelishini tekshiradi.
 *  4. Kategoriya: har doim CLIENT (mijozdan kelgan to'lov).
 *  5. Sub-kategoriya: maqsadga qarab (Взносы за квартиры / автостоянку / ...).
 *  6. Qaror: approve / reject (sabab bilan) / human (tushunmasa).
 */
@Injectable()
export class AgentAiService {
  private readonly log = new Logger(AgentAiService.name);

  private readonly K_AI_KEY = 'agent.aiKey';
  private readonly K_AI_MODEL = 'agent.aiModel';
  private readonly K_AI_ENABLED = 'agent.aiEnabled';
  private readonly K_AI_INTERVAL = 'agent.aiIntervalMin';
  private readonly DEFAULT_MODEL = 'claude-sonnet-4-6';
  private lastRunMs = 0;

  // Ustma-ust ishlamaslik uchun (bir vaqtda bitta tsikl)
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly correction: CorrectionService,
  ) {}

  /**
   * Har 5 daqiqada tekshiradi. TEJAMKOR: faqat agent yoqilgan + kalit bor +
   * kutayotgan (agentState=null) ariza bo'lsa Claude'ni chaqiradi. Aks holda
   * hech narsa qilmaydi (rasxod yo'q). `running` lock ustma-ust ishlamaydi.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (this.running) return;
    try {
      if (!(await this.isEnabled())) return;
      const intervalMin = await this.getIntervalMin();
      if (Date.now() - this.lastRunMs < intervalMin * 60_000) return; // interval hali o'tmagan
      this.lastRunMs = Date.now();
      const pending = await this.prisma.xatoCorrectionRequest.count({
        where: { status: 'pending', agentState: null, attachmentId: { not: null } },
      });
      if (pending === 0) return; // ariza yo'q — Claude chaqirilmaydi (rasxod 0)
      if (!(await this.getApiKey())) return; // kalit yo'q
      this.running = true;
      this.log.log(`AI agent tsikl boshlandi — ${pending} ta ariza`);
      await this.processPending(10);
    } catch (e: any) {
      this.log.warn(`AI agent tsikl xatosi: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  async getIntervalMin(): Promise<number> {
    const v = Number(await this.setting(this.K_AI_INTERVAL));
    return v >= 1 && v <= 1440 ? Math.round(v) : 5;
  }

  // ─── Sozlama ───────────────────────────────────────────────────────
  private async setting(key: string): Promise<string | null> {
    const s = await this.prisma.setting.findUnique({ where: { key } });
    return s?.value ?? null;
  }
  async getApiKey(): Promise<string | null> {
    const enc = await this.setting(this.K_AI_KEY);
    if (enc) { try { return this.crypto.decrypt(enc); } catch { /* skip */ } }
    return process.env.ANTHROPIC_API_KEY || null;
  }
  async isEnabled(): Promise<boolean> {
    return (await this.setting(this.K_AI_ENABLED)) === '1';
  }
  async getModel(): Promise<string> {
    return (await this.setting(this.K_AI_MODEL)) || this.DEFAULT_MODEL;
  }

  /** Shartnomadagi raqamlardan keyingi harflar = obyekt kodi. 118VTN24LJ → VTN */
  objectCode(contract?: string | null): string | null {
    if (!contract) return null;
    const c = contract.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const m = c.match(/^\d+([A-Z]{2,4})/);
    return m ? m[1] : null;
  }

  // ─── Bitta arizani agent bilan qayta ishlash ───────────────────────
  async processRequest(requestId: string): Promise<{ ok: boolean; decision?: string; reason?: string; error?: string }> {
    const req = await this.prisma.xatoCorrectionRequest.findUnique({ where: { id: requestId } });
    if (!req) return { ok: false, error: 'Ariza topilmadi' };
    if (req.status !== 'pending') return { ok: false, error: 'Ariza allaqachon ko\'rib chiqilgan' };
    if (req.agentState) return { ok: false, error: 'Agent allaqachon ishlagan/ishlamoqda' };

    const apiKey = await this.getApiKey();
    if (!apiKey) return { ok: false, error: 'AI kalit sozlanmagan' };

    // Atomik "claim" — ikki jarayon (cron + submit trigger) bir arizani
    // ustma-ust ishlamasin. Faqat agentState=null bo'lsa egallaydi.
    const claimed = await this.prisma.xatoCorrectionRequest.updateMany({
      where: { id: requestId, status: 'pending', agentState: null },
      data: { agentState: 'processing', agentAt: new Date() },
    });
    if (claimed.count === 0) return { ok: false, error: 'Boshqa jarayon ishlamoqda' };

    try {
      // 1) Ariza faylini o'qish
      let fileBlock: any = null;
      if (req.attachmentId) {
        const att = await this.prisma.transactionAttachment.findUnique({ where: { id: req.attachmentId } });
        if (att) {
          try {
            const buf = await fs.readFile(att.storagePath);
            const b64 = buf.toString('base64');
            const mt = att.mimeType || '';
            if (mt === 'application/pdf' || att.filename.toLowerCase().endsWith('.pdf')) {
              fileBlock = { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } };
            } else if (mt.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(att.filename)) {
              const media = mt.startsWith('image/') ? mt : 'image/jpeg';
              fileBlock = { type: 'image', source: { type: 'base64', media_type: media, data: b64 } };
            }
          } catch (e: any) {
            this.log.warn(`Ariza fayli o'qilmadi (${req.attachmentId}): ${e?.message}`);
          }
        }
      }

      // 2) CLIENT kategoriya + sub-kategoriyalar
      const clientCat = await this.prisma.category.findFirst({
        where: { code: 'CLIENT' },
        select: { id: true, name: true, children: { select: { id: true, name: true } } },
      });
      const subCats = (clientCat?.children || []).map((c) => c.name);

      // 3) Obyekt kodlari (deterministik guard)
      const proposedObj = this.objectCode(req.proposedContractNo);
      const purposeObj = this.objectCode(this.firstContractInText(req.snapPurpose));

      // 4) Claude'ni chaqirish
      const model = await this.getModel();
      const decision = await this.callClaude(apiKey, model, {
        purpose: req.snapPurpose || '',
        amount: req.snapAmount != null ? String(req.snapAmount) : '',
        client: req.snapClient || '',
        proposedContract: req.proposedContractNo || '',
        proposedObject: proposedObj || '(aniqlanmadi)',
        purposeObject: purposeObj || '(aniqlanmadi)',
        subCats,
        fileBlock,
      });

      // 5) Deterministik OBYEKT guard — mos kelmasa xodimga
      let finalDecision = decision.decision;
      let reason = decision.reason || '';
      if (proposedObj && purposeObj && proposedObj !== purposeObj) {
        finalDecision = 'human';
        reason = `Obyekt mos emas: maqsad "${purposeObj}", taklif "${proposedObj}". Boshqa obyektga o'tkazib bo'lmaydi — xodim tekshirsin.`;
      }

      // 6) Qarorni qo'llash
      if (finalDecision === 'approve') {
        // Sub-kategoriya nomi → id
        let subCategoryId: string | null = null;
        if (decision.subCategory && clientCat) {
          const match = clientCat.children.find(
            (c) => c.name.toLowerCase().trim() === String(decision.subCategory).toLowerCase().trim(),
          );
          subCategoryId = match?.id || null;
        }
        await this.correction.approve(requestId, undefined, {
          contractNo: req.proposedContractNo || undefined,
          categoryId: clientCat?.id || null,
          subCategoryId,
          actorId: 'agent',
          actorType: 'agent',
        });
        await this.prisma.xatoCorrectionRequest.update({
          where: { id: requestId }, data: { agentState: 'done', agentReason: reason },
        });
        this.log.log(`Agent TASDIQLADI: ${requestId} · ${req.proposedContractNo} · ${reason}`);
        return { ok: true, decision: 'approve', reason };
      }

      if (finalDecision === 'reject') {
        await this.correction.reject(requestId, reason, 'agent', 'agent');
        await this.prisma.xatoCorrectionRequest.update({
          where: { id: requestId }, data: { agentState: 'done', agentReason: reason },
        });
        this.log.log(`Agent RAD ETDI: ${requestId} · ${reason}`);
        return { ok: true, decision: 'reject', reason };
      }

      // human — pending qoladi, "ko'rib chiqish kerak" belgisi
      await this.prisma.xatoCorrectionRequest.update({
        where: { id: requestId }, data: { agentState: 'needs_review', agentReason: reason },
      });
      this.log.log(`Agent XODIMGA QOLDIRDI: ${requestId} · ${reason}`);
      return { ok: true, decision: 'human', reason };
    } catch (e: any) {
      await this.prisma.xatoCorrectionRequest.update({
        where: { id: requestId }, data: { agentState: 'needs_review', agentReason: `Agent xatosi: ${e?.message}` },
      }).catch(() => {});
      this.log.error(`Agent xatosi (${requestId}): ${e?.message}`);
      return { ok: false, error: e?.message };
    }
  }

  /** Kutilayotgan arizalarni ketma-ket agent bilan qayta ishlash (max N). */
  async processPending(limit = 20): Promise<{ ok: boolean; processed: number; results: any[] }> {
    const pend = await this.prisma.xatoCorrectionRequest.findMany({
      where: { status: 'pending', agentState: null, attachmentId: { not: null } },
      orderBy: { submittedAt: 'asc' },
      take: Math.min(50, Math.max(1, limit)),
      select: { id: true },
    });
    const results: any[] = [];
    for (const p of pend) {
      results.push({ id: p.id, ...(await this.processRequest(p.id)) });
    }
    return { ok: true, processed: results.length, results };
  }

  /** Agent boshqaruvi uchun holat (dashboard). */
  async status() {
    const [enabled, apiKey, pending, processing, needsReview, agentApproved, agentRejected] = await Promise.all([
      this.isEnabled(),
      this.getApiKey(),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'pending', agentState: null, attachmentId: { not: null } } }),
      this.prisma.xatoCorrectionRequest.count({ where: { agentState: 'processing' } }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'pending', agentState: 'needs_review' } }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'approved', reviewedByType: 'agent' } }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'rejected', reviewedByType: 'agent' } }),
    ]);
    return {
      ok: true, enabled, hasKey: !!apiKey, running: this.running,
      model: await this.getModel(), intervalMin: await this.getIntervalMin(),
      counts: { pending, processing, needsReview, agentApproved, agentRejected },
    };
  }

  /** Agent oxirgi qarorlari (faoliyat lentasi). */
  async recent(limit = 15) {
    const rows = await this.prisma.xatoCorrectionRequest.findMany({
      where: { agentAt: { not: null } },
      orderBy: { agentAt: 'desc' },
      take: Math.min(50, Math.max(1, limit)),
      select: {
        id: true, status: true, agentState: true, agentReason: true, agentAt: true,
        proposedContractNo: true, snapClient: true, snapAmount: true, reviewedByType: true,
      },
    });
    return {
      ok: true,
      rows: rows.map((r) => ({
        id: r.id, status: r.status, agentState: r.agentState, agentReason: r.agentReason,
        agentAt: r.agentAt, contractNo: r.proposedContractNo, client: r.snapClient,
        amount: r.snapAmount != null ? Number(r.snapAmount) : null,
        byAgent: r.reviewedByType === 'agent',
      })),
    };
  }

  // ─── Claude Messages API (tool_use bilan structured output) ────────
  private async callClaude(apiKey: string, model: string, ctx: {
    purpose: string; amount: string; client: string;
    proposedContract: string; proposedObject: string; purposeObject: string;
    subCats: string[]; fileBlock: any;
  }): Promise<{ decision: 'approve' | 'reject' | 'human'; reason: string; subCategory?: string; arizaValid?: boolean }> {
    const system = [
      'Sen "Xon Saroy" ko\'chmas mulk quruvchisi uchun to\'lov tuzatish arizalarini tekshiruvchi ehtiyotkor agentsan.',
      'QOIDALAR:',
      '1) OBYEKT: shartnoma raqamidagi raqamlardan keyingi 3 harf obyektni bildiradi (masalan 118VTN24LJ → VTN).',
      '   To\'lovni bir obyektdan boshqa obyektga o\'tkazib BO\'LMAYDI. Agar taklif qilingan shartnoma obyekti',
      '   maqsaddagi shartnoma obyektidan farq qilsa — "human" (xodimga qoldir).',
      '2) Ariza faylini diqqat bilan o\'qi: undagi shartnoma raqami taklif qilingan tuzatishga mos keladimi?',
      '   Ariza haqiqiy va tuzatishni tasdiqlasa — yaxshi. Tushunarsiz/mos kelmasa — "human".',
      '3) Kategoriya har doim "Клиент / Физ.Л / Юр.Л" (bu mijozdan kelgan to\'lov).',
      '4) Sub-kategoriyani MAQSAD matniga qarab ro\'yxatdan tanla (masalan uy/kvartira to\'lovi → "Взносы за квартиры",',
      '   avtostoyanka → "Взносы за автостоянку", qaytarish/возврат → "Возврат взносов за кв.", счётчик → "За счетчик",',
      '   qayta rasmiylashtirish → "Переоформление (приход)", boshqa nomdan → "Взнос от имени клиента").',
      '5) Ishonching komil bo\'lmasa yoki ma\'lumot yetarli bo\'lmasa — DOIM "human".',
      'submit_decision tool orqali javob ber. reason O\'ZBEK tilida qisqa bo\'lsin.',
    ].join('\n');

    const userContent: any[] = [
      { type: 'text', text:
        `TO'LOV MA'LUMOTI:\n` +
        `Maqsad (izoh): ${ctx.purpose || '(yo\'q)'}\n` +
        `Summa: ${ctx.amount}\n` +
        `Klient: ${ctx.client || '(yo\'q)'}\n` +
        `Taklif qilingan shartnoma: ${ctx.proposedContract} (obyekt: ${ctx.proposedObject})\n` +
        `Maqsaddagi shartnoma obyekti: ${ctx.purposeObject}\n\n` +
        `Mavjud sub-kategoriyalar: ${ctx.subCats.join(' | ') || '(yo\'q)'}\n\n` +
        (ctx.fileBlock ? 'Quyida ariza fayli. Uni o\'qib, qoidalarga ko\'ra qaror qabul qil.' : 'DIQQAT: ariza fayli yo\'q — bunday holatda "human".'),
      },
    ];
    if (ctx.fileBlock) userContent.push(ctx.fileBlock);

    const body = {
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: userContent }],
      tools: [{
        name: 'submit_decision',
        description: 'To\'lov tuzatish arizasi bo\'yicha yakuniy qaror',
        input_schema: {
          type: 'object',
          properties: {
            arizaContract: { type: 'string', description: 'Ariza faylidagi to\'g\'ri shartnoma raqami (topilsa)' },
            arizaValid: { type: 'boolean', description: 'Ariza fayli taklif qilingan tuzatishni tasdiqlaydimi' },
            subCategory: { type: 'string', description: 'Ro\'yxatdan tanlangan sub-kategoriya nomi (aniq nusxa)' },
            decision: { type: 'string', enum: ['approve', 'reject', 'human'], description: 'Yakuniy qaror' },
            reason: { type: 'string', description: 'Qisqa izoh (o\'zbekcha)' },
          },
          required: ['decision', 'reason'],
        },
      }],
      tool_choice: { type: 'tool', name: 'submit_decision' },
    };

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`Claude API xato: ${data?.error?.message || res.status}`);
    }
    const toolUse = (data?.content || []).find((c: any) => c.type === 'tool_use');
    if (!toolUse?.input) throw new Error('Claude javobi tushunarsiz (tool_use yo\'q)');
    const inp = toolUse.input;
    const dec = ['approve', 'reject', 'human'].includes(inp.decision) ? inp.decision : 'human';
    return {
      decision: dec,
      reason: String(inp.reason || '').slice(0, 1000),
      subCategory: inp.subCategory ? String(inp.subCategory) : undefined,
      arizaValid: !!inp.arizaValid,
    };
  }

  /** Matndan birinchi shartnoma raqamini ajratadi (obyekt kodini olish uchun). */
  private firstContractInText(text?: string | null): string | null {
    if (!text) return null;
    // Masalan: №118VTN24LJ, N 1844ORZ24PU, Договора №118VTN24LJ
    const m = text.match(/\b\d{2,}[A-Z]{2,4}\d{1,3}[A-Z]{0,4}\b/i);
    return m ? m[0] : null;
  }
}
