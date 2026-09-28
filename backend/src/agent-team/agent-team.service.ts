/**
 * Agent Support (@TRanSupport_bot jamoasi) — web kuzatuv xizmati.
 *
 * Python bot (repo ildizidagi agents/*.py) PostgreSQL'ning ALOHIDA `agents` sxemasiga yozadi.
 * Bu xizmat o'sha sxemani FAQAT O'QIYDI (har SELECT READ ONLY tranzaksiyada, 8 s statement_timeout).
 * Yagona yozuv: agents.kv_store dagi `agent_enabled_<nom>` ('1' | '0') — setAgentEnabled().
 *
 * Qoidalar:
 *  - Jadval/ustun nomlari SQL matnida qattiq yozilgan, qiymatlar faqat parametr (Prisma.sql).
 *  - SQL'da now() ishlatilmaydi (DB soati skew) — vaqt chegaralari JS'dan ::timestamptz parametr.
 *  - Bot o'rnatilmagan (sxema/jadval yo'q) — xato emas: installed=false va bo'sh qiymatlar, HTTP 200.
 *  - Sir qiymatlari (token, parol, lease owner, reja hashes, chat tarixi kv matni) javobga tushmaydi.
 *  - Fayllar faqat oq ro'yxatdan (support_facts.json, agents/memory/ nomlari, daily/YYYY-MM-DD.md).
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import {
  AGENT_NAMES,
  AGENT_TABLES,
  AgentBrief,
  AgentLastError,
  AgentName,
  AgentRunRow,
  AgentStats,
  AgentTeamAgents,
  AgentTeamChat,
  AgentTeamConstants,
  AgentTeamEnv,
  AgentTeamFactsSection,
  AgentTeamHealth,
  AgentTeamMemoryFile,
  AgentTeamMemoryFiles,
  AgentTeamMemoryLog,
  AgentTeamOverview,
  AgentTeamPlans,
  AgentTeamPromises,
  AgentTeamRun,
  AgentTeamRuns,
  AgentTeamSettings,
  AgentTeamSettingsAgent,
  AgentTeamTasks,
  AlertRow,
  BotLiveStatus,
  BotState,
  CHAT_ROLES,
  ChatRow,
  DAILY_FILE_RE,
  DayPoint,
  FACTS_SECTIONS,
  FactsBrief,
  FactsFreshness,
  FactsSection,
  FactsState,
  HEALTH_COMPONENTS,
  HEALTH_STATUSES,
  HealthBrief,
  HealthComponentState,
  HealthStatus,
  InstallState,
  KvKeyKind,
  KvKeyState,
  MEMORY_AGENT_FILES,
  MEMORY_CORE_FILES,
  MEMORY_SOURCES,
  MemoryFileGroup,
  MemoryFileMeta,
  MemoryLogRow,
  NotInstalledReason,
  PLAN_EVENT_KINDS,
  PendingCounts,
  PendingMemoryWrite,
  PendingPlan,
  PlanEditPreview,
  PlanEvent,
  PlanEventKind,
  PlanExecState,
  PromiseRow,
  RUN_BLOCKED_STATUSES,
  RUN_SOURCES,
  RUN_STATUSES,
  RUN_UNCOUNTED_STATUSES,
  RunCounts,
  SecretsPresence,
  SystemEventKind,
  TASK_STATUSES,
  TaskRow,
  TaskStatus,
  TodayStats,
  ToggleAgentResponse,
} from './agent-team.types';

// ---------------------------------------------------------------------------
// Konstantalar (agents/contract.py va checker_worker.py bilan mos)
// ---------------------------------------------------------------------------
const BOT_USERNAME = '@TRanSupport_bot';
const BOT_SERVICE = 'xon-tranzactions-leader';
const OWNER_TG_ID = '1954122311'; // C.EGASI_TG_ID

const TZ_OFFSET_MS = 5 * 3600_000; // Toshkent UTC+5 (DST yo'q)
const DAY_MS = 86_400_000;

const HEARTBEAT_S = 60;
const HEARTBEAT_WARN_S = 180; // checker_worker: warn 3 daq
const HEARTBEAT_ERROR_S = 600; // checker_worker: error 10 daq
const CHECKER_INTERVAL_S = 4 * 3600; // C.CHECKER_INTERVAL_S
const CHECKER_START_DELAY_S = 45;
const FACTS_INTERVAL_S = 300; // C.FACTS_INTERVAL_S
const FACTS_STALE_S = 900; // C.FACTS_ESKI_S
const FACTS_OLD_S = 1800;
const APPROVAL_TTL_S = 600; // C.APPROVAL_TTL_S
const PROMISE_REMINDER_S = 1500; // 25 daq
const PROMISE_MAX_REMINDERS = 3;
const HISTORY_CONTEXT_N = 12;
const IN_PROGRESS_WINDOW_MS = 30 * 60_000;
const CHAT_RETENTION_DAYS = 30;
const RETENTION_DAYS: Record<string, number> = {
  agent_chat_log: 30,
  agent_runs: 90,
  agent_health: 30,
  agent_alert_log: 30,
  agent_tasks: 90,
  agent_memory: 180,
};

const MODEL_STRONG_DEFAULT = 'claude-opus-5-5';
const MODEL_FAST_DEFAULT = 'claude-sonnet-5';
const DAILY_CAP_DEFAULT = 200;
const TIMEOUT_DEFAULT_S = 180;
const TIMEOUT_MIN_S = 10;

const INSTALL_CACHE_MS = 15_000;
const ENV_FILE_MAX_BYTES = 256 * 1024; // backend/.env (bot uni to'liq o'qiydi) — JSON kalitlar bilan ham sig'sin
const FACTS_MAX_BYTES = 8 * 1024 * 1024;
const MEMORY_READ_MAX = 256 * 1024;
const MEMORY_DAILY_MAX = 60;
const FACTS_REL_PATH = 'agents/state/support_facts.json';
const MEMORY_REL_DIR = 'agents/memory';

/** contract.MEMORY_FILES + AGENT_MEMORY_TPL: promptga qo'shilish chegarasi va qismi. */
const MEMORY_INJECT: Record<string, { limit: number; mode: 'head' | 'tail' }> = {
  'INDEX.md': { limit: 12000, mode: 'head' },
  'leader.md': { limit: 8000, mode: 'head' },
  'leader-runtime.md': { limit: 8000, mode: 'tail' },
  'learned.md': { limit: 6000, mode: 'tail' },
  'support.md': { limit: 8000, mode: 'head' },
  'checker.md': { limit: 8000, mode: 'head' },
  'teacher.md': { limit: 8000, mode: 'head' },
};
/** 256 KB dan katta bo'lsa OXIRI o'qiladigan fayllar (qolganlari — boshi). */
const MEMORY_TAIL_FILES = new Set(['learned.md', 'leader-runtime.md']);
const DAILY_NAME_RE = /^\d{4}-\d{2}-\d{2}\.md$/;

/** kv_store prefiks guruhlari (health.kv). SQL'dagi regex bilan bir xil tartib. */
const KV_GROUPS: { prefix: string; kind: KvKeyKind }[] = [
  { prefix: 'agent_enabled_', kind: 'flag' },
  { prefix: 'sup_appr_', kind: 'counter' },
  { prefix: 'sup_run_', kind: 'counter' },
  { prefix: 'sup_done_', kind: 'counter' },
  { prefix: 'tw_appr_', kind: 'counter' },
  { prefix: 'tw_run_', kind: 'counter' },
  { prefix: 'facts_cache_', kind: 'counter' },
];
/** health.kv — aniq kalitlar, qat'iy tartibda. */
const KV_EXACT: { key: string; kind: KvKeyKind }[] = [
  { key: 'leader_heartbeat', kind: 'heartbeat' },
  { key: 'agents_rate_limit_until', kind: 'timestamp' },
  { key: 'checker:last_full_run', kind: 'timestamp' },
  { key: 'teacher_daily_last_run', kind: 'date' },
  { key: 'cleanup_last', kind: 'timestamp' },
  { key: 'sup_exec_active', kind: 'lease' },
  { key: 'sup_exec_lock', kind: 'lease' },
  { key: 'checker_lease', kind: 'lease' },
  { key: 'teacher_daily_lease', kind: 'lease' },
  { key: 'facts_lease', kind: 'lease' },
  { key: 'leader_chat_history', kind: 'history' },
];
const OVERVIEW_KV = [
  'leader_heartbeat',
  'agents_rate_limit_until',
  'checker:last_full_run',
  'teacher_daily_last_run',
  'cleanup_last',
  'sup_exec_active',
];

const CHECK_SEVERITY: Record<HealthStatus, number> = { ok: 0, unknown: 1, warn: 2, error: 3 };

/** SISTEMA matni tasniflagichi (contract.py SIS_* shablonlari). Tartib muhim. */
const APOS = "['‘’ʻʼ]";
const SYSTEM_KIND_RULES: { kind: SystemEventKind; re: RegExp }[] = [
  { kind: 'plan_rejected', re: /^Support REJA RAD ETILDI/ },
  { kind: 'plan_rad', re: /^Support REJA RAD — ([\s\S]*)$/ },
  { kind: 'plan_env', re: new RegExp(`^Support \\.env so${APOS}radi`) },
  { kind: 'plan_offered', re: new RegExp(`^Support ruxsat so${APOS}rayapti — (\\d+) fayl, xavf: (\\S+)`) },
  { kind: 'plan_applied', re: /^Support APPROVED bajarildi — commit (\S+), (\d+) fayl/ },
  { kind: 'plan_failed', re: /^Support APPROVED BAJARILMADI — ([\s\S]+)$/ },
  { kind: 'agent_ok', re: /^(\S+) agent muvaffaqiyatli javob berdi/ },
  { kind: 'agent_empty', re: new RegExp(`^(\\S+) agent chaqirildi ammo bo${APOS}sh javob keldi`) },
  { kind: 'agent_not_called', re: /^(\S+) agent CHAQIRILMADI — / },
  { kind: 'agent_error', re: /^(\S+) agent XATOGA UCHRADI: / },
  { kind: 'memory_code', re: /^kod tomonidan yozildi/ },
  { kind: 'memory_teacher', re: /^teacher xotiraga yozdi/ },
  { kind: 'memory_pending', re: /^teacher yozuvi tasdiq kutmoqda/ },
  { kind: 'memory_rad', re: /^teacher yozuvi RAD — / },
];

const NOT_INSTALLED_MSG = "agents sxemasi yo'q — bot hali o'rnatilmagan";

// ---------------------------------------------------------------------------
// DB qator tiplari
// ---------------------------------------------------------------------------
interface KvRow {
  k: string;
  value: string | null;
  updated_at: Date;
}
interface TodayRow {
  agent: string;
  status: string;
  n: number;
  dsum: number | null;
  dn: number;
  last: Date | null;
}
interface LastRunRow {
  agent: string;
  ts: Date;
  status: string;
  source: string | null;
}
interface AgentCountRow {
  agent: string;
  n: number;
}
interface HealthLatestRow {
  component: string;
  status: string;
  message?: string | null;
  details?: string | null;
  ts: Date;
}
interface RunDbRow {
  id: bigint | number;
  ts: Date;
  agent: string;
  model: string | null;
  status: string;
  source: string | null;
  duration_ms: number | null;
  returncode: number | null;
  task_preview: string | null;
  response_preview: string | null;
  error: string | null;
}
interface StatusCountRow {
  status: string;
  n: number;
}

interface FactsSnapshot {
  exists: boolean;
  sizeBytes: number | null;
  mtimeMs: number | null;
  json: Record<string, unknown> | null;
  parseError: boolean;
}

interface EnvResolved {
  env: AgentTeamEnv;
  timeouts: Record<AgentName, number>;
}

