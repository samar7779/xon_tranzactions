import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { CrmService } from '../crm/crm.service';

/**
 * "Plan bo'yicha to'lov" — CRM to'lov jadvalini (grafik) sinxronlaydi va
 * obyekt bo'yicha "tushishi kerak vs tushgan" ni hisoblaydi.
 *
 * Sync: aktiv (to'liq to'lanmagan) shartnomalar → CRM /order/show →
 * initial.schedules + monthly.schedules → ContractSchedule jadvaliga.
 * Og'ir (11k+ shartnoma) — fon jarayon, concurrency bilan.
 */

type SyncState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  totalContracts: number;
  processed: number;
  upserted: number;
  errors: number;
  lastError: string | null;
  actor: string | null;
};

const LAST_SYNC_KEY = 'schedule.lastSyncAt';

@Injectable()
export class ScheduleService {
  private readonly log = new Logger(ScheduleService.name);
  private state: SyncState = {
    running: false, startedAt: null, finishedAt: null,
    totalContracts: 0, processed: 0, upserted: 0, errors: 0, lastError: null, actor: null,
  };

  constructor(private prisma: PrismaService, private crm: CrmService) {}

  async status() {
    let lastSyncAt: string | null = null;
    try {
      const s = await this.prisma.setting.findUnique({ where: { key: LAST_SYNC_KEY } });
      lastSyncAt = s?.value || null;
    } catch { /* ignore */ }
    return { ...this.state, lastSyncAt };
  }

  startSync(actor: string | null) {
    if (this.state.running) {
      return { ok: false, message: 'Sync allaqachon ishlayapti', state: this.state };
    }
    this.state = {
      running: true, startedAt: new Date().toISOString(), finishedAt: null,
      totalContracts: 0, processed: 0, upserted: 0, errors: 0, lastError: null, actor,
    };
    // Fon — await qilmaymiz
    this.runSync().catch((e) => {
      this.log.error('Schedule sync xato: ' + (e?.message || e));
      this.state.running = false;
      this.state.finishedAt = new Date().toISOString();
      this.state.lastError = String(e?.message || e).slice(0, 200);
    });
    return { ok: true, message: 'Sync boshlandi (fon)', state: this.state };
  }

  stopSync() {
    if (this.state.running) this.state.running = false;
    return { ok: true, message: 'To\'xtatildi' };
  }

  private async loadObjectMap(): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    try {
      const rows = await this.prisma.oplataKvObjectMapping.findMany();
      for (const r of rows) m.set(r.crmName.trim().toLowerCase(), r.oplataName);
    } catch { /* ignore */ }
    return m;
  }

  private async runSync() {
    const objMap = await this.loadObjectMap();
    const mapObject = (name: string | null) => (name ? (objMap.get(name.trim().toLowerCase()) || name) : null);
    const PER_PAGE = 100;
    const CONCURRENCY = 6;
    const syncedAt = new Date();

    // ── 1) Aktiv + to'liq to'lanmagan shartnomalar ro'yxati ──
    const contracts: Array<{ contract: string; object: string | null; clientName: string | null }> = [];
    let page = 1;
    let totalPage = 1;
    while (page <= totalPage && this.state.running) {
      const res = await this.crm.listContractsPage(page, PER_PAGE);
      if (!res.ok) { this.state.lastError = `CRM /index xato (sahifa ${page})`; break; }
      totalPage = res.totalPage || 1;
      for (const it of res.items) {
        if (it.deleted || it.archived) continue;
        if (it.percentagePaid >= 100) continue; // to'liq to'langan — kelajak to'lov yo'q
        contracts.push({
          contract: it.contract,
          object: mapObject(it.object),
          clientName: it.clientName ? String(it.clientName).slice(0, 255) : null,
        });
      }
      this.state.totalContracts = contracts.length;
      page++;
    }
    this.log.log(`Schedule sync: ${contracts.length} ta aktiv (to'liq to'lanmagan) shartnoma, ${totalPage} sahifa`);

    // ── 2) Har shartnoma jadvalini olib DB'ga yozamiz (concurrency) ──
    let idx = 0;
    const worker = async () => {
      while (this.state.running) {
        const i = idx++;
        if (i >= contracts.length) break;
        const c = contracts[i];
        try {
          const r = await this.crm.getContractSchedules(c.contract);
          if (r.ok && r.schedules.length > 0) {
            const data = r.schedules.map((s) => ({
              scheduleId: s.scheduleId,
              contractNo: c.contract,
              object: c.object,
              clientName: c.clientName,
              dueDate: new Date(s.dueDate),
              amount: s.amount,
              amountPaid: s.amountPaid,
              remaining: s.remaining,
              kind: s.kind,
              contractStatus: r.status,
              syncedAt,
            }));
            // Shartnoma jadvalini to'liq almashtiramiz (deleteMany + createMany) — tez va idempotent
            await this.prisma.$transaction([
              this.prisma.contractSchedule.deleteMany({ where: { contractNo: c.contract } }),
              this.prisma.contractSchedule.createMany({ data, skipDuplicates: true }),
            ]);
            this.state.upserted += data.length;
          }
        } catch (e: any) {
          this.state.errors++;
          this.state.lastError = String(e?.message || e).slice(0, 200);
        }
        this.state.processed++;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    this.state.running = false;
    this.state.finishedAt = new Date().toISOString();
    try {
      await this.prisma.setting.upsert({
        where: { key: LAST_SYNC_KEY },
        create: { key: LAST_SYNC_KEY, value: this.state.finishedAt },
        update: { value: this.state.finishedAt },
      });
    } catch { /* ignore */ }
    this.log.log(`Schedule sync tugadi: ${this.state.processed}/${contracts.length} shartnoma, ${this.state.upserted} installment, ${this.state.errors} xato`);
  }

  /** Obyekt bo'yicha: tushishi kerak (amount) vs tushgan (amountPaid) vs qolgan (remaining). */
  async byObject(opts: { from: string; to: string; kind?: string }) {
    const from = new Date(`${opts.from}T00:00:00`);
    const to = new Date(`${opts.to}T23:59:59`);
    const where: any = { dueDate: { gte: from, lte: to } };
    if (opts.kind === 'initial' || opts.kind === 'monthly') where.kind = opts.kind;

    const grouped = await this.prisma.contractSchedule.groupBy({
      by: ['object'],
      where,
      _sum: { amount: true, amountPaid: true, remaining: true },
      _count: true,
    });
    const rows = grouped.map((g) => ({
      object: g.object || '—',
      expected: Number(g._sum.amount || 0),
      received: Number(g._sum.amountPaid || 0),
      remaining: Number(g._sum.remaining || 0),
      count: g._count,
    })).sort((a, b) => b.expected - a.expected);

    const total = rows.reduce(
      (t, r) => ({ expected: t.expected + r.expected, received: t.received + r.received, remaining: t.remaining + r.remaining, count: t.count + r.count }),
      { expected: 0, received: 0, remaining: 0, count: 0 },
    );

    let lastSyncAt: string | null = null;
    try {
      const s = await this.prisma.setting.findUnique({ where: { key: LAST_SYNC_KEY } });
      lastSyncAt = s?.value || null;
    } catch { /* ignore */ }

    return { ok: true, from: opts.from, to: opts.to, kind: opts.kind || 'all', rows, total, lastSyncAt };
  }
}
