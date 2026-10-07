import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import * as os from 'os';

/**
 * Kategoriya SUB-AGENTI — qoidalar, schotchik, minfin va ta'minot bosqichlari
 * hal qila olmagan to'lovlar bo'yicha O'YLAB qaror chiqaradi.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * AUTENTIFIKATSIYA: faqat SETUP TOKEN (Claude Code obunasi).
 *
 * `ANTHROPIC_SETUP_TOKEN` → `CLAUDE_CODE_OAUTH_TOKEN` → `claude --print` CLI.
 * `ANTHROPIC_API_KEY` bu yerda ISHLATILMAYDI — u loyihaning boshqa modullari
 * uchun (chek-order, correction, sverka-agent, leader) va uning hisobidan
 * pul ketadi. Shuning uchun u env'dan ATAYIN O'CHIRIB tashlanadi.
 *
 * ⚠️ Ikki auth bir vaqtda berilsa CLI 60-180 sekund osilib qoladi — bu
 * agents/runner.py da amalda sinalgan. Shuning uchun env NOLDAN, oq ro'yxat
 * bilan quriladi (agents/contract.py AGENT_ENV_* bilan bir xil qoida).
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Qolgan qoidalar (qat'iy):
 *  - Agent HECH NARSA YOZMAYDI. Faqat taklif qaytaradi, yozishni orkestrator
 *    qiladi — shunda har o'zgarish audit log'ga tushadi va qaytarilishi mumkin.
 *  - Hech qanday ASBOB berilmaydi (Bash/Read/Write/WebFetch — hammasi taqiq).
 *    Agentga faqat matn kiradi va matn chiqadi, fayl tizimiga yo'l yo'q.
 *  - Mijoz to'lovlari (CLIENT) umuman berilmaydi — ular ОплатыКв mantiqi.
 *  - Ishonch 70 dan past bo'lsa qo'yilmaydi, "odam ko'rsin" bo'lib qoladi.
 *  - Javob faqat JSON. Boshqa matn kelsa — qaror emas, xato deb sanaladi.
 */
@Injectable()
export class KategoriyaAiService {
  private readonly log = new Logger(KategoriyaAiService.name);

  /** Bir so'rovda nechta to'lov — ko'p bo'lsa model e'tibori tarqaladi. */
  static readonly PAKET = 25;
  /** Shundan past ishonch bilan hech narsa yozilmaydi. */
  static readonly MIN_ISHONCH = 70;

  private static readonly TIMEOUT_MS = Number(process.env.KATEGORIYA_AI_TIMEOUT_MS || 180_000);
  private static readonly MODEL = process.env.KATEGORIYA_AI_MODEL || 'sonnet';
  /** Hech qanday asbob kerak emas — hammasi taqiqlanadi (BITTA argument). */
  private static readonly DISALLOWED =
    'Bash Edit Write NotebookEdit WebFetch WebSearch Read Grep Glob Task';
  private static readonly PATH_DEFAULT = '/usr/local/bin:/usr/bin:/bin';
  private static readonly KILL_GRACE_MS = 5000;
  /** Linux argv chegarasi 128 KB — ortiq bo'lsa paketni kichraytirish kerak. */
  private static readonly ARGV_MAX = 120_000;
  /**
   * Obuna chegarasi (rate limit) belgilari.
   *
   * ⚠️ Setup token Python agentlar (leader/support/checker/teacher) bilan BIR
   * XIL obunani ishlatadi. Chegaraga urilsak, ular ham ishlay olmay qoladi.
   * Shuning uchun bu belgini ko'rsak darhol to'xtaymiz va ularga joy qoldiramiz.
   */
  private static readonly LIMIT_RE =
    /(rate.?limit|usage limit|too many requests|429|quota|limit reached|try again later)/i;

  // ─────────────────────────── tayyorlik ───────────────────────────

  private token(): string {
    return String(process.env.ANTHROPIC_SETUP_TOKEN || '').trim();
  }

  private buyruq(): string {
    return String(process.env.CLAUDE_CMD || '').trim() || 'claude';
  }

  /** `claude --version` natijasi keshi — har so'rovda jarayon ochmaslik uchun. */
  private cliKesh: { vaqt: number; bor: boolean; versiya: string } | null = null;
  private static readonly KESH_MS = 5 * 60 * 1000;
  private static readonly PROBE_MS = 20_000;

