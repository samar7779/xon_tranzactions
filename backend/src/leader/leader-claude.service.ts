import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeaderConfigService, tashkentDayRange } from './leader-config.service';
import { RunAgentOptions, RunAgentResult, ToolImpl } from './leader.types';

/** runAgent qo'shimcha parametri: tashqi to'xtatish (masalan ask_support asbobi vaqt chegarasidan oshsa). */
export type RunAgentOptionsEx = RunAgentOptions & { signal?: AbortSignal };

type Usage = { input: number; output: number; cacheRead: number };

/**
 * Claude Messages API — agent tool loop (namuna: correction-bot-runner + sverka-agent claudeCall).
 *
 * - Retry: 429/5xx/529/tarmoq/timeout -> 3 urinish (1s, 2s, 4s yoki retry-after). 4xx -> darhol xato.
 *   Katta max_tokens (boost) so'rovida timeout qayta urinilmaydi (har urinish to'liq generatsiya haqi).
 * - Prompt caching: tools oxirgisi + system + messages oxirgi bloki (jami 3 breakpoint) — tool loop'da
 *   oldingi tarix cache_read bo'ladi.
 * - Bir qadamda ko'pi bilan 8 ta asbob, bir vaqtda 3 tadan (Prisma puli band bo'lmasin).
 * - Asbob vaqt chegarasidan oshsa — AbortSignal bilan to'xtatiladi (sub-agent fonda token yemasin).
 * - Har runAgent -> bitta LeaderRun qatori (tokenlar, asbob chaqiruvlari, vaqt, xato).
 * - Kunlik cap: boshida va loop ichida tekshiriladi (oshsa API chaqirilmaydi).
 * - Kalit va sarlavhalar log'ga YOZILMAYDI.
 */
@Injectable()
export class LeaderClaudeService {
  private readonly log = new Logger(LeaderClaudeService.name);

  private static readonly API_URL = 'https://api.anthropic.com/v1/messages';
  private static readonly HTTP_TIMEOUT_MS = 120_000;
  private static readonly RETRY_DELAYS_MS = [1000, 2000, 4000];
  private static readonly ATTEMPTS = 3;
  private static readonly TOOL_RESULT_MAX = 20_000;
  /** Bir javobdagi tool_use bloklari chegarasi va parallel bajarish soni. */
  private static readonly MAX_TOOLS_PER_STEP = 8;
  private static readonly TOOL_CONCURRENCY = 3;
  /** Katta javob (boost) uchun HTTP timeout ko'pi bilan 300 s. */
  private static readonly HTTP_TIMEOUT_MAX_MS = 300_000;
  /** Timeout bo'lgan urinish uchun taxminiy chiqish tokeni (usage kelmaydi, lekin haqi olinadi). */
  private static readonly LOST_OUTPUT_ESTIMATE = 8000;
  /** Bitta asbob (masalan ask_support sub-agenti) cheksiz osilib qolmasin. */
  private static readonly TOOL_TIMEOUT_MS = 7 * 60 * 1000;
  private static readonly FINAL_NOTE =
    "Asbob chaqiruvlari limiti tugadi. Hozirgacha topilgan ma'lumot bilan qisqa yakuniy javob ber.";

