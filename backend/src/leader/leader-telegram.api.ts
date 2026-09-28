import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { LeaderConfigService } from './leader-config.service';

/**
 * Leader bot — Telegram'ga YUBORISH (polling bu yerda YO'Q, u LeaderBotService'da).
 * call() xatoni yutmaydi: har doim { ok, description?, error_code? } qaytaradi (throw emas).
 * Token log'ga va xato matniga tushmaydi.
 */
@Injectable()
export class LeaderTelegramApi {
  private readonly log = new Logger(LeaderTelegramApi.name);
  static readonly CHUNK_LIMIT = 3900;

  constructor(private readonly config: LeaderConfigService) {}

  async call(method: string, payload: any, timeoutMs = 15_000): Promise<any> {
    const token = this.config.botToken();
    if (!token) return { ok: false, description: 'LEADER_BOT_TOKEN sozlanmagan', error_code: 0 };
    try {
      const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, payload ?? {}, {
        timeout: timeoutMs,
        validateStatus: () => true,
      });
      const data = res.data;
      if (data && typeof data === 'object') return data;
      return { ok: false, description: `HTTP ${res.status}`, error_code: res.status };
    } catch (e: any) {
      const desc = String(e?.code || e?.message || 'tarmoq xatosi').split(token).join('***');
      return { ok: false, description: desc, error_code: 0 };
    }
  }

  /**
   * Sanitize + 3900 belgidan bo'lish + HTML parse xatosida teglarsiz qayta yuborish.
   * Natija: hamma bo'lak yetkazildimi (plain fallback bilan bo'lsa ham true). Throw qilmaydi.
   */
  async sendHtml(chatId: string | number, html: string): Promise<boolean> {
    const clean = sanitizeTelegramHtml(html).trim() || "Bo'sh javob.";
    const chunks = splitTelegramHtml(clean, LeaderTelegramApi.CHUNK_LIMIT);
    let allOk = true;
    for (const chunk of chunks) {
      let r = await this.send(chatId, chunk, true);
      if (r?.ok) continue;

      // Flood limit — bir marta kutib qayta urinamiz
      if (r?.error_code === 429) {
        const wait = Math.min(Number(r?.parameters?.retry_after || 3), 30) * 1000;
        await this.sleep(wait);
        r = await this.send(chatId, chunk, true);
        if (r?.ok) continue;
      }

      // "can't parse entities" va boshqa 400 — teglarsiz oddiy matn
      if (r?.error_code === 400 || /parse entit/i.test(String(r?.description || ''))) {
        const r2 = await this.send(chatId, plainFromHtml(chunk).slice(0, 4096), false);
        if (r2?.ok) continue;
        this.log.warn(`sendMessage (plain) xato: ${String(r2?.description || '').slice(0, 200)}`);
        allOk = false;
        continue;
      }
      this.log.warn(`sendMessage xato: ${String(r?.description || '').slice(0, 200)}`);
      allOk = false;
    }
    return allOk;
  }

  /** Har egasiga shaxsiy chatda (private chat id = user id). Kamida bittasiga to'liq yetkazilsa — true. */
  async sendToOwners(html: string): Promise<boolean> {
    let delivered = false;
    for (const id of this.config.ownerIds()) {
      try {
        if (await this.sendHtml(id, html)) delivered = true;
      } catch (e: any) {
        this.log.warn(`sendToOwners xato: ${e?.message}`);
      }
    }
    return delivered;
  }

  async typing(chatId: string | number): Promise<void> {
    await this.call('sendChatAction', { chat_id: chatId, action: 'typing' }, 10_000);
  }

  private send(chatId: string | number, text: string, html: boolean): Promise<any> {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      ...(html ? { parse_mode: 'HTML' } : {}),
      link_preview_options: { is_disabled: true },
    });
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
}

// ─── HTML yordamchilari (Telegram HTML: faqat b, i, code, pre) ──────────

const ALLOWED_TAGS = new Set(['b', 'i', 'code', 'pre']);
const TAG_ALIAS: Record<string, string> = { strong: 'b', em: 'i' };