  /**
   * CLI o'rnatilganmi — eng ko'p uchraydigan nosozlik shu: `claude` backend
   * ishlayotgan foydalanuvchining PATH'ida bo'lmaydi. Buni web'da ko'rsatamiz,
   * shunda "AI ishlamadi" degan noaniq xato o'rniga aniq sabab ko'rinadi.
   */
  private async cliBormi(): Promise<{ bor: boolean; versiya: string }> {
    const hozir = Date.now();
    if (this.cliKesh && hozir - this.cliKesh.vaqt < KategoriyaAiService.KESH_MS) {
      return { bor: this.cliKesh.bor, versiya: this.cliKesh.versiya };
    }
    const r = await new Promise<{ bor: boolean; versiya: string }>((resolve) => {
      let bola: ReturnType<typeof spawn>;
      try {
        bola = spawn(this.buyruq(), ['--version'], {
          env: this.env(this.token()),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        resolve({ bor: false, versiya: '' });
        return;
      }
      let chiq = '';
      let tugadi = false;
      const soat = setTimeout(() => {
        if (tugadi) return;
        tugadi = true;
        try { bola.kill('SIGKILL'); } catch { /* tugagan */ }
        resolve({ bor: false, versiya: '' });
      }, KategoriyaAiService.PROBE_MS);
      bola.stdout?.setEncoding('utf8');
      bola.stdout?.on('data', (d) => { chiq += d; });
      bola.stderr?.on('data', () => { /* oqim to'lib qolmasin */ });
      bola.on('error', () => {
        if (tugadi) return;
        tugadi = true;
        clearTimeout(soat);
        resolve({ bor: false, versiya: '' });
      });
      bola.on('close', (kod) => {
        if (tugadi) return;
        tugadi = true;
        clearTimeout(soat);
        resolve({ bor: kod === 0, versiya: chiq.trim().slice(0, 40) });
      });
    });
    this.cliKesh = { vaqt: hozir, bor: r.bor, versiya: r.versiya };
    return r;
  }

  /** Web'da "tayyormi" belgisi uchun — sir qiymat qaytmaydi. */
  async tayyorlik(): Promise<{
    ok: boolean; usul: 'setup-token'; tokenBor: boolean;
    cliBor: boolean; versiya: string; buyruq: string; model: string;
  }> {
    const t = this.token();
    const cli = t ? await this.cliBormi() : { bor: false, versiya: '' };
    return {
      ok: !!t && cli.bor,
      usul: 'setup-token',
      tokenBor: !!t,
      cliBor: cli.bor,
      versiya: cli.versiya,
      buyruq: this.buyruq(),
      model: KategoriyaAiService.MODEL,
    };
  }

  /**
   * Agent jarayoni uchun env — NOLDAN, oq ro'yxat bilan.
   * agents/contract.py: AGENT_ENV_OS_KEYS + AGENT_ENV_TOKEN_KEY
   *                     + AGENT_ENV_OPTIONAL_KEYS, AGENT_ENV_FORBIDDEN hech qachon.
   */
  private env(token: string): Record<string, string> {
    const src = process.env;
    const env: Record<string, string> = {
      PATH: String(src.PATH || KategoriyaAiService.PATH_DEFAULT),
      HOME: String(src.HOME || src.USERPROFILE || os.homedir() || ''),
      LANG: String(src.LANG || 'C.UTF-8'),
      TZ: String(src.TZ || 'Asia/Tashkent'),
      // Token argv'ga EMAS, env'ga beriladi — jarayonlar ro'yxatida ko'rinmasin.
      CLAUDE_CODE_OAUTH_TOKEN: token,
    };
    if (src.LC_ALL) env.LC_ALL = String(src.LC_ALL);
    if (src.USER) env.USER = String(src.USER);
    // Ixtiyoriy: o'z proxy/gateway ishlatilsa.
    if (src.ANTHROPIC_BASE_URL) env.ANTHROPIC_BASE_URL = String(src.ANTHROPIC_BASE_URL);
    // ANTHROPIC_API_KEY bu yerda YO'Q — yuqoridagi izohga qarang.
    return env;
  }

  // ─────────────────────────── chaqiruv ───────────────────────────

  /**
   * Bir paket to'lov bo'yicha qaror so'raydi.
   *
   * @param bilim    agents/knowledge/kategoriya.md mazmuni (qoidalar, modda ro'yxati)
   * @param tolovlar modelga ko'rsatiladigan to'lovlar (sir ma'lumot YO'Q)
   */
  async qaror(
    bilim: string,
    tolovlar: Array<{
      id: string; sana: string; summa: string; yonalish: string;
      kontragent: string; izoh: string;
      shartnoma?: string | null; shartnomaSana?: string | null;
      hisob?: string | null; bank?: string | null;
    }>,
    kategoriyalar: Array<{ code: string; name: string }>,
  ): Promise<{
    ok: boolean;
    error?: string;
    /** Obuna chegarasiga urildi — darhol to'xtash kerak (Python agentlar ham shu tokenda) */
    limit?: boolean;
    qarorlar: Array<{
      id: string; categoryCode: string | null; modda: string | null;
      obyekt: string | null; shartnoma: string | null; shartnomaSana: string | null;
      ishonch: number; sabab: string;
    }>;
  }> {
    const token = this.token();
    if (!token) {
      return { ok: false, error: "ANTHROPIC_SETUP_TOKEN sozlanmagan (server .env)", qarorlar: [] };
    }
    if (tolovlar.length === 0) return { ok: true, qarorlar: [] };

    const prompt = this.promptQur(bilim, tolovlar, kategoriyalar);
    if (Buffer.byteLength(prompt, 'utf8') > KategoriyaAiService.ARGV_MAX) {
      return { ok: false, error: 'prompt juda uzun — paket kichraytirilishi kerak', qarorlar: [] };
    }

    const r = await this.cliChaqir(prompt, token);
    if (!r.ok) return { ok: false, error: r.error || 'nomalum xato', limit: r.limit === true, qarorlar: [] };

    const qarorlar = this.jsonAjrat(r.matn);
    if (!qarorlar) {
      return { ok: false, error: `javob JSON emas: ${r.matn.slice(0, 200)}`, qarorlar: [] };
    }
    return { ok: true, qarorlar };
  }

  private promptQur(
    bilim: string,
    tolovlar: Array<any>,
    kategoriyalar: Array<{ code: string; name: string }>,
  ): string {
    return [
      bilim.trim(),
      '',
      '## Mavjud kategoriyalar (faqat shu kodlardan birini tanla)',
      kategoriyalar.map((c) => `- ${c.code} — ${c.name}`).join('\n'),
      '',
      "## Tekshirish kerak bo'lgan to'lovlar",
      JSON.stringify(tolovlar, null, 1),
      '',
      '## Javob shakli',
      'FAQAT JSON massiv qaytar, boshqa matn yozma. Har element:',
      '{"id":"<to\'lov id>","categoryCode":"<kod yoki null>","modda":"<xarajat moddasi yoki null>",',
      ' "obyekt":"<obyekt nomi yoki null>","shartnoma":"<shartnoma № yoki null>",',
      ' "shartnomaSana":"<YYYY-MM-DD yoki null>","ishonch":<0..100>,"sabab":"<qisqa izoh, o\'zbekcha>"}',
      '',
      'Qoidalar:',
      `- Ishonching ${KategoriyaAiService.MIN_ISHONCH} dan past bo'lsa ham qaytar, lekin ishonchni rost ko'rsat — past bo'lsa yozilmaydi.`,
      "- Taxmin qilma. Izohda asos bo'lmasa — categoryCode null, sababda nima yetishmaganini yoz.",
      '- Mijozning uy to\'lovi bo\'lsa — hech narsa qo\'yma, sababda "mijoz to\'lovi" deb yoz.',
      "- Hech qanday asbob (Bash, Read, WebFetch) ishlatma — ularga ruxsat yo'q. Faqat yuqoridagi matnga tayan.",
    ].join('\n');
  }

  /**
   * `claude --print` ni chaqiradi.
   *
   * agents/runner.py dan ko'chirilgan amaliy qoidalar:
   *  - stdin = ignore (CLI interaktiv rejimga o'tib osilib qolmasin)
   *  - stdout va stderr IKKISI HAM uzluksiz o'qiladi (biri to'lib qolsa
   *    jarayon bloklanadi)
   *  - timeout'da butun jarayon GURUHI o'ldiriladi (CLI bola jarayon ochadi)
   *  - token faqat env'da, argv'da emas
   */
  private cliChaqir(
    prompt: string, token: string,
  ): Promise<{ ok: boolean; matn: string; error?: string; limit?: boolean }> {
    const buyruq = this.buyruq();
    const args = [
      '--print',
      '--model', KategoriyaAiService.MODEL,
      '--disallowedTools', KategoriyaAiService.DISALLOWED,
      '--', prompt,
    ];

    return new Promise((resolve) => {
      let bola: ReturnType<typeof spawn>;
      try {
        bola = spawn(buyruq, args, {
          env: this.env(token),
          stdio: ['ignore', 'pipe', 'pipe'],
          // Jarayon guruhi — timeout'da hammasini birga o'ldirish uchun.
          detached: process.platform !== 'win32',
        });
      } catch (e: any) {
        resolve({ ok: false, matn: '', error: `claude ishga tushmadi: ${String(e?.message || e)}` });
        return;
      }

      let chiq = '';
      let xato = '';
      let tugadi = false;

      const toxtat = () => {
        try {
          if (process.platform !== 'win32' && bola.pid) process.kill(-bola.pid, 'SIGTERM');
          else bola.kill('SIGTERM');
        } catch { /* allaqachon tugagan */ }
        setTimeout(() => {
          try {
            if (process.platform !== 'win32' && bola.pid) process.kill(-bola.pid, 'SIGKILL');
            else bola.kill('SIGKILL');
          } catch { /* allaqachon tugagan */ }
        }, KategoriyaAiService.KILL_GRACE_MS);
      };

      const soat = setTimeout(() => {
        if (tugadi) return;
        tugadi = true;
        toxtat();
        resolve({ ok: false, matn: '', error: `javob kelmadi (${Math.round(KategoriyaAiService.TIMEOUT_MS / 1000)}s timeout)` });
      }, KategoriyaAiService.TIMEOUT_MS);

      bola.stdout?.setEncoding('utf8');
      bola.stderr?.setEncoding('utf8');
      bola.stdout?.on('data', (d) => { chiq += d; });
      bola.stderr?.on('data', (d) => { xato += d; });

      bola.on('error', (e: any) => {
        if (tugadi) return;
        tugadi = true;
        clearTimeout(soat);
        const yoq = e?.code === 'ENOENT';
        resolve({
          ok: false,
          matn: '',
          error: yoq
            ? `claude CLI topilmadi (${buyruq}) — CLAUDE_CMD bilan to'liq yo'lni ko'rsating`
            : `claude xatosi: ${String(e?.message || e)}`,
        });
      });

      bola.on('close', (kod) => {
        if (tugadi) return;
        tugadi = true;
        clearTimeout(soat);
        if (kod === 0) {
          resolve({ ok: true, matn: chiq });
          return;
        }
        // Sir chiqmasligi uchun stderr qisqartiriladi va token maskalanadi.
        const xom = `${xato || chiq}`;
        const sabab = this.maska(xom).slice(0, 300).trim();
        resolve({
          ok: false,
          matn: '',
          error: `claude kod ${kod}${sabab ? `: ${sabab}` : ''}`,
          limit: KategoriyaAiService.LIMIT_RE.test(xom),
        });
      });
    });
  }

  /** Token tasodifan log'ga tushmasin. */
  private maska(s: string): string {
    const t = this.token();
    if (!t || t.length < 8) return s;
    return s.split(t).join('***');
  }

  /**
   * Model javobidan JSON massivni ajratadi.
   * Model ba'zan ```json ... ``` bloki yoki oldidan bir qator matn qo'shadi —
   * shuning uchun birinchi '[' dan oxirgi ']' gacha olinadi.
   */
  private jsonAjrat(matn: string): Array<any> | null {
    const bosh = matn.indexOf('[');
    const oxir = matn.lastIndexOf(']');
    if (bosh < 0 || oxir <= bosh) return null;
    let xom: any;
    try {
      xom = JSON.parse(matn.slice(bosh, oxir + 1));
    } catch {
      return null;
    }
    if (!Array.isArray(xom)) return null;
    const chiq: any[] = [];
    for (const r of xom) {
      if (!r || typeof r !== 'object' || !r.id) continue;
      const n = Number(r.ishonch);
      chiq.push({
        id: String(r.id),
        categoryCode: r.categoryCode ? String(r.categoryCode).slice(0, 32) : null,
        modda: r.modda ? String(r.modda).slice(0, 255) : null,
        obyekt: r.obyekt ? String(r.obyekt).slice(0, 255) : null,
        shartnoma: r.shartnoma ? String(r.shartnoma).slice(0, 255) : null,
        shartnomaSana: /^\d{4}-\d{2}-\d{2}$/.test(String(r.shartnomaSana || '')) ? String(r.shartnomaSana) : null,
        ishonch: Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0,
        sabab: String(r.sabab || '').slice(0, 1000),
      });
    }
    return chiq;
  }
}
