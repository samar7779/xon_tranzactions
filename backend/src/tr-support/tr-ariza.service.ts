import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fsp } from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmContractCacheService } from '../categorization/crm-contract-cache.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { CorrectionService } from '../correction/correction.service';
import { AgentAiService } from '../correction/agent-ai.service';
import { XATO_DATEFROM_KEY, normContract } from './tr-support.service';

/**
 * TR Support — XATO to'lovga ARIZA: egasi Telegram botga ariza (bank xati, chek) rasmini beradi, bot XATO
 * to'lovlar ro'yxatidan to'lovni topadi va [Ha] bosilgach XATO sahifasidagi "Shartnoma biriktirish" bilan AYNAN
 * bir xil ariza yuboradi: CorrectionService.createRequestWithFile (xato_correction_requests + ariza fayli).
 * Keyin AI tekshiruvchi (agent.aiName, AgentAiService.processRequest) uni odatdagidek o'zi ko'radi.
 * Fayl bot saqlagan rasmdan o'qiladi (static/tg_uploads/leader_bot_<16 hex>.<ext>), nomi qat'iy tekshiriladi.
 */
export const ARIZA_FAYL_RE = /^leader_bot_[0-9a-f]{16}\.(jpg|jpeg|png|webp|gif|pdf|doc|docx)$/;
const ARIZA_FAYL_MAX = 20 * 1024 * 1024;               // bot yuklab oladigan chegara (Telegram)
const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const OYNA_KUN = 3;                                     // sana ±3 kun (bank sanasi xatdagidan farq qilishi mumkin)

export interface ArizaCandidate {
  oplataKvId: string; txId: string | null; date: string | null; amount: number | null;
  contractNo: string | null; client: string | null; purpose: string | null;
  toAccount: string | null; fromAccount: string | null; direction: string | null;
  pending: { by: string | null; at: string | null; contract: string | null } | null;
}

@Injectable()
export class TrArizaService {
  private readonly log = new Logger(TrArizaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oplataKv: OplataKvService,
    private readonly crmCache: CrmContractCacheService,
    private readonly correction: CorrectionService,
    private readonly agentAi: AgentAiService,
    private readonly config: ConfigService,
  ) {}

  private async listDateFrom(): Promise<string | null> {
    return (await this.prisma.setting.findUnique({ where: { key: XATO_DATEFROM_KEY } }))?.value || null;
  }

  async aiName(): Promise<string> {
    return (await this.prisma.setting.findUnique({ where: { key: 'agent.aiName' } }))?.value?.trim() || 'AI Agent';
  }

  /** Shartnoma CRM'da (found) — kanonik shakl bilan. */
  async crmCheck(contract: string) {
    const c0 = normContract(contract);
    const c: any = c0 ? await this.crmCache.lookup(c0, { forceRefresh: true }) : null;
    return {
      contract: c?.found && c.contractNumber ? normContract(String(c.contractNumber)) : c0,
      found: !!c?.found, customerName: c?.customerName || null, objectName: c?.objectName || null,
    };
  }

  // ─── Qidiruv (FAQAT O'QISH) ──────────────────────────────────────
  async find(q: { tx?: string | null; summa?: number | null; sana?: string | null; hisob?: string | null; shartnoma?: string | null }) {
    const listDateFrom = await this.listDateFrom();
    let from: Date | null = null;
    let to: Date | null = null;
    if (q.sana) {
      const d = new Date(`${q.sana}T00:00:00Z`);
      from = new Date(d.getTime() - OYNA_KUN * 86400_000);
      to = new Date(d.getTime() + OYNA_KUN * 86400_000);
    }
    const keys: string[] = [];
    if (q.tx) {
      keys.push(q.tx);
      const t = await this.prisma.transaction.findFirst({ where: { OR: [{ id: q.tx }, { externalId: q.tx }] }, select: { id: true, externalId: true } });
      if (t) keys.push(t.id, ...(t.externalId ? [t.externalId] : []));
    }
    const rows = await this.oplataKv.findXatoRows({
      keys: keys.length ? Array.from(new Set(keys)) : undefined,
      amount: q.tx ? null : q.summa ?? null, from: q.tx ? null : from, to: q.tx ? null : to,
      listDateFrom, take: 20,
    });
    const src = rows.map((r) => r.sourceTxId).filter((x): x is string => !!x);
    const txs = src.length ? await this.prisma.transaction.findMany({
      where: { OR: [{ externalId: { in: src } }, { id: { in: src } }] },
      select: { id: true, externalId: true, toAccount: true, fromAccount: true, direction: true },
    }) : [];
    const txBy = new Map<string, (typeof txs)[number]>();
    for (const t of txs) { txBy.set(t.id, t); if (t.externalId) txBy.set(t.externalId, t); }
    const pend = rows.length ? await this.prisma.xatoCorrectionRequest.findMany({
      where: { status: 'pending', oplataKvId: { in: rows.map((r) => r.id) } },
      orderBy: { submittedAt: 'desc' },
      select: { oplataKvId: true, submittedByName: true, submittedAt: true, proposedContractNo: true },
    }) : [];
    const pendBy = new Map<string, (typeof pend)[number]>();
    for (const p of pend) if (p.oplataKvId && !pendBy.has(p.oplataKvId)) pendBy.set(p.oplataKvId, p);

    const digits = (s: any) => String(s ?? '').replace(/\D/g, '');
    const hisob = digits(q.hisob);
    let candidates: ArizaCandidate[] = rows.map((r) => {
      const t = r.sourceTxId ? txBy.get(r.sourceTxId) : undefined;
      const p = pendBy.get(r.id);
      return {
        oplataKvId: r.id, txId: t?.externalId || t?.id || r.sourceTxId || null,
        date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null,
        amount: r.paymentAmount != null ? Number(r.paymentAmount) : null,
        contractNo: r.contractNo || null, client: r.client || null,
        purpose: r.purpose != null ? String(r.purpose).slice(0, 300) : null,
        toAccount: t?.toAccount || null, fromAccount: t?.fromAccount || null, direction: t?.direction || null,
        pending: p ? { by: p.submittedByName || null, at: p.submittedAt ? new Date(p.submittedAt).toISOString() : null, contract: p.proposedContractNo || null } : null,
      };
    });
    let hisobMos: boolean | null = null;
    if (hisob.length >= 6 && candidates.length) {
      const mos = candidates.filter((c) => digits(c.toAccount).includes(hisob) || digits(c.fromAccount).includes(hisob));
      hisobMos = mos.length > 0;
      if (mos.length) candidates = mos;                // hisob mos kelmasa — hammasi qoladi, bot ogohlantiradi
    }
    const crm = q.shartnoma ? await this.crmCheck(q.shartnoma) : null;
    return { ok: true as const, candidates, hisobMos, crm, aiName: await this.aiName() };
  }

