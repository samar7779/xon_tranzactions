import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { OplataKvService } from '../oplata-kv/oplata-kv.service';
import { SyncService } from '../sync/sync.service';

/**
 * TR Support — "Eski tarixni yuklash" bot orqali (egasi qarori, 2026-10-09). Panel Tranzaksiyalar > Eski tarixni
 * yuklash bilan AYNAN bir xil: SyncService.resolveBackfillTargets + runBackfill (fonda).
 * Backfill faqat QO'SHADI: o'chirish/o'zgartirish aniqlash va qoldiq yangilash backfill rejimida o'chiq
 * (sync.service.ts `!isBackfill`). Himoya: bir vaqtda bitta yuklash, oraliq TARIX_MAX_KUN gacha.
 * Tugagach yangi to'lov bo'lsa BITTA OplatyKv sync (eski sanalar kunduzgi sync'ning "eng yangi 1000" iga kirmaydi).
 */
export const TARIX_MAX_KUN = 62;
// Shundan eski RUNNING backfill log — server restartida qolgan yetim (bitta hisob <= 62 kun bir necha daqiqa)
export const TARIX_YETIM_MIN = 20;
const ISO_KUN = /^\d{4}-\d{2}-\d{2}$/;

const toshkentBugun = (): string => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const ddmm = (s: string): string => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};

/** Jarayondagi (shu server ishga tushgandan beri) yuklash — holat'da OplatyKv natijasini berish uchun. */
interface TarixIsh {
  tugadi: boolean;
  okv: { qoshildi: number; yangilandi: number; yozilmadi: number } | null;
  okvXato: string | null;
}

