import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { CorrectionService } from './correction.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';

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
  private readonly K_AI_NAME = 'agent.aiName';
  private readonly K_AI_FROM = 'agent.aiFromHour';
  private readonly K_AI_TO = 'agent.aiToHour';
  private readonly DEFAULT_MODEL = 'claude-sonnet-4-6';
  private lastRunMs = 0;

  async getName(): Promise<string> {
    return (await this.setting(this.K_AI_NAME)) || 'AI Agent';
  }

  /** Ish vaqti oynasi (Toshkent soati). Default 0..24 = doim. */
  async getWorkHours(): Promise<{ from: number; to: number }> {
    const f = Number(await this.setting(this.K_AI_FROM));
    const t = Number(await this.setting(this.K_AI_TO));
    return {
      from: f >= 0 && f <= 24 ? Math.round(f) : 0,
      to: t >= 0 && t <= 24 ? Math.round(t) : 24,
    };
  }
  private inWorkWindow(from: number, to: number): boolean {
    if (from === to) return true; // teng bo'lsa — doim
    const h = new Date(Date.now() + 5 * 60 * 60 * 1000).getUTCHours(); // Toshkent UTC+5
    return from < to ? (h >= from && h < to) : (h >= from || h < to);
  }

  // Ustma-ust ishlamaslik uchun (bir vaqtda bitta tsikl)
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly correction: CorrectionService,
    private readonly oplataKv: OplataKvService,
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
      const { from, to } = await this.getWorkHours();
      if (!this.inWorkWindow(from, to)) return; // ish vaqti emas
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

  /**
   * Ikki shartnoma raqami "bir xil"mi — bank izoh matnida HARF TUSHIB QOLISHI
   * xatosini hisobga oladi (masalan "1699TN25PP" aslida "1699VTN25PP" — "V" tushgan).
   * Faqat tushgan harf (subsequence) qabul qilinadi; harf ALMASHTIRILISHI (boshqa
   * obyekt) qabul qilinmaydi. Maksimum 2 ta harf farqi.
   */
  looseSameContract(a?: string | null, b?: string | null): boolean {
    const norm = (s?: string | null) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const x = norm(a), y = norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [short, long] = x.length <= y.length ? [x, y] : [y, x];
    if (long.length - short.length > 2) return false; // 2 dan ko'p farq — typo emas
    let i = 0;
    for (let j = 0; j < long.length && i < short.length; j++) {
      if (long[j] === short[i]) i++;
    }
    return i === short.length; // short — long ichida tartib bilan bor (faqat harf tushgan)
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
      // 1) Ariza faylini o'qish — PDF/rasm to'g'ridan Claude'ga; Word (.docx) esa matn +
      //    ichki rasmlar (imzo/muhr) ajratib beriladi (Claude .docx'ni to'g'ridan o'qiy olmaydi).
      const fileBlocks: any[] = [];
      let docText: string | null = null;
      if (req.attachmentId) {
        const att = await this.prisma.transactionAttachment.findUnique({ where: { id: req.attachmentId } });
        if (att) {
          try {
            const buf = await fs.readFile(att.storagePath);
            const mt = att.mimeType || '';
            const fn = (att.filename || '').toLowerCase();
            if (mt === 'application/pdf' || fn.endsWith('.pdf')) {
              fileBlocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } });
            } else if (mt.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(fn)) {
              const media = mt.startsWith('image/') ? mt : 'image/jpeg';
              fileBlocks.push({ type: 'image', source: { type: 'base64', media_type: media, data: buf.toString('base64') } });
            } else if (mt.includes('wordprocessingml') || fn.endsWith('.docx')) {
              const parsed = await this.parseDocx(buf);
              docText = parsed.text || null;
              for (const im of parsed.images) {
                fileBlocks.push({ type: 'image', source: { type: 'base64', media_type: im.contentType, data: im.b64 } });
              }
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
      const purposeContract = this.firstContractInText(req.snapPurpose);
      const purposeObj = this.objectCode(purposeContract);

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
        fileBlocks,
        docText,
      });

      // 5) Deterministik OBYEKT guard — mos kelmasa xodimga
      let finalDecision = decision.decision;
      let reason = decision.reason || '';
      // Bank izoh matnida shartnoma raqamidan HARF tushib qolishi mumkin (masalan
      // "1699TN25PP" aslida "1699VTN25PP") — bu holda obyekt kodlari farq qilsa ham
      // BIR XIL shartnoma, xodimga qoldirmaymiz.
      if (proposedObj && purposeObj && proposedObj !== purposeObj
          && !this.looseSameContract(purposeContract, req.proposedContractNo)) {
        finalDecision = 'human';
        reason = `Obyekt mos emas: maqsad "${purposeObj}", taklif "${proposedObj}". Boshqa obyektga o'tkazib bo'lmaydi — xodim tekshirsin.`;
      }

      // 5.5) Deterministik IMZO guard — imzo/muhr tasdiqlanmasa HECH QACHON avtomat tasdiqlamaymiz
      //      (imzo tekshirish majburiy). Faqat 'approve' → 'human'ga tushiriladi (reject o'zgarmaydi).
      if (finalDecision === 'approve' && decision.hasSignature !== true) {
        finalDecision = 'human';
        reason = `Imzo/muhr tasdiqlanmadi — ariza tasdiqlash uchun xodimga yo'naltirildi.`
          + (decision.reason ? ` (${decision.reason})` : '');
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
          actorName: await this.getName(),
        });
        await this.prisma.xatoCorrectionRequest.update({
          where: { id: requestId }, data: { agentState: 'done', agentReason: reason },
        });
        this.log.log(`Agent TASDIQLADI: ${requestId} · ${req.proposedContractNo} · ${reason}`);
        return { ok: true, decision: 'approve', reason };
      }

      if (finalDecision === 'reject') {
        await this.correction.reject(requestId, reason, 'agent', 'agent', await this.getName());
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
    const wh = await this.getWorkHours();
    return {
      ok: true, enabled, hasKey: !!apiKey, running: this.running,
      model: await this.getModel(), intervalMin: await this.getIntervalMin(), name: await this.getName(),
      fromHour: wh.from, toHour: wh.to,
      counts: { pending, processing, needsReview, agentApproved, agentRejected },
    };
  }

  /** Agent faoliyati — paginatsiya + qidiruv (modal + Excel uchun). */
  async activity(opts: { q?: string; page?: number; perPage?: number } = {}) {
    const page = Math.max(1, opts.page || 1);
    const perPage = Math.min(200, Math.max(1, opts.perPage || 20));
    const where: any = { agentAt: { not: null } };
    const q = (opts.q || '').trim();
    if (q) {
      where.OR = [
        { proposedContractNo: { contains: q, mode: 'insensitive' } },
        { snapContractNo: { contains: q, mode: 'insensitive' } },
        { snapClient: { contains: q, mode: 'insensitive' } },
        { agentReason: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.xatoCorrectionRequest.count({ where }),
      this.prisma.xatoCorrectionRequest.findMany({
        where, orderBy: { agentAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        select: {
          id: true, status: true, agentState: true, agentReason: true, agentAt: true,
          proposedContractNo: true, snapClient: true, snapObject: true, snapAmount: true, reviewedByType: true,
        },
      }),
    ]);
    return {
      ok: true, total, page, perPage,
      rows: rows.map((r) => ({
        id: r.id, status: r.status, agentState: r.agentState, agentReason: r.agentReason,
        agentAt: r.agentAt, contractNo: r.proposedContractNo, client: r.snapClient, object: r.snapObject,
        amount: r.snapAmount != null ? Number(r.snapAmount) : null, byAgent: r.reviewedByType === 'agent',
      })),
    };
  }

  /** Agent bilan suhbat (Claude chat + qidiruv tool). Admin savol beradi, agent
   *  arizani/to'lovni bazadan o'zi topib javob beradi. */
  async chat(input: { message?: string; image?: { data: string; mediaType?: string } }): Promise<{ ok: boolean; reply?: string; error?: string }> {
    const apiKey = await this.getApiKey();
    if (!apiKey) return { ok: false, error: 'AI kalit sozlanmagan' };
    const userText = (input?.message || '').trim();
    if (!userText && !input?.image?.data) return { ok: false, error: 'Xabar yo\'q' };

    // Tarixdan konvo (oxirgi 30 xabar, matn)
    const hist = await this.prisma.agentChatMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 30 });
    hist.reverse();
    const convo: any[] = hist.map((m) => ({ role: m.role, content: m.content }));
    // Yangi user xabari (rasm bilan bo'lishi mumkin)
    if (input.image?.data) {
      const parts: any[] = [];
      if (userText) parts.push({ type: 'text', text: userText });
      parts.push({ type: 'image', source: { type: 'base64', media_type: input.image.mediaType || 'image/jpeg', data: input.image.data } });
      convo.push({ role: 'user', content: parts });
    } else {
      convo.push({ role: 'user', content: userText });
    }

    const name = await this.getName();
    const model = await this.getModel();
    const [pending, needsReview, agentApproved, agentRejected] = await Promise.all([
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'pending', agentState: null } }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'pending', agentState: 'needs_review' } }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'approved', reviewedByType: 'agent' } }),
      this.prisma.xatoCorrectionRequest.count({ where: { status: 'rejected', reviewedByType: 'agent' } }),
    ]);
    const system = [
      `Sen "${name}" — "Xon Saroy" ko'chmas mulk quruvchisi uchun XATO to'lov tuzatish arizalarini tekshiruvchi AI agentsan.`,
      `Admin bilan O'ZBEK tilida aniq, foydali va do'stona suhbatlashasan. Admin rasm (masalan ariza) yuborsa — uni o'qib tahlil qil.`,
      `Qoidalaring: shartnoma raqamidagi raqamlardan keyingi 3 harf = obyekt; to'lovni bir obyektdan boshqasiga o'tkazib bo'lmaydi; kategoriya har doim "Клиент/Физ.Л/Юр.Л"; sub-kategoriyani maqsadga qarab tanlaysan.`,
      `SENDA QUROLLAR BOR — ularni FAOL ishlat, hech qachon "imkonim yo'q / eslay olmayman" deb rad qilma:`,
      `• "lookup" — ariza yoki to'lovni bazadan topish (shartnoma/klient/ID bo'yicha).`,
      `• "xato_query" — barcha XATO to'lovlar bo'yicha ma'lumot (soni/summa/misollar).`,
      `• "read_ariza_file" — arizaning biriktirilgan FAYLINI (rasm, PDF yoki Word .docx) ochib O'QIYSAN. "Fayl ichida nima yozilgan", "arizani ko'rsat", "faylni o'qi" kabi savollarda SHU tool'ni chaqir va faylni ko'rib javob ber. Fayl har suhbatda qaytadan o'qiladi — bazada saqlangan, yo'qolmaydi.`,
      `• "list_review_arizas" — XODIMGA QOLDIRILGAN (ko'rib chiqish kerak) arizalar ro'yxati. "xodimga qoldirilgan qaysi" deganda shuni chaqir.`,
      `• "recheck_ariza" — arizani QAYTA tekshirish (agent qaytadan ishlaydi). Admin "yana tekshir / qayta ko'r" desa shuni chaqir. query bo'sh bo'lsa — barcha needs_review qayta tekshiriladi.`,
      `• "act_on_ariza" — arizani TASDIQLASH (approve) yoki RAD ETISH (reject). Admin "qabul qil / tasdiqla / rad et" desa shuni chaqir.`,
      `• "object_variants" — tizimdagi obyekt nomlari ro'yxati (obyekt tanlash uchun).`,
      `MUHIM — HARAKAT QILISHDAN OLDIN SO'RA: arizani tasdiqlash/rad etishdan oldin ADMIN'dan aniq tasdiq ol. Obyekt mos kelmasa yoki qaysi shartnoma noaniq bo'lsa — o'zing hal qilma, admindan SO'RA (masalan: "VATAN obyektiga tasdiqlaymi yoki boshqa obyektmi?"). Admin "barcha obyekt variantlarini ber" desa — object_variants bilan ro'yxat ber. Faqat admin aniq buyruq bergandagina act_on_ariza ni ishlat.`,
      `Taxmin qilma — avval mos tool bilan tekshir, keyin aniq javob ber. Savolga to'liq va foydali javob ber, quruq rad etma.`,
      `Joriy holat: ${pending} ta kutilmoqda, ${needsReview} ta xodimga qoldirilgan, ${agentApproved} ta sen tasdiqlagan, ${agentRejected} ta sen rad etgan.`,
    ].join('\n');
    const tools = [
      {
        name: 'lookup',
        description: 'Ariza yoki to\'lovni bazadan qidirish — shartnoma, klient, to\'lov ID, ariza ID yoki bank external ID bo\'yicha.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
      },
      {
        name: 'xato_query',
        description: 'XATO (CRM\'da tasdiqlanmagan) to\'lovlar bo\'yicha ma\'lumot — jami soni, umumiy summasi va shartnoma/klient/obyekt bo\'yicha misollar.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Ixtiyoriy filtr: shartnoma/klient/obyekt' } } },
      },
      {
        name: 'read_ariza_file',
        description: 'Arizaning biriktirilgan faylini (rasm, PDF yoki Word .docx) ochib o\'qish — ichidagi ma\'lumotni ko\'rish uchun. Ariza ID, shartnoma raqami yoki klient ismi bo\'yicha topadi. "Fayl ichida nima yozilgan", "arizani ko\'rsat" kabi savollar uchun.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Ariza ID / shartnoma raqami / klient ismi' } }, required: ['query'] },
      },
      {
        name: 'list_review_arizas',
        description: 'Xodimga qoldirilgan (ko\'rib chiqish kerak) arizalar ro\'yxati — id, shartnoma, klient, summa, obyekt, agent izohi.',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'recheck_ariza',
        description: 'Xodimga qoldirilgan arizani QAYTA tekshirish — agent qaytadan ishlaydi (fayl+qoidalar). query bo\'sh bo\'lsa barcha needs_review qayta tekshiriladi.',
        input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Ariza ID / shartnoma / klient (ixtiyoriy)' } } },
      },
      {
        name: 'act_on_ariza',
        description: 'Arizani TASDIQLASH (approve) yoki RAD ETISH (reject) — admin buyrug\'i bilan. approve uchun contractNo ixtiyoriy (bo\'lmasa taklif qilingani ishlatiladi); reject uchun reason kerak.',
        input_schema: { type: 'object', properties: { arizaId: { type: 'string' }, action: { type: 'string', enum: ['approve', 'reject'] }, contractNo: { type: 'string' }, reason: { type: 'string' } }, required: ['arizaId', 'action'] },
      },
      {
        name: 'object_variants',
        description: 'Tizimda mavjud obyekt nomlari ro\'yxati (obyekt tanlash uchun). query — ixtiyoriy filtr.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } } },
      },
    ];

    try {
      let reply = '';
      for (let i = 0; i < 6; i++) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model, max_tokens: 1400, system, messages: convo, tools }),
        });
        const data: any = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, error: `Claude API xato: ${data?.error?.message || res.status}` };

        if (data?.stop_reason === 'tool_use') {
          convo.push({ role: 'assistant', content: data.content });
          const toolResults: any[] = [];
          for (const block of data.content || []) {
            if (block.type === 'tool_use') {
              if (block.name === 'read_ariza_file') {
                // Fayl o'qish — natijaga rasm/PDF blokini QO'SHAMIZ (Claude ko'rsin)
                const r = await this.readArizaFileForChat(String(block.input?.query || ''));
                const trContent: any[] = [{ type: 'text', text: r.found ? r.summary : (r.message || 'Fayl topilmadi') }];
                if (r.found && r.fileBlocks) for (const fb of r.fileBlocks) trContent.push(fb);
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: trContent });
              } else {
                let result: any;
                if (block.name === 'lookup') result = await this.lookupForChat(String(block.input?.query || ''));
                else if (block.name === 'xato_query') result = await this.queryXatoForChat(String(block.input?.query || ''));
                else if (block.name === 'list_review_arizas') result = await this.listReviewArizas();
                else if (block.name === 'recheck_ariza') result = await this.recheckAriza(String(block.input?.query || ''));
                else if (block.name === 'act_on_ariza') result = await this.actOnAriza(block.input || {});
                else if (block.name === 'object_variants') result = await this.objectVariants(String(block.input?.query || ''));
                else result = { error: 'noma\'lum tool' };
                toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
              }
            }
          }
          convo.push({ role: 'user', content: toolResults });
          continue;
        }
        reply = (data?.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n').trim();
        break;
      }
      if (!reply) reply = 'Javob juda uzun bo\'ldi — savolni aniqroq bering.';
      // Tarixga saqlaymiz
      await this.prisma.agentChatMessage.create({ data: { role: 'user', content: userText || '(rasm)', hasImage: !!input.image?.data } });
      await this.prisma.agentChatMessage.create({ data: { role: 'assistant', content: reply } });
      return { ok: true, reply };
    } catch (e: any) {
      return { ok: false, error: e?.message };
    }
  }

  /** Chat tool: XATO to'lovlar bo'yicha ma'lumot. */
  private async queryXatoForChat(query: string) {
    const { rows, count } = await this.oplataKv.getXatoListForAgent({ limit: 2000 });
    const q = (query || '').trim().toLowerCase();
    const filtered = q
      ? rows.filter((r: any) =>
          (r.contractNo || '').toLowerCase().includes(q) ||
          (r.client || '').toLowerCase().includes(q) ||
          (r.object || '').toLowerCase().includes(q) ||
          (r.purpose || '').toLowerCase().includes(q))
      : rows;
    const sum = filtered.reduce((s: number, r: any) => s + (r.paymentAmount != null ? Number(r.paymentAmount) : 0), 0);
    return {
      jamiXatoSoni: count,
      mosKelganSoni: filtered.length,
      umumiySumma: sum,
      misollar: filtered.slice(0, 15).map((r: any) => ({
        shartnoma: r.contractNo, klient: r.client, obyekt: r.object,
        summa: r.paymentAmount != null ? Number(r.paymentAmount) : null, sana: r.date, maqsad: r.purpose,
      })),
    };
  }

  /** Chat tool: arizaning biriktirilgan faylini (rasm/PDF) o'qish — Claude ko'rishi uchun blok qaytaradi. */
  private async readArizaFileForChat(query: string): Promise<{ found: boolean; summary?: string; message?: string; fileBlocks?: any[] }> {
    const q = (query || '').trim();
    if (!q) return { found: false, message: 'Qidiruv so\'zi kerak (ariza ID / shartnoma / klient).' };
    const req = await this.prisma.xatoCorrectionRequest.findFirst({
      where: {
        attachmentId: { not: null },
        OR: [
          { id: q },
          { proposedContractNo: { contains: q, mode: 'insensitive' } },
          { snapContractNo: { contains: q, mode: 'insensitive' } },
          { appliedContractNo: { contains: q, mode: 'insensitive' } },
          { snapClient: { contains: q, mode: 'insensitive' } },
          { submittedByName: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: { submittedAt: 'desc' },
    });
    if (!req) return { found: false, message: `"${q}" bo'yicha fayl biriktirilgan ariza topilmadi.` };
    const att = await this.prisma.transactionAttachment.findUnique({ where: { id: req.attachmentId! } });
    if (!att) return { found: false, message: 'Ariza fayli topilmadi (biriktirma o\'chirilgan).' };
    let buf: Buffer;
    try { buf = await fs.readFile(att.storagePath); }
    catch { return { found: false, message: 'Fayl diskda topilmadi.' }; }
    const b64 = buf.toString('base64');
    const mt = att.mimeType || '';
    const statusUz = req.status === 'approved' ? 'tasdiqlangan' : req.status === 'rejected' ? 'rad etilgan' : 'kutilmoqda';
    const summary = `Ariza fayli: ${att.filename} · shartnoma ${req.appliedContractNo || req.proposedContractNo || req.snapContractNo || '—'} · klient ${req.snapClient || '—'} · holat: ${statusUz}. Fayl ichidagi ma'lumotni o'qib, admin savoliga javob ber.`;
    if (mt === 'application/pdf' || att.filename.toLowerCase().endsWith('.pdf')) {
      return { found: true, summary, fileBlocks: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } }] };
    }
    if (mt.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(att.filename)) {
      const media = mt.startsWith('image/') ? mt : 'image/jpeg';
      return { found: true, summary, fileBlocks: [{ type: 'image', source: { type: 'base64', media_type: media, data: b64 } }] };
    }
    if (mt.includes('wordprocessingml') || att.filename.toLowerCase().endsWith('.docx')) {
      const parsed = await this.parseDocx(buf);
      const fileBlocks = parsed.images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.contentType, data: im.b64 } }));
      const docSummary = `${summary}\n\nWORD HUJJATI MATNI:\n${parsed.text || '(matn topilmadi)'}\n`
        + (fileBlocks.length ? '(Hujjatdagi rasm(lar) qo\'shildi — imzo/muhr shu yerda bo\'lishi mumkin.)' : '(Hujjatda rasm yo\'q — imzo/muhr rasmi topilmadi.)');
      return { found: true, summary: docSummary, fileBlocks };
    }
    return { found: false, message: `Fayl turi qo'llab-quvvatlanmaydi (${mt || att.filename}). Faqat rasm, PDF va Word (.docx) o'qiladi.` };
  }

  /** Chat tool: xodimga qoldirilgan (needs_review) arizalar. */
  private async listReviewArizas() {
    const rows = await this.prisma.xatoCorrectionRequest.findMany({
      where: { status: 'pending', agentState: 'needs_review' },
      orderBy: { submittedAt: 'desc' }, take: 20,
    });
    return {
      soni: rows.length,
      arizalar: rows.map((r) => ({
        arizaId: r.id, shartnoma: r.proposedContractNo, klient: r.snapClient,
        summa: r.snapAmount != null ? Number(r.snapAmount) : null,
        obyekt: r.snapObject, maqsad: r.snapPurpose, agentIzohi: r.agentReason,
      })),
    };
  }

  /** Chat tool: arizani qayta tekshirish (agent qaytadan ishlaydi). */
  private async recheckAriza(query: string) {
    const q = (query || '').trim();
    const where: any = { status: 'pending', agentState: 'needs_review' };
    if (q) {
      where.agentState = { in: ['needs_review', null] };
      where.OR = [
        { id: q },
        { proposedContractNo: { contains: q, mode: 'insensitive' } },
        { snapContractNo: { contains: q, mode: 'insensitive' } },
        { snapClient: { contains: q, mode: 'insensitive' } },
      ];
    }
    const arizas = await this.prisma.xatoCorrectionRequest.findMany({ where, orderBy: { submittedAt: 'desc' }, take: 5 });
    if (!arizas.length) return { qaytaTekshirildi: 0, xabar: q ? `"${q}" bo'yicha qayta tekshiriladigan ariza topilmadi.` : 'Xodimga qoldirilgan ariza yo\'q.' };
    const natijalar: any[] = [];
    for (const a of arizas) {
      await this.prisma.xatoCorrectionRequest.update({ where: { id: a.id }, data: { agentState: null } });
      const r = await this.processRequest(a.id);
      natijalar.push({ arizaId: a.id, shartnoma: a.proposedContractNo, klient: a.snapClient, natija: r.decision || (r.ok ? '?' : 'xato'), izoh: r.reason || r.error });
    }
    return { qaytaTekshirildi: natijalar.length, natijalar };
  }

  /** Chat tool: arizani tasdiqlash / rad etish (admin buyrug'i bilan). */
  private async actOnAriza(input: { arizaId?: string; action?: string; contractNo?: string; reason?: string }) {
    const id = (input.arizaId || '').trim();
    if (!id) return { ok: false, xabar: 'arizaId kerak.' };
    const req = await this.prisma.xatoCorrectionRequest.findFirst({
      where: { OR: [{ id }, { proposedContractNo: id }, { snapContractNo: id }] },
      orderBy: { submittedAt: 'desc' },
    });
    if (!req) return { ok: false, xabar: `Ariza topilmadi: ${id}` };
    if (req.status !== 'pending') return { ok: false, xabar: `Bu ariza allaqachon ${req.status === 'approved' ? 'tasdiqlangan' : 'rad etilgan'}.` };
    const name = await this.getName();

    if (input.action === 'approve') {
      const contract = (input.contractNo || req.proposedContractNo || '').trim();
      if (!contract) return { ok: false, xabar: 'Tasdiqlash uchun shartnoma raqami kerak (contractNo).' };
      const clientCat = await this.prisma.category.findFirst({ where: { code: 'CLIENT' }, select: { id: true, children: { select: { id: true, name: true } } } });
      const subId = this.inferSubCategoryId(req.snapPurpose, clientCat?.children || []);
      await this.correction.approve(req.id, undefined, {
        contractNo: contract, categoryId: clientCat?.id || null, subCategoryId: subId,
        actorId: 'agent', actorType: 'agent', actorName: name,
      });
      await this.prisma.xatoCorrectionRequest.update({ where: { id: req.id }, data: { agentState: 'done', agentReason: `Chat orqali admin buyrug'i bilan tasdiqlandi (${contract})` } });
      return { ok: true, natija: 'approved', shartnoma: contract };
    }
    if (input.action === 'reject') {
      const reason = (input.reason || '').trim() || 'Chat orqali admin rad etdi';
      await this.correction.reject(req.id, reason, 'agent', 'agent', name);
      await this.prisma.xatoCorrectionRequest.update({ where: { id: req.id }, data: { agentState: 'done', agentReason: reason } });
      return { ok: true, natija: 'rejected', sabab: reason };
    }
    return { ok: false, xabar: 'action "approve" yoki "reject" bo\'lishi kerak.' };
  }

  /** Maqsad matnidan sub-kategoriyani taxmin qiladi (chat approve uchun). */
  private inferSubCategoryId(purpose: string | null, children: Array<{ id: string; name: string }>): string | null {
    const p = (purpose || '').toLowerCase();
    const find = (kw: string) => children.find((c) => c.name.toLowerCase().includes(kw))?.id || null;
    if (/(автостоян|avtostoyan|парковк)/.test(p)) return find('автостоян');
    if (/(возврат|qaytar)/.test(p)) return find('возврат');
    if (/(сч[её]тчик|schetchik|hisoblagich)/.test(p)) return find('сч');
    if (/(переоформл)/.test(p)) return find('переоформл');
    return find('квартир'); // default — kvartira to'lovi
  }

  /** Chat tool: tizimdagi obyekt nomlari. */
  private async objectVariants(query: string) {
    const rows = await this.prisma.oplataKv.findMany({ where: { object: { not: null } }, select: { object: true }, distinct: ['object'], take: 300 });
    let objs = rows.map((r) => r.object).filter(Boolean) as string[];
    const q = (query || '').trim().toLowerCase();
    if (q) objs = objs.filter((o) => o.toLowerCase().includes(q));
    objs.sort();
    return { soni: objs.length, obyektlar: objs.slice(0, 60) };
  }

  /** Chat tarixi. */
  async chatHistory(limit = 60) {
    const rows = await this.prisma.agentChatMessage.findMany({ orderBy: { createdAt: 'desc' }, take: Math.min(200, limit) });
    rows.reverse();
    return { ok: true, rows: rows.map((m) => ({ role: m.role, content: m.content, hasImage: m.hasImage, at: m.createdAt })) };
  }
  async clearChatHistory() {
    const res = await this.prisma.agentChatMessage.deleteMany({});
    return { ok: true, deleted: res.count };
  }

  /** Chat tool: ariza yoki to'lovni bazadan qidirish. */
  private async lookupForChat(query: string) {
    const q = (query || '').trim();
    if (!q) return { found: false, message: 'Qidiruv so\'zi bo\'sh' };

    // 1) Arizalar
    const arizalar = await this.prisma.xatoCorrectionRequest.findMany({
      where: {
        OR: [
          { id: q }, { txId: q }, { oplataKvId: q },
          { proposedContractNo: { contains: q, mode: 'insensitive' } },
          { snapContractNo: { contains: q, mode: 'insensitive' } },
          { snapExternalId: { contains: q, mode: 'insensitive' } },
          { snapClient: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5, orderBy: { submittedAt: 'desc' },
      select: {
        id: true, status: true, agentState: true, agentReason: true, rejectReason: true,
        proposedContractNo: true, appliedContractNo: true, categoryName: true, subCategoryName: true,
        snapClient: true, snapObject: true, snapAmount: true, snapPurpose: true, snapExternalId: true,
        submittedByName: true, reviewedByName: true, reviewedByType: true, submittedAt: true, reviewedAt: true,
      },
    });
    if (arizalar.length) {
      return {
        found: true, type: 'ariza', count: arizalar.length,
        items: arizalar.map((r) => ({
          arizaId: r.id, status: r.status, agentState: r.agentState, agentReason: r.agentReason,
          rejectReason: r.rejectReason, taklifShartnoma: r.proposedContractNo, qollanganShartnoma: r.appliedContractNo,
          kategoriya: r.categoryName, subKategoriya: r.subCategoryName, klient: r.snapClient, obyekt: r.snapObject,
          summa: r.snapAmount != null ? Number(r.snapAmount) : null, maqsad: r.snapPurpose, ixtId: r.snapExternalId,
          kimYubordi: r.submittedByName, kimKordi: r.reviewedByName, kim: r.reviewedByType,
        })),
      };
    }

    // 2) To'lovlar (OplataKv)
    const payments = await this.prisma.oplataKv.findMany({
      where: {
        OR: [
          { id: q }, { sourceTxId: q },
          { contractNo: { contains: q, mode: 'insensitive' } },
          { client: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 5,
      select: { id: true, contractNo: true, client: true, object: true, paymentAmount: true, date: true, purpose: true, txType: true, sourceTxId: true },
    });
    if (payments.length) {
      return {
        found: true, type: 'tolov', count: payments.length,
        items: payments.map((p) => ({
          tolovId: p.id, shartnoma: p.contractNo, klient: p.client, obyekt: p.object,
          summa: p.paymentAmount != null ? Number(p.paymentAmount) : null,
          sana: p.date, maqsad: p.purpose, tur: p.txType, txId: p.sourceTxId,
        })),
      };
    }

    // 3) Tranzaksiya (id yoki external id)
    const tx = await this.prisma.transaction.findFirst({
      where: { OR: [{ id: q }, { externalId: q }] },
      select: { id: true, externalId: true, contractNumber: true, fromName: true, amount: true, direction: true, valueDate: true, description: true },
    });
    if (tx) {
      return {
        found: true, type: 'tranzaksiya',
        item: {
          txId: tx.id, ixtId: tx.externalId, shartnoma: tx.contractNumber, klient: tx.fromName,
          summa: Number(tx.amount) * (tx.direction === 'OUT' ? -1 : 1), sana: tx.valueDate, maqsad: tx.description,
        },
      };
    }

    return { found: false, message: `"${q}" bo'yicha ariza yoki to'lov topilmadi` };
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
  /**
   * Word (.docx) faylini o'qiydi — Claude .docx'ni to'g'ridan qabul qilmaydi. mammoth bilan:
   *  - matn (shartnoma raqami/summa/klient o'qish uchun),
   *  - ichki rasmlar (imzo/muhr bo'lishi mumkin — Claude ko'rib imzoni tekshirishi uchun).
   * Faqat Claude qo'llab-quvvatlaydigan rasm turlari (png/jpeg/gif/webp), maks 4 ta.
   */
  private async parseDocx(buf: Buffer): Promise<{ text: string; images: { contentType: string; b64: string }[] }> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require('mammoth');
    const images: { contentType: string; b64: string }[] = [];
    let text = '';
    try {
      const r = await mammoth.extractRawText({ buffer: buf });
      text = String(r?.value || '').replace(/\n{3,}/g, '\n\n').trim();
    } catch (e: any) {
      this.log.warn(`docx matn o'qilmadi: ${e?.message}`);
    }
    try {
      await mammoth.convertToHtml({ buffer: buf }, {
        convertImage: mammoth.images.imgElement(async (image: any) => {
          try {
            const ct = String(image.contentType || '').toLowerCase();
            if (/^image\/(png|jpe?g|gif|webp)$/.test(ct) && images.length < 4) {
              const b64 = await image.read('base64');
              if (b64) images.push({ contentType: ct === 'image/jpg' ? 'image/jpeg' : ct, b64 });
            }
          } catch { /* skip bitta rasm */ }
          return { src: '' };
        }),
      });
    } catch (e: any) {
      this.log.warn(`docx rasm o'qilmadi: ${e?.message}`);
    }
    return { text, images };
  }

  private async callClaude(apiKey: string, model: string, ctx: {
    purpose: string; amount: string; client: string;
    proposedContract: string; proposedObject: string; purposeObject: string;
    subCats: string[]; fileBlocks: any[]; docText?: string | null;
  }): Promise<{ decision: 'approve' | 'reject' | 'human'; reason: string; subCategory?: string; arizaValid?: boolean; hasSignature?: boolean }> {
    const system = [
      'Sen "Xon Saroy" ko\'chmas mulk quruvchisi uchun to\'lov tuzatish arizalarini tekshiruvchi ehtiyotkor agentsan.',
      'QOIDALAR:',
      '1) OBYEKT: shartnoma raqamidagi raqamlardan keyingi 3 harf obyektni bildiradi (masalan 118VTN24LJ → VTN).',
      '   To\'lovni bir obyektdan boshqa obyektga o\'tkazib BO\'LMAYDI. Agar taklif qilingan shartnoma obyekti',
      '   maqsaddagi shartnoma obyektidan farq qilsa — "human" (xodimga qoldir).',
      '   ESLATMA: bank izoh matnida shartnoma raqamidan HARF tushib qolishi mumkin (masalan "1699TN25PP"',
      '   aslida "1699VTN25PP" — "V" tushgan). Raqamlar va oxiri mos kelib faqat harf tushgan bo\'lsa — bu',
      '   BIR XIL shartnoma, obyekt farqi deb hisoblama, o\'tkazib yubor.',
      '2) Ariza faylini diqqat bilan o\'qi: undagi shartnoma raqami taklif qilingan tuzatishga mos keladimi?',
      '   Ariza haqiqiy va tuzatishni tasdiqlasa — yaxshi. Tushunarsiz/mos kelmasa — "human".',
      '3) Kategoriya har doim "Клиент / Физ.Л / Юр.Л" (bu mijozdan kelgan to\'lov).',
      '4) Sub-kategoriyani MAQSAD matniga qarab ro\'yxatdan tanla (masalan uy/kvartira to\'lovi → "Взносы за квартиры",',
      '   avtostoyanka → "Взносы за автостоянку", qaytarish/возврат → "Возврат взносов за кв.", счётчик → "За счетчик",',
      '   qayta rasmiylashtirish → "Переоформление (приход)", boshqa nomdan → "Взнос от имени клиента").',
      '5) Ishonching komil bo\'lmasa yoki ma\'lumot yetarli bo\'lmasa — DOIM "human".',
      '6) IMZO (MAJBURIY): arizada haqiqiy IMZO (qo\'l bilan qo\'yilgan yoki skan qilingan) yoki MUHR (pechat)',
      '   BO\'LISHI SHART. Faqat "имзо"/"imzo" degan YOZUV, bo\'sh joy yoki terilgan ism — bu imzo EMAS.',
      '   Word hujjati faqat terilgan matndan iborat bo\'lib ichida imzo/muhr RASMI bo\'lmasa — imzo YO\'Q.',
      '   hasSignature=true FAQAT haqiqiy imzo yoki muhr ko\'zga tashlansa. Imzo yo\'q bo\'lsa hasSignature=false',
      '   va decision="human" (xodim tekshirsin), reason\'da "imzo yo\'q" deb yoz.',
      'submit_decision tool orqali javob ber. reason O\'ZBEK tilida qisqa bo\'lsin.',
    ].join('\n');

    const hasDocText = !!(ctx.docText && ctx.docText.trim());
    const hasFile = (ctx.fileBlocks && ctx.fileBlocks.length > 0) || hasDocText;
    const userContent: any[] = [
      { type: 'text', text:
        `TO'LOV MA'LUMOTI:\n` +
        `Maqsad (izoh): ${ctx.purpose || '(yo\'q)'}\n` +
        `Summa: ${ctx.amount}\n` +
        `Klient: ${ctx.client || '(yo\'q)'}\n` +
        `Taklif qilingan shartnoma: ${ctx.proposedContract} (obyekt: ${ctx.proposedObject})\n` +
        `Maqsaddagi shartnoma obyekti: ${ctx.purposeObject}\n\n` +
        `Mavjud sub-kategoriyalar: ${ctx.subCats.join(' | ') || '(yo\'q)'}\n` +
        (hasDocText
          ? `\nARIZA HUJJATI MATNI (Word'dan o'qildi):\n"""\n${ctx.docText!.slice(0, 6000)}\n"""\n`
            + (ctx.fileBlocks.length
                ? '(Hujjat ichidagi rasm(lar) quyida — imzo/muhr shu yerda bo\'lishi mumkin, DIQQAT bilan qara.)\n'
                : '(Hujjatda hech qanday rasm yo\'q — demak imzo/muhr RASMI topilmadi.)\n')
          : '') +
        '\n' + (hasFile
          ? 'Yuqoridagi ariza ma\'lumotini o\'qib, qoidalarga (ayniqsa 6-band IMZO) ko\'ra qaror qabul qil.'
          : 'DIQQAT: ariza fayli yo\'q — bunday holatda "human".'),
      },
    ];
    for (const fb of (ctx.fileBlocks || [])) userContent.push(fb);

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
            hasSignature: { type: 'boolean', description: 'Arizada haqiqiy IMZO yoki MUHR (pechat) bormi — terilgan "imzo" so\'zi yoki ism EMAS, faqat ko\'rinadigan imzo/muhr' },
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
      hasSignature: typeof inp.hasSignature === 'boolean' ? inp.hasSignature : undefined,
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
