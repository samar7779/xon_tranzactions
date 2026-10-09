import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { SyncService } from '../sync/sync.service';

/**
 * TR Support — "Eski tarixni yuklash" bot orqali (egasi qarori, 2026-10-09). Panel Tranzaksiyalar > Eski tarixni
 * yuklash bilan AYNAN bir xil: SyncService.resolveBackfillTargets + runBackfill (fonda).
 * Backfill faqat QO'SHADI: o'chirish/o'zgartirish aniqlash va qoldiq yangilash backfill rejimida o'chiq
 * (sync.service.ts `!isBackfill`). Himoya: bir vaqtda bitta yuklash, oraliq TARIX_MAX_KUN gacha.
 */
export const TARIX_MAX_KUN = 62;
const ISO_KUN = /^\d{4}-\d{2}-\d{2}$/;

const toshkentBugun = (): string => new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10);
const ddmm = (s: string): string => {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
};

@Injectable()
export class TrTarixService {
  private readonly log = new Logger(TrTarixService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  async boshla(b: { dan: string; gacha: string; bank?: string | null; hisob?: string | null }) {
    if (!ISO_KUN.test(b.dan) || !ISO_KUN.test(b.gacha)) throw new BadRequestException('Sana YYYY-MM-DD bo\'lishi kerak');
    if (b.dan > b.gacha) throw new BadRequestException("Boshlanish sanasi tugash sanasidan keyin bo'lmasin");
    if (b.gacha > toshkentBugun()) throw new BadRequestException('Kelajak sana bo\'lmaydi');
    const kun = Math.round((Date.parse(b.gacha) - Date.parse(b.dan)) / 86_400_000) + 1;
    if (kun > TARIX_MAX_KUN) {
      throw new BadRequestException(`Oraliq ${kun} kun — bot orqali ko'pi bilan ${TARIX_MAX_KUN} kun. Bo'lib yuboring yoki panelda yuklang`);
    }
    // bir vaqtda bitta (oxirgi 3 soatdagi tugamagan backfill)
    const ishlayapti = await this.prisma.syncLog.findFirst({
      where: { source: { contains: 'backfill' }, status: 'RUNNING', startedAt: { gte: new Date(Date.now() - 3 * 3600_000) } },
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
      const q = b.bank.trim();
      const bk = await this.prisma.bank.findFirst({
        where: { OR: [{ code: { equals: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }] },
        select: { id: true, name: true },
      });
      if (!bk) {
        const hammasi = await this.prisma.bank.findMany({ select: { name: true }, orderBy: { name: 'asc' } });
        throw new BadRequestException(`Bank topilmadi: "${q}". Banklar: ${hammasi.map((x) => x.name).join(', ')}`);
      }
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
    this.sync.runBackfill(t.accounts, t.dates).catch((e: any) => this.log.warn(`Backfill (bot) xato: ${e?.message}`));
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
    };
  }
}
