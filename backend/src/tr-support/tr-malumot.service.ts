import { Injectable, Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../common/prisma/prisma.service';
import { CorrectionService } from '../correction/correction.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { mfoToBankName } from '../oplata-kv/memorial-order/mfo-banks';
import { XATO_DATEFROM_KEY } from './tr-support.service';

/**
 * TR Support — agent (@TRanSupport_bot) uchun FAQAT O'QISH ma'lumotlari (egasi qarori, 2026-10-05):
 *   1) hisob(raqam)  — hisob raqam bo'yicha: egasi (to'lovlardagi nom), MFO va bank, INN, korxona (DIDOX),
 *                       bizning hisobmi, shu hisobdan/ga to'lovlar statistikasi, shartnomalar, oxirgi to'lovlar.
 *   2) xatoFayl()    — XATO to'lovlar ro'yxati (xato-list sahifasi bilan AYNAN bir xil filtr va sana) Excel fayl.
 * Hech narsa yozilmaydi.
 */

// Hisob raqamning 6-8 xonasi — valyuta (ISO 4217 raqamli)
const VALYUTA: Record<string, string> = {
  '000': 'UZS', '840': 'USD', '978': 'EUR', '643': 'RUB', '156': 'CNY', '398': 'KZT', '826': 'GBP', '392': 'JPY',
};
export const HISOB_RE = /^\d{16,25}$/;
const QATOR_MAX = 3000;        // statistikaga olinadigan eng ko'p to'lov (jamilar alohida, to'liq)
const XATO_MAX = 2000;         // xato-list sahifasi bilan bir xil chegara

export interface HisobNom { nom: string | null; mfo: string | null; inn: string | null; soni: number; oxirgi: string | null }
export interface HisobTomon { soni: number; summa: number; birinchi: string | null; oxirgi: string | null }

const iso = (d: any): string | null => (d ? new Date(d).toISOString() : null);
const num = (v: any): number => (v == null ? 0 : Number(v));
const str = (v: any): string | null => (v == null || String(v).trim() === '' ? null : String(v).trim());

@Injectable()
export class TrMalumotService {
  private readonly log = new Logger(TrMalumotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oplataKv: OplataKvService,
    private readonly correction: CorrectionService,
  ) {}

  // ─── 1) Hisob raqam ma'lumoti ─────────────────────────────────────
  async hisob(raqam: string) {
    const acc = String(raqam || '').replace(/\s+/g, '');
    const valyutaKod = acc.slice(5, 8);

    // Bizning hisob(lar)imiz
    const bizniki = await this.prisma.bankAccount.findMany({
      where: { accountNo: acc },
      select: {
        branch: true, ownerName: true, currency: true, syncEnabled: true, lastSyncedAt: true,
        bank: { select: { name: true, code: true } },
      },
    });

    // Shu hisob ishtirok etgan to'lovlar: jamilar (to'liq) + oxirgi QATOR_MAX tasi (nom, MFO, INN, shartnoma)
    // from_account/to_account indekssiz — bitta so'rovda ikkala tomon (kamdan-kam so'raladi).
    const jami = await this.prisma.$queryRaw<any[]>`
      SELECT (from_account = ${acc}) AS jonatuvchi, count(*)::int AS soni, COALESCE(sum(amount), 0)::text AS summa,
             min(txn_date) AS birinchi, max(txn_date) AS oxirgi
      FROM transactions WHERE from_account = ${acc} OR to_account = ${acc}
      GROUP BY 1`;
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT id, external_id, txn_date, amount::text AS amount, direction::text AS yon, contract_number,
             (from_account = ${acc}) AS jonatuvchi,
             from_name, from_mfo, from_inn, to_name, to_mfo, to_inn, left(description, 160) AS izoh
      FROM transactions WHERE from_account = ${acc} OR to_account = ${acc}
      ORDER BY txn_date DESC LIMIT ${QATOR_MAX}`;

    const tomon = (j: boolean): HisobTomon => {
      const r = jami.find((x) => !!x.jonatuvchi === j);
      return r
        ? { soni: num(r.soni), summa: num(r.summa), birinchi: iso(r.birinchi), oxirgi: iso(r.oxirgi) }
        : { soni: 0, summa: 0, birinchi: null, oxirgi: null };
    };

    // Shu hisob egasining nomi/MFO/INN (to'lovlardagi) — chastotasi bo'yicha
    const nomMap = new Map<string, HisobNom>();
    const shMap = new Map<string, number>();
    for (const r of rows) {
      const nom = str(r.jonatuvchi ? r.from_name : r.to_name);
      const mfo = str(r.jonatuvchi ? r.from_mfo : r.to_mfo);
      const inn = str(r.jonatuvchi ? r.from_inn : r.to_inn);
      const k = `${nom}|${mfo}|${inn}`;
      const e = nomMap.get(k) || { nom, mfo, inn, soni: 0, oxirgi: null };
      e.soni += 1;
      if (!e.oxirgi) e.oxirgi = iso(r.txn_date);   // rows sana bo'yicha kamayuvchi
      nomMap.set(k, e);
      const sh = str(r.contract_number);
      if (sh) shMap.set(sh, (shMap.get(sh) || 0) + 1);
    }
    const nomlar = [...nomMap.values()].sort((a, b) => b.soni - a.soni).slice(0, 8);
    const shartnomalar = [...shMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([shartnoma, soni]) => ({ shartnoma, soni }));
    const oxirgi = rows.slice(0, 5).map((r) => ({
      id: str(r.external_id) || String(r.id), sana: iso(r.txn_date), summa: num(r.amount), yon: str(r.yon),
      jonatuvchi: !!r.jonatuvchi, qarshi: str(r.jonatuvchi ? r.to_name : r.from_name),
      shartnoma: str(r.contract_number), izoh: str(r.izoh),
    }));

    // Korxona (DIDOX): to'lovlardagi INN bo'yicha yoki kontragentning bank hisoblari ro'yxatida shu raqam
    const innlar = [...new Set(nomlar.map((n) => n.inn).filter((x): x is string => !!x))].slice(0, 5);
    const byAcc = await this.prisma.$queryRaw<any[]>`
      SELECT id FROM counterparties WHERE bank_accounts::text LIKE ${'%' + acc + '%'} LIMIT 3`;
    const kontragentlar = await this.prisma.counterparty.findMany({
      where: { OR: [{ inn: { in: innlar } }, { id: { in: byAcc.map((x) => String(x.id)) } }] },
      select: {
        inn: true, name: true, fullName: true, director: true, phone: true, address: true, vatStatus: true,
        oked: true, registrationDate: true, isActive: true, bankAccounts: true,
      },
      take: 3,
    });
    const korxonalar = kontragentlar.map((c) => {
      const ba = Array.isArray(c.bankAccounts)
        ? (c.bankAccounts as any[]).find((x) => String(x?.account || '').replace(/\s+/g, '') === acc) : null;
      return {
        inn: c.inn, nom: c.name, toliqNom: str(c.fullName), direktor: str(c.director), telefon: str(c.phone),
        manzil: str(c.address), qqs: str(c.vatStatus), oked: str(c.oked),
        royxatdan: c.registrationDate ? iso(c.registrationDate) : null, faol: c.isActive,
        bankNomi: str(ba?.bankName), mfo: str(ba?.mfo),
      };
    });

    // MFO -> bank nomi: ma'lumotnoma, bizning hisoblar (filial), kontragent bank ro'yxati
    const filiallar = await this.prisma.bankAccount.findMany({
      where: { branch: { in: [...new Set([...nomlar.map((n) => n.mfo), ...bizniki.map((b) => b.branch)].filter((x): x is string => !!x))] } },
      select: { branch: true, bank: { select: { name: true } } },
    });
    const bankNomi = (mfo: string | null): string | null => {
      if (!mfo) return null;
      return str(mfoToBankName(mfo)) || str(filiallar.find((f) => f.branch === mfo)?.bank?.name)
        || korxonalar.find((k) => k.mfo === mfo)?.bankNomi || null;
    };

    return {
      ok: true as const,
      hisob: acc,
      balansKod: acc.slice(0, 5),
      valyuta: VALYUTA[valyutaKod] || (valyutaKod ? `kod ${valyutaKod}` : null),
      bizniki: bizniki.map((b) => ({
        bank: b.bank?.name || null, mfo: b.branch, bankNomi: bankNomi(b.branch), egasi: str(b.ownerName),
        valyuta: b.currency, sync: b.syncEnabled, oxirgiSync: iso(b.lastSyncedAt),
      })),
      nomlar: nomlar.map((n) => ({ ...n, bankNomi: bankNomi(n.mfo) })),
      jonatuvchi: tomon(true),      // shu hisobdan ketgan to'lovlar
      qabulQiluvchi: tomon(false),  // shu hisobga kelgan to'lovlar
      shartnomalar,
      oxirgi,
      korxonalar,
      kesilgan: rows.length >= QATOR_MAX,
      topildi: bizniki.length > 0 || rows.length > 0 || korxonalar.length > 0,
    };
  }

  // ─── 2) XATO to'lovlar ro'yxati — Excel fayl ───────────────────────
  async xatoFayl(filtr?: string | null) {
    const dateFrom = (await this.prisma.setting.findUnique({ where: { key: XATO_DATEFROM_KEY } }))?.value || null;
    const { rows } = await this.oplataKv.getXatoListForAgent({ dateFrom, limit: XATO_MAX });
    const f = String(filtr || '').trim().toLowerCase();
    const tanlangan = f
      ? rows.filter((r: any) => [r.account, r.object, r.contractNo, r.client, r.purpose, r.txType]
        .some((v) => String(v || '').toLowerCase().includes(f)))
      : rows;
    const ids = tanlangan.map((r: any) => r.id);
    const [pending, rejected] = await Promise.all([
      this.correction.pendingInfoByOplataKvId(ids),
      this.correction.rejectedOplataKvIds(ids),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'TR Support';
    const ws = wb.addWorksheet("XATO to'lovlar", { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [
      { header: '№', key: 'n', width: 6 },
      { header: 'Sana', key: 'sana', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
      { header: "Summa (so'm)", key: 'summa', width: 16, style: { numFmt: '#,##0' } },
      { header: 'XATO shartnoma', key: 'shartnoma', width: 18 },
      { header: 'Mijoz', key: 'mijoz', width: 30 },
      { header: 'Obyekt', key: 'obyekt', width: 20 },
      { header: 'Qabul qiluvchi hisob', key: 'hisob', width: 28 },
      { header: 'Tip', key: 'tip', width: 20 },
      { header: "To'lov maqsadi", key: 'maqsad', width: 60 },
      { header: 'Ariza holati', key: 'ariza', width: 14 },
      { header: 'Ariza: kim', key: 'kim', width: 22 },
      { header: 'Ariza: taklif shartnoma', key: 'taklif', width: 20 },
      { header: 'Ariza sanasi', key: 'arizaSana', width: 12, style: { numFmt: 'dd.mm.yyyy' } },
      { header: "To'lov ID", key: 'txId', width: 70 },
      { header: 'OplatyKv ID', key: 'okvId', width: 28 },
    ];
    let summa = 0;
    let kutilmoqda = 0;
    let rad = 0;
    tanlangan.forEach((r: any, i: number) => {
      const p = pending.get(r.id);
      const isRad = !p && rejected.has(r.id);
      const s = r.paymentAmount != null ? Number(r.paymentAmount) : null;
      summa += s || 0;
      if (p) kutilmoqda += 1;
      if (isRad) rad += 1;
      ws.addRow({
        n: i + 1, sana: r.date ? new Date(r.date) : null, summa: s, shartnoma: r.contractNo || '',
        mijoz: r.client || '', obyekt: r.object || '', hisob: r.account || '', tip: r.txType || '',
        maqsad: r.purpose || '', ariza: p ? 'Kutilmoqda' : isRad ? 'Rad etilgan' : '',
        kim: p?.by || '', taklif: p?.contractNo || '', arizaSana: p?.at ? new Date(p.at) : null,
        txId: r.sourceTxId || '', okvId: r.id,
      });
    });
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const kun = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);   // Toshkent sanasi
    const filename = `xato-tolovlar_${kun}${f ? '_filtr' : ''}.xlsx`;
    this.log.log(`XATO fayl: ${tanlangan.length} qator${f ? ' (filtr)' : ''}, ${buf.length} bayt`);
    return {
      ok: true as const, filename, base64: buf.toString('base64'),
      soni: tanlangan.length, jami: rows.length, summa, kutilmoqda, rad,
      dateFrom, filtr: f || null, kesilgan: rows.length >= XATO_MAX,
    };
  }
}
