import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as os from 'os';
import { PrismaService } from '../common/prisma/prisma.service';
import { DeployService } from '../deploy/deploy.service';
import { LeaderConfigService } from './leader-config.service';
import { redactSecrets } from './leader-code-tools.service';
import { CheckLevel, CheckResult, ToolImpl } from './leader.types';

/**
 * Checker — DETERMINISTIK salomatlik tekshiruvlari (LLM'siz). FAQAT O'QISH:
 * bank/CRM API chaqirilmaydi, biznes jadvallarga yozilmaydi, Setting faqat oq ro'yxatdan o'qiladi.
 *
 * Tuzoqlar (koddan tasdiqlangan):
 *  - lastSyncedAt login xatosida ham yangilanadi (PARTIAL) — shuning uchun alohida signal:
 *    oxirgi yakunlangan SyncLog PARTIAL & fetched=0 & errors>=10 => login shubhasi.
 *  - SyncLog RUNNING restartdan keyin qolib ketadi (boot-cleanup yo'q) — faqat warn.
 *  - XonPay har restartda 'Server restart — orphan running entry' failed qatori yozadi — hisobga olinmaydi.
 *  - CRM sverka restartda 'crashed' bo'ladi — faqat warn.
 */

const TZ_MS = 5 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 15_000;
const TOOL_CACHE_MS = 30_000;
const SUMMARY_CHARS = 300;
const DETAIL_CHARS = 160;
const MAX_DETAILS = 10;

/** SyncService.tick faqat shu turdagi banklarni sync qiladi (GENERIC — yo'q). */
const SYNC_API_KINDS = ['KAPITALBANK_V3', 'IPAK_YOLI_V1', 'HAMKORBANK_V1'] as const;
const XONPAY_ORPHAN_RE = /^\s*Server restart/i;

/** Setting oq ro'yxati (spec 6) — bu servis faqat shulardan o'qiydi. */
const SETTING_WHITELIST = new Set([
  'xonpay.cron.enabled',
  'xonpay.cron.intervalMinutes',
  'shmitd.enabled',
  'sverka.telegram.notifiedToday',
  'crmSverka.lastRun',
]);

type CheckBody = { level: CheckLevel; summary: string; details?: string[] };
type Item = { level: CheckLevel; text: string };

const LEVEL_RANK: Record<CheckLevel, number> = { ok: 0, unknown: 1, warn: 2, critical: 3 };

// ─── Yordamchilar ───────────────────────────────────────────────────────

function tkDay(d: Date = new Date()): string {
  return new Date(d.getTime() + TZ_MS).toISOString().slice(0, 10);
}
function tkHour(d: Date = new Date()): number {
  return new Date(d.getTime() + TZ_MS).getUTCHours();
}
function tkStamp(d: Date | string | null | undefined): string {
  if (!d) return '-';
  const t = new Date(d as any);
  if (isNaN(t.getTime())) return String(d);
  const s = new Date(t.getTime() + TZ_MS).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}
/**
 * Deploy logi vaqti ('YYYY-MM-DD HH:mm:ss', deploy.sh `date`, server soatida, zonasiz) -> Toshkent 'YYYY-MM-DD HH:mm'.
 * Node jarayoni server TZ'sida — zonasiz matn lokal vaqt sifatida o'qiladi.
 */
function deployStamp(s: any): string {
  if (!s) return '-';
  const str = String(s).trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(str);
  return tkStamp(m ? new Date(`${m[1]}T${m[2]}`) : str);
}

// Kirill -> lotin (o'zbek). Deterministik matnlar (/health, alert) shefimga kirillsiz borsin.
const CYR_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'sh', ъ: "'", ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h', і: 'i', є: 'ye',
};
/** Kirill harflarni lotinga o'giradi (so'z boshidagi "е" -> "ye"); lotin matn o'zgarmaydi. */
export function cyrToLat(input: any): string {
  const s = String(input ?? '');
  if (!/[\u0400-\u04FF]/.test(s)) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const lower = ch.toLowerCase();
    let t = CYR_LAT[lower];
    if (t === undefined) {
      out += ch;
      continue;
    }
    const prev = i > 0 ? s[i - 1] : '';
    if (lower === 'е' && (!prev || !/[\u0400-\u04FFA-Za-z]/.test(prev))) t = 'ye';
    if (ch !== lower && t) {
      const next = s[i + 1] || '';
      const wordUpper = next && next !== next.toLowerCase();
      t = wordUpper ? t.toUpperCase() : t[0].toUpperCase() + t.slice(1);
    }
    out += t;
  }
  return out;
}

