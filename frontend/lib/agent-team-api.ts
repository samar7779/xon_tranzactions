/**
 * Agent Support (@TRanSupport_bot jamoasi) — backend /agent-team API klienti.
 * Loyiha api.ts naqshida: JWT, timeout, xato -> ApiError (toast uchun e.message).
 *
 * Qoidalar:
 *  - Barcha GET'lar AGENT_VIEW, yagona yozuv (setAgentEnabled) AGENT_MANAGE talab qiladi.
 *  - Bot o'rnatilmagan bo'lsa GET'lar xato bermaydi: javobda installed=false.
 *  - Support REJA tasdig'i ([Ha]/[Yo'q]) bu yerda YO'Q — faqat Telegram'da.
 *  - React Query kalitlari va yangilanish oraliqlari shu yerda (hamma ko'rinish bir xil ishlatadi).
 */
import { api } from '@/lib/api';
import type {
  AgentName,
  AgentTeamAgents,
  AgentTeamChat,
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
  AgentTeamTasks,
  ToggleAgentResponse,
} from '@/lib/agent-team-types';

const BASE = '/agent-team';

/** undefined / null / '' qiymatlarni tashlab query satr quradi ('?a=1&b=x' yoki ''). */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'boolean') {
      if (v) sp.set(k, '1');
      continue;
    }
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ---------------------------------------------------------------------------
// So'rov parametrlari (backend agent-team.types.ts dagi izohlar bilan bir xil)
// ---------------------------------------------------------------------------
export interface RunsParams {
  agent?: AgentName | '';
  /** bitta yoki vergulli ro'yxat: 'error,timeout' */
  status?: string;
  source?: string;
  /** 'YYYY-MM-DD' (Toshkent) */
  from?: string;
  to?: string;
  q?: string;
  page?: number;
  perPage?: number;
}

export interface ChatParams {
  role?: 'owner' | 'leader' | 'system' | '';
  q?: string;
  from?: string;
  to?: string;
  forward?: boolean;
  /** kursor: shu id dan kichik yozuvlar */
  before?: number | null;
  limit?: number;
}

export interface TasksParams {
  status?: 'in_progress' | 'done' | 'failed' | '';
  agent?: AgentName | '';
  q?: string;
  page?: number;
  perPage?: number;
}

export interface PromisesParams {
  status?: 'open' | 'closed' | 'all';
  limit?: number;
}

export interface MemoryLogParams {
  source?: string;
  agent?: AgentName | '';
  result?: 'ok' | 'rad' | '';
  q?: string;
  page?: number;
  perPage?: number;
}

// ---------------------------------------------------------------------------
// Fetch funksiyalari
// ---------------------------------------------------------------------------
export const agentTeamApi = {
  overview: () => api.get<AgentTeamOverview>(`${BASE}/overview`),
  agents: () => api.get<AgentTeamAgents>(`${BASE}/agents`),
  /** AGENT_MANAGE. O'rnatilmagan bo'lsa 409, noto'g'ri nom 400. */
  setAgentEnabled: (name: AgentName, enabled: boolean) =>
    api.put<ToggleAgentResponse>(`${BASE}/agents/${encodeURIComponent(name)}/enabled`, { enabled }),

  runs: (p: RunsParams = {}) =>
    api.get<AgentTeamRuns>(`${BASE}/runs${qs({ ...p })}`),
  run: (id: number) => api.get<AgentTeamRun>(`${BASE}/runs/${encodeURIComponent(String(id))}`),

  chat: (p: ChatParams = {}) =>
    api.get<AgentTeamChat>(`${BASE}/chat${qs({ ...p })}`),

  tasks: (p: TasksParams = {}) =>
    api.get<AgentTeamTasks>(`${BASE}/tasks${qs({ ...p })}`),
  promises: (p: PromisesParams = {}) =>
    api.get<AgentTeamPromises>(`${BASE}/promises${qs({ ...p })}`),

  plans: () => api.get<AgentTeamPlans>(`${BASE}/plans`),

  memoryLog: (p: MemoryLogParams = {}) =>
    api.get<AgentTeamMemoryLog>(`${BASE}/memory/log${qs({ ...p })}`),
  memoryFiles: () => api.get<AgentTeamMemoryFiles>(`${BASE}/memory/files`),
  /** name: 'INDEX.md' | 'learned.md' | 'daily/2026-09-28.md' ... (oq ro'yxat) */
  memoryFile: (name: string) =>
    api.get<AgentTeamMemoryFile>(`${BASE}/memory/file${qs({ name })}`),

  health: () => api.get<AgentTeamHealth>(`${BASE}/health`),
  factsSection: (key: string) =>
    api.get<AgentTeamFactsSection>(`${BASE}/facts/section${qs({ key })}`),

  settings: () => api.get<AgentTeamSettings>(`${BASE}/settings`),
};

// ---------------------------------------------------------------------------
// React Query kalitlari — invalidatsiya uchun prefiks: ['agent-team']
// ---------------------------------------------------------------------------
export const agentTeamKeys = {
  all: ['agent-team'] as const,
  overview: () => ['agent-team', 'overview'] as const,
  agents: () => ['agent-team', 'agents'] as const,
  runs: (p: RunsParams) => ['agent-team', 'runs', p] as const,
  run: (id: number) => ['agent-team', 'run', id] as const,
  chat: (p: Omit<ChatParams, 'before'>) => ['agent-team', 'chat', p] as const,
  tasks: (p: TasksParams) => ['agent-team', 'tasks', p] as const,
  promises: (p: PromisesParams) => ['agent-team', 'promises', p] as const,
  plans: () => ['agent-team', 'plans'] as const,
  memoryLog: (p: MemoryLogParams) => ['agent-team', 'memory-log', p] as const,
  memoryFiles: () => ['agent-team', 'memory-files'] as const,
  memoryFile: (name: string) => ['agent-team', 'memory-file', name] as const,
  health: () => ['agent-team', 'health'] as const,
  factsSection: (key: string) => ['agent-team', 'facts-section', key] as const,
  settings: () => ['agent-team', 'settings'] as const,
};

/** refetchInterval (ms). Ko'rinish yashirin bo'lsa (tab boshqa) so'rov yubormang: enabled=false. */
export const AGENT_TEAM_REFRESH = {
  overview: 10_000,
  agents: 15_000,
  runs: 15_000,
  chat: 10_000,
  tasks: 10_000,
  promises: 20_000,
  plans: 5_000,          // TTL 600 s — kutilayotgan reja tez ko'rinsin
  memoryLog: 20_000,
  memoryFiles: 30_000,
  health: 30_000,
  settings: 60_000,
} as const;
