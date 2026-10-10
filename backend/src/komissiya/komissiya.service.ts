import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { tashkentKun } from '../common/tashkent';

/**
 * BANK KOMISSIYASIGA OBYEKT QO'YISH
 *
 * Ravshan aka topshirig'i (10.10.2026): «Начисленные %% … За документ №…
 * Тариф CORPORATE 0,1%» kabi chiqim qatorlarida obyekt avtomat tursin.
 *
 *   1-QOIDA — firma zakazchik bo'lsa (bitta obyektga ishlaydi):
 *             komissiya o'sha obyektga yoziladi. Kalit — hisob egasi
 *             (`bank_accounts.owner_name`), chunki komissiya aynan
 *             o'sha firmaning hisobidan yechiladi.
 *
 *   2-QOIDA — firma genpodryad bo'lsa (ko'p obyekt): firma bo'yicha
 *             aniqlab bo'lmaydi. Izohdagi «За документ №N S=summa»
 *             orqali ASL TO'LOV topiladi va uning obyekti olinadi.
 *
 * Dalil (30 kunlik tahlil, 10.10.2026):
 *   1 746 ta komissiya, hammasi BANK kategoriyasida, obyekti 0 ta.
 *   Hujjat raqami hammasida bor va hammasining asl to'lovi topildi.
 *   Raqamning o'zi noyob emas (bir raqamda bir nechta to'lov), lekin
 *   izohdagi summa bilan birga noyob bo'ladi — ziddiyat 0 ta.
 */
@Injectable()
export class KomissiyaService {
  private readonly log = new Logger(KomissiyaService.name);

  /** Hujjat raqami: «За документ №29884» → "29884" (kirill/lotin farqsiz). */
  private static readonly DOC_RE = /окумент[^0-9]*([0-9]+)/i;
  /** Izohdagi asl summa: «S=32 933 772,00» → 32933772 */
  private static readonly SUMMA_RE = /S\s*=\s*([0-9][0-9\s., ]*)/i;

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────── yordamchilar ─────────────────────────

  /** Komissiya qatorlarini topish sharti — hamma joyda bir xil. */
  private komissiyaShart(dateFrom?: string, dateTo?: string): Prisma.TransactionWhereInput {
    return {
      direction: 'OUT',
      ...(dateFrom || dateTo
        ? {
            txnDate: {
              ...(dateFrom ? { gte: new Date(`${dateFrom}T00:00:00+05:00`) } : {}),
              ...(dateTo ? { lte: new Date(`${dateTo}T23:59:59.999+05:00`) } : {}),
            },
          }
        : {}),
      OR: [
        { description: { contains: 'Начисленные', mode: 'insensitive' } },
        { description: { contains: 'CORPORATE', mode: 'insensitive' } },
      ],
    };
  }

  /** Izohdan hujjat raqami. */
  private hujjatRaqami(izoh: string | null): string | null {
    const m = KomissiyaService.DOC_RE.exec(String(izoh || ''));
    return m ? m[1] : null;
  }

  /**
   * Izohdan ASL to'lov summasi.
   * «S=32 933 772,00» → 32933772 (bo'shliqlar ajratuvchi, vergul kasr).
   */
  private aslSumma(izoh: string | null): number | null {
    const m = KomissiyaService.SUMMA_RE.exec(String(izoh || ''));
    if (!m) return null;
    const raqam = m[1].replace(/[^0-9,]/g, '').replace(',', '.');
    const v = Number(raqam);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }

  // ───────────────────── firma → obyekt ro'yxati ─────────────────────