  // ─── Yuborish (egasi [Ha] bosgach) ───────────────────────────────
  private uploadsDir(): string {
    return path.resolve(this.config.get<string>('AGENTS_UPLOADS_DIR') || '/var/www/xon_tranzactions/static/tg_uploads');
  }

  /** Bot saqlagan fayl (ariza va AI Переброска uchun umumiy). nomi — saqlanadigan fayl nomi prefiksi. */
  async readFile(name: string, nomi = 'ariza_tr_support'): Promise<{ buffer: Buffer; originalname: string; mimetype: string; size: number }> {
    const m = ARIZA_FAYL_RE.exec(name || '');
    if (!m) throw new BadRequestException("Ariza fayli nomi noto'g'ri");
    const dir = this.uploadsDir();
    const full = path.join(dir, name);
    let real: string;
    try { real = await fsp.realpath(full); } catch { throw new BadRequestException('Ariza fayli topilmadi (bot rasmi 7 kun saqlanadi)'); }
    if (path.dirname(real) !== (await fsp.realpath(dir))) throw new BadRequestException("Ariza fayli noto'g'ri joyda");
    const st = await fsp.stat(real);
    if (!st.isFile() || st.size <= 0 || st.size > ARIZA_FAYL_MAX) throw new BadRequestException("Ariza fayli bo'sh yoki juda katta");
    const buffer = await fsp.readFile(real);
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    return { buffer, originalname: `${nomi}.${ext}`, mimetype: MIME[m[1]], size: buffer.length };
  }

  async submit(b: { oplataKvId: string; contractNo: string; fayl: string; yubordi: string }) {
    const row = await this.prisma.oplataKv.findUnique({ where: { id: b.oplataKvId }, select: { id: true } });
    if (!row) throw new NotFoundException("To'lov (OplatyKv) topilmadi");
    // XATO ro'yxatida bo'lishi SHART (xato-list bilan bir xil)
    const inList = await this.oplataKv.findXatoRows({ ids: [b.oplataKvId], listDateFrom: await this.listDateFrom(), take: 1 });
    if (!inList.length) throw new ConflictException("Bu to'lov XATO to'lovlar ro'yxatida emas — ariza yuborilmaydi");
    const crm = await this.crmCheck(b.contractNo);
    if (!crm.found) throw new BadRequestException(`Shartnoma ${crm.contract} CRM'da topilmadi — boshqa shartnoma bering`);
    const file = await this.readFile(b.fayl);
    const res = await this.correction.createRequestWithFile({
      oplataKvId: b.oplataKvId, proposedContractNo: crm.contract, source: 'telegram',
      submittedByName: (b.yubordi || 'TR Support bot').slice(0, 190), submittedByChatId: null,
    }, file);
    let aiEnabled = false;
    try { aiEnabled = await this.agentAi.isEnabled(); } catch { aiEnabled = false; }
    if (!res.alreadyPending && aiEnabled) {
      // XATO sahifasidagi submit bilan bir xil: AI darrov o'zi ko'radi (javobni kutmaymiz)
      this.agentAi.processRequest(res.id).catch((e: any) => this.log.warn(`AI tekshiruv xato (${res.id}): ${e?.message}`));
    }
    this.log.log(`TR Support ariza ${res.id}${res.alreadyPending ? ' (allaqachon bor)' : ''} → ${crm.contract}`);
    return { ok: true as const, id: res.id, alreadyPending: !!res.alreadyPending, contract: crm.contract, aiEnabled, aiName: await this.aiName() };
  }

  // ─── Holat (AI natijasi) ─────────────────────────────────────────
  async status(id: string) {
    const r = await this.prisma.xatoCorrectionRequest.findUnique({
      where: { id },
      select: {
        id: true, status: true, agentState: true, agentReason: true, reviewedByName: true, reviewedByType: true,
        rejectReason: true, appliedContractNo: true, proposedContractNo: true, reviewedAt: true,
      },
    });
    if (!r) throw new NotFoundException('Ariza topilmadi');
    return {
      ok: true as const, id: r.id, status: r.status, agentState: r.agentState || null,
      agentReason: r.agentReason ? String(r.agentReason).slice(0, 500) : null,
      reviewedBy: r.reviewedByName || null, reviewedByType: r.reviewedByType || null,
      rejectReason: r.rejectReason ? String(r.rejectReason).slice(0, 500) : null,
      contract: r.appliedContractNo || r.proposedContractNo || null,
      reviewedAt: r.reviewedAt ? new Date(r.reviewedAt).toISOString() : null,
      aiName: await this.aiName(),
    };
  }
}
