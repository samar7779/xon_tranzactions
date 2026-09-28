/**
 * Agent Support (Telegram agentlar jamoasi, @TRanSupport_bot) — web kuzatuv API javob tiplari.
 *
 * Manba: Python bot (repo ildizidagi agents/*.py) PostgreSQL'ning ALOHIDA `agents` sxemasiga yozadi
 * (DDL: agents/db_migrations.py, kalitlar: agents/contract.py). Backend bu sxemani FAQAT O'QIYDI.
 * Yagona yozuv: agents.kv_store dagi `agent_enabled_<nom>` ('1' | '0'), faqat AGENT_MANAGE bilan.
 *
 * Qoidalar (barcha javoblar uchun):
 *  - Vaqtlar ISO-8601 UTC satr (Date emas). Sana (kun) — 'YYYY-MM-DD', Toshkent (UTC+5).
 *  - BIGSERIAL/COUNT -> number (BigInt JSON'ga chiqmaydi).
 *  - Bot o'rnatilmagan bo'lsa (sxema yoki jadval yo'q) xato EMAS: installed=false va bo'sh qiymatlar
 *    (massivlar [], sonlar 0, qolganlari null). Maydonlar hech qachon undefined bo'lmaydi.
 *  - Sir qiymatlari (token, parol) hech qachon qaytarilmaydi — faqat boolean.
 *
 * Frontend nusxasi: frontend/lib/agent-team-types.ts (shu fayl bilan sinxron saqlang).
 */

// ---------------------------------------------------------------------------
// Oq ro'yxatlar (contract.py bilan harfma-harf)
// ---------------------------------------------------------------------------
export const AGENT_NAMES = ['leader', 'support', 'checker', 'teacher'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];

/** agent_runs.status (C.RUN_*) */
export const RUN_STATUSES = [
  'ok', 'empty', 'error', 'timeout', 'disabled', 'capped', 'rate_limited', 'no_prompt', 'bad_name',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];
/** Chaqirilmagan (bloklangan) statuslar — "blocked" ga yig'iladi. */
export const RUN_BLOCKED_STATUSES = ['disabled', 'capped', 'rate_limited', 'no_prompt', 'bad_name'] as const;
/** Kunlik chegaraga (AGENT_DAILY_CAP) KIRMAYDIGAN statuslar (runner.UNCOUNTED_STATUSES). */
export const RUN_UNCOUNTED_STATUSES = ['disabled', 'capped', 'rate_limited', 'bad_name'] as const;

/** agent_runs.source */
export const RUN_SOURCES = ['dm', 'deleg', 'synth', 'fon', 'checker', 'teacher_daily', 'manual'] as const;
export type RunSource = (typeof RUN_SOURCES)[number];