  /**
   * Firmalar ro'yxati + MAVJUD MA'LUMOTDAN taklif.
   *
   * Taklif: shu firmaning to'lovlarida eng ko'p uchragan obyekt va nechta
   * xil obyekt borligi. `obyektXil === 1` bo'lsa firma zakazchik (1-qoida),
   * ko'p bo'lsa genpodryad (2-qoida) ehtimoli yuqori.
   */
  async firmalar(): Promise<{
    ok: true;
    rows: Array<{
      firma: string;
      komissiya: number;
      taklifObyekt: string | null;
      obyektXil: number;
      obyektliTolov: number;
      saqlanganObyekt: string | null;
      genpodryad: boolean;
      tasdiqlangan: boolean;
    }>;
  }> {
    // Komissiya soni — firma kesimida
    const komissiyalar = await this.prisma.$queryRaw<Array<{ firma: string; n: bigint }>>`
      SELECT coalesce(a.owner_name, '—') AS firma, count(*)::bigint AS n
        FROM transactions t
        LEFT JOIN bank_accounts a ON a.id = t.account_id
       WHERE t.direction = 'OUT'
         AND (t.description ILIKE '%Начисленные%' OR t.description ILIKE '%CORPORATE%')
       GROUP BY 1
    `;

    // Taklif — har firmaning to'lovlaridagi hukmron obyekt (1 yil)
    const taklif = await this.prisma.$queryRaw<Array<{
      firma: string; xil: bigint; tolov: bigint; asosiy: string | null;
    }>>`
      SELECT coalesce(a.owner_name, '—')                      AS firma,
             count(DISTINCT t.erp_object)::bigint             AS xil,
             count(*)::bigint                                 AS tolov,
             mode() WITHIN GROUP (ORDER BY t.erp_object)      AS asosiy
        FROM transactions t
        JOIN bank_accounts a ON a.id = t.account_id
       WHERE t.direction = 'OUT'
         AND t.erp_object IS NOT NULL
         AND t.txn_date >= now() - interval '365 days'
       GROUP BY 1
    `;
    const taklifMap = new Map(taklif.map((r) => [r.firma, r]));

    const saqlangan = await this.prisma.firmaObyekt.findMany();
    const saqMap = new Map(saqlangan.map((s) => [s.firma, s]));

    const rows = komissiyalar
      .map((k) => {
        const t = taklifMap.get(k.firma);
        const s = saqMap.get(k.firma);
        return {
          firma: k.firma,
          komissiya: Number(k.n),
          taklifObyekt: t?.asosiy ?? null,
          obyektXil: Number(t?.xil ?? 0),
          obyektliTolov: Number(t?.tolov ?? 0),
          saqlanganObyekt: s?.obyekt ?? null,
          genpodryad: s?.genpodryad ?? false,
          tasdiqlangan: !!s,
        };
      })
      .sort((a, b) => b.komissiya - a.komissiya);

    return { ok: true, rows };
  }

  /** Firma → obyekt yozuvlarini saqlash (upsert). */
  async firmalarSaqla(items: Array<{ firma: string; obyekt?: string | null; genpodryad?: boolean }>) {
    let saqlandi = 0;
    for (const it of items) {
      const firma = String(it.firma || '').trim();
      if (!firma || firma === '—') continue;
      const obyekt = it.genpodryad ? null : (String(it.obyekt || '').trim() || null);
      await this.prisma.firmaObyekt.upsert({
        where: { firma },
        create: { firma, obyekt, genpodryad: !!it.genpodryad },
        update: { obyekt, genpodryad: !!it.genpodryad },
      });
      saqlandi++;
    }
    return { ok: true as const, saqlandi };
  }

  // ───────────────────── obyektni to'ldirish ─────────────────────