@Injectable()
export class TrTarixService {
  private readonly log = new Logger(TrTarixService.name);
  private readonly ishlar = new Map<string, TarixIsh>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
    private readonly oplataKv: OplataKvService,
  ) {}

  private async bankTop(q: string): Promise<{ id: string; name: string }> {
    const mos = await this.prisma.bank.findMany({
      where: { OR: [{ code: { equals: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] },
      select: { id: true, name: true, code: true },
    });
    const aniq = mos.filter((b) => b.code.toLowerCase() === q.toLowerCase() || b.name.toLowerCase() === q.toLowerCase());
    if (aniq.length === 1) return aniq[0];
    if (mos.length === 1) return mos[0];
    if (mos.length > 1) {
      throw new BadRequestException(`Bank aniq emas: "${q}" — ${mos.map((b) => b.name).join(', ')}. To'liqroq yozing`);
    }
    const hammasi = await this.prisma.bank.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
    throw new BadRequestException(`Bank topilmadi: "${q}". Banklar: ${hammasi.map((x) => x.name).join(', ')}`);
  }

  async boshla(b: { dan: string; gacha: string; bank?: string | null; hisob?: string | null }) {
    if (!ISO_KUN.test(b.dan) || !ISO_KUN.test(b.gacha)) throw new BadRequestException('Sana YYYY-MM-DD bo\'lishi kerak');
    if (b.dan > b.gacha) throw new BadRequestException("Boshlanish sanasi tugash sanasidan keyin bo'lmasin");
    if (b.gacha > toshkentBugun()) throw new BadRequestException('Kelajak sana bo\'lmaydi');
    const kun = Math.round((Date.parse(b.gacha) - Date.parse(b.dan)) / 86_400_000) + 1;
    if (kun > TARIX_MAX_KUN) {
      throw new BadRequestException(`Oraliq ${kun} kun — bot orqali ko'pi bilan ${TARIX_MAX_KUN} kun. Bo'lib yuboring yoki panelda yuklang`);
    }
    // bir vaqtda bitta: so'nggi TARIX_YETIM_MIN daqiqadagi tugamagan backfill (eskisi — restartdan qolgan yetim)
    const ishlayapti = await this.prisma.syncLog.findFirst({
      where: {
        source: { contains: 'backfill' }, status: 'RUNNING',
        startedAt: { gte: new Date(Date.now() - TARIX_YETIM_MIN * 60_000) },
      },
      orderBy: { startedAt: 'desc' },
      select: { source: true, startedAt: true },
    });
    if (ishlayapti) {
      throw new ConflictException(`Eski tarix yuklash allaqachon ishlayapti (${ishlayapti.source.split(' · backfill')[0]},`
        + ` ${new Date(ishlayapti.startedAt.getTime() + 5 * 3600_000).toISOString().slice(11, 16)} dan). Tugashini kuting`);
    }

    let scope: 'all' | 'bank' | 'account' = 'all';
    let bankId: string | undefined;
    let accountId: string | undefined;
    let qamrov = 'barcha hisoblar (sync yoqilgan)';
    if (b.hisob) {
      const a = await this.prisma.bankAccount.findFirst({
        where: { accountNo: b.hisob },
        select: { id: true, accountNo: true, ownerName: true, bank: { select: { name: true } } },
      });
      if (!a) throw new BadRequestException(`Hisob topilmadi: ${b.hisob} (bizning bank hisoblarimiz orasida yo'q)`);
      scope = 'account';
      accountId = a.id;
      qamrov = `${a.accountNo} — ${a.ownerName || '-'}, ${a.bank?.name || '-'}`;
    } else if (b.bank) {
      const bk = await this.bankTop(b.bank.trim());
      scope = 'bank';
      bankId = bk.id;
      qamrov = `${bk.name} (sync yoqilgan hisoblar)`;
    }

    const t = await this.sync.resolveBackfillTargets({ scope, bankId, accountId, dateFrom: b.dan, dateTo: b.gacha });
    if (t.accounts.length === 0) throw new BadRequestException('Sync yoqilgan hisob topilmadi');
    const chegara = t.syncMinDate ? t.syncMinDate.toISOString().slice(0, 10) : null;
    if (t.dates.length === 0) {
      throw new BadRequestException(chegara
        ? `Oraliq to'liq sync chegarasidan (${chegara}) oldin. Chegarani panel sozlamasida o'zgartiring`
        : "Sana oralig'i noto'g'ri");
    }
    const startedAt = new Date().toISOString();
    const ish: TarixIsh = { tugadi: false, okv: null, okvXato: null };
    this.ishlar.set(startedAt, ish);
    while (this.ishlar.size > 10) this.ishlar.delete(this.ishlar.keys().next().value as string);
    void this.yakunla(startedAt, ish, t.accounts, t.dates);
    this.log.log(`Eski tarix (bot): ${qamrov} · ${t.dates[0]}–${t.dates[t.dates.length - 1]} · ${t.accounts.length} hisob`);
    return {
      ok: true as const,
      startedAt,
      qamrov,
      hisoblar: t.accounts.length,
      kunlar: t.dates.length,
      dan: ddmm(t.dates[0]),
      gacha: ddmm(t.dates[t.dates.length - 1]),
      ogohlantirish: t.clampedCount > 0 && chegara
        ? `Sync chegarasi (${chegara}) tufayli ${t.clampedCount} kun o'tkazib yuborildi` : null,
    };
  }

  /** Fonda: backfill, keyin yangi to'lov bo'lsa bitta OplatyKv sync. Xato bo'lsa ham `tugadi` belgilanadi. */
  private async yakunla(startedAt: string, ish: TarixIsh, accounts: { id: string; credentialId: string }[], dates: string[]) {
    try {
      await this.sync.runBackfill(accounts, dates);
      const s = await this.prisma.syncLog.aggregate({
        _sum: { saved: true },
        where: { source: { contains: 'backfill' }, startedAt: { gte: new Date(startedAt) } },
      });
      if ((s._sum.saved || 0) > 0) {
        const r: any = await this.oplataKv.syncNowRespectingSettings({ id: null, name: 'TR Support · eski tarix' });
        ish.okv = {
          qoshildi: Number(r?.added || 0), yangilandi: Number(r?.updated || 0),
          yozilmadi: Array.isArray(r?.yozilmadi) ? r.yozilmadi.length : 0,
        };
      }
    } catch (e: any) {
      ish.okvXato = String(e?.message || e).slice(0, 200);
      this.log.warn(`Eski tarix (bot) yakunlash xato: ${ish.okvXato}`);
    } finally {
      ish.tugadi = true;
    }
  }

  /** Panel /sync/backfill/status bilan bir xil manba: since dan keyingi backfill loglari, jamlangan. */
  async holat(since: string) {
    const d = new Date(since);
    if (Number.isNaN(d.getTime())) throw new BadRequestException("since noto'g'ri");
    const logs = await this.prisma.syncLog.findMany({
      where: { source: { contains: 'backfill' }, startedAt: { gte: d } },
      orderBy: { startedAt: 'asc' },
      take: 1000,
      select: { source: true, status: true, fetched: true, saved: true, errors: true, errorMessage: true, finishedAt: true },
    });
    const tugagan = logs.filter((l) => l.status !== 'RUNNING');
    const xatolilar = logs.filter((l) => l.status === 'FAILED' || l.errors > 0);
    const ish = this.ishlar.get(since) || null;
    return {
      ok: true as const,
      boshlangan: logs.length,
      tugagan: tugagan.length,
      olindi: logs.reduce((s, l) => s + (l.fetched || 0), 0),
      yangi: logs.reduce((s, l) => s + (l.saved || 0), 0),
      xato: logs.reduce((s, l) => s + (l.errors || 0), 0),
      xatolar: xatolilar.slice(0, 10).map((l) => ({
        hisob: l.source.split(' · backfill')[0].slice(0, 120),
        xabar: (l.errorMessage || (l.status === 'FAILED' ? 'bajarilmadi' : `${l.errors} ta yozuv xato`)).replace(/\s+/g, ' ').slice(0, 200),
      })),
      oxirgi: tugagan.reduce<string | null>((m, l) => {
        const v = l.finishedAt ? l.finishedAt.toISOString() : null;
        return v && (!m || v > m) ? v : m;
      }, null),
      // null = bu server jarayonida boshlanmagan (restart bo'lgan) — faqat loglar bo'yicha
      ish: ish ? { tugadi: ish.tugadi, okv: ish.okv, okvXato: ish.okvXato } : null,
    };
  }
}