/** agent_tasks.status */
export const TASK_STATUSES = ['in_progress', 'done', 'failed'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** agent_tasks.intent (Leader JSON) */
export const TASK_INTENTS = ['diagnose', 'fix', 'check', 'remember', 'just_answer'] as const;
/** agent_tasks.source */
export const TASK_SOURCES = ['dm', 'fon'] as const;

/** agent_chat_log.role */
export const CHAT_ROLES = ['owner', 'leader', 'system'] as const;
export type ChatRole = (typeof CHAT_ROLES)[number];

/** agent_health.status / agent_alert_log.status */
export const HEALTH_STATUSES = ['ok', 'warn', 'error', 'unknown'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];
/** checker_worker.CHECKS tartibida */
export const HEALTH_COMPONENTS = [
  'services', 'db', 'disk', 'facts', 'leader_bot', 'deploy', 'bank_sync', 'sverka', 'xonpay',
  'google_export', 'oplatykv_sync', 'agents',
] as const;

/** agent_memory.source / mode */
export const MEMORY_SOURCES = ['trigger', 'deleg', 'fon', 'forward', 'daily'] as const;
export const MEMORY_MODES = ['append', 'write'] as const;

/** support_facts.json bo'limlari (C.FACTS_UMUMIY_KALITLAR + C.FACTS_LOYIHA_KALITLARI, updated_at'siz) */
export const FACTS_SECTIONS = [
  'system', 'schedulers', 'deploy', 'agent_tasks',
  'client_income', 'bank_flow', 'balances', 'bank_sync', 'hamkorbank', 'sverka', 'crm_sverka',
  'xato', 'oplatykv_sync', 'bank_changes', 'xonpay', 'google_export', 'api_usage',
  'telegram_notify', 'counterparties', 'panel_activity',
] as const;
export type FactsSectionKey = (typeof FACTS_SECTIONS)[number];

/** agents sxemasidagi jadvallar (db_migrations.TABLES) */
export const AGENT_TABLES = [
  'kv_store', 'agent_runs', 'agent_tasks', 'agent_memory', 'agent_health',
  'agent_promises', 'agent_alert_log', 'agent_chat_log',
] as const;

/** Xotira fayllari oq ro'yxati (agents/memory/ ichida). Kunlik: DAILY_FILE_RE. */
export const MEMORY_CORE_FILES = ['INDEX.md', 'leader.md', 'learned.md', 'leader-runtime.md'] as const;
export const MEMORY_AGENT_FILES = ['support.md', 'checker.md', 'teacher.md'] as const;
export const DAILY_FILE_RE = /^daily\/(\d{4}-\d{2}-\d{2})\.md$/;

// ---------------------------------------------------------------------------
// Umumiy
// ---------------------------------------------------------------------------
export type NotInstalledReason = 'no_schema' | 'no_tables' | 'no_permission' | 'db_error';

/** Har DB'ga bog'liq javob shu maydonlar bilan boshlanadi. */
export interface InstallState {
  /** agents sxemasi va 8 ta jadvalning hammasi bor va o'qiladi */
  installed: boolean;
  reason: 'ok' | NotInstalledReason;
  /** reason='no_tables' da yo'q jadvallar nomi */
  missingTables: string[];
}

/** Statuslar bo'yicha yig'indi. blocked = disabled+capped+rate_limited+no_prompt+bad_name. */
export interface RunCounts {
  total: number;
  ok: number;
  empty: number;
  error: number;
  timeout: number;
  blocked: number;
}

// ---------------------------------------------------------------------------
// GET /agent-team/overview
// ---------------------------------------------------------------------------
/** Heartbeat yoshi: <=180 s live, <=600 s stale, >600 s offline, kalit yo'q -> unknown. */
export type BotLiveStatus = 'live' | 'stale' | 'offline' | 'unknown';

export interface BotState {
  username: string;                 // '@TRanSupport_bot'
  service: string;                  // 'xon-tranzactions-leader'
  liveStatus: BotLiveStatus;
  heartbeatAt: string | null;       // kv leader_heartbeat
  heartbeatAgeSec: number | null;
  rateLimitedUntil: string | null;  // kv agents_rate_limit_until — faqat kelajakda bo'lsa
  planExecuting: boolean;           // kv sup_exec_active lease amal qilyapti
  planExecutingUntil: string | null;
  checkerLastRunAt: string | null;  // kv checker:last_full_run
  teacherLastDay: string | null;    // kv teacher_daily_last_run ('YYYY-MM-DD')
  cleanupLastAt: string | null;     // kv cleanup_last
}

/** Faqat mavjudligi. Qiymat HECH QACHON qaytmaydi. */
export interface SecretsPresence {
  setupToken: boolean;              // ANTHROPIC_SETUP_TOKEN
  botToken: boolean;                // LEADER_BOT_TOKEN
}

export interface TodayStats extends RunCounts {
  /** Kunlik chegaraga kiradiganlar (RUN_UNCOUNTED_STATUSES dan tashqari) */
  counted: number;
  /** Faqat status='ok' qatorlar o'rtachasi */
  avgDurationMs: number | null;
  lastRunAt: string | null;
}

export interface AgentBrief {
  name: AgentName;
  /** kv agent_enabled_<nom> != '0' (yozuv yo'q = yoqilgan) */
  enabled: boolean;
  today: RunCounts;
  lastRunAt: string | null;
  lastStatus: string | null;        // RunStatus (DB'dan kelgani uchun string)
  lastSource: string | null;        // RunSource
  /** agent_tasks.status='in_progress' va updated_at oxirgi 30 daqiqada */
  inProgress: number;
  /** Bugun Leader'dan topshiriq (source='deleg') soni — diagramma chizig'i uchun */
  delegToday: number;
}

export interface PendingCounts {
  plans: number;                    // kv sup_appr_* (muddati o'tmagan)
  memoryWrites: number;             // kv tw_appr_* (muddati o'tmagan)
  openPromises: number;
  overduePromises: number;          // open va due_at <= now
  tasksInProgress: number;
}

/** fresh <=900 s, stale <=1800 s, old >1800 s, missing = fayl yo'q/o'qilmadi */
export type FactsFreshness = 'fresh' | 'stale' | 'old' | 'missing';

export interface FactsBrief {
  exists: boolean;
  updatedAt: string | null;
  ageSec: number | null;
  freshness: FactsFreshness;
  /** {error, izoh} shaklidagi (xato bergan) bo'limlar soni */
  errorSections: number;
}

export interface HealthBrief {
  /** Har komponent oxirgi holatining eng yomoni (null = yozuv yo'q) */
  worst: HealthStatus | null;
  counts: Record<HealthStatus, number>;
  checkedAt: string | null;         // eng oxirgi agent_health.ts
}

export interface AgentTeamOverview extends InstallState {
  serverTime: string;
  bot: BotState;
  /** env'dan — installed=false bo'lsa ham to'ldiriladi */
  secrets: SecretsPresence;
  today: TodayStats;
  /** max(agent_runs.ts, agent_chat_log.ts) */
  lastActivityAt: string | null;
  /** Har doim 4 ta, AGENT_NAMES tartibida */
  agents: AgentBrief[];
  pending: PendingCounts;
  /** Fayldan — installed=false bo'lsa ham to'ldiriladi */
  facts: FactsBrief;
  health: HealthBrief;
}

// ---------------------------------------------------------------------------
// GET /agent-team/agents   ·   PUT /agent-team/agents/:name/enabled
// ---------------------------------------------------------------------------
export interface DayPoint {
  date: string;                     // 'YYYY-MM-DD' Toshkent
  total: number;
  ok: number;
  /** error + timeout */
  failed: number;
}

export interface AgentLastError {
  id: number;
  ts: string;
  status: string;                   // 'error' | 'timeout'
  source: string | null;
  error: string | null;
}

export interface AgentStats extends AgentBrief {
  enabledRaw: string | null;        // kv qiymati: '0' | '1' | null (yozuv yo'q)
  enabledUpdatedAt: string | null;
  /** Oxirgi chaqiruvda ishlatilgan model (agent_runs.model) */
  model: string | null;
  /** env bo'yicha kutilgan: checker -> AGENTS_MODEL_FAST, qolganlari -> AGENTS_MODEL_STRONG */
  defaultModel: string;
  /** AGENT_TIMEOUT_S_<AGENT> -> AGENT_TIMEOUT_S -> 180 */
  timeoutS: number;
  todayCounted: number;
  dailyCap: number;
  /** Oxirgi 7 Toshkent kuni (bugun bilan) */
  week: RunCounts;
  avgDurationMs7d: number | null;   // faqat ok
  p95DurationMs7d: number | null;   // faqat ok
  /** ok / (total - blocked), 0..1; chaqiruv bo'lmasa null */
  successRate7d: number | null;
  /** 7 ta nuqta, eskidan yangiga (oxirgisi bugun), bo'sh kun 0 bilan */
  series: DayPoint[];
  /** Oxirgi status IN ('error','timeout') qator (muddatsiz) */
  lastError: AgentLastError | null;
}

export interface AgentTeamAgents extends InstallState {
  dailyCap: number;
  /** Har doim 4 ta, AGENT_NAMES tartibida (installed=false da ham, nol qiymatlar bilan) */
  agents: AgentStats[];
}

/** PUT body: { enabled: boolean }. O'rnatilmagan bo'lsa 409. Nom oq ro'yxatda bo'lmasa 400. */
export interface ToggleAgentBody {
  enabled: boolean;
}
export interface ToggleAgentResponse {
  ok: true;
  name: AgentName;
  enabled: boolean;
  /** kv'ga yozilgan qiymat */
  value: '0' | '1';
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// GET /agent-team/runs   ·   GET /agent-team/runs/:id
// ---------------------------------------------------------------------------
export interface AgentRunRow {
  id: number;
  ts: string;
  agent: string;
  model: string | null;
  status: string;
  source: string | null;
  durationMs: number | null;
  returncode: number | null;
  taskPreview: string | null;       // <=500 belgi, bot sirlarni maskalagan
  responsePreview: string | null;   // <=500 belgi
  error: string | null;             // <=500 belgi
}

/**
 * So'rov: ?agent=<AgentName>&status=<RunStatus[,RunStatus]>&source=<RunSource>
 *         &from=YYYY-MM-DD&to=YYYY-MM-DD (Toshkent kuni, ikkalasi ham kiradi)
 *         &q=<matn, task/response/error ILIKE>&page=1&perPage=25 (<=100)
 * Oq ro'yxatda bo'lmagan qiymat e'tiborsiz qoldiriladi (filtrsiz).
 */
export interface AgentTeamRuns extends InstallState {
  total: number;
  page: number;
  perPage: number;
  /** id DESC */
  rows: AgentRunRow[];
  /** Joriy filtr bo'yicha (status filtrisiz) har status soni — facet chiplar uchun */
  statusCounts: Record<string, number>;
}

export interface AgentTeamRun extends InstallState {
  row: AgentRunRow | null;
}

// ---------------------------------------------------------------------------
// GET /agent-team/chat
// ---------------------------------------------------------------------------
/** SISTEMA (role='system') matni contract.py shablonlari bo'yicha tasniflanadi. */
export type SystemEventKind =
  | 'plan_offered'      // Support ruxsat so'rayapti — {n} fayl, xavf: {risk}
  | 'plan_applied'      // Support APPROVED bajarildi — commit {hash}, {n} fayl
  | 'plan_failed'       // Support APPROVED BAJARILMADI — {sabab}
  | 'plan_rejected'     // Support REJA RAD ETILDI — egasi [Yo'q] bosdi
  | 'plan_rad'          // Support REJA RAD — {sabab}
  | 'plan_env'          // Support .env so'radi — rad etildi
  | 'agent_ok'          // {agent} agent muvaffaqiyatli javob berdi. Qisqacha: ...
  | 'agent_empty'       // {agent} agent chaqirildi ammo bo'sh javob keldi
  | 'agent_not_called'  // {agent} agent CHAQIRILMADI — {sabab}. Vazifa BAJARILMADI
  | 'agent_error'       // {agent} agent XATOGA UCHRADI: {xato}. Vazifa BAJARILMADI
  | 'memory_code'       // kod tomonidan yozildi (Teacher chetlab o'tildi): ...
  | 'memory_teacher'    // teacher xotiraga yozdi. Qisqacha: ...
  | 'memory_pending'    // teacher yozuvi tasdiq kutmoqda — hali YOZILMAGAN
  | 'memory_rad'        // teacher yozuvi RAD — {sabab}
  | 'other';

export interface ChatRow {
  id: number;
  ts: string;
  role: string;                     // ChatRole
  text: string;                     // system: SISTEMA ichki matni ("[SISTEMA: " va "]" siz)
  isForward: boolean;
  /** Faqat role='system' uchun, qolganlarida null */
  kind: SystemEventKind | null;
  /** kind agent_* bo'lsa — agent nomi, aks holda null */
  agent: string | null;
}

/**
 * So'rov: ?role=owner|leader|system&q=<ILIKE>&from=YYYY-MM-DD&to=YYYY-MM-DD&forward=1
 *         &before=<id> (kursor: shu id dan kichiklar)&limit=60 (<=200)
 */
export interface AgentTeamChat extends InstallState {
  /** id DESC (yangidan eskiga) */
  rows: ChatRow[];
  hasMore: boolean;
  /** Keyingi sahifa uchun before qiymati (rows oxirgi id), hasMore=false bo'lsa null */
  nextBefore: number | null;
  retentionDays: number;            // 30
}

// ---------------------------------------------------------------------------
// GET /agent-team/tasks   ·   GET /agent-team/promises
// ---------------------------------------------------------------------------
export interface TaskRow {
  id: number;
  createdAt: string;
  updatedAt: string;
  agent: string;
  intent: string | null;
  source: string;                   // dm | fon
  isForward: boolean;
  task: string;                     // <=2000 belgi
  status: string;                   // TaskStatus
  resultPreview: string | null;     // <=500 belgi
  runId: number | null;             // agent_runs.id
}

/** So'rov: ?status=in_progress|done|failed&agent=<AgentName>&q=<ILIKE>&page=1&perPage=25 (<=100) */
export interface AgentTeamTasks extends InstallState {
  total: number;
  page: number;
  perPage: number;
  /** status filtrisiz, boshqa filtrlar bilan */
  counts: Record<TaskStatus, number>;
  /** id DESC */
  rows: TaskRow[];
}

export interface PromiseRow {
  id: number;
  createdAt: string;
  dueAt: string;
  text: string;                     // <=500 belgi
  trigger: string | null;
  status: string;                   // open | closed
  reminderCount: number;
  lastRemindedAt: string | null;
  /** status='open' va dueAt <= hozir */
  overdue: boolean;
}

/** So'rov: ?status=open|closed|all (default open)&limit=100 (<=200) */
export interface AgentTeamPromises extends InstallState {
  counts: { open: number; closed: number; overdue: number };
  maxReminders: number;             // 3
  reminderIntervalS: number;        // 1500
  /** open: due_at ASC; closed/all: id DESC */
  rows: PromiseRow[];
}

// ---------------------------------------------------------------------------
// GET /agent-team/plans   (Support REJA — tasdiq FAQAT Telegram'da)
// ---------------------------------------------------------------------------
export interface PlanEditPreview {
  file: string;
  find: string;                     // <=600 belgi
  replace: string;                  // <=600 belgi
  findLen: number;
  replaceLen: number;
  truncated: boolean;
  /** find === '' -> yangi fayl */
  isNewFile: boolean;
}

export interface PendingPlan {
  /** Token'ning birinchi 8 belgisi (to'liq token qaytmaydi) */
  ref: string;
  createdAt: string | null;
  /** createdAt + approvalTtlS */
  expiresAt: string | null;
  expired: boolean;
  /** kv sup_run_<token> bor — qaror qabul qilingan, ijro kutilmoqda/bormoqda */
  claimed: boolean;
  summary: string;
  risk: string;                     // past | orta | yuqori
  dangerFlags: string[];
  files: string[];
  /** Ko'pi bilan 12 ta */
  edits: PlanEditPreview[];
  editsTotal: number;
  test: string;                     // <=2000 belgi
}

export type PlanEventKind = 'offered' | 'applied' | 'failed' | 'rejected' | 'rad' | 'env';
export const PLAN_EVENT_KINDS: readonly PlanEventKind[] = ['offered', 'applied', 'failed', 'rejected', 'rad', 'env'];

export interface PlanEvent {
  id: number;                       // agent_chat_log.id
  ts: string;
  kind: PlanEventKind;
  text: string;                     // SISTEMA ichki matni
  commit: string | null;            // applied
  files: number | null;             // offered | applied
  risk: string | null;              // offered
  reason: string | null;            // failed | rad
}

export interface PlanExecState {
  /** kv sup_exec_active lease hozir amal qilyapti */
  active: boolean;
  /** lease egasi token'ining birinchi 8 belgisi */
  ref: string | null;
  until: string | null;
  /** kv sup_exec_lock lease amal qilyapti */
  lockHeld: boolean;
}

export interface AgentTeamPlans extends InstallState {
  approvalTtlS: number;             // 600
  exec: PlanExecState;
  /** kv sup_appr_* (created DESC) */
  pending: PendingPlan[];
  /** agent_chat_log system 'Support ...' yozuvlari, oxirgi 30 kun, id DESC, <=200 */
  history: PlanEvent[];
  stats30d: Record<PlanEventKind, number>;
}

// ---------------------------------------------------------------------------
// GET /agent-team/memory/log · /memory/files · /memory/file
// ---------------------------------------------------------------------------
export interface MemoryLogRow {
  id: number;
  ts: string;
  path: string;
  mode: string;                     // append | write
  source: string;                   // MEMORY_SOURCES
  agent: string | null;
  content: string;                  // <=4000 belgi (bot sirlarni maskalagan)
  result: string;                   // natija yoki "RAD: <sabab>"
  rejected: boolean;                // result 'RAD:' bilan boshlanadi
  rejectReason: string | null;
}

export interface PendingMemoryWrite {
  ref: string;                      // token'ning birinchi 8 belgisi
  createdAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  manba: string;
  sababTuri: string;                // fon | forward
  blocks: { path: string; mode: string; content: string /* <=1500 */ }[];
}

/** So'rov: ?source=<MEMORY_SOURCES>&agent=<AgentName>&result=ok|rad&q=<ILIKE>&page=1&perPage=25 (<=100) */
export interface AgentTeamMemoryLog extends InstallState {
  total: number;
  page: number;
  perPage: number;
  counts: { ok: number; rad: number };
  /** id DESC */
  rows: MemoryLogRow[];
  /** kv tw_appr_* — Telegram'da [Ha]/[Yo'q] kutmoqda */
  pending: PendingMemoryWrite[];
}

export type MemoryFileGroup = 'core' | 'agent' | 'daily';

export interface MemoryFileMeta {
  /** 'INDEX.md' | 'learned.md' | ... | 'daily/2026-09-28.md' (agents/memory/ ga nisbatan) */
  name: string;
  group: MemoryFileGroup;
  exists: boolean;
  size: number;
  mtime: string | null;
  /** Promptga qo'shilish chegarasi (contract.MEMORY_FILES), yo'q bo'lsa null */
  limitChars: number | null;
  injectMode: 'head' | 'tail' | null;
}

/** Fayl tizimidan — DB'ga bog'liq emas (installed yo'q). */
export interface AgentTeamMemoryFiles {
  dirExists: boolean;
  dir: string;                      // 'agents/memory'
  /** core va agent fayllari har doim (exists=false bo'lsa ham), daily — mavjudlari, sana DESC, <=60 */
  files: MemoryFileMeta[];
}

/** So'rov: ?name=<oq ro'yxat nomi>. Noto'g'ri nom -> 400. Fayl yo'q -> exists=false, content=''. */
export interface AgentTeamMemoryFile extends MemoryFileMeta {
  /** 256 KB dan oshsa kesiladi: learned.md va leader-runtime.md — oxiri, qolganlari — boshi */
  truncated: boolean;
  content: string;
}

// ---------------------------------------------------------------------------
// GET /agent-team/health · GET /agent-team/facts/section
// ---------------------------------------------------------------------------
export interface HealthComponentState {
  component: string;
  status: HealthStatus;
  message: string | null;
  /** details JSON (parse bo'lmasa satr sifatida), yo'q bo'lsa null */
  details: unknown;
  ts: string;
  /** Oxirgi 12 tekshiruv, eskidan yangiga */
  recent: { ts: string; status: HealthStatus }[];
}

export interface AlertRow {
  id: number;
  ts: string;
  component: string;
  status: string;
  message: string | null;
}

export interface FactsSection {
  key: string;
  ok: boolean;
  error: string | null;
  izoh: string | null;              // <=300 belgi
}

export interface FactsState extends FactsBrief {
  path: string;                     // 'agents/state/support_facts.json'
  sizeBytes: number | null;
  staleAfterS: number;              // 900
  intervalS: number;                // 300
  parseError: boolean;
  /** FACTS_SECTIONS tartibida (faylda borlari) */
  sections: FactsSection[];
}

export type KvKeyKind = 'heartbeat' | 'timestamp' | 'date' | 'lease' | 'flag' | 'counter' | 'history';

export interface KvKeyState {
  /** Aniq kalit yoki prefiks guruhi: 'sup_appr_*', 'agent_enabled_*' */
  key: string;
  kind: KvKeyKind;
  present: boolean;
  updatedAt: string | null;
  /** Xavfsiz ko'rinish: vaqt, lease 'until', '0'/'1', son. Boshqa hech narsa. */
  value: string | null;
  /** prefiks guruhlari va history uchun element soni */
  count: number | null;
}

export interface AgentTeamHealth extends InstallState {
  checkerIntervalS: number;         // 14400
  checkerLastRunAt: string | null;
  /** checkerLastRunAt + checkerIntervalS */
  nextCheckAt: string | null;
  /** Har komponentning oxirgi holati, HEALTH_COMPONENTS tartibida, keyin boshqalari */
  components: HealthComponentState[];
  /** Oxirgi 30 kun, id DESC, <=100 */
  alerts: AlertRow[];
  facts: FactsState;
  kv: KvKeyState[];
}

/** So'rov: ?key=<FACTS_SECTIONS>. Noto'g'ri kalit -> 400. */
export interface AgentTeamFactsSection {
  exists: boolean;
  key: string;
  updatedAt: string | null;
  /** Bo'lim JSON'i (yo'q bo'lsa null) */
  data: unknown;
}

// ---------------------------------------------------------------------------
// GET /agent-team/settings (faqat o'qish)
// ---------------------------------------------------------------------------
export interface AgentTeamEnv {
  setupToken: boolean;              // ANTHROPIC_SETUP_TOKEN bor
  botToken: boolean;                // LEADER_BOT_TOKEN bor
  ownerTgId: string | null;         // LEADER_TG_ID (yo'q bo'lsa null; bot default 1954122311)
  ownerTgIdMatches: boolean;        // bo'sh yoki 1954122311
  useCli: boolean;                  // AGENTS_USE_CLI === '1'
  agentOsUser: string | null;       // AGENT_OS_USER (foydalanuvchi nomi, sir emas)
  claudeCmd: string | null;         // CLAUDE_CMD
  anthropicBaseUrl: boolean;        // ANTHROPIC_BASE_URL bor (qiymat qaytmaydi)
  modelStrong: string;              // AGENTS_MODEL_STRONG || 'claude-opus-5-5'
  modelFast: string;                // AGENTS_MODEL_FAST || 'claude-sonnet-5'
  dailyCap: number;                 // AGENT_DAILY_CAP || 200
  timeoutS: number;                 // AGENT_TIMEOUT_S || 180
  /** backend/.env da v1 leader faol (LEADER_ENABLED != '0' va LEADER_OWNER_TG_IDS bor) — 409 xavfi */
  v1LeaderActive: boolean;
  /** Qiymatlar qayerdan o'qildi: backend process.env, AGENTS_ENV_FILE fayli yoki ikkalasi */
  source: 'process' | 'env_file' | 'mixed' | 'none';
}

export interface AgentTeamSettingsAgent {
  name: AgentName;
  enabled: boolean;
  enabledRaw: string | null;
  enabledUpdatedAt: string | null;
  timeoutS: number;
  defaultModel: string;
}

export interface AgentTeamConstants {
  heartbeatS: number;               // 60
  heartbeatWarnS: number;           // 180
  heartbeatErrorS: number;          // 600
  checkerIntervalS: number;         // 14400
  checkerStartDelayS: number;       // 45
  factsIntervalS: number;           // 300
  factsStaleS: number;              // 900
  teacherDailyTime: string;         // '22:30'
  approvalTtlS: number;             // 600
  promiseReminderS: number;         // 1500
  promiseMaxReminders: number;      // 3
  historyContextN: number;          // 12
  retentionDays: Record<string, number>;
}

export interface AgentTeamSettings extends InstallState {
  env: AgentTeamEnv;
  agents: AgentTeamSettingsAgent[];
  constants: AgentTeamConstants;
}