  /**
   * Komissiya qatorlariga obyekt qo'yadi.
   *
   * Tartib: avval 1-qoida (firma zakazchik), bo'lmasa 2-qoida (hujjat
   * raqami + summa orqali asl to'lov). Ikkalasi ham bermasa — tegilmaydi.
   *
   * @param opts.dryRun  standart true — hech narsa yozilmaydi
   * @param opts.force   obyekti bor qatorlarni ham qayta hisoblash
   */
  async obyektToldir(opts?: {
    dateFrom?: string; dateTo?: string; dryRun?: boolean; force?: boolean; limit?: number;
  }): Promise<{
    ok: true; dryRun: boolean;
    korildi: number; firmadan: number; hujjatdan: number; topilmadi: number;
    sabablar: Array<{ sabab: string; qator: number }>;
    namunalar: Array<{
      sana: string; summa: string; firma: string; hujjat: string | null;
      aslSumma: string | null; obyekt: string; usul: string;
    }>;
  }> {
    const dryRun = opts?.dryRun !== false;
    const limit = Math.min(opts?.limit || 5000, 20000);

    const where: Prisma.TransactionWhereInput = {
      ...this.komissiyaShart(opts?.dateFrom, opts?.dateTo),
      ...(opts?.force ? {} : { erpObject: null }),
    };

    const komissiyalar = await this.prisma.transaction.findMany({
      where,
      select: {
        id: true, txnDate: true, amount: true, description: true, accountId: true,
      },
      orderBy: { txnDate: 'desc' },
      take: limit,
    });

    if (komissiyalar.length === 0) {
      return {
        ok: true, dryRun, korildi: 0, firmadan: 0, hujjatdan: 0, topilmadi: 0,
        sabablar: [], namunalar: [],
      };
    }

    // ── Firma → obyekt (1-qoida) ──
    const hisoblar = await this.prisma.bankAccount.findMany({
      select: { id: true, ownerName: true },
    });
    const hisobFirma = new Map(hisoblar.map((h) => [h.id, h.ownerName || '']));
    const firmaRows = await this.prisma.firmaObyekt.findMany();
    const firmaObyekt = new Map(
      firmaRows.filter((f) => !f.genpodryad && f.obyekt).map((f) => [f.firma, f.obyekt as string]),
    );

    // ── Asl to'lovlar (2-qoida) — hamma hujjat raqamini BIR SO'ROVDA olamiz ──
    const hujjatlar = Array.from(new Set(
      komissiyalar.map((k) => this.hujjatRaqami(k.description)).filter((d): d is string => !!d),
    ));
    const aslMap = new Map<string, Array<{ summa: number; obyekt: string | null }>>();
    if (hujjatlar.length > 0) {
      const CHUNK = 5000;
      for (let i = 0; i < hujjatlar.length; i += CHUNK) {
        const part = hujjatlar.slice(i, i + CHUNK);
        const asl = await this.prisma.transaction.findMany({
          where: { docNumber: { in: part } },
          select: { docNumber: true, amount: true, erpObject: true },
        });
        for (const a of asl) {
          if (!a.docNumber) continue;
          const arr = aslMap.get(a.docNumber) || [];
          arr.push({ summa: Math.round(Math.abs(Number(a.amount))), obyekt: a.erpObject });
          aslMap.set(a.docNumber, arr);
        }
      }
    }

    let firmadan = 0, hujjatdan = 0, topilmadi = 0;
    const sabablar = new Map<string, number>();
    const namunalar: any[] = [];
    const updates: Array<{ id: string; obyekt: string }> = [];

    for (const k of komissiyalar) {
      const firma = (k.accountId ? hisobFirma.get(k.accountId) : '') || '';
      let obyekt: string | null = null;
      let usul = '';

      // 1-QOIDA — firma zakazchik
      const firmaniki = firmaObyekt.get(firma);
      if (firmaniki) {
        obyekt = firmaniki;
        usul = 'firma';
        firmadan++;
      } else {
        // 2-QOIDA — hujjat raqami + summa orqali asl to'lov
        const doc = this.hujjatRaqami(k.description);
        const s = this.aslSumma(k.description);
        if (!doc) {
          sabablar.set('izohda hujjat raqami yo‘q', (sabablar.get('izohda hujjat raqami yo‘q') || 0) + 1);
        } else if (!s) {
          sabablar.set('izohda asl summa (S=) yo‘q', (sabablar.get('izohda asl summa (S=) yo‘q') || 0) + 1);
        } else {
          const nomzodlar = (aslMap.get(doc) || []).filter((a) => a.summa === s);
          const obyektlar = Array.from(new Set(nomzodlar.map((n) => n.obyekt).filter((o): o is string => !!o)));
          if (nomzodlar.length === 0) {
            sabablar.set('asl to‘lov topilmadi', (sabablar.get('asl to‘lov topilmadi') || 0) + 1);
          } else if (obyektlar.length === 0) {
            sabablar.set('asl to‘lovda obyekt yo‘q', (sabablar.get('asl to‘lovda obyekt yo‘q') || 0) + 1);
          } else if (obyektlar.length > 1) {
            sabablar.set('asl to‘lovlarda obyekt har xil', (sabablar.get('asl to‘lovlarda obyekt har xil') || 0) + 1);
          } else {
            obyekt = obyektlar[0];
            usul = 'hujjat';
            hujjatdan++;
          }
        }
      }

      if (!obyekt) {
        topilmadi++;
        continue;
      }

      updates.push({ id: k.id, obyekt });
      if (namunalar.length < 30) {
        namunalar.push({
          sana: tashkentKun(k.txnDate),
          summa: String(k.amount),
          firma: firma.slice(0, 32),
          hujjat: this.hujjatRaqami(k.description),
          aslSumma: this.aslSumma(k.description)?.toString() ?? null,
          obyekt,
          usul,
        });
      }
    }

    if (!dryRun && updates.length > 0) {
      // Obyekt bo'yicha guruhlab bitta updateMany — 5 000 ta alohida so'rov emas.
      const guruh = new Map<string, string[]>();
      for (const u of updates) {
        const arr = guruh.get(u.obyekt) || [];
        arr.push(u.id);
        guruh.set(u.obyekt, arr);
      }
      for (const [obyekt, ids] of guruh) {
        const CHUNK = 5000;
        for (let i = 0; i < ids.length; i += CHUNK) {
          await this.prisma.transaction.updateMany({
            where: { id: { in: ids.slice(i, i + CHUNK) } },
            data: { erpObject: obyekt },
          });
        }
      }
      this.log.log(`komissiya obyekt: ${updates.length} qator to'ldirildi (firma ${firmadan}, hujjat ${hujjatdan})`);
    }

    return {
      ok: true, dryRun,
      korildi: komissiyalar.length,
      firmadan, hujjatdan, topilmadi,
      sabablar: Array.from(sabablar.entries())
        .map(([sabab, qator]) => ({ sabab, qator }))
        .sort((a, b) => b.qator - a.qator),
      namunalar,
    };
  }
}
