import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { CategorizationService } from '../categorization/categorization.service';
import { CrmContractCacheService } from '../categorization/crm-contract-cache.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';

/**
 * TR Support — Telegram agenti (@TRanSupport_bot) orqali, egasi [Ha] bosgach, to'lov ustunlarini tahrirlash:
 *   Kontragent  = top kategoriya (masalan "Клиент / Физ.Л / Юр.Л"),
 *   Kategoriya  = subkategoriya (masalan "Взносы за квартиры"),
 *   Shartnoma   = CRM'da tasdiqlangan raqam (topilmasa tahrir qilinmaydi).
 * Yozish panelning o'z yo'llari bilan: CategorizationService.setManual / setContract (tarix + OplatyKv
 * propagation bir xil). Bir tasdiqdagi barcha tahrirdan keyin BITTA OplatyKv sync. Har tahrir
 * tr_support_edits ga (kim tasdiqladi, izoh, oldin/keyin); "Ortga qaytarish" oldingi holatni tiklaydi.
 */

// Panel CombinedEditDialog bilan bir xil: bu kontragentlar qo'lda tanlanmaydi
export const HIDDEN_KONTRAGENTS = ['COUNTERPARTY_RETURN', 'COUNTERPARTY'];
// Shartnoma faqat shu kontragentlarda (panel 3-qadami shu ikkisida ko'rinadi)
export const CONTRACT_TOPS = ['CLIENT', 'TRANSFER'];
export const TR_SUPPORT_CODE_DEFAULT = '7779';
export const TR_SUPPORT_MAX_ITEMS = 20;