export function escapeHtml(s: any): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * LLM HTML'ini Telegram uchun tozalaydi: faqat <b>,<i>,<code>,<pre> qoladi (atributlar tashlanadi),
 * qolgan <, >, & escape. Teglar muvozanatlanadi (ochiq qolganlari yopiladi, ortiqcha yopuvchi
 * tashlanadi). code/pre ichida boshqa teglar matn sifatida ko'rsatiladi — istisno: <pre><code>...</code></pre>
 * (Telegram rasman qo'llaydi). <br> -> yangi qator.
 */
export function sanitizeTelegramHtml(input: string): string {
  const src = String(input ?? '').replace(/\r\n?/g, '\n');
  const re =
    /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)(?:\s+[a-zA-Z_:-]+\s*=\s*(?:"[^"<>]*"|'[^'<>]*'))*\s*\/?\s*>|&(#\d{1,7}|#x[0-9a-fA-F]{1,6}|lt|gt|amp|quot);|[<>&]/g;
  const stack: string[] = [];
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += src.slice(last, m.index);
    last = re.lastIndex;
    const tok = m[0];

    if (m[2] !== undefined) {
      let name = m[2].toLowerCase();
      name = TAG_ALIAS[name] || name;
      const closing = m[1] === '/';
      const inCode = stack.length > 0 && (stack[stack.length - 1] === 'code' || stack[stack.length - 1] === 'pre');

      if (inCode) {
        const top = stack[stack.length - 1];
        // <pre> ichida <code> ochilishi mumkin (Telegram: <pre><code class="language-x">)
        if (!closing && name === 'code' && top === 'pre') {
          stack.push('code');
          out += '<code>';
          continue;
        }
        // code/pre ichida faqat o'zining yopuvchisi teg bo'ladi
        if (closing && name === top) out += `</${stack.pop()}>`;
        else out += escapeHtml(tok);
        continue;
      }
      if (name === 'br') {
        out += '\n';
        continue;
      }
      if (!ALLOWED_TAGS.has(name)) {
        out += escapeHtml(tok);
        continue;
      }
      if (!closing) {
        stack.push(name);
        out += `<${name}>`;
        continue;
      }
      const idx = stack.lastIndexOf(name);
      if (idx < 0) continue; // ortiqcha yopuvchi — tashlanadi
      while (stack.length > idx) out += `</${stack.pop()}>`;
      continue;
    }

    if (m[3] !== undefined) {
      out += tok; // to'g'ri entity — o'zgarishsiz
      continue;
    }
    out += escapeHtml(tok);
  }
  out += src.slice(last);
  while (stack.length) out += `</${stack.pop()}>`;
  return out.replace(/<(b|i|code|pre)><\/\1>/g, '');
}

/**
 * Tozalangan HTML'ni limit bo'yicha bo'ladi (imkon qadar yangi qatordan). Har bo'lak
 * mustaqil to'g'ri HTML: bo'lak oxirida ochiq teglar yopiladi, keyingisida qayta ochiladi.
 */
export function splitTelegramHtml(html: string, limit = LeaderTelegramApi.CHUNK_LIMIT): string[] {
  const out: string[] = [];
  let rest = String(html ?? '');
  let carry: string[] = [];
  let guard = 0;
  while (rest.length && guard++ < 1000) {
    const prefix = carry.map((t) => `<${t}>`).join('');
    const budget = Math.max(200, limit - prefix.length - 30); // 30 — yopuvchi teglar uchun joy
    let cut = rest.length;
    if (rest.length > budget) {
      cut = rest.lastIndexOf('\n', budget);
      if (cut < budget * 0.5) cut = budget;
      // teg yoki entity o'rtasidan kesilmasin
      const lt = rest.lastIndexOf('<', cut - 1);
      const gt = rest.lastIndexOf('>', cut - 1);
      if (lt > gt && lt > 0) cut = lt;
      const amp = rest.lastIndexOf('&', cut - 1);
      const semi = rest.lastIndexOf(';', cut - 1);
      if (amp > semi && cut - amp <= 10 && amp > 0) cut = amp;
      if (cut <= 0) cut = budget;
    }
    const piece = rest.slice(0, cut);
    rest = rest.slice(cut).replace(/^\n/, '');

    const stack = [...carry];
    const tagRe = /<(\/?)(b|i|code|pre)>/g;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(piece))) {
      if (t[1]) {
        const idx = stack.lastIndexOf(t[2]);
        if (idx >= 0) stack.splice(idx, 1);
      } else {
        stack.push(t[2]);
      }
    }
    const closing = [...stack].reverse().map((x) => `</${x}>`).join('');
    const chunk = (prefix + piece + closing).replace(/<(b|i|code|pre)><\/\1>/g, '');
    if (plainFromHtml(chunk).trim()) out.push(chunk);
    carry = stack;
  }
  return out.length ? out : [html];
}

/** Teglarsiz oddiy matn (HTML parse xatosida fallback). */
export function plainFromHtml(html: string): string {
  return String(html ?? '')
    .replace(/<\/?(b|i|code|pre)>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d{1,7});/g, (_, n) => safeFromCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]{1,6});/g, (_, h) => safeFromCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function safeFromCode(n: number): string {
  try {
    return String.fromCodePoint(n);
  } catch {
    return '';
  }
}