// ---------------------------------------------------------------------------
// Yordamchilar
// ---------------------------------------------------------------------------
function tashkentDay(d: Date): string {
  return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
function dayStartUtc(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - TZ_OFFSET_MS);
}
function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
/** 'YYYY-MM-DD' va haqiqiy sana (2026-02-30 emas). */
function validDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
}
/** timestamptz parametr (sessiya TimeZone'iga bog'liq emas). */
function tz(d: Date): Prisma.Sql {
  return Prisma.sql`${d.toISOString()}::timestamptz`;
}
function whereOf(conds: Prisma.Sql[]): Prisma.Sql {
  return conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
}
/** Date | satr -> ISO (UTC) yoki null. */
function iso(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  const t = d.getTime();
  return Number.isFinite(t) ? d.toISOString() : null;
}
function isoReq(v: unknown): string {
  return iso(v) ?? new Date(0).toISOString();
}
const ISO_LIKE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?)?$/;
/** Bot yozgan ISO vaqt (Python isoformat) -> ms. Date.parse'ning erkin parserini chetlab o'tadi ('1' -> 2001 kabi). */
function parseIsoMs(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s || s.length > 40 || !ISO_LIKE_RE.test(s)) return null;
  const t = Date.parse(s.replace(' ', 'T'));
  return Number.isFinite(t) ? t : null;
}
function msIso(ms: number | null): string | null {
  return ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString();
}
function num(v: unknown): number {
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'bigint' ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}
/** `from` dan boshlab `count` ta kod nuqtadan keyingi UTF-16 indeks (surrogate jufti bitta belgi). */
function cpIndex(s: string, from: number, count: number): number {
  let i = from;
  for (let n = 0; n < count && i < s.length; n++) {
    const c = s.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 2 : 1;
  }
  return i;
}
/** Satr boshidan <= max kod nuqta; surrogate jufti bo'linmaydi (qo'shimcha belgisiz). */
function cpHead(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, cpIndex(s, 0, max));
}
/**
 * <= max kod nuqta (bot Python len() bilan cheklaydi — mos). Surrogate jufti bo'linmaydi.
 * Kesilsa max-1 belgi + '…' (jimgina kesilmaydi: UI va nusxada qisqartirilgani ko'rinadi).
 */