  constructor(
    private readonly config: LeaderConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Bugungi (Toshkent) LeaderRun input+output yig'indisi. */
  async todayTokens(): Promise<number> {
    const { from, to } = tashkentDayRange();
    const agg = await this.prisma.leaderRun.aggregate({
      where: { createdAt: { gte: from, lte: to } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    return Number(agg?._sum?.inputTokens || 0) + Number(agg?._sum?.outputTokens || 0);
  }

  async runAgent(opts: RunAgentOptionsEx): Promise<RunAgentResult> {
    const started = Date.now();
    const model = this.config.model(opts.modelKind);
    const usage = { input: 0, output: 0, cacheRead: 0 };
    const toolNames: string[] = [];

    let result: RunAgentResult;
    try {
      result = await this.loop(opts, model, usage, toolNames);
    } catch (e: any) {
      result = {
        text: '',
        status: 'error',
        toolCalls: toolNames.length,
        toolNames,
        error: String(e?.message || e || 'nomalum xato'),
      };
    }

    const durationMs = Date.now() - started;
    try {
      await this.prisma.leaderRun.create({
        data: {
          agent: String(opts.agent).slice(0, 16),
          model: model.slice(0, 64),
          status: result.status,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadTokens: usage.cacheRead,
          toolCalls: result.toolCalls,
          durationMs,
          error: result.error ? result.error.slice(0, 500) : null,
        },
      });
    } catch (e: any) {
      this.log.warn(`LeaderRun yozilmadi: ${e?.message}`);
    }

    this.log.log(
      `run ${opts.agent}/${model}: ${result.status} in=${usage.input} out=${usage.output} ` +
        `cache=${usage.cacheRead} tools=${result.toolCalls} ${durationMs}ms` +
        (result.error ? ` xato=${result.error.slice(0, 120)}` : ''),
    );
    return result;
  }

  // ─── Tool loop ───────────────────────────────────────────────────────
  private async loop(opts: RunAgentOptionsEx, model: string, usage: Usage, toolNames: string[]): Promise<RunAgentResult> {
    const signal = opts.signal;
    const done = (status: RunAgentResult['status'], text: string, error?: string): RunAgentResult => ({
      text,
      status,
      toolCalls: toolNames.length,
      toolNames,
      ...(error ? { error } : {}),
    });

    // 1) Kunlik cap — oshgan bo'lsa API chaqirilmaydi
    const cap = this.config.dailyTokenCap();
    const usedBefore = await this.todayTokens();
    if (usedBefore >= cap) return done('capped', '', `Kunlik token limiti tugadi (${usedBefore} / ${cap})`);

    // 2) Kalit
    const apiKey = await this.config.apiKey();
    if (!apiKey) return done('error', 'Claude API kaliti sozlanmagan', 'Claude API kaliti sozlanmagan');

    // 3) So'rov qismlari (tools -> system -> messages tartibida keshlanadi)
    const tools = this.uniqueTools(opts.tools || []);
    const toolDefs = tools.map((t, i) => {
      const d: any = { name: t.name, description: t.description, input_schema: t.input_schema };
      if (i === tools.length - 1) d.cache_control = { type: 'ephemeral' };
      return d;
    });
    const systemText = String(opts.system || '').trim() || 'Sen yordamchi agentsan. Toza lotin o\'zbek tilida javob ber.';
    const system = [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }];
    const maxIterations = Math.max(1, Math.floor(opts.maxIterations || 1));
    let maxTokens = Math.max(256, Math.floor(opts.maxTokens || 1024));
    let boosted = false;

    const convo: any[] = this.normalizeMessages(opts.messages || []);
    if (!convo.length) return done('error', '', "Bo'sh so'rov (messages yo'q)");

    const baseBody = (): any => ({
      model,
      max_tokens: maxTokens,
      system,
      ...(toolDefs.length ? { tools: toolDefs } : {}),
      messages: this.withMessageCache(convo),
    });

    for (let iter = 0; iter < maxIterations; iter++) {
      if (signal?.aborted) return done('error', '', "To'xtatildi (vaqt chegarasi)");
      const data = await this.call(apiKey, baseBody(), usage, signal);
      this.addUsage(usage, data?.usage);
      const content: any[] = Array.isArray(data?.content) ? data.content : [];
      const stop = String(data?.stop_reason || '');

      if (stop === 'max_tokens' && !boosted) {
        // Fikrlash (adaptive thinking) ham max_tokens'ga kiradi — javob yoki asbob chaqiruvi
        // kesilgan bo'lishi mumkin. Bir marta kattaroq chegara bilan shu qadamni qaytaramiz.
        boosted = true;
        maxTokens = Math.min(Math.max(maxTokens * 4, 4000), 16_000);
        this.log.warn(`${opts.agent}: max_tokens'ga yetdi — ${maxTokens} bilan qayta so'raladi`);
        if (usedBefore + usage.input + usage.output >= cap) {
          return done('capped', '', `Kunlik token limiti ish davomida tugadi (${cap})`);
        }
        iter--;
        continue;
      }

      if (stop === 'tool_use') {
        const uses = content.filter((b) => b?.type === 'tool_use');
        // Assistant content o'zgarishsiz qaytariladi (thinking bloklari ham)
        convo.push({ role: 'assistant', content });
        const results = await this.execTools(tools, uses, toolNames, signal);
        convo.push({ role: 'user', content: results });
        if (signal?.aborted) return done('error', '', "To'xtatildi (vaqt chegarasi)");

        // Loop ichida ham cap: sub-agent limitni yeb qo'ymasin
        if (usedBefore + usage.input + usage.output >= cap) {
          return done('capped', '', `Kunlik token limiti ish davomida tugadi (${cap})`);
        }
        continue;
      }

      if (stop === 'pause_turn') {
        // Server davom ettirishni so'radi — assistant content bilan qayta yuboramiz
        convo.push({ role: 'assistant', content });
        continue;
      }

      if (stop === 'refusal') {
        const cat = data?.stop_details?.category ? ` (${data.stop_details.category})` : '';
        return done('error', '', `Model javob berishdan bosh tortdi${cat}`);
      }

      const text = this.extractText(content);
      if (!text) {
        return done('error', '', stop === 'max_tokens' ? 'Javob max_tokens chegarasida kesildi (matn yo\'q)' : `Bo'sh javob (stop_reason=${stop || '?'})`);
      }
      return done('ok', text);
    }

    // 4) maxIterations tugadi — yakuniy javob, asboblarsiz.
    // Tarixda tool_use/tool_result bor — API tools ro'yxatini talab qiladi, shuning uchun
    // tools qoladi, lekin tool_choice 'none' (model asbob chaqira olmaydi).
    const last = convo[convo.length - 1];
    const note = { type: 'text', text: LeaderClaudeService.FINAL_NOTE };
    if (last?.role === 'user' && Array.isArray(last.content)) {
      convo[convo.length - 1] = { role: 'user', content: [...last.content, note] };
    } else {
      convo.push({ role: 'user', content: [note] });
    }
    if (signal?.aborted) return done('error', '', "To'xtatildi (vaqt chegarasi)");
    const finalBody = baseBody();
    if (toolDefs.length) finalBody.tool_choice = { type: 'none' };
    const data = await this.call(apiKey, finalBody, usage, signal);
    this.addUsage(usage, data?.usage);
    if (data?.stop_reason === 'refusal') return done('error', '', 'Model javob berishdan bosh tortdi');
    const text = this.extractText(Array.isArray(data?.content) ? data.content : []);
    if (!text) return done('error', '', `Iteratsiya limiti (${maxIterations}) tugadi, yakuniy javob bo'sh`);
    return done('max_iter', text);
  }

  // ─── Asbob bajarish ──────────────────────────────────────────────────
  /**
   * Bir qadamdagi asboblar: ko'pi bilan MAX_TOOLS_PER_STEP tasi bajariladi (ortig'iga xato tool_result —
   * API har tool_use uchun javob kutadi), bir vaqtda TOOL_CONCURRENCY tadan. Natija tartibi saqlanadi.
   */
  private async execTools(tools: ToolImpl[], uses: any[], toolNames: string[], parent?: AbortSignal): Promise<any[]> {
    const max = LeaderClaudeService.MAX_TOOLS_PER_STEP;
    const results: any[] = new Array(uses.length);
    const runnable: number[] = [];
    uses.forEach((u, i) => {
      if (i < max) runnable.push(i);
      else
        results[i] = {
          type: 'tool_result',
          tool_use_id: u?.id,
          content: JSON.stringify({ error: `Bir qadamda juda ko'p asbob (ko'pi bilan ${max} ta) — qolganini keyingi qadamda chaqir` }),
          is_error: true,
        };
    });
    let next = 0;
    const worker = async () => {
      while (next < runnable.length) {
        const i = runnable[next++];
        results[i] = await this.execTool(tools, uses[i], toolNames, parent);
      }
    };
    await Promise.all(Array.from({ length: Math.min(LeaderClaudeService.TOOL_CONCURRENCY, runnable.length) }, () => worker()));
    return results;
  }

  private async execTool(tools: ToolImpl[], use: any, toolNames: string[], parent?: AbortSignal): Promise<any> {
    const name = String(use?.name || '');
    toolNames.push(name);
    const tool = tools.find((t) => t.name === name);
    let out: any;
    if (!tool) {
      out = { error: `Noma'lum asbob: ${name}` };
    } else if (parent?.aborted) {
      out = { error: "To'xtatildi (vaqt chegarasi)" };
    } else {
      // Vaqt chegarasi yoki ota-agent to'xtasa — asbobning o'zi ham to'xtaydi (sub-agent fonda ishlamasin)
      const ac = new AbortController();
      const onParent = () => ac.abort();
      parent?.addEventListener('abort', onParent, { once: true });
      try {
        const input = use?.input && typeof use.input === 'object' ? use.input : {};
        out = await this.withTimeout(
          Promise.resolve().then(() => (tool.run as (i: any, s?: AbortSignal) => Promise<any>)(input, ac.signal)),
          LeaderClaudeService.TOOL_TIMEOUT_MS,
          `${name} vaqt chegarasidan oshdi`,
        );
      } catch (e: any) {
        ac.abort();
        out = { error: String(e?.message || e || 'asbob xatosi').slice(0, 500) };
      } finally {
        parent?.removeEventListener('abort', onParent);
      }
    }

    let s: string;
    try {
      s = JSON.stringify(out === undefined ? null : out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    } catch {
      s = JSON.stringify({ error: "Natijani JSON'ga aylantirib bo'lmadi" });
    }
    if (s == null) s = 'null';
    if (s.length > LeaderClaudeService.TOOL_RESULT_MAX) {
      s = s.slice(0, LeaderClaudeService.TOOL_RESULT_MAX) + '...(kesildi)';
    }
    const isErr = !!(out && typeof out === 'object' && !Array.isArray(out) && out.error);
    return { type: 'tool_result', tool_use_id: use?.id, content: s, ...(isErr ? { is_error: true } : {}) };
  }

  private withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const t = new Promise<T>((_, rej) => {
      timer = setTimeout(() => rej(new Error(msg)), ms);
    });
    return Promise.race([p, t]).finally(() => clearTimeout(timer));
  }

  // ─── HTTP + retry ────────────────────────────────────────────────────
  private async call(apiKey: string, body: any, usage: Usage, signal?: AbortSignal): Promise<any> {
    const attempts = LeaderClaudeService.ATTEMPTS;
    const maxTokens = Number(body?.max_tokens) || 0;
    // Uzun javob 120 s ga sig'maydi (≈40 token/s) — katta max_tokens uchun timeout kattaroq
    const timeoutMs = Math.min(
      LeaderClaudeService.HTTP_TIMEOUT_MAX_MS,
      Math.max(LeaderClaudeService.HTTP_TIMEOUT_MS, maxTokens * 25),
    );
    const bigRequest = maxTokens > 4000;
    const payload = JSON.stringify(body);
    let lastErr: Error | null = null;
    for (let i = 0; i < attempts; i++) {
      const isLast = i === attempts - 1;
      if (signal?.aborted) throw new Error("Claude so'rovi to'xtatildi (vaqt chegarasi)");
      let res: Response;
      try {
        res = await fetch(LeaderClaudeService.API_URL, {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: payload,
          signal: this.anySignal(signal, AbortSignal.timeout(timeoutMs)),
        });
      } catch (e: any) {
        if (signal?.aborted) throw new Error("Claude so'rovi to'xtatildi (vaqt chegarasi)");
        const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        const why = timedOut ? `timeout (${Math.round(timeoutMs / 1000)} s)` : String(e?.message || e);
        lastErr = new Error(`Claude tarmoq xatosi: ${why}`);
        if (timedOut) {
          // Server generatsiya qilgan, haqi olinadi, usage esa kelmadi — cap uchun taxminiy hisob
          usage.output += Math.min(maxTokens || LeaderClaudeService.LOST_OUTPUT_ESTIMATE, LeaderClaudeService.LOST_OUTPUT_ESTIMATE);
          if (bigRequest) throw lastErr; // katta so'rovni qayta yubormaymiz (yana to'liq haq)
        }
        if (!isLast) {
          await this.sleep(LeaderClaudeService.RETRY_DELAYS_MS[i], signal);
          continue;
        }
        throw lastErr;
      }

      if (res.ok) {
        try {
          return await res.json();
        } catch (e: any) {
          lastErr = new Error(`Claude javobi o'qilmadi: ${e?.message}`);
          if (!isLast) {
            await this.sleep(LeaderClaudeService.RETRY_DELAYS_MS[i], signal);
            continue;
          }
          throw lastErr;
        }
      }

      const raw = await res.text().catch(() => '');
      let msg = raw;
      try {
        msg = JSON.parse(raw)?.error?.message || raw;
      } catch {
        /* matn sifatida qoladi */
      }
      lastErr = new Error(`Claude API ${res.status}: ${String(msg).slice(0, 300)}`);
      const retryable = res.status === 429 || res.status === 408 || res.status >= 500; // 529 ham
      if (!retryable || isLast) throw lastErr;

      const ra = Number(res.headers.get('retry-after'));
      const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : LeaderClaudeService.RETRY_DELAYS_MS[i];
      this.log.warn(`Claude ${res.status} — ${Math.round(wait / 1000)} s dan keyin qayta urinish (${i + 2}/${attempts})`);
      await this.sleep(wait, signal);
    }
    throw lastErr || new Error('Claude javob bermadi');
  }

  // ─── Yordamchilar ────────────────────────────────────────────────────
  private addUsage(acc: Usage, u: any) {
    if (!u) return;
    // Cache yozish ham input sifatida hisoblanadi (limit uchun halol), cache o'qish alohida.
    acc.input += Number(u.input_tokens || 0) + Number(u.cache_creation_input_tokens || 0);
    acc.output += Number(u.output_tokens || 0);
    acc.cacheRead += Number(u.cache_read_input_tokens || 0);
  }

  private extractText(content: any[]): string {
    return content
      .filter((b) => b?.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  /** Bir xil nomli asbob ikki marta bo'lsa API 400 beradi — birinchisi qoladi. */
  private uniqueTools(tools: ToolImpl[]): ToolImpl[] {
    const seen = new Set<string>();
    const out: ToolImpl[] = [];
    for (const t of tools) {
      if (!t?.name || typeof t.run !== 'function') continue;
      if (seen.has(t.name)) {
        this.log.warn(`Takroriy asbob nomi tashlandi: ${t.name}`);
        continue;
      }
      seen.add(t.name);
      out.push(t);
    }
    return out;
  }

  /**
   * Birinchi va oxirgi xabar user bo'lsin (yangi modellarda assistant prefill 400 beradi);
   * bo'sh matnli xabarlar tashlanadi.
   */
  private normalizeMessages(msgs: Array<{ role: 'user' | 'assistant'; content: any }>): any[] {
    const out = msgs.filter((m) => {
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) return false;
      if (typeof m.content === 'string') return m.content.trim().length > 0;
      return Array.isArray(m.content) && m.content.length > 0;
    });
    while (out.length && out[0].role !== 'user') out.shift();
    while (out.length && out[out.length - 1].role !== 'user') out.pop();
    return out.map((m) => ({ role: m.role, content: m.content }));
  }

  /**
   * Messages nusxasi: oxirgi xabarning oxirgi blokiga cache_control (tools + system + shu = 3 breakpoint,
   * chegara 4). Asl convo o'zgartirilmaydi — breakpoint har iteratsiyada faqat oxirida turadi.
   */
  private withMessageCache(convo: any[]): any[] {
    if (!convo.length) return convo;
    const out = convo.slice();
    const last = out[out.length - 1];
    const cc = { type: 'ephemeral' };
    if (typeof last?.content === 'string') {
      if (!last.content.trim()) return convo;
      out[out.length - 1] = { role: last.role, content: [{ type: 'text', text: last.content, cache_control: cc }] };
      return out;
    }
    if (Array.isArray(last?.content) && last.content.length) {
      const blocks = last.content.slice();
      const b = blocks[blocks.length - 1];
      // thinking/redacted_thinking bloklariga cache_control qo'yib bo'lmaydi
      if (!b || typeof b !== 'object' || !['text', 'tool_result', 'tool_use', 'image', 'document'].includes(b.type)) return convo;
      blocks[blocks.length - 1] = { ...b, cache_control: cc };
      out[out.length - 1] = { role: last.role, content: blocks };
      return out;
    }
    return convo;
  }

  /** Bir nechta signal — biri abort bo'lsa natija ham abort (Node 20.3+ AbortSignal.any, eskisida qo'lda). */
  private anySignal(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
    if (!a) return b;
    const anyFn = (AbortSignal as any).any;
    if (typeof anyFn === 'function') return anyFn([a, b]);
    const ac = new AbortController();
    const abort = () => ac.abort();
    if (a.aborted || b.aborted) ac.abort();
    else {
      a.addEventListener('abort', abort, { once: true });
      b.addEventListener('abort', abort, { once: true });
    }
    return ac.signal;
  }

  /** Kutish; signal abort bo'lsa darhol tugaydi. */
  private sleep(ms: number, signal?: AbortSignal) {
    return new Promise<void>((r) => {
      if (signal?.aborted) return r();
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        signal?.removeEventListener('abort', done);
        r();
      }
      signal?.addEventListener('abort', done, { once: true });
    });
  }
}