const APOS = /[‘’ʻʼ`´]/g;
const QOLSIN = new Set(['', 'qolsin', "o'zgarmasin", 'ozgarmasin', '=', 'keep', 'same', '-qolsin']);
const YOQ = new Set(["yo'q", 'yoq', '-', 'none', 'null', "bo'sh", 'bosh', 'tozalash', 'clear', '—']);

export type TrChoice = { kontragent?: string | null; kategoriya?: string | null; shartnoma?: string | null };
export type TrItem = TrChoice & { tx: string };

export interface TrCat { id: string; code: string; name: string }
export interface TrTop extends TrCat { children: TrCat[] }

export interface TrState {
  categoryId: string | null; categoryCode: string | null; categoryName: string | null;
  subcategoryId: string | null; subcategoryCode: string | null; subcategoryName: string | null;
  contractNumber: string | null; isContractManual: boolean;
}

export interface TrTxView {
  id: string; externalId: string | null; date: string | null; amount: number; direction: string | null;
  source: string | null; description: string | null; editable: boolean;
  kontragent: { code: string; name: string } | null;
  kategoriya: { code: string; name: string } | null;
  shartnoma: string | null; isContractManual: boolean;
}

export interface TrChange { field: 'kontragent' | 'kategoriya' | 'shartnoma'; from: string | null; to: string | null }

/** XATO to'lovlar ro'yxati (xato-list) holati: ro'yxatdagi to'lov agent orqali TAHRIRLANMAYDI — ariza orqali. */
export interface TrXato {
  inList: boolean;
  contractNo: string | null;
  pending: boolean;                 // shu to'lovga kutilayotgan ariza bor
  pendingBy: string | null; pendingAt: string | null; pendingContract: string | null;
  xabar: string | null;             // egasiga tayyor matn (inList bo'lsa)
}
export const XATO_DATEFROM_KEY = 'agent.dateFrom'; // xato-list sahifasi bilan bir xil sozlama

export interface TrPreview {
  valid: boolean;
  xato: TrXato | null;
  errors: string[];
  tx: TrTxView | null;
  changes: TrChange[];
  crm: { contract: string; found: boolean; customerName: string | null; objectName: string | null } | null;
  plan: {
    txId: string; catChange: boolean; categoryId: string | null; subcategoryId: string | null; contract?: string | null;
    contractXato?: boolean;         // shartnoma CRM'siz yoziladi (XATO ro'yxatiga tushishi uchun)
  } | null;
}

const norm = (s: any) => String(s ?? '').replace(APOS, "'").toLowerCase().replace(/[\s./]+/g, ' ').trim();
const isQolsin = (v: any) => v == null || QOLSIN.has(norm(v));
const isYoq = (v: any) => YOQ.has(norm(v));
// shartnoma=XATO — to'lovni XATO ro'yxatiga tushirish: shartnomaga AYNAN "XATO" yoziladi (CRM tekshiruvisiz).
// Egasi qarori (2026-09-30): raqam qo'shilsa ham (masalan "XATO:467RZM26HA") baribir "XATO" saqlanadi.
const XATO_RE = /^xato(?:\s*[:=\s]\s*(.*))?$/i;
export const XATO_SHARTNOMA = 'XATO';
export const normContract = (s: string) => s.replace(/№/g, '').replace(/N°/g, '').replace(/\s+/g, '').trim().toUpperCase();

@Injectable()
export class TrSupportService {
  private readonly log = new Logger(TrSupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cat: CategorizationService,
    private readonly crmCache: CrmContractCacheService,
    private readonly oplataKv: OplataKvService,
    private readonly config: ConfigService,
  ) {}

  // ─── Kirish kodi (panel TR Support tabi) ─────────────────────────
  checkCode(code: unknown): void {
    const want = String(this.config.get('TR_SUPPORT_CODE') || TR_SUPPORT_CODE_DEFAULT);
    const got = typeof code === 'string' ? code.trim() : '';
    const a = createHash('sha256').update(got).digest();
    const b = createHash('sha256').update(want).digest();
    if (!got || !timingSafeEqual(a, b)) throw new ForbiddenException("Kod noto'g'ri");
  }

  // ─── Variantlar ────────────────────────────────────────────────
  async loadTree(): Promise<TrTop[]> {
    const all = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, parentId: true },
    });
    return all
      .filter((c) => !c.parentId && !HIDDEN_KONTRAGENTS.includes(c.code))
      .map((t) => ({
        id: t.id, code: t.code, name: t.name,
        children: all.filter((c) => c.parentId === t.id).map((c) => ({ id: c.id, code: c.code, name: c.name })),
      }));
  }

  private findIn<T extends TrCat>(list: T[], v: string): T | undefined {
    const n = norm(v);
    return list.find((c) => c.code.toUpperCase() === String(v).trim().toUpperCase())
      || list.find((c) => norm(c.name) === n);
  }

  private async findTx(ref: string) {
    const r = String(ref || '').trim();
    if (!r) return null;
    return this.prisma.transaction.findFirst({
      where: { OR: [{ id: r }, { externalId: r }] },
      select: {
        id: true, externalId: true, txnDate: true, amount: true, direction: true, source: true, description: true,
        categoryId: true, subcategoryId: true, contractNumber: true, isContractManual: true,
        category: { select: { code: true, name: true } },
        subcategory: { select: { code: true, name: true } },
      },
    });
  }

  private stateOfTx(tx: any): TrState {
    return {
      categoryId: tx.categoryId || null, categoryCode: tx.category?.code || null, categoryName: tx.category?.name || null,
      subcategoryId: tx.subcategoryId || null, subcategoryCode: tx.subcategory?.code || null,
      subcategoryName: tx.subcategory?.name || null,
      contractNumber: tx.contractNumber || null, isContractManual: !!tx.isContractManual,
    };
  }

  private async stateOf(txId: string): Promise<TrState | null> {
    const tx = await this.findTx(txId);
    return tx ? this.stateOfTx(tx) : null;
  }

  private viewOf(tx: any): TrTxView {
    return {
      id: tx.id, externalId: tx.externalId || null,
      date: tx.txnDate ? new Date(tx.txnDate).toISOString() : null,
      amount: Number(tx.amount || 0), direction: tx.direction || null, source: tx.source || null,
      description: tx.description != null ? String(tx.description).slice(0, 300) : null,
      editable: tx.source !== 'ALOQA_BANK',
      kontragent: tx.category ? { code: tx.category.code, name: tx.category.name } : null,
      kategoriya: tx.subcategory ? { code: tx.subcategory.code, name: tx.subcategory.name } : null,
      shartnoma: tx.contractNumber || null, isContractManual: !!tx.isContractManual,
    };
  }

  async options(ref: string): Promise<{ ok: true; tx: TrTxView | null; tree: TrTop[]; xato: TrXato | null }> {
    const [tx, tree] = await Promise.all([this.findTx(ref), this.loadTree()]);
    return { ok: true, tx: tx ? this.viewOf(tx) : null, tree, xato: tx ? await this.xatoStatus(tx) : null };
  }

  /** XATO to'lovlar ro'yxatida bormi (xato-list bilan bir xil filtr va sana) va kutilayotgan ariza. */
  async xatoStatus(tx: { id: string; externalId: string | null }): Promise<TrXato> {
    const dateFrom = (await this.prisma.setting.findUnique({ where: { key: XATO_DATEFROM_KEY } }))?.value || null;
    const row = await this.oplataKv.findXatoRowForTx([tx.externalId, tx.id], dateFrom);
    if (!row) {
      return { inList: false, contractNo: null, pending: false, pendingBy: null, pendingAt: null, pendingContract: null, xabar: null };
    }
    const p = await this.prisma.xatoCorrectionRequest.findFirst({
      where: { status: 'pending', OR: [{ oplataKvId: row.id }, { txId: tx.id }] },
      orderBy: { submittedAt: 'desc' },
      select: { submittedByName: true, submittedAt: true, proposedContractNo: true },
    });
    const sh = row.contractNo || "yo'q";
    const at = p?.submittedAt ? new Date(p.submittedAt).toISOString() : null;
    const xabar = p
      ? `Bu to'lov XATO to'lovlar ro'yxatida (shartnoma ${sh}) va unga ariza allaqachon yuborilgan`
        + ` (${p.submittedByName || "noma'lum"}${at ? ', ' + at.slice(0, 10) : ''}${p.proposedContractNo ? ', taklif: ' + p.proposedContractNo : ''}).`
        + ' Tahrir qilinmaydi: ariza tasdiqlanishini kuting.'
      : `Bu to'lov XATO to'lovlar ro'yxatida (shartnoma ${sh}). Tahrir qilinmaydi: XATO to'lovlar ro'yxatidan ariza`
        + ` biriktiring — to'lov kartasidagi "Shartnoma biriktirish" (to'g'ri shartnoma va chek).`;
    return {
      inList: true, contractNo: row.contractNo || null, pending: !!p, pendingBy: p?.submittedByName || null,
      pendingAt: at, pendingContract: p?.proposedContractNo || null, xabar,
    };
  }

  // ─── Tekshiruv (FAQAT O'QISH; CRM faqat o'qiladi) ─────────────────
  async preview(ref: string, choice: TrChoice, tree?: TrTop[]): Promise<TrPreview> {
    const out: TrPreview = { valid: false, xato: null, errors: [], tx: null, changes: [], crm: null, plan: null };
    const tx = await this.findTx(ref);
    if (!tx) {
      out.errors.push(`To'lov topilmadi: ${String(ref).slice(0, 80)}`);
      return out;
    }
    out.tx = this.viewOf(tx);
    // XATO to'lovlar ro'yxatidagi to'lov — tahrir yo'q, ariza orqali (egasi qoidasi)
    out.xato = await this.xatoStatus(tx);
    if (out.xato.inList) {
      out.errors.push(out.xato.xabar as string);
      return out;
    }
    if (tx.source === 'ALOQA_BANK') out.errors.push("Aloqa Bank import qatorini tahrirlab bo'lmaydi (faqat o'qish)");
    const tops = tree || await this.loadTree();
    const curTop = tops.find((t) => t.id === tx.categoryId) || null;
    const topNames = tops.map((t) => t.name).join(', ');

    // 1) Kontragent (top kategoriya)
    let newTop: TrTop | null = curTop;
    let newTopId: string | null = tx.categoryId || null;
    let topChanged = false;
    if (!isQolsin(choice.kontragent)) {
      const t = this.findIn(tops, String(choice.kontragent));
      if (!t) out.errors.push(`Kontragent "${choice.kontragent}" topilmadi. Variantlar: ${topNames}`);
      else if (t.id !== tx.categoryId) { newTop = t; newTopId = t.id; topChanged = true; }
    }

    // 2) Kategoriya (subkategoriya)
    let newSubId: string | null = tx.subcategoryId || null;
    if (!isQolsin(choice.kategoriya)) {
      if (isYoq(choice.kategoriya)) newSubId = null;
      else if (!newTop) out.errors.push('Avval kontragentni tanlang (hozir kontragent yo\'q yoki qo\'lda tanlanmaydigan tur)');
      else {
        const s = this.findIn(newTop.children, String(choice.kategoriya));
        if (!s) {
          out.errors.push(`Kategoriya "${choice.kategoriya}" "${newTop.name}" ichida yo'q. Variantlar: ${
            newTop.children.map((c) => c.name).join(', ') || "yo'q (kategoriyasiz)"}`);
        } else newSubId = s.id;
      }
    } else if (topChanged && newTop) {
      if (newTop.children.length) {
        out.errors.push(`Kontragent "${newTop.name}" ga o'zgarsa kategoriyani ham tanlang: ${
          newTop.children.map((c) => c.name).join(', ')}`);
      } else newSubId = null;
    }
    const subChanged = newSubId !== (tx.subcategoryId || null);

    // 3) Shartnoma (CRM'da bo'lishi SHART) yoki XATO rejimi (egasi tasdig'i bilan XATO ro'yxatiga tushirish)
    let newContract: string | null | undefined;
    let contractXato = false;
    const xm = !isQolsin(choice.shartnoma) ? XATO_RE.exec(String(choice.shartnoma).trim()) : null;
    if (xm) {
      contractXato = true;
      if ((newTop?.code || '') !== 'CLIENT') {
        out.errors.push("XATO ro'yxatiga faqat \"Клиент / Физ.Л / Юр.Л\" kontragentli to'lov tushadi — kontragentni ham tanlang");
      } else {
        newContract = XATO_SHARTNOMA === (tx.contractNumber || null) ? undefined : XATO_SHARTNOMA;
      }
    } else if (!isQolsin(choice.shartnoma)) {
      newContract = isYoq(choice.shartnoma) ? null : normContract(String(choice.shartnoma)) || null;
      if (newContract && !/^[A-Z0-9/]{3,64}$/.test(newContract)) {
        out.errors.push(`Shartnoma raqami noto'g'ri: "${choice.shartnoma}"`);
        newContract = undefined;
      } else if ((newContract || null) === (tx.contractNumber || null)) newContract = undefined;
    }
    if (newContract && !contractXato) {
      const topCode = newTop?.code || '';
      if (!CONTRACT_TOPS.includes(topCode)) {
        out.errors.push("Shartnoma faqat \"Клиент / Физ.Л / Юр.Л\" yoki \"Переброска\" kontragentida qo'yiladi");
      } else {
        const c: any = await this.crmCache.lookup(newContract, { forceRefresh: true });
        // O/0, I/1 varianti bilan topilsa — CRM'dagi KANONIK shakl yoziladi (aks holda to'lov yana XATO bo'ladi)
        if (c?.found && c.contractNumber) newContract = normContract(String(c.contractNumber));
        out.crm = {
          contract: newContract as string, found: !!c?.found,
          customerName: c?.customerName || null, objectName: c?.objectName || null,
        };
        if (!c?.found) out.errors.push(`Shartnoma ${newContract} CRM'da topilmadi — boshqa shartnoma bering`);
        else if (newContract === (tx.contractNumber || null)) newContract = undefined;
      }
    }

    const nameOf = (id: string | null, list: TrCat[]) => (id ? list.find((c) => c.id === id)?.name || null : null);
    if (topChanged) out.changes.push({ field: 'kontragent', from: tx.category?.name || null, to: newTop?.name || null });
    if (subChanged) {
      out.changes.push({ field: 'kategoriya', from: tx.subcategory?.name || null, to: nameOf(newSubId, newTop?.children || []) });
    }
    if (newContract !== undefined) {
      out.changes.push({ field: 'shartnoma', from: tx.contractNumber || null, to: newContract });
    }
    if (!out.errors.length && !out.changes.length) {
      out.errors.push("Hech narsa o'zgarmaydi: tanlangan qiymatlar hozirgisi bilan bir xil");
    }
    out.valid = out.errors.length === 0;
    out.plan = {
      txId: tx.id, catChange: topChanged || subChanged, categoryId: newTopId, subcategoryId: newSubId,
      ...(newContract !== undefined ? { contract: newContract } : {}),
      ...(contractXato ? { contractXato: true } : {}),
    };
    return out;
  }

  // ─── Tahrir (egasi [Ha] bosgach) ─────────────────────────────────
  async apply(items: TrItem[], meta: { approvedBy: string; comment?: string | null; requestedBy?: string | null }) {
    if (!Array.isArray(items) || items.length === 0 || items.length > TR_SUPPORT_MAX_ITEMS) {
      throw new BadRequestException(`items: 1-${TR_SUPPORT_MAX_ITEMS} ta`);
    }
    const approvedBy = String(meta.approvedBy || '').trim().slice(0, 120);
    if (approvedBy.length < 2) throw new BadRequestException('approvedBy: kim tasdiqlaganini yozing');
    const label = `TR Support · tasdiq: ${approvedBy}`.slice(0, 120);
    const batchId = `trs_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
    const tree = await this.loadTree();
    const results: Array<{ tx: string; id?: string; status: 'applied' | 'failed' | 'skipped'; errors?: string[]; changes: TrChange[] }> = [];

    for (const it of items) {
      const p = await this.preview(it.tx, it, tree);
      if (!p.valid || !p.plan) {
        results.push({ tx: it.tx, status: 'skipped', errors: p.errors, changes: p.changes });
        continue;
      }
      const txRow = await this.findTx(p.plan.txId);
      const before = this.stateOfTx(txRow);
      let status: 'applied' | 'failed' = 'applied';
      let error: string | null = null;
      try {
        if (p.plan.catChange) {
          await this.cat.setManual(p.plan.txId, { categoryId: p.plan.categoryId, subcategoryId: p.plan.subcategoryId }, null, label);
        }
        if (p.plan.contract !== undefined) {
          if (p.plan.contractXato) await this.cat.setContractManual(p.plan.txId, p.plan.contract, null, label);
          else await this.cat.setContract(p.plan.txId, p.plan.contract, null, label);
        }
      } catch (e: any) {
        status = 'failed';
        error = String(e?.response?.message || e?.message || e).slice(0, 500);
        this.log.warn(`TR Support tahrir xato (${p.plan.txId}): ${error}`);
      }
      const after = (await this.stateOf(p.plan.txId)) || before;
      const row = await this.prisma.trSupportEdit.create({
        data: {
          batchId, txId: p.plan.txId, txExternalId: txRow?.externalId || null, txDate: txRow?.txnDate || null,
          amount: txRow?.amount ?? null, direction: txRow?.direction || null,
          before: before as any, after: after as any, changed: p.changes.map((c) => c.field),
          approvedBy, comment: meta.comment ? String(meta.comment).slice(0, 2000) : null,
          requestedBy: meta.requestedBy ? String(meta.requestedBy).slice(0, 120) : null,
          status, error,
        },
      });
      results.push({ tx: it.tx, id: row.id, status, ...(error ? { errors: [error] } : {}), changes: p.changes });
    }

    // Hammasidan keyin BITTA OplatyKv sync (panel "Sync" tugmasi bilan bir xil)
    let sync: any = null;
    if (results.some((r) => r.status !== 'skipped')) {
      sync = await this.runSync(label);
      await this.prisma.trSupportEdit.updateMany({ where: { batchId }, data: { syncResult: sync } });
    }
    this.log.log(`TR Support ${batchId}: ${results.map((r) => r.status).join(',')} · sync=${sync?.ok ?? '-'}`);
    return { ok: true as const, batchId, results, sync };
  }

  private async runSync(actorName: string): Promise<any> {
    try {
      const s: any = await this.oplataKv.syncNowRespectingSettings({ id: null, name: actorName });
      return {
        ok: s?.ok !== false, added: Number(s?.added || 0), updated: Number(s?.updated || 0),
        skipped: Number(s?.skipped || 0), duration: s?.duration ?? null, background: !!s?.objectsBackground,
        at: new Date().toISOString(),
      };
    } catch (e: any) {
      this.log.warn(`TR Support sync xato: ${e?.message}`);
      return { ok: false, error: String(e?.message || e).slice(0, 300), at: new Date().toISOString() };
    }
  }

  // ─── Tarix (panel TR Support tabi) ───────────────────────────────
  async list(q: { page?: number; perPage?: number; q?: string }) {
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const perPage = Math.min(100, Math.max(1, Math.floor(Number(q.perPage) || 30)));
    const s = String(q.q || '').trim();
    const where: any = s ? {
      OR: [
        { txExternalId: { contains: s, mode: 'insensitive' } }, { txId: s },
        { approvedBy: { contains: s, mode: 'insensitive' } }, { comment: { contains: s, mode: 'insensitive' } },
      ],
    } : {};
    const [total, rows] = await Promise.all([
      this.prisma.trSupportEdit.count({ where }),
      this.prisma.trSupportEdit.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    ]);
    return {
      ok: true as const, total, page, perPage,
      items: rows.map((r) => ({ ...r, amount: r.amount != null ? Number(r.amount) : null })),
    };
  }

  // ─── Ortga qaytarish ───────────────────────────────────────────────
  async rollback(id: string, actorName: string, note?: string | null) {
    const row = await this.prisma.trSupportEdit.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Tahrir topilmadi');
    if (row.status === 'rolled_back') throw new ConflictException('Bu tahrir allaqachon ortga qaytarilgan');
    const cur = await this.stateOf(row.txId);
    if (!cur) throw new NotFoundException('Tranzaksiya topilmadi');
    const after = row.after as any as TrState;
    const same = (cur.categoryId || null) === (after.categoryId || null)
      && (cur.subcategoryId || null) === (after.subcategoryId || null)
      && (cur.contractNumber || null) === (after.contractNumber || null);
    if (!same) {
      throw new ConflictException(
        `To'lov bu tahrirdan keyin yana o'zgargan (hozir: ${cur.categoryName || '-'} / ${cur.subcategoryName || '-'} / ${
          cur.contractNumber || "shartnoma yo'q"}). Ortga qaytarilmadi — avval tekshiring.`,
      );
    }
    const label = `TR Support · ortga: ${actorName}`.slice(0, 120);
    const before = row.before as any as TrState;
    await this.cat.restoreSnapshot(row.txId, {
      categoryId: before.categoryId || null, subcategoryId: before.subcategoryId || null,
      contractNumber: before.contractNumber || null, isContractManual: !!before.isContractManual,
    }, label);
    const sync = await this.runSync(label);
    const updated = await this.prisma.trSupportEdit.update({
      where: { id },
      data: {
        status: 'rolled_back', rolledBackAt: new Date(), rolledBackBy: actorName.slice(0, 120),
        rollbackNote: note ? String(note).slice(0, 2000) : null, syncResult: sync,
      },
    });
    return { ok: true as const, item: { ...updated, amount: updated.amount != null ? Number(updated.amount) : null }, sync };
  }
}