function clip(v: unknown, max: number): string {
  const s = typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);
  if (s.length <= max) return s; // UTF-16 uzunligi >= kod nuqtalari soni
  if (max <= 0) return '';
  const keep = cpIndex(s, 0, max - 1);
  if (cpIndex(s, keep, 1) >= s.length) return s; // jami <= max kod nuqta
  return `${s.slice(0, keep)}…`;
}
function clipOrNull(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  return clip(v, max);
}
/** Query qiymati -> satr (massiv bo'lsa vergul bilan). */
function qStr(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(',').trim();
  return '';
}
function intParam(v: unknown, def: number, min: number, max: number): number {
  const s = qStr(v);
  if (!/^\d{1,9}$/.test(s)) return def;
  return Math.min(max, Math.max(min, parseInt(s, 10)));
}
function oneOf<T extends string>(v: unknown, list: readonly T[]): T | null {
  const s = qStr(v);
  return (list as readonly string[]).includes(s) ? (s as T) : null;
}
function dayParam(v: unknown): string | null {
  const s = qStr(v);
  return validDay(s) ? s : null;
}
/** ILIKE naqshi: trim, <=100 belgi, % _ \ ekranlangan. Bo'sh -> null. */
function likePattern(v: unknown): string | null {
  const s = cpHead(qStr(v), 100);
  if (!s) return null;
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function safeJson(v: string | null | undefined): unknown {
  if (!v) return undefined;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}
function isAgentName(v: string): v is AgentName {
  return (AGENT_NAMES as readonly string[]).includes(v);
}
function emptyRunCounts(): RunCounts {
  return { total: 0, ok: 0, empty: 0, error: 0, timeout: 0, blocked: 0 };
}
function runCountsOf(m: Map<string, number>): RunCounts {
  let total = 0;
  for (const n of m.values()) total += n;
  const g = (s: string) => m.get(s) ?? 0;
  return {
    total,
    ok: g('ok'),
    empty: g('empty'),
    error: g('error'),
    timeout: g('timeout'),
    blocked: RUN_BLOCKED_STATUSES.reduce((a, s) => a + g(s), 0),
  };
}
function uncountedOf(m: Map<string, number>): number {
  return RUN_UNCOUNTED_STATUSES.reduce((a, s) => a + (m.get(s) ?? 0), 0);
}
function bump(m: Map<string, number>, k: string, n: number) {
  m.set(k, (m.get(k) ?? 0) + n);
}
function healthStatusOf(v: unknown): HealthStatus {
  return (HEALTH_STATUSES as readonly string[]).includes(String(v)) ? (v as HealthStatus) : 'unknown';
}
function liveStatusOf(ageSec: number | null): BotLiveStatus {
  if (ageSec === null) return 'unknown';
  if (ageSec <= HEARTBEAT_WARN_S) return 'live';
  if (ageSec <= HEARTBEAT_ERROR_S) return 'stale';
  return 'offline';
}
/** kv enabled qiymati: yozuv yo'q yoki '0' emas -> yoqilgan (runner.py: enabled.strip() == "0"). */
function enabledOf(row: KvRow | undefined): boolean {
  return !(row && row.value !== null && row.value.trim() === '0');
}
function enabledRawOf(row: KvRow | undefined): string | null {
  return row && row.value !== null ? row.value.trim().slice(0, 8) : null;
}
/** kv lease qiymati {"owner", "until"} — owner javobga chiqmaydi, faqat ref (8 belgi) uchun. */
function leaseOf(row: KvRow | undefined, nowMs: number): { active: boolean; untilMs: number | null; ref: string | null } {
  const obj = safeJson(row?.value);
  if (!isPlainObject(obj)) return { active: false, untilMs: null, ref: null };
  const untilMs = parseIsoMs(obj.until);
  const owner = typeof obj.owner === 'string' ? obj.owner : null;
  return { active: untilMs !== null && untilMs > nowMs, untilMs, ref: owner ? owner.slice(0, 8) : null };
}
/** Tasdiq payload yaratilgan vaqti: created_ts (epoch s) -> created (ISO). O'qilmasa null. */
function createdMsOf(createdTs: unknown, created: unknown): number | null {
  const ts = typeof createdTs === 'number' ? createdTs : typeof createdTs === 'string' ? Number(createdTs) : NaN;
  if (Number.isFinite(ts) && ts > 0) return ts * 1000;
  return parseIsoMs(created);
}
function classifySystem(text: string): { kind: SystemEventKind; m: RegExpMatchArray | null } {
  for (const r of SYSTEM_KIND_RULES) {
    const m = text.match(r.re);
    if (m) return { kind: r.kind, m };
  }
  return { kind: 'other', m: null };
}
/** SISTEMA ichki matni: agar "[SISTEMA: ...]" o'rami saqlangan bo'lsa olib tashlanadi. */
function systemInner(text: string): string {
  if (text.startsWith('[SISTEMA: ') && text.endsWith(']')) return text.slice(10, -1);
  return text;
}
/** config.parse_env_text bilan bir xil: # izoh, 'export ', '..' / ".." (""-da \n \" \\). */
function parseEnvText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lineRe = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(lineRe);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === "'" || val[0] === '"')) {
      const q = val[0];
      val = val.slice(1, -1);
      if (q === '"') val = val.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else {
      const hashAt = val.indexOf(' #');
      if (hashAt >= 0) val = val.slice(0, hashAt).trimEnd();
    }
    out[key] = val;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Xizmat
// ---------------------------------------------------------------------------
@Injectable()
export class AgentTeamService {
  private readonly logger = new Logger(AgentTeamService.name);

  private readonly agentsDir = path.resolve(process.env.AGENTS_DIR || path.resolve(process.cwd(), '..', 'agents'));
  private readonly memoryDir = path.join(this.agentsDir, 'memory');
  private readonly factsPath = path.join(this.agentsDir, 'state', 'support_facts.json');

  private installCache: { at: number; state: InstallState } | null = null;
  private installInflight: Promise<InstallState> | null = null;
  private factsCache: { key: string; snap: FactsSnapshot } | null = null;
  private envFileCache: { file: string; key: string; vars: Record<string, string> } | null = null;
  private readonly warnedAt = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  // =========================================================================
  // Infratuzilma: o'rnatish holati, faqat-o'qish o'rami, xato tasnifi
  // =========================================================================

  /** Barcha SELECT'lar bitta READ ONLY tranzaksiyada (bitta ulanish), 8 s statement_timeout. */
  private async ro<T extends readonly Prisma.PrismaPromise<unknown>[]>(
    ...queries: T
  ): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
    const res = await this.prisma.$transaction([
      this.prisma.$executeRawUnsafe('SET TRANSACTION READ ONLY'),
      this.prisma.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'"),
      ...queries,
    ]);
    return res.slice(2) as unknown as { -readonly [K in keyof T]: Awaited<T[K]> };
  }

  private pgCode(e: unknown): string | null {
    const err = e as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
    const metaCode = err?.meta?.code;
    if (typeof metaCode === 'string' && /^[0-9A-Z]{5}$/.test(metaCode)) return metaCode;
    const m = String(err?.message ?? '').match(/\b(42P01|3F000|42501)\b/);
    return m ? m[1] : null;
  }

  private reasonOf(e: unknown, where: string): NotInstalledReason {
    const code = this.pgCode(e);
    if (code === '42P01') return 'no_tables';
    if (code === '3F000') return 'no_schema';
    const reason: NotInstalledReason = code === '42501' ? 'no_permission' : 'db_error';
    this.warnThrottled(
      `${where}:${reason}`,
      `agent-team ${where}: ${reason}${code ? ` (${code})` : ''} — ${clip((e as Error)?.message, 300).replace(/\s+/g, ' ')}`,
    );
    return reason;
  }

  private warnThrottled(key: string, msg: string) {
    const now = Date.now();
    if ((this.warnedAt.get(key) ?? 0) + 60_000 > now) return;
    this.warnedAt.set(key, now);
    this.logger.warn(msg);
  }

  /** agents sxemasi, 8 jadval va huquqlar. 15 s kesh; xato bo'lsa kesh tozalanadi. Hech qachon throw qilmaydi. */
  private async installState(force = false): Promise<InstallState> {
    if (!force && this.installCache && Date.now() - this.installCache.at < INSTALL_CACHE_MS) {
      return this.installCache.state;
    }
    if (!this.installInflight) {
      this.installInflight = this.computeInstallState().finally(() => {
        this.installInflight = null;
      });
    }
    return this.installInflight;
  }

  private async computeInstallState(): Promise<InstallState> {
    try {
      const [rows] = await this.ro(
        this.prisma.$queryRaw<{ has_schema: boolean; tables: string[] | null }[]>`
          SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'agents') AS has_schema,
                 ARRAY(SELECT c.relname::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'agents' AND c.relkind IN ('r', 'p')) AS tables`,
      );
      let state: InstallState;
      const r0 = rows[0];
      if (!r0?.has_schema) {
        state = { installed: false, reason: 'no_schema', missingTables: [] };
      } else {
        const have = new Set(r0.tables ?? []);
        const missing = AGENT_TABLES.filter((t) => !have.has(t));
        if (missing.length) {
          state = { installed: false, reason: 'no_tables', missingTables: [...missing] };
        } else {
          const [priv] = await this.ro(
            this.prisma.$queryRaw<{ u: boolean; sel: boolean | null }[]>`
              SELECT has_schema_privilege('agents', 'USAGE') AS u,
                     (SELECT bool_and(has_table_privilege(c.oid, 'SELECT'))
                        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                       WHERE n.nspname = 'agents' AND c.relkind IN ('r', 'p')
                         AND c.relname IN (${Prisma.join([...AGENT_TABLES])})) AS sel`,
          );
          const p0 = priv[0];
          state =
            p0?.u && p0?.sel !== false
              ? { installed: true, reason: 'ok', missingTables: [] }
              : { installed: false, reason: 'no_permission', missingTables: [] };
        }
      }
      this.installCache = { at: Date.now(), state };
      return state;
    } catch (e) {
      this.installCache = null;
      return { installed: false, reason: this.reasonOf(e, 'install'), missingTables: [] };
    }
  }

  /**
   * O'rnatilgan bo'lsa run(), aks holda empty(). run() dagi DB xatosi (jadval o'chirilgan, huquq yo'q,
   * timeout) — installed=false + sabab (HTTP 200). HttpException'lar o'zgarmasdan uzatiladi.
   */
  private async guarded<T>(
    where: string,
    empty: (st: InstallState) => T | Promise<T>,
    run: () => Promise<T>,
  ): Promise<T> {
    const st = await this.installState();
    if (!st.installed) return empty(st);
    try {
      return await run();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      const reason = this.reasonOf(e, where);
      this.installCache = null;
      let st2: InstallState = { installed: false, reason, missingTables: [] };
      if (reason === 'no_tables' || reason === 'no_schema') {
        const fresh = await this.installState(true);
        if (!fresh.installed) st2 = fresh;
      }
      return empty(st2);
    }
  }

  private installFields(st: InstallState): InstallState {
    return { installed: st.installed, reason: st.reason, missingTables: [...st.missingTables] };
  }

  // =========================================================================
  // Env (faqat mavjudligi — qiymatlar javobga tushmaydi)
  // =========================================================================

  /**
   * Botning env fayli — config.env_file_path() bilan bir xil: AGENTS_ENV_FILE (ORNATISH 6-qadam B varianti uchun
   * backend env'iga ham yoziladi), bo'lmasa <repo>/backend/.env (config.ENV_FILE_DEFAULT). Nisbiy yo'l repo
   * ildiziga nisbatan (bot unit'ining WorkingDirectory'si).
   */
  private botEnvFilePath(): string {
    const raw = (process.env.AGENTS_ENV_FILE || '').trim();
    const repo = path.resolve(this.agentsDir, '..');
    if (!raw) return path.join(repo, 'backend', '.env');
    return path.isAbsolute(raw) ? raw : path.resolve(repo, raw);
  }

  /** Env faylini har so'rovda stat qiladi (mtime+size keshi) — o'zgarsa backend restartisiz yangidan o'qiladi. */
  private envFileVars(): Record<string, string> | null {
    const file = this.botEnvFilePath();
    try {
      const st = fs.statSync(file);
      if (!st.isFile()) return null;
      if (st.size > ENV_FILE_MAX_BYTES) {
        this.warnThrottled('envfile:size', `agent-team: bot env fayli ${ENV_FILE_MAX_BYTES} baytdan katta — o'qilmadi`);
        return null;
      }
      const key = `${st.mtimeMs}:${st.size}`;
      if (this.envFileCache && this.envFileCache.file === file && this.envFileCache.key === key) {
        return this.envFileCache.vars;
      }
      const vars = parseEnvText(fs.readFileSync(file, 'utf8'));
      this.envFileCache = { file, key, vars };
      return vars;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        this.warnThrottled('envfile:read', `agent-team: bot env fayli o'qilmadi (${code ?? 'xato'})`);
      }
      return null;
    }
  }

  /**
   * Bot kaliti qiymati — bot ko'radigan manbadan. Bot (config.env) avval o'z os.environ'ini o'qiydi, lekin unit'da
   * u yerda bot kalitlari yo'q (faqat HOME, TZ, LANG, PYTHONUNBUFFERED, AGENTS_ENV_FILE) — hammasi env faylidan.
   * Shu sabab fayl o'qilsa FAQAT fayl: kalit faylda yo'q bo'lsa bot default ishlatadi (backend process.env —
   * backend startidagi eski nusxa — bu yerda manba emas). Fayl o'qilmasa (yo'q/huquq yo'q) — zaxira process.env.
   */
  private readEnv(name: string, fileVars: Record<string, string> | null, used: Set<'process' | 'env_file'>): string | undefined {
    if (fileVars) {
      if (!Object.prototype.hasOwnProperty.call(fileVars, name)) return undefined;
      used.add('env_file');
      return fileVars[name];
    }
    if (Object.prototype.hasOwnProperty.call(process.env, name) && process.env[name] !== undefined) {
      used.add('process');
      return process.env[name];
    }
    return undefined;
  }

  /** config.env_int: bo'sh/yaroqsiz -> default, min dan kichik -> min. */
  private envInt(raw: string | undefined, def: number, min: number): number {
    const s = (raw ?? '').trim();
    if (!s) return def;
    if (!/^[+-]?\d{1,9}$/.test(s)) return def;
    return Math.max(min, parseInt(s, 10));
  }

  private resolveEnv(): EnvResolved {
    const fileVars = this.envFileVars();
    const used = new Set<'process' | 'env_file'>();
    const get = (n: string) => this.readEnv(n, fileVars, used);
    const trimmed = (n: string, max: number): string | null => {
      const v = (get(n) ?? '').trim();
      return v ? cpHead(v, max) : null;
    };

    const setupToken = !!(get('ANTHROPIC_SETUP_TOKEN') ?? '').trim();
    const botToken = !!(get('LEADER_BOT_TOKEN') ?? '').trim();
    const anthropicBaseUrl = !!(get('ANTHROPIC_BASE_URL') ?? '').trim();
    const ownerTgId = trimmed('LEADER_TG_ID', 32);
    const useCli = (get('AGENTS_USE_CLI') ?? '').trim() === '1';
    const agentOsUser = trimmed('AGENT_OS_USER', 64);
    const claudeCmd = trimmed('CLAUDE_CMD', 200);
    const modelStrong = trimmed('AGENTS_MODEL_STRONG', 64) || MODEL_STRONG_DEFAULT;
    const modelFast = trimmed('AGENTS_MODEL_FAST', 64) || MODEL_FAST_DEFAULT;
    const dailyCap = this.envInt(get('AGENT_DAILY_CAP'), DAILY_CAP_DEFAULT, 1);
    const timeoutS = this.envInt(get('AGENT_TIMEOUT_S'), TIMEOUT_DEFAULT_S, TIMEOUT_MIN_S);
    const timeouts = {} as Record<AgentName, number>;
    for (const a of AGENT_NAMES) {
      timeouts[a] = this.envInt(get(`AGENT_TIMEOUT_S_${a.toUpperCase()}`), timeoutS, TIMEOUT_MIN_S);
    }
    const v1LeaderActive =
      (process.env.LEADER_ENABLED || '').trim() !== '0' && !!(process.env.LEADER_OWNER_TG_IDS || '').trim();

    const source: AgentTeamEnv['source'] =
      used.size === 0 ? 'none' : used.size === 2 ? 'mixed' : used.has('process') ? 'process' : 'env_file';

    return {
      env: {
        setupToken,
        botToken,
        ownerTgId,
        ownerTgIdMatches: !ownerTgId || ownerTgId === OWNER_TG_ID,
        useCli,
        agentOsUser,
        claudeCmd,
        anthropicBaseUrl,
        modelStrong,
        modelFast,
        dailyCap,
        timeoutS,
        v1LeaderActive,
        source,
      },
      timeouts,
    };
  }

  private secretsOf(env: AgentTeamEnv): SecretsPresence {
    return { setupToken: env.setupToken, botToken: env.botToken };
  }

  /**
   * runner.pick_model agent nomiga qaramaydi: faqat context.complexity='simple' -> tez model, aks holda kuchli.
   * complexity='simple' ni faqat Checker fon tekshiruvi beradi (checker_worker: source='checker', har 4 soat).
   * Leader delegatsiyasi (source='deleg') complexity'siz — Checker uchun ham kuchli model.
   * source ma'lum bo'lsa (oxirgi chaqiruv manbasi) — o'sha chaqiruv uchun kutilgan model; aks holda runner default'i.
   */
  private defaultModel(name: AgentName, env: AgentTeamEnv, source?: string | null): string {
    return name === 'checker' && source === 'checker' ? env.modelFast : env.modelStrong;
  }

  // =========================================================================
  // Facts fayli (agents/state/support_facts.json)
  // =========================================================================

  private async readFacts(): Promise<FactsSnapshot> {
    const none: FactsSnapshot = { exists: false, sizeBytes: null, mtimeMs: null, json: null, parseError: false };
    let st: fs.Stats;
    try {
      st = await fs.promises.lstat(this.factsPath);
    } catch {
      return none;
    }
    if (!st.isFile()) return none;
    const key = `${st.mtimeMs}:${st.size}`;
    if (this.factsCache?.key === key) return this.factsCache.snap;
    let snap: FactsSnapshot;
    if (st.size > FACTS_MAX_BYTES) {
      snap = { exists: true, sizeBytes: st.size, mtimeMs: st.mtimeMs, json: null, parseError: true };
    } else {
      try {
        const text = await fs.promises.readFile(this.factsPath, 'utf8');
        const parsed: unknown = JSON.parse(text.replace(/^﻿/, ''));
        snap = isPlainObject(parsed)
          ? { exists: true, sizeBytes: st.size, mtimeMs: st.mtimeMs, json: parsed, parseError: false }
          : { exists: true, sizeBytes: st.size, mtimeMs: st.mtimeMs, json: null, parseError: true };
      } catch {
        snap = { exists: true, sizeBytes: st.size, mtimeMs: st.mtimeMs, json: null, parseError: true };
      }
    }
    this.factsCache = { key, snap };
    return snap;
  }

  /** {error, izoh} shaklidagi (butunlay xato bergan) bo'lim. */
  private isErrorSection(v: unknown): boolean {
    return isPlainObject(v) && 'error' in v && Object.keys(v).every((k) => k === 'error' || k === 'izoh');
  }

  private factsBrief(snap: FactsSnapshot, nowMs: number): FactsBrief {
    if (!snap.exists) return { exists: false, updatedAt: null, ageSec: null, freshness: 'missing', errorSections: 0 };
    const updMs = (snap.json ? parseIsoMs(snap.json.updated_at) : null) ?? snap.mtimeMs;
    const ageSec = updMs === null ? null : Math.max(0, Math.round((nowMs - updMs) / 1000));
    let freshness: FactsFreshness = 'missing';
    if (!snap.parseError && ageSec !== null) {
      freshness = ageSec <= FACTS_STALE_S ? 'fresh' : ageSec <= FACTS_OLD_S ? 'stale' : 'old';
    }
    let errorSections = 0;
    if (snap.json) {
      for (const k of FACTS_SECTIONS) if (k in snap.json && this.isErrorSection(snap.json[k])) errorSections++;
    }
    return { exists: true, updatedAt: msIso(updMs), ageSec, freshness, errorSections };
  }

  private factsState(snap: FactsSnapshot, nowMs: number): FactsState {
    const brief = this.factsBrief(snap, nowMs);
    const sections: FactsSection[] = [];
    if (snap.json) {
      for (const key of FACTS_SECTIONS) {
        if (!(key in snap.json)) continue;
        const v = snap.json[key];
        const obj = isPlainObject(v) ? v : null;
        const err = obj && obj.error !== undefined && obj.error !== null ? clip(obj.error, 300) : null;
        const izoh = obj && typeof obj.izoh === 'string' ? clip(obj.izoh, 300) : null;
        sections.push({ key, ok: !this.isErrorSection(v), error: err, izoh });
      }
    }
    return {
      ...brief,
      path: FACTS_REL_PATH,
      sizeBytes: snap.sizeBytes,
      staleAfterS: FACTS_STALE_S,
      intervalS: FACTS_INTERVAL_S,
      parseError: snap.parseError,
      sections,
    };
  }

  // =========================================================================
  // Umumiy SQL bo'laklari (overview + agents)
  // =========================================================================

  private qKv(keys: string[]) {
    return this.prisma.$queryRaw<KvRow[]>`
      SELECT k, value, updated_at FROM agents.kv_store WHERE k IN (${Prisma.join(keys)})`;
  }

  private qTodayByAgentStatus(todayStart: Date) {
    return this.prisma.$queryRaw<TodayRow[]>`
      SELECT agent, status, COUNT(*)::int AS n,
             SUM(duration_ms)::float8 AS dsum, COUNT(duration_ms)::int AS dn, MAX(ts) AS last
        FROM agents.agent_runs
       WHERE ts >= ${tz(todayStart)}
       GROUP BY agent, status`;
  }

  /** (VALUES ('leader'), ...) — har agent uchun LATERAL (agent, ts) indeksi bo'yicha 1 qator. */
  private agentValues(): Prisma.Sql {
    return Prisma.join(AGENT_NAMES.map((a) => Prisma.sql`(${a})`));
  }

  private qLastPerAgent() {
    return this.prisma.$queryRaw<LastRunRow[]>`
      SELECT a.agent, r.ts, r.status, r.source
        FROM (VALUES ${this.agentValues()}) AS a(agent)
        CROSS JOIN LATERAL (
          SELECT x.ts, x.status, x.source FROM agents.agent_runs x
           WHERE x.agent = a.agent
           ORDER BY x.ts DESC LIMIT 1
        ) r`;
  }

  private qDelegToday(todayStart: Date) {
    return this.prisma.$queryRaw<AgentCountRow[]>`
      SELECT agent, COUNT(*)::int AS n FROM agents.agent_runs
       WHERE ts >= ${tz(todayStart)} AND source = 'deleg'
       GROUP BY agent`;
  }

  private qInProgress(since: Date) {
    return this.prisma.$queryRaw<AgentCountRow[]>`
      SELECT agent, COUNT(*)::int AS n FROM agents.agent_tasks
       WHERE status = 'in_progress' AND updated_at > ${tz(since)}
       GROUP BY agent`;
  }

  private enabledKeys(): string[] {
    return AGENT_NAMES.map((a) => `agent_enabled_${a}`);
  }

  private kvMap(rows: KvRow[]): Map<string, KvRow> {
    return new Map(rows.map((r) => [r.k, r]));
  }

  private countMap(rows: AgentCountRow[]): Map<string, number> {
    return new Map(rows.map((r) => [r.agent, num(r.n)]));
  }

  /** Bugungi (agent,status) qatorlaridan: agent bo'yicha status xaritasi va umumiy TodayStats. */
  private todayOf(rows: TodayRow[]): { byAgent: Map<string, Map<string, number>>; total: TodayStats } {
    const byAgent = new Map<string, Map<string, number>>();
    const all = new Map<string, number>();
    let dsum = 0;
    let dn = 0;
    let lastMs: number | null = null;
    for (const r of rows) {
      const n = num(r.n);
      bump(all, r.status, n);
      if (!byAgent.has(r.agent)) byAgent.set(r.agent, new Map());
      bump(byAgent.get(r.agent), r.status, n);
      if (r.status === 'ok' && num(r.dn) > 0) {
        dsum += num(r.dsum);
        dn += num(r.dn);
      }
      const t = r.last ? new Date(r.last).getTime() : NaN;
      if (Number.isFinite(t) && (lastMs === null || t > lastMs)) lastMs = t;
    }
    const counts = runCountsOf(all);
    return {
      byAgent,
      total: {
        ...counts,
        counted: counts.total - uncountedOf(all),
        avgDurationMs: dn > 0 ? Math.round(dsum / dn) : null,
        lastRunAt: msIso(lastMs),
      },
    };
  }

  private briefs(
    todayByAgent: Map<string, Map<string, number>>,
    last: LastRunRow[],
    deleg: Map<string, number>,
    inProg: Map<string, number>,
    kv: Map<string, KvRow>,
  ): AgentBrief[] {
    const lastBy = new Map(last.map((r) => [r.agent, r]));
    return AGENT_NAMES.map((name) => {
      const l = lastBy.get(name);
      return {
        name,
        enabled: enabledOf(kv.get(`agent_enabled_${name}`)),
        today: runCountsOf(todayByAgent.get(name) ?? new Map()),
        lastRunAt: l ? iso(l.ts) : null,
        lastStatus: l ? l.status : null,
        lastSource: l ? l.source ?? null : null,
        inProgress: inProg.get(name) ?? 0,
        delegToday: deleg.get(name) ?? 0,
      };
    });
  }

  private emptyBrief(name: AgentName): AgentBrief {
    return {
      name,
      enabled: true,
      today: emptyRunCounts(),
      lastRunAt: null,
      lastStatus: null,
      lastSource: null,
      inProgress: 0,
      delegToday: 0,
    };
  }

  // =========================================================================
  // #1 GET /agent-team/overview
  // =========================================================================

  async overview(): Promise<AgentTeamOverview> {
    const now = new Date();
    const nowMs = now.getTime();
    const { env } = this.resolveEnv();
    const facts = this.factsBrief(await this.readFacts(), nowMs);
    const secrets = this.secretsOf(env);

    const base = (st: InstallState): AgentTeamOverview => ({
      ...this.installFields(st),
      serverTime: now.toISOString(),
      bot: {
        username: BOT_USERNAME,
        service: BOT_SERVICE,
        liveStatus: 'unknown',
        heartbeatAt: null,
        heartbeatAgeSec: null,
        rateLimitedUntil: null,
        planExecuting: false,
        planExecutingUntil: null,
        checkerLastRunAt: null,
        teacherLastDay: null,
        cleanupLastAt: null,
      },
      secrets,
      today: { ...emptyRunCounts(), counted: 0, avgDurationMs: null, lastRunAt: null },
      lastActivityAt: null,
      agents: AGENT_NAMES.map((a) => this.emptyBrief(a)),
      pending: { plans: 0, memoryWrites: 0, openPromises: 0, overduePromises: 0, tasksInProgress: 0 },
      facts,
      health: { worst: null, counts: { ok: 0, warn: 0, error: 0, unknown: 0 }, checkedAt: null },
    });

    return this.guarded('overview', base, async () => {
      const todayStart = dayStartUtc(tashkentDay(now));
      const [kvRows, today, last, deleg, inProg, act, appr, prom, tip, health] = await this.ro(
        this.qKv([...OVERVIEW_KV, ...this.enabledKeys()]),
        this.qTodayByAgentStatus(todayStart),
        this.qLastPerAgent(),
        this.qDelegToday(todayStart),
        this.qInProgress(new Date(nowMs - IN_PROGRESS_WINDOW_MS)),
        this.prisma.$queryRaw<{ t: Date | null }[]>`
          SELECT GREATEST((SELECT MAX(ts) FROM agents.agent_runs),
                          (SELECT MAX(ts) FROM agents.agent_chat_log)) AS t`,
        // Faqat bosh qismi: created_ts / created (to'liq reja payload'i kerak emas).
        // [Ha]/[Yo'q] bosilgan (sup_run_/tw_run_ <token> claim qilingan) yozuvlar tasdiq KUTMAYDI:
        // reja.decide() sup_appr_ ni o'chirmaydi, u ijro tugagach _finish() da o'chadi (plans() dagi `claimed` bilan bir xil).
        this.prisma.$queryRaw<{ k: string; head: string | null; updated_at: Date }[]>`
          SELECT s.k, left(s.value, 512) AS head, s.updated_at FROM agents.kv_store s
           WHERE (s.k LIKE 'sup!_appr!_%' ESCAPE '!'
                  AND NOT EXISTS (SELECT 1 FROM agents.kv_store r WHERE r.k = 'sup_run_' || substr(s.k, 10)))
              OR (s.k LIKE 'tw!_appr!_%' ESCAPE '!'
                  AND NOT EXISTS (SELECT 1 FROM agents.kv_store r WHERE r.k = 'tw_run_' || substr(s.k, 9)))
           ORDER BY s.updated_at DESC LIMIT 200`,
        this.prisma.$queryRaw<{ open: number; overdue: number }[]>`
          SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
                 COUNT(*) FILTER (WHERE status = 'open' AND due_at <= ${tz(now)})::int AS overdue
            FROM agents.agent_promises`,
        this.prisma.$queryRaw<{ n: number }[]>`
          SELECT COUNT(*)::int AS n FROM agents.agent_tasks WHERE status = 'in_progress'`,
        this.prisma.$queryRaw<HealthLatestRow[]>`
          SELECT DISTINCT ON (component) component, status, ts
            FROM agents.agent_health
           ORDER BY component, ts DESC`,
      );

      const kv = this.kvMap(kvRows);
      const { byAgent, total } = this.todayOf(today);
      const out = base({ installed: true, reason: 'ok', missingTables: [] });

      out.bot = this.botState(kv, nowMs);
      out.today = total;
      out.lastActivityAt = iso(act[0]?.t ?? null);
      out.agents = this.briefs(byAgent, last, this.countMap(deleg), this.countMap(inProg), kv);

      const pending: PendingCounts = {
        plans: 0,
        memoryWrites: 0,
        openPromises: num(prom[0]?.open),
        overduePromises: num(prom[0]?.overdue),
        tasksInProgress: num(tip[0]?.n),
      };
      for (const r of appr) {
        const head = r.head ?? '';
        const tsM = head.match(/"created_ts"\s*:\s*"?([0-9.eE+-]+)/);
        const crM = head.match(/"created"\s*:\s*"([^"]{1,40})"/);
        const createdMs = createdMsOf(tsM ? tsM[1] : undefined, crM ? crM[1] : undefined);
        if (createdMs === null || createdMs + APPROVAL_TTL_S * 1000 <= nowMs) continue;
        if (r.k.startsWith('sup_appr_')) pending.plans++;
        else if (r.k.startsWith('tw_appr_')) pending.memoryWrites++;
      }
      out.pending = pending;
      out.health = this.healthBrief(health);
      return out;
    });
  }

  private botState(kv: Map<string, KvRow>, nowMs: number): BotState {
    const hbRow = kv.get('leader_heartbeat');
    const hbMs = hbRow ? parseIsoMs(hbRow.value) ?? new Date(hbRow.updated_at).getTime() : null;
    const hbOk = hbMs !== null && Number.isFinite(hbMs);
    const ageSec = hbOk ? Math.max(0, Math.round((nowMs - hbMs) / 1000)) : null;
    const rl = parseIsoMs(kv.get('agents_rate_limit_until')?.value);
    const exec = leaseOf(kv.get('sup_exec_active'), nowMs);
    const teacher = (kv.get('teacher_daily_last_run')?.value ?? '').trim();
    return {
      username: BOT_USERNAME,
      service: BOT_SERVICE,
      liveStatus: liveStatusOf(ageSec),
      heartbeatAt: hbOk ? msIso(hbMs) : null,
      heartbeatAgeSec: ageSec,
      rateLimitedUntil: rl !== null && rl > nowMs ? msIso(rl) : null,
      planExecuting: exec.active,
      planExecutingUntil: exec.active ? msIso(exec.untilMs) : null,
      checkerLastRunAt: msIso(parseIsoMs(kv.get('checker:last_full_run')?.value)),
      teacherLastDay: /^\d{4}-\d{2}-\d{2}$/.test(teacher) ? teacher : null,
      cleanupLastAt: msIso(parseIsoMs(kv.get('cleanup_last')?.value)),
    };
  }

  private healthBrief(rows: HealthLatestRow[]): HealthBrief {
    const counts: Record<HealthStatus, number> = { ok: 0, warn: 0, error: 0, unknown: 0 };
    let worst: HealthStatus | null = null;
    let checkedMs: number | null = null;
    for (const r of rows) {
      const s = healthStatusOf(r.status);
      counts[s]++;
      if (worst === null || CHECK_SEVERITY[s] > CHECK_SEVERITY[worst]) worst = s;
      const t = new Date(r.ts).getTime();
      if (Number.isFinite(t) && (checkedMs === null || t > checkedMs)) checkedMs = t;
    }
    return { worst, counts, checkedAt: msIso(checkedMs) };
  }

  // =========================================================================
  // #2 GET /agent-team/agents
  // =========================================================================

  async agents(): Promise<AgentTeamAgents> {
    const now = new Date();
    const nowMs = now.getTime();
    const { env, timeouts } = this.resolveEnv();
    const today = tashkentDay(now);
    const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
    const emptySeries = (): DayPoint[] => days.map((date) => ({ date, total: 0, ok: 0, failed: 0 }));

    const stat = (name: AgentName, brief: AgentBrief): AgentStats => ({
      ...brief,
      enabledRaw: null,
      enabledUpdatedAt: null,
      model: null,
      defaultModel: this.defaultModel(name, env),
      timeoutS: timeouts[name],
      todayCounted: 0,
      dailyCap: env.dailyCap,
      week: emptyRunCounts(),
      avgDurationMs7d: null,
      p95DurationMs7d: null,
      successRate7d: null,
      series: emptySeries(),
      lastError: null,
    });

    const empty = (st: InstallState): AgentTeamAgents => ({
      ...this.installFields(st),
      dailyCap: env.dailyCap,
      agents: AGENT_NAMES.map((a) => stat(a, this.emptyBrief(a))),
    });

    return this.guarded('agents', empty, async () => {
      const todayStart = dayStartUtc(today);
      const weekStart = dayStartUtc(days[0]);
      const names = Prisma.join([...AGENT_NAMES]);
      const [series, durs, models, errors, todayRows, last, deleg, inProg, kvRows] = await this.ro(
        this.prisma.$queryRaw<{ agent: string; day: string; status: string; n: number }[]>`
          SELECT agent, to_char((ts AT TIME ZONE 'UTC') + interval '5 hours', 'YYYY-MM-DD') AS day,
                 status, COUNT(*)::int AS n
            FROM agents.agent_runs
           WHERE ts >= ${tz(weekStart)} AND agent IN (${names})
           GROUP BY 1, 2, 3`,
        this.prisma.$queryRaw<{ agent: string; avg: number | null; p95: number | null }[]>`
          SELECT agent, AVG(duration_ms)::float8 AS avg,
                 percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95
            FROM agents.agent_runs
           WHERE ts >= ${tz(weekStart)} AND status = 'ok' AND duration_ms IS NOT NULL AND agent IN (${names})
           GROUP BY agent`,
        this.prisma.$queryRaw<{ agent: string; model: string; source: string | null }[]>`
          SELECT a.agent, r.model, r.source
            FROM (VALUES ${this.agentValues()}) AS a(agent)
            CROSS JOIN LATERAL (
              SELECT x.model, x.source FROM agents.agent_runs x
               WHERE x.agent = a.agent AND x.model IS NOT NULL
               ORDER BY x.ts DESC LIMIT 1
            ) r`,
        this.prisma.$queryRaw<
          { agent: string; id: bigint; ts: Date; status: string; source: string | null; error: string | null }[]
        >`
          SELECT a.agent, r.id, r.ts, r.status, r.source, r.error
            FROM (VALUES ${this.agentValues()}) AS a(agent)
            CROSS JOIN LATERAL (
              SELECT x.id, x.ts, x.status, x.source, x.error FROM agents.agent_runs x
               WHERE x.agent = a.agent AND x.status IN ('error', 'timeout')
               ORDER BY x.ts DESC LIMIT 1
            ) r`,
        this.qTodayByAgentStatus(todayStart),
        this.qLastPerAgent(),
        this.qDelegToday(todayStart),
        this.qInProgress(new Date(nowMs - IN_PROGRESS_WINDOW_MS)),
        this.qKv(this.enabledKeys()),
      );

      const kv = this.kvMap(kvRows);
      const { byAgent } = this.todayOf(todayRows);
      const briefs = this.briefs(byAgent, last, this.countMap(deleg), this.countMap(inProg), kv);

      // 7 kun: agent -> kun -> status -> n
      const weekBy = new Map<string, Map<string, number>>();
      const dayBy = new Map<string, Map<string, DayPoint>>();
      for (const r of series) {
        const n = num(r.n);
        if (!weekBy.has(r.agent)) weekBy.set(r.agent, new Map());
        bump(weekBy.get(r.agent), r.status, n);
        if (!dayBy.has(r.agent)) dayBy.set(r.agent, new Map());
        const dm = dayBy.get(r.agent);
        const p = dm.get(r.day) ?? { date: r.day, total: 0, ok: 0, failed: 0 };
        p.total += n;
        if (r.status === 'ok') p.ok += n;
        if (r.status === 'error' || r.status === 'timeout') p.failed += n;
        dm.set(r.day, p);
      }
      const durBy = new Map(durs.map((d) => [d.agent, d]));
      const modelBy = new Map(models.map((m) => [m.agent, m]));
      const errBy = new Map(errors.map((e) => [e.agent, e]));

      const agents = briefs.map((b) => {
        const name = b.name;
        const s = stat(name, b);
        const kvRow = kv.get(`agent_enabled_${name}`);
        s.enabledRaw = enabledRawOf(kvRow);
        s.enabledUpdatedAt = kvRow ? iso(kvRow.updated_at) : null;
        const m = modelBy.get(name);
        s.model = m ? clip(m.model, 64) : null;
        // Oxirgi chaqiruv manbasi uchun kutilgan model (Checker: fon -> tez, deleg -> kuchli) — UI farq belgisi to'g'ri
        s.defaultModel = this.defaultModel(name, env, m?.source ?? null);
        const todayMap = byAgent.get(name) ?? new Map<string, number>();
        s.todayCounted = runCountsOf(todayMap).total - uncountedOf(todayMap);
        const wk = runCountsOf(weekBy.get(name) ?? new Map());
        s.week = wk;
        const d = durBy.get(name);
        s.avgDurationMs7d = d && d.avg !== null ? Math.round(num(d.avg)) : null;
        s.p95DurationMs7d = d && d.p95 !== null ? Math.round(num(d.p95)) : null;
        const denom = wk.total - wk.blocked;
        s.successRate7d = denom > 0 ? wk.ok / denom : null;
        const dm = dayBy.get(name);
        s.series = days.map((date) => dm?.get(date) ?? { date, total: 0, ok: 0, failed: 0 });
        const e = errBy.get(name);
        const lastError: AgentLastError | null = e
          ? {
              id: num(e.id),
              ts: isoReq(e.ts),
              status: e.status,
              source: e.source ?? null,
              error: clipOrNull(e.error, 500),
            }
          : null;
        s.lastError = lastError;
        return s;
      });

      return { installed: true, reason: 'ok', missingTables: [], dailyCap: env.dailyCap, agents };
    });
  }

  // =========================================================================
  // #3 PUT /agent-team/agents/:name/enabled — YAGONA YOZUV
  // =========================================================================

  async setAgentEnabled(name: string, body: unknown, actor: string): Promise<ToggleAgentResponse> {
    const agent = AGENT_NAMES.find((a) => a === name);
    if (!agent) throw new BadRequestException(`Noma'lum agent: ruxsat etilganlar — ${AGENT_NAMES.join(', ')}`);
    const enabled = isPlainObject(body) ? body.enabled : undefined;
    if (typeof enabled !== 'boolean') throw new BadRequestException("body.enabled boolean bo'lishi kerak");

    const st = await this.installState(true);
    if (!st.installed && (st.reason === 'no_schema' || (st.reason === 'no_tables' && st.missingTables.includes('kv_store')))) {
      throw new ConflictException(NOT_INSTALLED_MSG);
    }

    // Kalit faqat oq ro'yxat nomidan (foydalanuvchi satridan emas); qiymat runner.py formati: '1' | '0'
    const key = `agent_enabled_${agent}`;
    const value: '0' | '1' = enabled ? '1' : '0';
    const now = new Date();
    let rows: { updated_at: Date }[];
    try {
      rows = await this.prisma.$queryRaw<{ updated_at: Date }[]>`
        INSERT INTO agents.kv_store (k, value, updated_at) VALUES (${key}, ${value}, ${tz(now)})
        ON CONFLICT (k) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
        RETURNING updated_at`;
    } catch (e) {
      const code = this.pgCode(e);
      this.installCache = null;
      if (code === '42P01' || code === '3F000') throw new ConflictException(NOT_INSTALLED_MSG);
      if (code === '42501') throw new ConflictException("agents.kv_store ga yozish huquqi yo'q (DB foydalanuvchisi)");
      this.logger.error(`agent_enabled yozilmadi (${agent}): ${clip((e as Error)?.message, 300)}`);
      throw new InternalServerErrorException('Agent holati saqlanmadi');
    }
    this.logger.log(`${key} = ${value} (${enabled ? 'yoqildi' : "o'chirildi"}) — ${actor}`);
    return { ok: true, name: agent, enabled, value, updatedAt: iso(rows[0]?.updated_at) ?? now.toISOString() };
  }

  // =========================================================================
  // #4 GET /agent-team/runs · #5 GET /agent-team/runs/:id
  // =========================================================================

  private runRow(r: RunDbRow): AgentRunRow {
    return {
      id: num(r.id),
      ts: isoReq(r.ts),
      agent: r.agent,
      model: r.model ?? null,
      status: r.status,
      source: r.source ?? null,
      durationMs: numOrNull(r.duration_ms),
      returncode: numOrNull(r.returncode),
      taskPreview: clipOrNull(r.task_preview, 500),
      responsePreview: clipOrNull(r.response_preview, 500),
      error: clipOrNull(r.error, 500),
    };
  }

  /** Toshkent kuni oralig'i ts ustuni uchun (from/to ikkalasi ham kiradi). */
  private tsRange(from: string | null, to: string | null): Prisma.Sql[] {
    const conds: Prisma.Sql[] = [];
    if (from) conds.push(Prisma.sql`ts >= ${tz(dayStartUtc(from))}`);
    if (to) conds.push(Prisma.sql`ts < ${tz(new Date(dayStartUtc(to).getTime() + DAY_MS))}`);
    return conds;
  }

  async runs(q: Record<string, unknown>): Promise<AgentTeamRuns> {
    const page = intParam(q.page, 1, 1, 100_000);
    const perPage = intParam(q.perPage, 25, 1, 100);
    const empty = (st: InstallState): AgentTeamRuns => ({
      ...this.installFields(st),
      total: 0,
      page,
      perPage,
      rows: [],
      statusCounts: {},
    });

    return this.guarded('runs', empty, async () => {
      const base: Prisma.Sql[] = [];
      const agent = oneOf(q.agent, AGENT_NAMES);
      if (agent) base.push(Prisma.sql`agent = ${agent}`);
      const source = oneOf(q.source, RUN_SOURCES);
      if (source) base.push(Prisma.sql`source = ${source}`);
      base.push(...this.tsRange(dayParam(q.from), dayParam(q.to)));
      const pat = likePattern(q.q);
      if (pat) {
        base.push(Prisma.sql`(task_preview ILIKE ${pat} ESCAPE '\\' OR response_preview ILIKE ${pat} ESCAPE '\\'
                              OR error ILIKE ${pat} ESCAPE '\\')`);
      }
      const statuses = Array.from(
        new Set(
          qStr(q.status)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => (RUN_STATUSES as readonly string[]).includes(s)),
        ),
      );
      const all = statuses.length ? [...base, Prisma.sql`status IN (${Prisma.join(statuses)})`] : base;

      const [cnt, sc, rows] = await this.ro(
        this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM agents.agent_runs ${whereOf(all)}`,
        this.prisma.$queryRaw<StatusCountRow[]>`
          SELECT status, COUNT(*)::int AS n FROM agents.agent_runs ${whereOf(base)} GROUP BY status`,
        this.prisma.$queryRaw<RunDbRow[]>`
          SELECT id, ts, agent, model, status, source, duration_ms, returncode,
                 task_preview, response_preview, error
            FROM agents.agent_runs ${whereOf(all)}
           ORDER BY id DESC
           LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      );
      const statusCounts: Record<string, number> = {};
      for (const r of sc) statusCounts[r.status] = num(r.n);
      return {
        installed: true,
        reason: 'ok',
        missingTables: [],
        total: num(cnt[0]?.n),
        page,
        perPage,
        rows: rows.map((r) => this.runRow(r)),
        statusCounts,
      };
    });
  }

  async run(id: string): Promise<AgentTeamRun> {
    if (typeof id !== 'string' || !/^\d{1,18}$/.test(id)) throw new BadRequestException("id noto'g'ri");
    const empty = (st: InstallState): AgentTeamRun => ({ ...this.installFields(st), row: null });
    return this.guarded('run', empty, async () => {
      const [rows] = await this.ro(
        this.prisma.$queryRaw<RunDbRow[]>`
          SELECT id, ts, agent, model, status, source, duration_ms, returncode,
                 task_preview, response_preview, error
            FROM agents.agent_runs WHERE id = ${id}::bigint`,
      );
      return { installed: true, reason: 'ok', missingTables: [], row: rows[0] ? this.runRow(rows[0]) : null };
    });
  }

  // =========================================================================
  // #6 GET /agent-team/chat
  // =========================================================================

  async chat(q: Record<string, unknown>): Promise<AgentTeamChat> {
    const limit = intParam(q.limit, 60, 1, 200);
    const empty = (st: InstallState): AgentTeamChat => ({
      ...this.installFields(st),
      rows: [],
      hasMore: false,
      nextBefore: null,
      retentionDays: CHAT_RETENTION_DAYS,
    });

    return this.guarded('chat', empty, async () => {
      const conds: Prisma.Sql[] = [];
      const role = oneOf(q.role, CHAT_ROLES);
      if (role) conds.push(Prisma.sql`role = ${role}`);
      const fwd = qStr(q.forward);
      if (fwd === '1' || fwd === 'true') conds.push(Prisma.sql`is_forward = true`);
      const pat = likePattern(q.q);
      if (pat) conds.push(Prisma.sql`text ILIKE ${pat} ESCAPE '\\'`);
      conds.push(...this.tsRange(dayParam(q.from), dayParam(q.to)));
      const before = qStr(q.before);
      if (/^\d{1,18}$/.test(before)) conds.push(Prisma.sql`id < ${before}::bigint`);

      const [rows] = await this.ro(
        this.prisma.$queryRaw<{ id: bigint; ts: Date; role: string; text: string; is_forward: boolean }[]>`
          SELECT id, ts, role, text, is_forward FROM agents.agent_chat_log ${whereOf(conds)}
           ORDER BY id DESC LIMIT ${limit + 1}`,
      );
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      const out: ChatRow[] = page.map((r) => {
        const isSystem = r.role === 'system';
        const text = clip(isSystem ? systemInner(r.text ?? '') : r.text ?? '', 20000);
        let kind: SystemEventKind | null = null;
        let agent: string | null = null;
        if (isSystem) {
          const c = classifySystem(text);
          kind = c.kind;
          if (c.kind.startsWith('agent_') && c.m) agent = clip(c.m[1], 32);
        }
        return { id: num(r.id), ts: isoReq(r.ts), role: r.role, text, isForward: !!r.is_forward, kind, agent };
      });
      return {
        installed: true,
        reason: 'ok',
        missingTables: [],
        rows: out,
        hasMore,
        nextBefore: hasMore && out.length ? out[out.length - 1].id : null,
        retentionDays: CHAT_RETENTION_DAYS,
      };
    });
  }

  // =========================================================================
  // #7 GET /agent-team/tasks · #8 GET /agent-team/promises
  // =========================================================================

  async tasks(q: Record<string, unknown>): Promise<AgentTeamTasks> {
    const page = intParam(q.page, 1, 1, 100_000);
    const perPage = intParam(q.perPage, 25, 1, 100);
    const emptyCounts = (): Record<TaskStatus, number> => ({ in_progress: 0, done: 0, failed: 0 });
    const empty = (st: InstallState): AgentTeamTasks => ({
      ...this.installFields(st),
      total: 0,
      page,
      perPage,
      counts: emptyCounts(),
      rows: [],
    });

    return this.guarded('tasks', empty, async () => {
      const base: Prisma.Sql[] = [];
      const agent = oneOf(q.agent, AGENT_NAMES);
      if (agent) base.push(Prisma.sql`agent = ${agent}`);
      const pat = likePattern(q.q);
      if (pat) base.push(Prisma.sql`(task ILIKE ${pat} ESCAPE '\\' OR result_preview ILIKE ${pat} ESCAPE '\\')`);
      const status = oneOf(q.status, TASK_STATUSES);
      const all = status ? [...base, Prisma.sql`status = ${status}`] : base;

      const [cnt, sc, rows] = await this.ro(
        this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM agents.agent_tasks ${whereOf(all)}`,
        this.prisma.$queryRaw<StatusCountRow[]>`
          SELECT status, COUNT(*)::int AS n FROM agents.agent_tasks ${whereOf(base)} GROUP BY status`,
        this.prisma.$queryRaw<
          {
            id: bigint;
            created_at: Date;
            updated_at: Date;
            agent: string;
            intent: string | null;
            source: string;
            is_forward: boolean;
            task: string;
            status: string;
            result_preview: string | null;
            run_id: bigint | null;
          }[]
        >`
          SELECT id, created_at, updated_at, agent, intent, source, is_forward, task, status,
                 result_preview, run_id
            FROM agents.agent_tasks ${whereOf(all)}
           ORDER BY id DESC
           LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
      );
      const counts = emptyCounts();
      for (const r of sc) if ((TASK_STATUSES as readonly string[]).includes(r.status)) counts[r.status as TaskStatus] = num(r.n);
      const out: TaskRow[] = rows.map((r) => ({
        id: num(r.id),
        createdAt: isoReq(r.created_at),
        updatedAt: isoReq(r.updated_at),
        agent: r.agent,
        intent: clipOrNull(r.intent, 32),
        source: r.source,
        isForward: !!r.is_forward,
        task: clip(r.task, 2000),
        status: r.status,
        resultPreview: clipOrNull(r.result_preview, 500),
        runId: numOrNull(r.run_id),
      }));
      return { installed: true, reason: 'ok', missingTables: [], total: num(cnt[0]?.n), page, perPage, counts, rows: out };
    });
  }

  async promises(q: Record<string, unknown>): Promise<AgentTeamPromises> {
    const status = oneOf(q.status, ['open', 'closed', 'all'] as const) ?? 'open';
    const limit = intParam(q.limit, 100, 1, 200);
    const empty = (st: InstallState): AgentTeamPromises => ({
      ...this.installFields(st),
      counts: { open: 0, closed: 0, overdue: 0 },
      maxReminders: PROMISE_MAX_REMINDERS,
      reminderIntervalS: PROMISE_REMINDER_S,
      rows: [],
    });

    return this.guarded('promises', empty, async () => {
      const now = new Date();
      type PromiseDbRow = {
        id: bigint;
        created_at: Date;
        due_at: Date;
        text: string;
        trigger: string | null;
        status: string;
        reminder_count: number;
        last_reminded_at: Date | null;
      };
      const rowsQ =
        status === 'open'
          ? this.prisma.$queryRaw<PromiseDbRow[]>`
              SELECT id, created_at, due_at, text, trigger, status, reminder_count, last_reminded_at
                FROM agents.agent_promises WHERE status = 'open'
               ORDER BY due_at ASC, id ASC LIMIT ${limit}`
          : status === 'closed'
            ? this.prisma.$queryRaw<PromiseDbRow[]>`
                SELECT id, created_at, due_at, text, trigger, status, reminder_count, last_reminded_at
                  FROM agents.agent_promises WHERE status <> 'open'
                 ORDER BY id DESC LIMIT ${limit}`
            : this.prisma.$queryRaw<PromiseDbRow[]>`
                SELECT id, created_at, due_at, text, trigger, status, reminder_count, last_reminded_at
                  FROM agents.agent_promises
                 ORDER BY id DESC LIMIT ${limit}`;
      const [cnt, rows] = await this.ro(
        this.prisma.$queryRaw<{ open: number; closed: number; overdue: number }[]>`
          SELECT COUNT(*) FILTER (WHERE status = 'open')::int AS open,
                 COUNT(*) FILTER (WHERE status <> 'open')::int AS closed,
                 COUNT(*) FILTER (WHERE status = 'open' AND due_at <= ${tz(now)})::int AS overdue
            FROM agents.agent_promises`,
        rowsQ,
      );
      const nowMs = now.getTime();
      const out: PromiseRow[] = rows.map((r) => {
        const dueMs = new Date(r.due_at).getTime();
        return {
          id: num(r.id),
          createdAt: isoReq(r.created_at),
          dueAt: isoReq(r.due_at),
          text: clip(r.text, 500),
          trigger: clipOrNull(r.trigger, 32),
          status: r.status,
          reminderCount: num(r.reminder_count),
          lastRemindedAt: iso(r.last_reminded_at),
          overdue: r.status === 'open' && Number.isFinite(dueMs) && dueMs <= nowMs,
        };
      });
      return {
        installed: true,
        reason: 'ok',
        missingTables: [],
        counts: { open: num(cnt[0]?.open), closed: num(cnt[0]?.closed), overdue: num(cnt[0]?.overdue) },
        maxReminders: PROMISE_MAX_REMINDERS,
        reminderIntervalS: PROMISE_REMINDER_S,
        rows: out,
      };
    });
  }

  // =========================================================================
  // #9 GET /agent-team/plans (Support REJA — tasdiq FAQAT Telegram'da)
  // =========================================================================

  private emptyPlanStats(): Record<PlanEventKind, number> {
    const o = {} as Record<PlanEventKind, number>;
    for (const k of PLAN_EVENT_KINDS) o[k] = 0;
    return o;
  }

  private planEventOf(id: number, ts: string, text: string): PlanEvent | null {
    const { kind, m } = classifySystem(text);
    if (!kind.startsWith('plan_')) return null;
    const ev: PlanEvent = {
      id,
      ts,
      kind: kind.slice(5) as PlanEventKind,
      text: clip(text, 2000),
      commit: null,
      files: null,
      risk: null,
      reason: null,
    };
    if (kind === 'plan_offered' && m) {
      ev.files = numOrNull(m[1]);
      ev.risk = clip(m[2], 20);
    } else if (kind === 'plan_applied' && m) {
      ev.commit = clip(m[1], 64);
      ev.files = numOrNull(m[2]);
    } else if ((kind === 'plan_failed' || kind === 'plan_rad') && m) {
      ev.reason = clip((m[1] ?? '').trim(), 300) || null;
    }
    return ev;
  }

  private pendingPlanOf(row: KvRow, nowMs: number): { token: string; plan: PendingPlan } | null {
    const p = safeJson(row.value);
    if (!isPlainObject(p)) return null;
    const token = row.k.slice('sup_appr_'.length);
    if (!token) return null;
    const createdMs = createdMsOf(p.created_ts, p.created);
    const createdIso = msIso(parseIsoMs(p.created)) ?? msIso(createdMs) ?? iso(row.updated_at);
    const expiresMs = createdMs !== null ? createdMs + APPROVAL_TTL_S * 1000 : null;
    const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
      Array.isArray(v) ? v.slice(0, maxItems).map((x) => clip(x, maxLen)) : [];
    const rawEdits = Array.isArray(p.edits) ? p.edits : [];
    const edits: PlanEditPreview[] = rawEdits.slice(0, 12).map((e) => {
      const o = isPlainObject(e) ? e : {};
      const find = typeof o.find === 'string' ? o.find : '';
      const replace = typeof o.replace === 'string' ? o.replace : '';
      // 'truncated' bayrog'i bor — '…' qo'shilmaydi (diff ko'rinishi buzilmasin), faqat surrogate xavfsiz kesish
      const findHead = cpHead(find, 600);
      const replaceHead = cpHead(replace, 600);
      return {
        file: clip(o.file, 300),
        find: findHead,
        replace: replaceHead,
        findLen: find.length,
        replaceLen: replace.length,
        truncated: findHead.length < find.length || replaceHead.length < replace.length,
        isNewFile: find === '',
      };
    });
    return {
      token,
      plan: {
        ref: token.slice(0, 8),
        createdAt: createdIso,
        expiresAt: msIso(expiresMs),
        expired: expiresMs === null || expiresMs <= nowMs,
        claimed: false,
        summary: clip(p.summary, 500),
        risk: clip(p.risk, 20),
        dangerFlags: strList(p.danger_flags, 10, 300),
        files: strList(p.files, 50, 300),
        edits,
        editsTotal: rawEdits.length,
        test: clip(p.test, 2000),
      },
    };
  }

  async plans(): Promise<AgentTeamPlans> {
    const empty = (st: InstallState): AgentTeamPlans => ({
      ...this.installFields(st),
      approvalTtlS: APPROVAL_TTL_S,
      exec: { active: false, ref: null, until: null, lockHeld: false },
      pending: [],
      history: [],
      stats30d: this.emptyPlanStats(),
    });

    return this.guarded('plans', empty, async () => {
      const now = new Date();
      const nowMs = now.getTime();
      const since = new Date(nowMs - 30 * DAY_MS);
      const [appr, execRows, hist, statRows] = await this.ro(
        this.prisma.$queryRaw<KvRow[]>`
          SELECT k, value, updated_at FROM agents.kv_store
           WHERE k LIKE 'sup!_appr!_%' ESCAPE '!'
           ORDER BY updated_at DESC LIMIT 20`,
        this.qKv(['sup_exec_active', 'sup_exec_lock']),
        this.prisma.$queryRaw<{ id: bigint; ts: Date; text: string }[]>`
          SELECT id, ts, text FROM agents.agent_chat_log
           WHERE role = 'system' AND text LIKE 'Support %' AND ts >= ${tz(since)}
           ORDER BY id DESC LIMIT 200`,
        this.prisma.$queryRaw<{ text: string }[]>`
          SELECT left(text, 200) AS text FROM agents.agent_chat_log
           WHERE role = 'system' AND text LIKE 'Support %' AND ts >= ${tz(since)}`,
      );

      const parsed = appr.map((r) => this.pendingPlanOf(r, nowMs)).filter((x) => x !== null);
      if (parsed.length) {
        const runKeys = parsed.map((x) => `sup_run_${x.token}`).filter((k) => k.length <= 64);
        if (runKeys.length) {
          const [claimed] = await this.ro(
            this.prisma.$queryRaw<{ k: string }[]>`
              SELECT k FROM agents.kv_store WHERE k IN (${Prisma.join(runKeys)})`,
          );
          const set = new Set(claimed.map((c) => c.k));
          for (const x of parsed) x.plan.claimed = set.has(`sup_run_${x.token}`);
        }
      }
      const pending = parsed
        .map((x) => x.plan)
        .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0));

      const kv = this.kvMap(execRows);
      const active = leaseOf(kv.get('sup_exec_active'), nowMs);
      const lock = leaseOf(kv.get('sup_exec_lock'), nowMs);
      const exec: PlanExecState = {
        active: active.active,
        ref: active.active ? active.ref : null,
        until: active.active ? msIso(active.untilMs) : null,
        lockHeld: lock.active,
      };

      const history: PlanEvent[] = [];
      for (const h of hist) {
        const ev = this.planEventOf(num(h.id), isoReq(h.ts), systemInner(h.text ?? ''));
        if (ev) history.push(ev);
      }
      const stats30d = this.emptyPlanStats();
      for (const s of statRows) {
        const { kind } = classifySystem(systemInner(s.text ?? ''));
        if (kind.startsWith('plan_')) stats30d[kind.slice(5) as PlanEventKind]++;
      }

      return {
        installed: true,
        reason: 'ok',
        missingTables: [],
        approvalTtlS: APPROVAL_TTL_S,
        exec,
        pending,
        history,
        stats30d,
      };
    });
  }

  // =========================================================================
  // #10 GET /agent-team/memory/log
  // =========================================================================

  private pendingMemoryOf(row: KvRow, nowMs: number): PendingMemoryWrite | null {
    const p = safeJson(row.value);
    if (!isPlainObject(p)) return null;
    const token = row.k.slice('tw_appr_'.length);
    if (!token) return null;
    const createdMs = createdMsOf(p.created_ts, p.created);
    const expiresMs = createdMs !== null ? createdMs + APPROVAL_TTL_S * 1000 : null;
    const blocks = (Array.isArray(p.blocks) ? p.blocks : []).slice(0, 20).map((b) => {
      const o = isPlainObject(b) ? b : {};
      return { path: clip(o.path, 300), mode: clip(o.mode, 16), content: clip(o.content, 1500) };
    });
    return {
      ref: token.slice(0, 8),
      createdAt: msIso(parseIsoMs(p.created)) ?? msIso(createdMs) ?? iso(row.updated_at),
      expiresAt: msIso(expiresMs),
      expired: expiresMs === null || expiresMs <= nowMs,
      manba: clip(p.manba, 200),
      sababTuri: clip(p.sabab_turi, 40),
      blocks,
    };
  }

  async memoryLog(q: Record<string, unknown>): Promise<AgentTeamMemoryLog> {
    const page = intParam(q.page, 1, 1, 100_000);
    const perPage = intParam(q.perPage, 25, 1, 100);
    const empty = (st: InstallState): AgentTeamMemoryLog => ({
      ...this.installFields(st),
      total: 0,
      page,
      perPage,
      counts: { ok: 0, rad: 0 },
      rows: [],
      pending: [],
    });

    return this.guarded('memoryLog', empty, async () => {
      const base: Prisma.Sql[] = [];
      const source = oneOf(q.source, MEMORY_SOURCES);
      if (source) base.push(Prisma.sql`source = ${source}`);
      const agent = oneOf(q.agent, AGENT_NAMES);
      if (agent) base.push(Prisma.sql`agent = ${agent}`);
      const pat = likePattern(q.q);
      if (pat) base.push(Prisma.sql`(content ILIKE ${pat} ESCAPE '\\' OR path ILIKE ${pat} ESCAPE '\\')`);
      const result = oneOf(q.result, ['ok', 'rad'] as const);
      const all =
        result === 'rad'
          ? [...base, Prisma.sql`result LIKE 'RAD:%'`]
          : result === 'ok'
            ? [...base, Prisma.sql`result NOT LIKE 'RAD:%'`]
            : base;

      const [cnt, counts, rows, appr] = await this.ro(
        this.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM agents.agent_memory ${whereOf(all)}`,
        this.prisma.$queryRaw<{ ok: number; rad: number }[]>`
          SELECT COUNT(*) FILTER (WHERE result NOT LIKE 'RAD:%')::int AS ok,
                 COUNT(*) FILTER (WHERE result LIKE 'RAD:%')::int AS rad
            FROM agents.agent_memory ${whereOf(base)}`,
        this.prisma.$queryRaw<
          {
            id: bigint;
            ts: Date;
            path: string;
            mode: string;
            source: string;
            agent: string | null;
            content: string;
            result: string;
          }[]
        >`
          SELECT id, ts, path, mode, source, agent, content, result
            FROM agents.agent_memory ${whereOf(all)}
           ORDER BY id DESC
           LIMIT ${perPage} OFFSET ${(page - 1) * perPage}`,
        this.prisma.$queryRaw<KvRow[]>`
          SELECT k, value, updated_at FROM agents.kv_store
           WHERE k LIKE 'tw!_appr!_%' ESCAPE '!'
           ORDER BY updated_at DESC LIMIT 20`,
      );
      const nowMs = Date.now();
      const out: MemoryLogRow[] = rows.map((r) => {
        const res = r.result ?? '';
        const rejected = res.startsWith('RAD:');
        return {
          id: num(r.id),
          ts: isoReq(r.ts),
          path: clip(r.path, 255),
          mode: r.mode,
          source: r.source,
          agent: r.agent ?? null,
          content: clip(r.content, 4000),
          result: clip(res, 255),
          rejected,
          rejectReason: rejected ? clip(res.replace(/^RAD:\s*/, ''), 255) : null,
        };
      });
      const pending = appr.map((r) => this.pendingMemoryOf(r, nowMs)).filter((x) => x !== null);
      return {
        installed: true,
        reason: 'ok',
        missingTables: [],
        total: num(cnt[0]?.n),
        page,
        perPage,
        counts: { ok: num(counts[0]?.ok), rad: num(counts[0]?.rad) },
        rows: out,
        pending,
      };
    });
  }

  // =========================================================================
  // #11 GET /agent-team/memory/files · #12 GET /agent-team/memory/file
  // =========================================================================

  private memoryGroupOf(name: string): MemoryFileGroup | null {
    if ((MEMORY_CORE_FILES as readonly string[]).includes(name)) return 'core';
    if ((MEMORY_AGENT_FILES as readonly string[]).includes(name)) return 'agent';
    if (DAILY_FILE_RE.test(name)) return 'daily';
    return null;
  }

  /** Oq ro'yxat nomi -> absolyut yo'l (MEMORY_DIR ichida), aks holda null. */
  private memoryPath(name: string): string | null {
    const root = path.resolve(this.memoryDir);
    const full = path.resolve(root, ...name.split('/'));
    return full.startsWith(root + path.sep) ? full : null;
  }

  /** lstat: oddiy fayl bo'lsa Stats, symlink/katalog/yo'q bo'lsa null. */
  private async regularFileStat(full: string): Promise<fs.Stats | null> {
    try {
      const st = await fs.promises.lstat(full);
      return st.isFile() && !st.isSymbolicLink() ? st : null;
    } catch {
      return null;
    }
  }

  private memoryMeta(name: string, group: MemoryFileGroup, st: fs.Stats | null): MemoryFileMeta {
    const inj = group === 'daily' ? null : MEMORY_INJECT[name] ?? null;
    return {
      name,
      group,
      exists: !!st,
      size: st ? st.size : 0,
      mtime: st ? new Date(st.mtimeMs).toISOString() : null,
      limitChars: inj ? inj.limit : null,
      injectMode: inj ? inj.mode : null,
    };
  }

  async memoryFiles(): Promise<AgentTeamMemoryFiles> {
    let dirExists = false;
    try {
      dirExists = (await fs.promises.stat(this.memoryDir)).isDirectory();
    } catch {
      dirExists = false;
    }
    const fixed: { name: string; group: MemoryFileGroup }[] = [
      ...MEMORY_CORE_FILES.map((name) => ({ name, group: 'core' as const })),
      ...MEMORY_AGENT_FILES.map((name) => ({ name, group: 'agent' as const })),
    ];
    const files: MemoryFileMeta[] = await Promise.all(
      fixed.map(async (f) => {
        const full = dirExists ? this.memoryPath(f.name) : null;
        return this.memoryMeta(f.name, f.group, full ? await this.regularFileStat(full) : null);
      }),
    );

    if (dirExists) {
      const dailyDir = path.join(this.memoryDir, 'daily');
      try {
        const dst = await fs.promises.lstat(dailyDir);
        if (dst.isDirectory() && !dst.isSymbolicLink()) {
          const names = (await fs.promises.readdir(dailyDir, { withFileTypes: true }))
            .filter((d) => d.isFile() && DAILY_NAME_RE.test(d.name))
            .map((d) => d.name)
            .sort()
            .reverse()
            .slice(0, MEMORY_DAILY_MAX);
          const metas = await Promise.all(
            names.map(async (n) => {
              const name = `daily/${n}`;
              const full = this.memoryPath(name);
              const st = full ? await this.regularFileStat(full) : null;
              return st ? this.memoryMeta(name, 'daily', st) : null;
            }),
          );
          for (const m of metas) if (m) files.push(m);
        }
      } catch {
        // daily/ yo'q — ro'yxat bo'sh
      }
    }
    return { dirExists, dir: MEMORY_REL_DIR, files };
  }

  async memoryFile(nameRaw: unknown): Promise<AgentTeamMemoryFile> {
    const name = typeof nameRaw === 'string' ? nameRaw.trim() : '';
    const group = name ? this.memoryGroupOf(name) : null;
    const full = group ? this.memoryPath(name) : null;
    if (!group || !full) throw new BadRequestException("Fayl nomi ruxsat etilmagan");

    const missing = (): AgentTeamMemoryFile => ({ ...this.memoryMeta(name, group, null), truncated: false, content: '' });
    const lst = await this.regularFileStat(full);
    if (!lst) return missing();
    // Oraliq katalog symlink bo'lsa ham MEMORY_DIR dan chiqib ketmasin
    try {
      const [realRoot, realFile] = await Promise.all([fs.promises.realpath(this.memoryDir), fs.promises.realpath(full)]);
      if (!realFile.startsWith(realRoot + path.sep)) return missing();
    } catch {
      return missing();
    }

    let fh: fs.promises.FileHandle | null = null;
    try {
      fh = await fs.promises.open(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const st = await fh.stat();
      if (!st.isFile()) return missing();
      const size = st.size;
      const len = Math.min(size, MEMORY_READ_MAX);
      const tail = MEMORY_TAIL_FILES.has(name);
      const pos = tail ? size - len : 0;
      const buf = Buffer.alloc(len);
      let off = 0;
      while (off < len) {
        const { bytesRead } = await fh.read(buf, off, len - off, pos + off);
        if (!bytesRead) break;
        off += bytesRead;
      }
      const truncated = size > MEMORY_READ_MAX;
      let content = buf.subarray(0, off).toString('utf8');
      if (truncated) content = tail ? content.replace(/^�+/, '') : content.replace(/�+$/, '');
      if (!tail || !truncated) content = content.replace(/^﻿/, '');
      return { ...this.memoryMeta(name, group, st), truncated, content };
    } catch {
      return missing();
    } finally {
      if (fh) await fh.close().catch(() => undefined);
    }
  }

  // =========================================================================
  // #13 GET /agent-team/health · #14 GET /agent-team/facts/section
  // =========================================================================

  async health(): Promise<AgentTeamHealth> {
    const now = new Date();
    const nowMs = now.getTime();
    const facts = this.factsState(await this.readFacts(), nowMs);
    const empty = (st: InstallState): AgentTeamHealth => ({
      ...this.installFields(st),
      checkerIntervalS: CHECKER_INTERVAL_S,
      checkerLastRunAt: null,
      nextCheckAt: null,
      components: [],
      alerts: [],
      facts,
      kv: [],
    });

    return this.guarded('health', empty, async () => {
      const [latest, recent, alerts, kvRows, groups] = await this.ro(
        this.prisma.$queryRaw<HealthLatestRow[]>`
          SELECT DISTINCT ON (component) component, status, message, details, ts
            FROM agents.agent_health
           ORDER BY component, ts DESC`,
        this.prisma.$queryRaw<{ component: string; ts: Date; status: string }[]>`
          SELECT component, ts, status FROM (
            SELECT component, ts, status,
                   row_number() OVER (PARTITION BY component ORDER BY ts DESC) AS rn
              FROM agents.agent_health
             WHERE ts >= ${tz(new Date(nowMs - 7 * DAY_MS))}
          ) x
           WHERE rn <= 12
           ORDER BY component, ts ASC`,
        this.prisma.$queryRaw<{ id: bigint; ts: Date; component: string; status: string; message: string | null }[]>`
          SELECT id, ts, component, status, message FROM agents.agent_alert_log
           WHERE ts >= ${tz(new Date(nowMs - 30 * DAY_MS))}
           ORDER BY id DESC LIMIT 100`,
        this.qKv([...KV_EXACT.map((x) => x.key), ...this.enabledKeys()]),
        this.prisma.$queryRaw<{ g: string | null; n: number; u: Date | null }[]>`
          SELECT substring(k from '^(agent_enabled_|sup_appr_|sup_run_|sup_done_|tw_appr_|tw_run_|facts_cache_)') AS g,
                 COUNT(*)::int AS n, MAX(updated_at) AS u
            FROM agents.kv_store
           WHERE k ~ '^(agent_enabled_|sup_appr_|sup_run_|sup_done_|tw_appr_|tw_run_|facts_cache_)'
           GROUP BY 1`,
      );

      // Komponentlar: HEALTH_COMPONENTS tartibida, keyin boshqalari alifbo bo'yicha
      const recentBy = new Map<string, { ts: string; status: HealthStatus }[]>();
      for (const r of recent) {
        if (!recentBy.has(r.component)) recentBy.set(r.component, []);
        recentBy.get(r.component).push({ ts: isoReq(r.ts), status: healthStatusOf(r.status) });
      }
      const order = new Map<string, number>(HEALTH_COMPONENTS.map((c, i) => [c, i]));
      const components: HealthComponentState[] = latest
        .map((r) => {
          let details: unknown = null;
          if (r.details !== null && r.details !== undefined && r.details !== '') {
            const parsed = safeJson(r.details);
            details = parsed === undefined ? clip(r.details, 4000) : parsed;
          }
          return {
            component: clip(r.component, 64),
            status: healthStatusOf(r.status),
            message: clipOrNull(r.message, 2000),
            details,
            ts: isoReq(r.ts),
            recent: recentBy.get(r.component) ?? [],
          };
        })
        .sort((a, b) => {
          const ia = order.has(a.component) ? order.get(a.component) : Number.MAX_SAFE_INTEGER;
          const ib = order.has(b.component) ? order.get(b.component) : Number.MAX_SAFE_INTEGER;
          return ia !== ib ? ia - ib : a.component.localeCompare(b.component);
        });

      const alertRows: AlertRow[] = alerts.map((a) => ({
        id: num(a.id),
        ts: isoReq(a.ts),
        component: clip(a.component, 64),
        status: a.status,
        message: clipOrNull(a.message, 2000),
      }));

      const kv = this.kvMap(kvRows);
      const checkerMs = parseIsoMs(kv.get('checker:last_full_run')?.value);

      return {
        installed: true,
        reason: 'ok',
        missingTables: [],
        checkerIntervalS: CHECKER_INTERVAL_S,
        checkerLastRunAt: msIso(checkerMs),
        nextCheckAt: checkerMs !== null ? msIso(checkerMs + CHECKER_INTERVAL_S * 1000) : null,
        components,
        alerts: alertRows,
        facts,
        kv: this.kvStates(kv, groups, nowMs),
      };
    });
  }

  /** Holat kalitlari — faqat xavfsiz ko'rinish (vaqt, lease until, '0'/'1', son). */
  private kvStates(kv: Map<string, KvRow>, groups: { g: string | null; n: number; u: Date | null }[], nowMs: number): KvKeyState[] {
    const out: KvKeyState[] = [];
    for (const { key, kind } of KV_EXACT) {
      const row = kv.get(key);
      const st: KvKeyState = {
        key,
        kind,
        present: !!row,
        updatedAt: row ? iso(row.updated_at) : null,
        value: null,
        count: null,
      };
      if (row) {
        if (kind === 'heartbeat' || kind === 'timestamp') {
          st.value = msIso(parseIsoMs(row.value));
        } else if (kind === 'date') {
          const v = (row.value ?? '').trim();
          st.value = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
        } else if (kind === 'lease') {
          st.value = msIso(leaseOf(row, nowMs).untilMs); // owner QAYTMAYDI
        } else if (kind === 'history') {
          const arr = safeJson(row.value);
          st.count = Array.isArray(arr) ? arr.length : null; // matn QAYTMAYDI
        }
      }
      out.push(st);
    }
    const gBy = new Map(groups.filter((g) => g.g).map((g) => [g.g, g]));
    for (const { prefix, kind } of KV_GROUPS) {
      const g = gBy.get(prefix);
      const st: KvKeyState = {
        key: `${prefix}*`,
        kind,
        present: !!g && num(g.n) > 0,
        updatedAt: g ? iso(g.u) : null,
        value: null,
        count: g ? num(g.n) : 0,
      };
      if (prefix === 'agent_enabled_') {
        const parts: string[] = [];
        for (const a of AGENT_NAMES) {
          const row = kv.get(`agent_enabled_${a}`);
          if (!row) continue;
          const v = (row.value ?? '').trim();
          parts.push(`${a}=${v === '0' || v === '1' ? v : '?'}`);
        }
        st.value = parts.length ? parts.join(' ') : null;
      }
      out.push(st);
    }
    return out;
  }

  async factsSection(keyRaw: unknown): Promise<AgentTeamFactsSection> {
    const key = oneOf(keyRaw, FACTS_SECTIONS);
    if (!key) throw new BadRequestException("Facts bo'limi noma'lum");
    const snap = await this.readFacts();
    const brief = this.factsBrief(snap, Date.now());
    const json = snap.json;
    return {
      exists: !!json,
      key,
      updatedAt: brief.updatedAt,
      data: json && Object.prototype.hasOwnProperty.call(json, key) ? json[key] ?? null : null,
    };
  }

  // =========================================================================
  // #15 GET /agent-team/settings
  // =========================================================================

  async settings(): Promise<AgentTeamSettings> {
    const { env, timeouts } = this.resolveEnv();
    const constants: AgentTeamConstants = {
      heartbeatS: HEARTBEAT_S,
      heartbeatWarnS: HEARTBEAT_WARN_S,
      heartbeatErrorS: HEARTBEAT_ERROR_S,
      checkerIntervalS: CHECKER_INTERVAL_S,
      checkerStartDelayS: CHECKER_START_DELAY_S,
      factsIntervalS: FACTS_INTERVAL_S,
      factsStaleS: FACTS_STALE_S,
      teacherDailyTime: '22:30',
      approvalTtlS: APPROVAL_TTL_S,
      promiseReminderS: PROMISE_REMINDER_S,
      promiseMaxReminders: PROMISE_MAX_REMINDERS,
      historyContextN: HISTORY_CONTEXT_N,
      retentionDays: { ...RETENTION_DAYS },
    };
    const agentRow = (name: AgentName, row: KvRow | undefined): AgentTeamSettingsAgent => ({
      name,
      enabled: enabledOf(row),
      enabledRaw: enabledRawOf(row),
      enabledUpdatedAt: row ? iso(row.updated_at) : null,
      timeoutS: timeouts[name],
      defaultModel: this.defaultModel(name, env),
    });
    const empty = (st: InstallState): AgentTeamSettings => ({
      ...this.installFields(st),
      env,
      agents: AGENT_NAMES.map((a) => agentRow(a, undefined)),
      constants,
    });

    return this.guarded('settings', empty, async () => {
      const [kvRows] = await this.ro(this.qKv(this.enabledKeys()));
      const kv = this.kvMap(kvRows);
      return {
        installed: true,
        reason: 'ok',
        missingTables: [],
        env,
        agents: AGENT_NAMES.map((a) => agentRow(a, kv.get(`agent_enabled_${a}`))),
        constants,
      };
    });
  }
}