/** Davomiylik: "45 daqiqa", "3 soat 10 daqiqa", "2 kun". */
function dur(ms: number): string {
  if (!Number.isFinite(ms)) return 'hech qachon';
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 120) return `${min} daqiqa`;
  const h = Math.floor(min / 60);
  if (h < 48) return min % 60 ? `${h} soat ${min % 60} daqiqa` : `${h} soat`;
  return `${Math.floor(h / 24)} kun`;
}
function fmtSum(n: any): string {
  const v = Math.round(Math.abs(Number(n) || 0));
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function cut(s: any, n: number): string {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 3) + '...' : t;
}
/** DB'dagi xato matni: sirlar va email yashiriladi, bir qator, qisqa. */
function cleanErr(s: any, n = 120): string {
  const t = redactSecrets(String(s ?? '')).replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '(email)');
  return cut(t, n) || "matn yo'q";
}
function shortAcc(acc: string): string {
  const a = String(acc || '');
  return a.length > 12 ? `${a.slice(0, 5)}...${a.slice(-4)}` : a;
}
function worst(items: Item[]): CheckLevel {
  let lvl: CheckLevel = 'ok';
  for (const i of items) if (LEVEL_RANK[i.level] > LEVEL_RANK[lvl]) lvl = i.level;
  return lvl;
}
/** Muammoli bandlardan bir qatorli summary: eng jiddiy 2 tasi + "va yana N ta". */
function summarize(items: Item[], prefix = ''): string {
  const sorted = [...items].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  const head = sorted.slice(0, 2).map((i) => i.text).join('; ');
  const more = sorted.length > 2 ? ` va yana ${sorted.length - 2} ta` : '';
  return `${prefix}${head}${more}`;
}
function parseJson(v: string | null | undefined): any {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

@Injectable()
export class LeaderHealthService {
  private readonly log = new Logger(LeaderHealthService.name);
  private inflight: Promise<CheckResult[]> | null = null;
  private toolCache: { at: number; results: CheckResult[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LeaderConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Barcha tekshiruvlar parallel; har biri 15 s ichida (xato/timeout => 'unknown'). Bir vaqtda bitta run. */
  runAll(): Promise<CheckResult[]> {
    if (this.inflight) return this.inflight;
    this.inflight = this.doRunAll().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  tool(): ToolImpl {
    return {
      name: 'health_checks',
      description:
        "Tizim salomatligi — deterministik tekshiruvlar: bank sync, XonPay sync, Google eksport, SHMITD hisoboti, " +
        "bank sverka, CRM sverka, API 5xx xatolari, muvaffaqiyatsiz kirishlar, deploy, disk, xotira. " +
        "Har biri: key, title, level (ok | warn | critical | unknown), summary, details. unknown = tekshirib bo'lmadi (muammo degani emas).",
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        try {
          const c = this.toolCache;
          const results = c && Date.now() - c.at < TOOL_CACHE_MS ? c.results : await this.runAll();
          if (!c || c.results !== results) this.toolCache = { at: Date.now(), results };
          const counts: Record<CheckLevel, number> = { ok: 0, warn: 0, critical: 0, unknown: 0 };
          for (const r of results) counts[r.level]++;
          return { checked_at: `${tkStamp(new Date())} (Toshkent)`, counts, results };
        } catch (e: any) {
          return { error: `Tekshiruv bajarilmadi: ${cut(e?.message, 200)}` };
        }
      },
    };
  }

  // ─── Ichki ────────────────────────────────────────────────────────────

  private async doRunAll(): Promise<CheckResult[]> {
    const now = new Date();
    const checks: Array<[string, string, () => Promise<CheckBody>]> = [
      ['bank_sync', 'Bank sync', () => this.checkBankSync(now)],
      ['xonpay', 'XonPay sync', () => this.checkXonpay(now)],
      ['google_export', 'Google eksport', () => this.checkGoogleExport(now)],
      ['shmitd', 'SHMITD hisoboti', () => this.checkShmitd()],
      ['sverka', 'Bank sverka', () => this.checkSverka(now)],
      ['crm_sverka', 'CRM sverka', () => this.checkCrmSverka()],
      ['api_errors', 'API xatolari', () => this.checkApiErrors(now)],
      ['failed_logins', 'Kirish urinishlari', () => this.checkFailedLogins(now)],
      ['deploy', 'Deploy', () => this.checkDeploy()],
      ['disk', 'Disk', () => this.checkDisk()],
      ['memory', 'Xotira (RAM)', () => this.checkMemory()],
    ];
    const results = await Promise.all(checks.map(([key, title, fn]) => this.guard(key, title, fn)));
    const bad = results.filter((r) => r.level === 'critical' || r.level === 'warn').map((r) => `${r.key}=${r.level}`);
    if (bad.length) this.log.debug?.(`health: ${bad.join(', ')}`);
    return results;
  }

  private async guard(key: string, title: string, fn: () => Promise<CheckBody>): Promise<CheckResult> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const body = await Promise.race<CheckBody>([
        fn(),
        new Promise<CheckBody>((_, rej) => {
          timer = setTimeout(() => rej(new Error('vaqt tugadi (15 s)')), CHECK_TIMEOUT_MS);
        }),
      ]);
      // DB qiymatlari (sheet, bank nomi, sabab) kirillda bo'lishi mumkin — shefimga lotinda boradi
      const out: CheckResult = { key, title, level: body.level, summary: cut(cyrToLat(body.summary), SUMMARY_CHARS) };
      const details = (body.details || []).filter(Boolean).slice(0, MAX_DETAILS).map((d) => cut(cyrToLat(d), DETAIL_CHARS));
      if (details.length) out.details = details;
      return out;
    } catch (e: any) {
      this.log.warn(`health ${key} xato: ${e?.message}`);
      return { key, title, level: 'unknown', summary: cyrToLat(`Tekshirib bo'lmadi: ${cleanErr(e?.message, 150)}`) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Setting'lar — faqat oq ro'yxatdan. */
  private async settings(keys: string[]): Promise<Record<string, string | null>> {
    for (const k of keys) if (!SETTING_WHITELIST.has(k)) throw new Error(`Setting oq ro'yxatda yo'q: ${k}`);
    const rows = await this.prisma.setting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
    const out: Record<string, string | null> = {};
    for (const k of keys) out[k] = null;
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  /** Raw SELECT faqat READ ONLY tranzaksiya ichida. */
  private async readOnly<T>(q: Prisma.Sql): Promise<T> {
    const [, rows] = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe('SET TRANSACTION READ ONLY'),
      this.prisma.$queryRaw<T>(q),
    ]);
    return rows as T;
  }

  /** timestamp(3) ustunlar UTC saqlanadi — parametrni tz'siz UTC matn qilib beramiz (session TZ'ga bog'liq emas). */
  private utcTs(d: Date): string {
    return d.toISOString().replace('T', ' ').replace('Z', '');
  }

  // ─── 1. Bank sync ─────────────────────────────────────────────────────
  private async checkBankSync(now: Date): Promise<CheckBody> {
    const accounts = await this.prisma.bankAccount.findMany({
      where: {
        syncEnabled: true,
        credential: { isActive: true },
        bank: { isActive: true, syncIntervalMinutes: { gt: 0 }, apiKind: { in: [...SYNC_API_KINDS] } },
      },
      select: {
        id: true,
        accountNo: true,
        lastSyncedAt: true,
        bank: { select: { code: true, name: true, syncIntervalMinutes: true } },
      },
    });
    if (!accounts.length) return { level: 'ok', summary: "Avto-sync yoqilgan faol hisob yo'q" };

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const logs = await this.readOnly<Array<{ account_id: string; status: string; fetched: number; errors: number; started_at: Date }>>(
      Prisma.sql`
        SELECT account_id, status, fetched, errors, started_at FROM (
          SELECT account_id, status::text AS status, fetched, errors, started_at,
                 ROW_NUMBER() OVER (PARTITION BY account_id ORDER BY started_at DESC) AS rn
          FROM sync_logs
          WHERE account_id IN (${Prisma.join(accounts.map((a) => a.id))})
            AND started_at > ${this.utcTs(since)}::timestamp
        ) t
        WHERE rn <= 3
        ORDER BY account_id, started_at DESC`,
    );
    const byAcc = new Map<string, typeof logs>();
    for (const l of logs) {
      const arr = byAcc.get(l.account_id) || [];
      arr.push(l);
      byAcc.set(l.account_id, arr);
    }

    const workHours = tkHour(now) >= 8 && tkHour(now) < 22;
    const items: Item[] = [];
    let oldestOkMs = 0;
    for (const a of accounts) {
      const label = `${a.bank.name || a.bank.code} ${shortAcc(a.accountNo)}`;
      const interval = Number(a.bank.syncIntervalMinutes) || 5;
      const warnAfter = 3 * interval;
      const critAfter = Math.max(warnAfter, 60);
      const ageMs = a.lastSyncedAt ? now.getTime() - new Date(a.lastSyncedAt).getTime() : Infinity;
      const ageMin = ageMs / 60_000;
      const l = byAcc.get(a.id) || [];
      const latest = l[0];
      const lastDone = l.find((x) => x.status !== 'RUNNING');

      let flagged = false;
      if (lastDone && lastDone.status === 'PARTIAL' && Number(lastDone.fetched) === 0 && Number(lastDone.errors) >= 10) {
        items.push({ level: 'critical', text: `${label}: login shubhasi (oxirgi sync PARTIAL, 0 ta olindi, ${lastDone.errors} xato)` });
        flagged = true;
      }
      if (ageMin > critAfter && workHours) {
        items.push({ level: 'critical', text: `${label}: ${dur(ageMs)} sync yo'q` });
        flagged = true;
      } else if (ageMin > warnAfter) {
        items.push({ level: 'warn', text: `${label}: ${dur(ageMs)} sync yo'q (interval ${interval} daqiqa)` });
        flagged = true;
      }
      if (latest && latest.status === 'RUNNING' && now.getTime() - new Date(latest.started_at).getTime() > 15 * 60_000) {
        items.push({ level: 'warn', text: `${label}: sync ${dur(now.getTime() - new Date(latest.started_at).getTime())} dan beri RUNNING (uzilgan bo'lishi mumkin)` });
        flagged = true;
      }
      if (l.length >= 3 && l.slice(0, 3).every((x) => x.status === 'FAILED')) {
        items.push({ level: 'warn', text: `${label}: oxirgi 3 ta sync FAILED` });
        flagged = true;
      }
      if (!flagged && Number.isFinite(ageMs)) oldestOkMs = Math.max(oldestOkMs, ageMs);
    }

    if (!items.length) {
      return { level: 'ok', summary: `${accounts.length} ta hisob sog' (eng eski sync ${dur(oldestOkMs)} oldin)` };
    }
    const level = worst(items);
    const bad = new Set(items.map((i) => i.text.split(':')[0])).size;
    return {
      level,
      summary: summarize(items, `${bad} ta hisobda muammo: `),
      details: [...items].sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level]).map((i) => `[${i.level}] ${i.text}`),
    };
  }

  // ─── 2. XonPay ────────────────────────────────────────────────────────
  private async checkXonpay(now: Date): Promise<CheckBody> {
    const s = await this.settings(['xonpay.cron.enabled', 'xonpay.cron.intervalMinutes']);
    if (s['xonpay.cron.enabled'] === 'false') return { level: 'ok', summary: "Cron o'chirilgan (tekshirilmaydi)" };
    const iv = parseInt(String(s['xonpay.cron.intervalMinutes'] || ''), 10);
    const interval = Number.isFinite(iv) && iv >= 1 && iv <= 1440 ? iv : 60;

    const [lastSuccess, recent] = await Promise.all([
      this.prisma.xonpaySyncLog.findFirst({
        where: { status: 'success' },
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, finishedAt: true, inserted: true, matched: true },
      }),
      this.prisma.xonpaySyncLog.findMany({
        where: { status: { in: ['success', 'failed'] } },
        orderBy: { startedAt: 'desc' },
        take: 15,
        select: { status: true, errorMessage: true, startedAt: true },
      }),
    ]);
    // Restart "orphan" qatorlari — soxta signal
    const real = recent.filter((r) => !(r.status === 'failed' && XONPAY_ORPHAN_RE.test(r.errorMessage || '')));
    let failedRun = 0;
    for (const r of real) {
      if (r.status !== 'failed') break;
      failedRun++;
    }
    const details: string[] = real.slice(0, 5).map((r) =>
      `${tkStamp(r.startedAt)} ${r.status}${r.status === 'failed' ? `: ${cleanErr(r.errorMessage, 100)}` : ''}`);

    if (failedRun >= 2) {
      return {
        level: 'critical',
        summary: `Ketma-ket ${failedRun} ta sync xato: ${cleanErr(real[0].errorMessage, 120)}`,
        details,
      };
    }
    if (!lastSuccess) return { level: 'warn', summary: 'Muvaffaqiyatli sync topilmadi', details };
    const at = lastSuccess.finishedAt || lastSuccess.startedAt;
    const ageMs = now.getTime() - new Date(at).getTime();
    if (ageMs > 3 * interval * 60_000) {
      return { level: 'warn', summary: `Oxirgi muvaffaqiyatli sync ${dur(ageMs)} oldin (interval ${interval} daqiqa)`, details };
    }
    return {
      level: 'ok',
      summary: `Oxirgi muvaffaqiyatli sync ${dur(ageMs)} oldin (+${lastSuccess.inserted} yangi, ${lastSuccess.matched} mos)`,
      details,
    };
  }

  // ─── 3. Google eksport ────────────────────────────────────────────────
  private async checkGoogleExport(now: Date): Promise<CheckBody> {
    const since = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const rows = await this.readOnly<Array<{ sheet_id: string; sheet_name: string; status: string; error: string | null; started_at: Date }>>(
      Prisma.sql`
        SELECT sheet_id, sheet_name, status, error, started_at FROM (
          SELECT sheet_id, sheet_name, status, error, started_at,
                 ROW_NUMBER() OVER (PARTITION BY sheet_id ORDER BY started_at DESC) AS rn
          FROM export_cron_logs
          WHERE started_at > ${this.utcTs(since)}::timestamp
        ) t
        WHERE rn <= 2
        ORDER BY sheet_id, started_at DESC`,
    );
    const bySheet = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = bySheet.get(r.sheet_id) || [];
      arr.push(r);
      bySheet.set(r.sheet_id, arr);
    }
    if (!bySheet.size) return { level: 'ok', summary: "Oxirgi 3 kunda eksport ishga tushmagan" };

    const items: Item[] = [];
    for (const list of bySheet.values()) {
      const [a, b] = list;
      const name = `"${cut(a.sheet_name || a.sheet_id, 40)}"`;
      if (a.status === 'error' && b?.status === 'error') {
        items.push({ level: 'critical', text: `${name}: ketma-ket 2 ta xato — ${cleanErr(a.error, 100)}` });
      } else if (a.status === 'error') {
        items.push({ level: 'warn', text: `${name}: oxirgi eksport xato — ${cleanErr(a.error, 100)}` });
      }
    }
    if (!items.length) return { level: 'ok', summary: `${bySheet.size} ta sheet, oxirgi eksportlar muvaffaqiyatli` };
    return { level: worst(items), summary: summarize(items), details: items.map((i) => `[${i.level}] ${i.text}`) };
  }

  // ─── 4. SHMITD ────────────────────────────────────────────────────────
  private async checkShmitd(): Promise<CheckBody> {
    const s = await this.settings(['shmitd.enabled']);
    if (s['shmitd.enabled'] !== '1') return { level: 'ok', summary: "O'chirilgan (tekshirilmaydi)" };
    const last = await this.prisma.shmitdLog.findFirst({
      orderBy: { sentAt: 'desc' },
      select: { status: true, error: true, sentAt: true, targetDate: true, totalCount: true },
    });
    if (!last) return { level: 'ok', summary: "Hali hisobot yuborilmagan" };
    if (last.status === 'error') {
      return { level: 'critical', summary: `${last.targetDate} hisoboti xato (${tkStamp(last.sentAt)}): ${cleanErr(last.error, 120)}` };
    }
    return { level: 'ok', summary: `Oxirgi hisobot ${last.targetDate}: ${last.status}, ${last.totalCount} ta (${tkStamp(last.sentAt)})` };
  }

  // ─── 5. Bank sverka ───────────────────────────────────────────────────
  private async checkSverka(now: Date): Promise<CheckBody> {
    const s = await this.settings(['sverka.telegram.notifiedToday']);
    const store = parseJson(s['sverka.telegram.notifiedToday']);
    const today = tkDay(now);
    if (!store || store.date !== today || !store.accounts || typeof store.accounts !== 'object') {
      return { level: 'ok', summary: "Bugun ochiq farq yo'q (Hamkorbank sverka qilinmaydi)" };
    }
    const open = Object.values<any>(store.accounts).filter((a) => a && !a.dismissed);
    if (!open.length) return { level: 'ok', summary: "Bugungi farqlar yo'q yoki yopilgan" };
    open.sort((a, b) => Math.abs(Number(b.totalFarq) || 0) - Math.abs(Number(a.totalFarq) || 0));
    const level: CheckLevel = tkHour(now) >= 20 ? 'critical' : 'warn';
    const items: Item[] = open.map((a) => ({
      level,
      text: `${cut(a.bankName || '', 30)} ${shortAcc(a.accountNo)} (${fmtSum(a.totalFarq)} so'm)`.trim(),
    }));
    return {
      level,
      summary: summarize(items, `${open.length} ta hisobda farq ochiq${level === 'critical' ? ' (soat 20:00 dan keyin)' : ''}: `),
      details: open.map((a) => `${cut(a.bankName || '', 30)} ${shortAcc(a.accountNo)}: ${fmtSum(a.totalFarq)} so'm${a.culprit ? `, sabab: ${cut(a.culprit, 80)}` : ''}`),
    };
  }

  // ─── 6. CRM sverka ────────────────────────────────────────────────────
  private async checkCrmSverka(): Promise<CheckBody> {
    const s = await this.settings(['crmSverka.lastRun']);
    const st = parseJson(s['crmSverka.lastRun']);
    if (!st || !st.status) return { level: 'ok', summary: "Hali ishga tushmagan" };
    if (st.status === 'error' || st.status === 'crashed') {
      const why = st.status === 'crashed' ? "jarayon uzilgan (odatda server restart)" : cleanErr(st.error || st.warning, 120);
      return { level: 'warn', summary: `Oxirgi run ${st.status} (${tkStamp(st.startedAt)}): ${why}` };
    }
    if (st.status === 'running') return { level: 'ok', summary: `Hozir ishlamoqda (boshlangan ${tkStamp(st.startedAt)})` };
    const extra = st.warning ? `, ogohlantirish: ${cleanErr(st.warning, 80)}` : '';
    return {
      level: 'ok',
      summary: `Oxirgi run ${tkStamp(st.finishedAt || st.startedAt)}: CRM ${st.crmCount ?? '-'} ta, bizda ${st.ourCount ?? '-'} ta${extra}`,
    };
  }

  // ─── 7. API 5xx ───────────────────────────────────────────────────────
  private async checkApiErrors(now: Date): Promise<CheckBody> {
    const since = new Date(now.getTime() - 15 * 60_000);
    const where = { createdAt: { gte: since }, statusCode: { gte: 500 } };
    const [n5xx, total] = await Promise.all([
      this.prisma.apiRequestLog.count({ where }),
      this.prisma.apiRequestLog.count({ where: { createdAt: { gte: since } } }),
    ]);
    if (n5xx === 0) return { level: 'ok', summary: `Oxirgi 15 daqiqada 5xx yo'q (${total} ta so'rov)` };
    const top = await this.prisma.apiRequestLog.groupBy({
      by: ['path'],
      where,
      _count: { _all: true },
      orderBy: { _count: { path: 'desc' } },
      take: 3,
    });
    const details = top.map((t: any) => `${cut(t.path, 100)}: ${t._count?._all ?? 0} ta`);
    const level: CheckLevel = n5xx > 5 ? 'critical' : 'ok';
    return {
      level,
      summary: `Oxirgi 15 daqiqada 5xx: ${n5xx} ta (${total} ta so'rovdan)${top[0] ? `, eng ko'p: ${cut(top[0].path, 80)}` : ''}`,
      details,
    };
  }

  // ─── 8. Muvaffaqiyatsiz kirishlar ─────────────────────────────────────
  private async checkFailedLogins(now: Date): Promise<CheckBody> {
    const since = new Date(now.getTime() - 15 * 60_000);
    const n = await this.prisma.auditLog.count({ where: { createdAt: { gte: since }, module: 'auth', success: false } });
    if (n >= 10) return { level: 'warn', summary: `Oxirgi 15 daqiqada ${n} ta muvaffaqiyatsiz kirish urinishi` };
    return { level: 'ok', summary: n ? `Oxirgi 15 daqiqada ${n} ta muvaffaqiyatsiz kirish` : "Oxirgi 15 daqiqada muvaffaqiyatsiz kirish yo'q" };
  }

  // ─── 9. Deploy ────────────────────────────────────────────────────────
  private async checkDeploy(): Promise<CheckBody> {
    let st: any = null;
    try {
      const svc = this.moduleRef.get(DeployService, { strict: false });
      if (svc) st = await svc.status();
    } catch {
      st = null;
    }
    if (!st) st = await this.fetchDeployStatus();
    if (!st) return { level: 'unknown', summary: "Deploy holatini o'qib bo'lmadi" };
    if (st.ok === false) return { level: 'unknown', summary: `Deploy logi o'qilmadi: ${cleanErr(st.error, 100)}` };

    const commit = st.currentCommit ? `, commit ${String(st.currentCommit).slice(0, 8)}` : '';
    switch (st.state) {
      case 'failed': {
        const err = st.error ? `; ${cleanErr(st.error, 120)}` : '';
        return {
          level: 'critical',
          summary: `Oxirgi deploy xato bilan tugadi (${deployStamp(st.finishedAt)}): ${cleanErr(st.message, 100)}${err}`,
        };
      }
      case 'running':
        return { level: 'ok', summary: `Deploy ketmoqda${st.currentPhase ? ` (${cut(st.currentPhase, 40)})` : ''}, ${st.elapsedSeconds || 0} s` };
      case 'success':
        return { level: 'ok', summary: `Oxirgi deploy muvaffaqiyatli (${deployStamp(st.finishedAt)}${commit})` };
      default:
        return { level: 'ok', summary: `Deploy logida yakunlangan yozuv yo'q${commit}` };
    }
  }

  /** Zaxira: lokal HTTP (DeployService topilmasa). Restart paytida "connection refused" — 1 marta qayta urinish. */
  private async fetchDeployStatus(): Promise<any> {
    const port = Number(process.env.PORT) || 3001;
    for (let i = 0; i < 2; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/_deploy/status`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) return await res.json();
      } catch {
        /* keyingi urinish */
      }
      if (i === 0) await new Promise((r) => setTimeout(r, 1500));
    }
    return null;
  }

  // ─── 10. Disk ─────────────────────────────────────────────────────────
  private async checkDisk(): Promise<CheckBody> {
    const statfs = (fs.promises as any).statfs;
    if (typeof statfs !== 'function') return { level: 'unknown', summary: "statfs mavjud emas (Node 18.15+ kerak)" };
    const s = await statfs.call(fs.promises, this.config.repoDir());
    const bsize = Number(s.bsize) || 0;
    const blocks = Number(s.blocks) || 0;
    const used = (blocks - Number(s.bfree)) * bsize;
    const avail = Number(s.bavail) * bsize;
    if (!blocks || used + avail <= 0) return { level: 'unknown', summary: "Disk hajmi aniqlanmadi" };
    const pct = (used / (used + avail)) * 100;
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1);
    const level: CheckLevel = pct > 92 ? 'critical' : pct > 85 ? 'warn' : 'ok';
    return { level, summary: `Band: ${pct.toFixed(1)}% (bo'sh ${gb(avail)} GB, jami ${gb(blocks * bsize)} GB)` };
  }

  // ─── 11. Xotira ───────────────────────────────────────────────────────
  private async checkMemory(): Promise<CheckBody> {
    const total = os.totalmem();
    let avail = os.freemem();
    // Linux: MemAvailable (kesh ham bo'shatiladigan xotira) — freemem eski Node'da faqat MemFree
    if (process.platform === 'linux') {
      try {
        const txt = await fs.promises.readFile('/proc/meminfo', 'utf8');
        const m = txt.match(/^MemAvailable:\s+(\d+)\s*kB/m);
        if (m) avail = Number(m[1]) * 1024;
      } catch {
        /* freemem bilan qolamiz */
      }
    }
    const pct = total ? (avail / total) * 100 : 0;
    const mb = (n: number) => Math.round(n / 1024 ** 2);
    const load = os.loadavg().map((x) => x.toFixed(2)).join(' / ');
    const level: CheckLevel = pct < 5 ? 'warn' : 'ok';
    return {
      level,
      summary: `Bo'sh: ${pct.toFixed(1)}% (${mb(avail)} MB / ${mb(total)} MB), load ${load}`,
      details: [
        `Server uptime: ${dur(os.uptime() * 1000)}`,
        `Backend jarayoni uptime: ${dur(process.uptime() * 1000)}`,
        `Node: ${process.version}`,
        `Backend RSS: ${mb(process.memoryUsage().rss)} MB`,
      ],
    };
  }
}
