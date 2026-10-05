import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { TrArizaService } from './tr-ariza.service';

/**
 * TR Support — AI Переброска bot orqali (egasi qarori, 2026-10-05). Panel OplatyKv > "+" > AI Переброска bilan
 * AYNAN bir xil yo'llar:
 *   tahlil(fayl) -> OplataKvService.analyzePerereboskaAriza (agent arizani o'qiydi; DB'ga yozmaydi)
 *   yarat(...)   -> OplataKvService.createPerereboska (panelda xodim "Yaratish" bosgandek; qoidalarni o'zi
 *                   majburlaydi: bir obyekt, summalar teng, qoldiq yetarli, hujjat). Bot faqat egasi tasdig'idan keyin.
 * Fayl bot saqlagan ariza faylidan (static/tg_uploads/leader_bot_<hex>.<ext>) o'qiladi.
 */
export interface PerebroskaYarat {
  fayl: string;
  fromContractNo: string;
  amount: number;
  date: string;
  destinations: Array<{ contractNo: string; amount: number }>;
  agentState: string | null;
  agentReason: string | null;
  agentData: any;
  tasdiq: string;
  izoh: string | null;
}

@Injectable()
export class TrPerebroskaService {
  private readonly log = new Logger(TrPerebroskaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oplataKv: OplataKvService,
    private readonly trAriza: TrArizaService,
  ) {}

  async tahlil(fayl: string) {
    const file = await this.trAriza.readFile(fayl, 'perebroska_tr_support');
    const r: any = await this.oplataKv.analyzePerereboskaAriza(file);
    return {
      ok: true as const,
      extracted: r.extracted || {},
      agentState: r.agentState || null,
      agentReason: r.agentReason || null,
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
      balanceEnough: r.balanceEnough !== false,
      duplicates: Array.isArray(r.duplicates) ? r.duplicates : [],
    };
  }

  async yarat(b: PerebroskaYarat) {
    const file = await this.trAriza.readFile(b.fayl, 'perebroska_tr_support');
    const label = `TR Support · tasdiq: ${b.tasdiq}`.slice(0, 120);
    const r: any = await this.oplataKv.createPerereboska({
      fromContractNo: b.fromContractNo,
      amount: b.amount,
      date: b.date,
      destinations: b.destinations,
      note: [label, b.izoh].filter(Boolean).join('; ').slice(0, 500),
      file,
      actor: { id: null, name: label },
      agentUsed: true,
      agentState: b.agentState,
      agentReason: b.agentReason,
      agentData: b.agentData,
    });
    const ids = [r.sourceId, ...(r.destIds || [])].filter(Boolean);
    const rows = ids.length
      ? await this.prisma.oplataKv.findMany({
        where: { id: { in: ids } },
        select: { id: true, contractNo: true, paymentAmount: true, date: true, client: true, object: true },
      })
      : [];
    const tartib = new Map(ids.map((id: string, i: number) => [id, i]));
    rows.sort((a, c) => (tartib.get(a.id) ?? 0) - (tartib.get(c.id) ?? 0));
    this.log.log(`AI Переброска (bot): ${b.fromContractNo} -> ${b.destinations.map((d) => d.contractNo).join(', ')} · ${b.amount} · ${label}`);
    return {
      ok: true as const,
      groupId: String(r.groupId),
      amount: Number(r.amount),
      qatorlar: rows.map((x) => ({
        contractNo: x.contractNo, summa: x.paymentAmount != null ? Number(x.paymentAmount) : null,
        sana: x.date ? new Date(x.date).toISOString() : null, mijoz: x.client || null, obyekt: x.object || null,
      })),
    };
  }
}
