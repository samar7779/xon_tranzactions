/**
 * Leader agentlar jamoasi — umumiy tiplar (barcha leader/* fayllari shu kontraktga tayanadi).
 *
 * v1 QOIDA: agentlar FAQAT KO'RADI va TAHLIL QILADI. Biznes jadvallarga, kodga, bank API'ga
 * hech narsa yozilmaydi. Yozish faqat leader_* jadvallariga (tarix, xotira, audit, alert).
 */

export type AgentName = 'leader' | 'support' | 'checker' | 'teacher';

export type ModelKind = 'fast' | 'strong';

/** Claude Messages API tool ta'rifi (input_schema — JSON Schema). */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, any>;
}

/**
 * Bajariladigan asbob. run() natijasi JSON-serializable, sirlardan TOZALANGAN va hajmi cheklangan
 * bo'lishi shart (tool_result ~20 KB dan oshmasin). Xato bo'lsa throw emas — { error: '...' } qaytaradi.
 */
export interface ToolImpl extends ToolDef {
  run(input: any): Promise<any>;
}

export type CheckLevel = 'ok' | 'warn' | 'critical' | 'unknown';

/** Checker deterministik tekshiruvi natijasi. */
export interface CheckResult {
  /** Barqaror kalit: 'bank_sync', 'xonpay', 'google_export', 'shmitd', 'sverka', 'crm_sverka',
   *  'api_errors', 'failed_logins', 'deploy', 'disk', 'memory' */
  key: string;
  /** Odam tilidagi nom (lotin o'zbek). */
  title: string;
  level: CheckLevel;
  /** Bir qator: aniq nom va raqam bilan ("Kapitalbank 20208...: 3 soat sync yo'q"). */
  summary: string;
  /** Ko'pi bilan 10 qator tafsilot. */
  details?: string[];
}

export interface RunAgentOptions {
  agent: AgentName;
  modelKind: ModelKind;
  /** Tizim prompti (keshlanadigan qism — o'zgaruvchan ma'lumot bu yerga QO'YILMAYDI). */
  system: string;
  /** Claude messages (user/assistant). */
  messages: Array<{ role: 'user' | 'assistant'; content: any }>;
  tools: ToolImpl[];
  maxIterations: number;
  maxTokens: number;
}

export interface RunAgentResult {
  text: string;
  status: 'ok' | 'error' | 'capped' | 'max_iter';
  toolCalls: number;
  /** Chaqirilgan asboblar nomlari (tartib bilan) — audit va tarix meta uchun. */
  toolNames: string[];
  error?: string;
}

export interface OwnerMessageContext {
  /** Egasi reply qilgan xabar matni (bo'lsa). */
  replyToText?: string;
  /** Xabar boshqa joydan forward qilingan (ishonchsiz matn). */
  forwarded?: boolean;
}
