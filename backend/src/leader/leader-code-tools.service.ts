import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { execFile, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { LeaderConfigService } from './leader-config.service';
import { ToolImpl } from './leader.types';

/**
 * Support agenti uchun KOD asboblari — FAQAT O'QISH.
 *
 * Qoidalar:
 *  - Faqat git kuzatadigan fayllar (`git ls-files`). git `execFile` bilan (SHELL YO'Q), 10 s timeout.
 *  - Maxfiy yo'llar (deny) ro'yxatda ham ko'rsatilmaydi, o'qilmaydi, grep natijasidan tashlanadi.
 *  - read_file: path traversal (`../`, absolyut yo'l), symlink va repo tashqarisi rad etiladi.
 *  - read_file / grep / git_log natijasidagi sirlar (token, kalit, parol qiymati) `***` bilan yashiriladi.
 *  - Redaksiya FAYL darajasida (ko'p qatorli tayinlash ham ushlanadi). grep sirli qatorlarni FAQAT
 *    redaksiyalangan matn bo'yicha qidiradi — xom sir bilan moslik natija soniga ta'sir qilmaydi (oracle yo'q).
 *  - Kodga yozilgan qisqa raqamli kodlar (GATE/KOD/PIN nomli) topiladi va ularning boshqa joydagi
 *    nusxalari ham (izoh, solishtirish) `***` bo'ladi.
 *  - Asbob hech qachon throw qilmaydi — xato bo'lsa `{ error }` qaytaradi.
 */

const GIT_TIMEOUT_MS = 10_000;
const GIT_MAX_BUFFER = 4 * 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
/** Sir skaneri o'qiydigan eng katta fayl (undan kattasi grep'da ehtiyotkor rejimda). */
const SCAN_MAX_BYTES = 4 * 1024 * 1024;
/** Sirli qatorlarda naqsh qidirish (alohida jarayon, ReDoS asosiy jarayonni to'xtatmasin). */
const REGEX_TIMEOUT_MS = 5000;
/** tool_result ~20 KB dan oshmasin — JSON qobig'i uchun zaxira qoldiramiz. */
const OUT_CHAR_BUDGET = 16_000;
const LS_CACHE_MS = 30_000;

const LIST_LIMIT = 300;
const GREP_LIMIT = 100;
const GREP_LINE_CHARS = 300;
const READ_LINE_CHARS = 500;
const READ_DEFAULT_LIMIT = 200;
const READ_MAX_LIMIT = 400;
const LOG_DEFAULT_LIMIT = 10;
const LOG_MAX_LIMIT = 20;

/** Har git chaqiruvi oldidan: fsmonitor hook ishlamasin, egalik tekshiruvi (root) to'smasin, yo'llar qo'shtirnoqsiz. */
const GIT_BASE_ARGS = [
  '--literal-pathspecs',
  '-c', 'core.quotepath=off',
  '-c', 'core.fsmonitor=false',
  '-c', 'safe.directory=*',
  '-c', 'log.showSignature=false',
];

// ─── Deny (yo'l bo'yicha, katta-kichik harfsiz) ─────────────────────────
const DENY_SEGMENTS = new Set(['.git', 'node_modules', 'dist', 'uploads', 'tz', '.claude']);
const DENY_EXT = ['.pem', '.key', '.p12', '.pfx', '.jks', '.keystore', '.sqlite', '.sqlite3', '.log'];
const DENY_SUBSTR = ['credential', 'service-account', 'secret'];
const DENY_NAMES = new Set([
  '.npmrc', '.pgpass', '.netrc', '.htpasswd', 'id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519',
  // Bank proxy/forwarder skriptlari — ichida qattiq yozilgan umumiy sir bor (tahlil uchun kerak emas)
  'xt-forwarder.php', 'bank-proxy.php', 'setup-bank-proxy.sh',
]);

/** Yo'l maxfiy/shaxsiy hisoblanadimi (ro'yxatda ham ko'rsatilmaydi). */
export function isDeniedPath(rel: string): boolean {
  const norm = String(rel ?? '').replace(/\\/g, '/').toLowerCase();
  const parts = norm.split('/').filter((p) => p && p !== '.');
  if (parts.length === 0) return false;
  for (const seg of parts) {
    if (DENY_SEGMENTS.has(seg)) return true;       // .git/, node_modules/, dist/, uploads/, tz/
    if (seg.startsWith('.next')) return true;      // .next/, .next-build/ ...
    if (seg.startsWith('.env')) return true;       // .env, .env.local, .env.example ...
  }
  const base = parts[parts.length - 1];
  if (DENY_NAMES.has(base)) return true;
  if (DENY_EXT.some((e) => base.endsWith(e))) return true;
  if (DENY_SUBSTR.some((s) => norm.includes(s))) return true;
  return false;
}

/**
 * Foydalanuvchi (LLM) bergan nisbiy yo'lni tekshiradi va normallashtiradi.
 * Absolyut yo'l, `..`, boshqaruv belgilari, pathspec "magic" (`:`) rad etiladi.
 */
export function validateRelPath(input: any, allowEmpty: boolean): { rel?: string; error?: string } {
  if (input === undefined || input === null || input === '') {
    return allowEmpty ? { rel: '' } : { error: "Yo'l (path) berilmadi" };
  }
  if (typeof input !== 'string') return { error: "Yo'l matn bo'lishi kerak" };
  let p = input.trim();
  if (!p) return allowEmpty ? { rel: '' } : { error: "Yo'l (path) berilmadi" };
  if (p.length > 300) return { error: "Yo'l juda uzun" };
  if (/[\x00-\x1f]/.test(p)) return { error: "Yo'lda ruxsat etilmagan belgi bor" };
  p = p.replace(/\\/g, '/');
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.startsWith('~')) {
    return { error: "Absolyut yo'l taqiqlangan — repo ildiziga nisbatan yo'l bering (masalan backend/src/app.module.ts)" };
  }
  if (p.startsWith(':')) return { error: "Yo'l ':' bilan boshlanmasin" };
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') return { error: "'..' taqiqlangan — repo tashqarisiga chiqib bo'lmaydi" };
    parts.push(seg);
  }
  if (parts.length === 0) return allowEmpty ? { rel: '' } : { error: "Yo'l (path) berilmadi" };
  return { rel: parts.join('/') };
}

// ─── Redaksiya ──────────────────────────────────────────────────────────

/** camelCase / kebab / nuqtali nom -> SNAKE_UPPER. */
function normName(name: string): string {
  return String(name ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
}

/** Kalit nomi sirga o'xshaydimi (SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE|CRED ...). camelCase ham tushuniladi. */
export function isSensitiveName(name: string): boolean {
  const n = normName(name);
  if (/(SECRET|PASSWORD|PASSWD|PASSPHRASE|PAROL|TOKEN|API_?KEY|PRIVATE|ACCESS_?KEY)/.test(n)) return true;
  if (/(^|_)CRED(ENTIALS?|S)?(_|$)/.test(n)) return true;
  if (/(^|_)(PWD|PASS)(_|$)/.test(n)) return true;
  if (/(^|_)(AUTH|KEY)$/.test(n)) return true;
  return false;
}

/** Qisqa kirish kodi nomi: darvoza kodi, PIN (GATE, IMPORT_KOD, pinCode, PASSCODE ...). Qiymati 4-12 raqam. */
export function isCodeName(name: string): boolean {
  return /(^|_)(GATE|KOD|PIN|PINCODE|PASSCODE)(_|$)/.test(normName(name));
}

// ─── Kodga yozilgan qisqa kodlar (literal) ro'yxati ────────────────────
// Skaner GATE/KOD/PIN nomli raqamli qiymatlarni topadi; shu qiymat boshqa joyda (izoh, `=== '...'`)
// uchrasa ham yashiriladi. Qo'shimcha: env LEADER_SECRET_LITERALS (vergulli, har biri 4+ belgi).
const discoveredLiterals = new Set<string>();
let literalCache: { key: string; re: RegExp | null } = { key: '', re: null };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Skaner topgan literal kodlarni o'rnatadi (oldingisi almashtiriladi). */
export function setSecretLiterals(values: Iterable<string>): void {
  discoveredLiterals.clear();
  for (const v of values) {
    const s = String(v ?? '').trim();
    if (/^[A-Za-z0-9_-]{4,64}$/.test(s)) discoveredLiterals.add(s);
  }
}

/** Joriy literal ro'yxat imzosi (o'zgarsa skaner natijasi qayta hisoblanadi). */
export function secretLiteralsKey(): string {
  literalRegex();
  return literalCache.key;
}

function literalRegex(): RegExp | null {
  const env = String(process.env.LEADER_SECRET_LITERALS || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 64);
  const all = [...new Set([...discoveredLiterals, ...env])].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const key = all.join('\u0001');
  if (key !== literalCache.key) {
    // Raqamli kod faqat raqam chegarasida (so'z ichida ham: "user7779" -> "user***"), boshqalari — so'z chegarasida
    const parts = all.map((v) =>
      /^\d+$/.test(v) ? `(?<!\\d)${escapeRe(v)}(?!\\d)` : `(?<![A-Za-z0-9])${escapeRe(v)}(?![A-Za-z0-9])`,
    );
    literalCache = { key, re: parts.length ? new RegExp(parts.join('|'), 'g') : null };
  }
  return literalCache.re;
}

/** Sir bo'lmagan, yashirish shart emas qiymatlar (setting kaliti, env nomi, allaqachon ***). */
function isBenignValue(v: string): boolean {
  const s = String(v ?? '').trim();
  if (!s) return true;
  if (/^\*+$/.test(s)) return true;
  if (/^\$\{?[A-Za-z_]\w*\}?$/.test(s)) return true;                                  // $VAR / ${VAR}
  if (s.length <= 64 && /^[a-z][A-Za-z_-]{0,31}(\.[a-z][A-Za-z_-]{0,31})+$/.test(s)) return true; // 'sverka.telegram.botToken'
  if (s.length <= 64 && /^[A-Z]+(_[A-Z]+)+$/.test(s)) return true;                    // 'LEADER_BOT_TOKEN' (env nomi)
  return false;
}

const MASK = '***';

/** Aniq ko'rinishli sirlar (qayerda bo'lsa ham). */
const KNOWN_SECRET_PATTERNS: RegExp[] = [
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}/g,                          // Telegram bot token
  /sk-ant-[A-Za-z0-9_-]{10,}/g,                               // Anthropic
  /\b(?:xs|xk)_live_\w+/g,                                    // Developer API kalitlari
  /\bxt_[A-Za-z0-9]{20,}\b/g,                                 // bank forwarder shared secret shakli
  /\bghp_\w+/g,
  /\bgithub_pat_\w+/g,
  /\bgh[ousr]_[A-Za-z0-9]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,                                    // AWS
  /\bAIza[0-9A-Za-z_-]{35}\b/g,                               // Google API key
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,                          // Slack
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
];

// NOM = 'qiymat' / NOM: "qiymat" / 'NOM' => 'qiymat' / $NOM = '...' / obj.nom === '...'
const RE_ASSIGN_QUOTED =
  /(["'`]?)(\$?[A-Za-z_][\w.$-]{0,80})\1(\]?\s*(?::=|=>|\?\?=|\|\|=|===?|!==?|[:=])\s*)(["'`])((?:(?!\4)[^\\\r\n]|\\.){6,2000})\4/g;
// define('NOM', 'qiymat') / config.get('JWT_SECRET', 'qiymat') / os.getenv('PASSWORD', '...')
const RE_ARG_PAIR = /(["'])([\w.$-]{1,80})\1(\s*,\s*)(["'`])((?:(?!\4)[^\\\r\n]|\\.){6,2000})\4/g;
// process.env.X_PASSWORD || 'qiymat' / $_ENV['X_SECRET'] ?? 'qiymat'
const RE_FALLBACK = /([\w.$\]'"-]{1,120})(\s*(?:\|\||\?\?|\?:)\s*)(["'`])((?:(?!\3)[^\\\r\n]|\\.){6,2000})\3/g;
// ${X_TOKEN:-qiymat}
const RE_SHELL_DEFAULT = /\$\{([A-Za-z_]\w{0,80})(:?[-=])([^}\s]{6,2000})\}/g;
// NOM=qiymat (qo'shtirnoqsiz: shell, .env uslubi, URL query)
const RE_ASSIGN_BARE = /(^|[\s;&|(?,])(export\s+)?([A-Za-z_][\w.-]{0,80})=(?![=>'"`\s$(])([^\s'"`;&|)<>,]{6,2000})/gm;
// YAML: nom: qiymat
const RE_YAML = /^(\s*-?\s*["']?)([\w.-]{1,80})(["']?\s*:[ \t]+)([A-Za-z0-9_+/=@!%^*~-]{6,500})[ \t]*$/gm;
// scheme://user:parol@host
const RE_URL_CREDS = /([a-z][a-z0-9+.-]{0,20}:\/\/[^\s:/@'"`]{1,120}:)([^\s@'"`/]{3,500})@/gi;
const RE_BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g;
const RE_PEM = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;
// Uzun yuqori entropiyali bo'lak (base64/hex kalit, PEM tanasi qatori)
const RE_BLOB = /[A-Za-z0-9+/=_-]{40,}/g;
// Qisqa raqamli kod: GATE = '1234' / IMPORT_KOD: "1234" / pin === '1234' (4-12 raqam)
const RE_CODE_QUOTED =
  /(["'`]?)(\$?[A-Za-z_][\w.$-]{0,80})\1(\]?\s*(?::=|=>|\?\?=|\|\|=|===?|!==?|[:=])\s*)(["'`])(\d{4,12})\4/g;
// KOD=1234 (qo'shtirnoqsiz)
const RE_CODE_BARE = /(^|[\s;&|(?,])(export\s+)?([A-Za-z_][\w.-]{0,80})=(\d{4,12})(?![\w.])/gm;

/** Matndagi GATE/KOD/PIN nomli raqamli qiymatlar (literal ro'yxat uchun). */
export function discoverCodeLiterals(text: string): string[] {
  const s = String(text ?? '');
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  const q = new RegExp(RE_CODE_QUOTED.source, 'g');
  while ((m = q.exec(s))) if (isCodeName(m[2])) out.add(m[5]);
  const b = new RegExp(RE_CODE_BARE.source, 'gm');
  while ((m = b.exec(s))) if (isCodeName(m[3])) out.add(m[4]);
  return [...out];
}

/**
 * Matndagi sirlarni `***` bilan almashtiradi. Qatorlar soni O'ZGARMAYDI
 * (read_file qator raqamlari to'g'ri qolsin).
 */
export function redactSecrets(input: string): string {
  let s = String(input ?? '');
  if (!s) return s;

  // Private key bloki — har qatori *** (yangi qatorlar saqlanadi)
  s = s.replace(RE_PEM, (m) => m.replace(/[^\r\n]+/g, MASK));

  for (const re of KNOWN_SECRET_PATTERNS) s = s.replace(re, MASK);
  s = s.replace(RE_BEARER, (_m, kind) => `${kind} ${MASK}`);

  s = s.replace(RE_ASSIGN_QUOTED, (m, q1, name, sep, q, val) =>
    isSensitiveName(name) && !isBenignValue(val) ? `${q1}${name}${q1}${sep}${q}${MASK}${q}` : m);
  s = s.replace(RE_ARG_PAIR, (m, q1, name, sep, q, val) =>
    isSensitiveName(name) && !isBenignValue(val) ? `${q1}${name}${q1}${sep}${q}${MASK}${q}` : m);
  s = s.replace(RE_FALLBACK, (m, name, sep, q, val) =>
    isSensitiveName(String(name).replace(/[\]'"]/g, ' ')) && !isBenignValue(val) ? `${name}${sep}${q}${MASK}${q}` : m);
  s = s.replace(RE_SHELL_DEFAULT, (m, name, op, val) =>
    isSensitiveName(name) && !isBenignValue(val) ? `\${${name}${op}${MASK}}` : m);
  s = s.replace(RE_ASSIGN_BARE, (m, pre, exp, name, val) =>
    isSensitiveName(name) && !isBenignValue(val) ? `${pre}${exp || ''}${name}=${MASK}` : m);
  s = s.replace(RE_YAML, (m, pre, name, sep, val) =>
    isSensitiveName(name) && !isBenignValue(val) ? `${pre}${name}${sep}${MASK}` : m);
  s = s.replace(RE_URL_CREDS, (_m, head) => `${head}${MASK}@`);
  s = s.replace(RE_CODE_QUOTED, (m, q1, name, sep, q) =>
    isCodeName(name) || isSensitiveName(name) ? `${q1}${name}${q1}${sep}${q}${MASK}${q}` : m);
  s = s.replace(RE_CODE_BARE, (m, pre, exp, name) => (isCodeName(name) ? `${pre}${exp || ''}${name}=${MASK}` : m));
  const lit = literalRegex();
  if (lit) s = s.replace(lit, MASK);

  s = s.replace(RE_BLOB, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) ? MASK : m));
  return s;
}

/**
 * Fayl darajasidagi redaksiya bilan qaysi qatorlar o'zgarganini qaytaradi: qator raqami (1 dan) ->
 * redaksiyalangan qator. Qatorlar soni mos kelmasa (kutilmagan) — har qator alohida redaksiya.
 */
export function sensitiveLines(text: string): Map<number, string> {
  const raw = String(text ?? '').split(/\r?\n/);
  const red = redactSecrets(String(text ?? '')).split(/\r?\n/);
  const out = new Map<number, string>();
  if (raw.length === red.length) {
    for (let i = 0; i < raw.length; i++) if (raw[i] !== red[i]) out.set(i + 1, red[i]);
  } else {
    for (let i = 0; i < raw.length; i++) {
      const r = redactSecrets(raw[i]);
      if (r !== raw[i]) out.set(i + 1, r);
    }
  }
  return out;
}

/** git ERE naqshini JS RegExp'ga yaqinlashtiradi (POSIX sinflari, \< \>). */
function ereToJs(p: string): string {
  return p
    .replace(/\[:alpha:\]/g, 'A-Za-z')
    .replace(/\[:digit:\]/g, '0-9')
    .replace(/\[:alnum:\]/g, 'A-Za-z0-9')
    .replace(/\[:upper:\]/g, 'A-Z')
    .replace(/\[:lower:\]/g, 'a-z')
    .replace(/\[:space:\]/g, '\\s')
    .replace(/\[:blank:\]/g, ' \\t')
    .replace(/\[:xdigit:\]/g, '0-9A-Fa-f')
    .replace(/\\[<>]/g, '\\b');
}

// Alohida node jarayonida: naqsh foydalanuvchi (LLM) dan — og'ir regex asosiy jarayonni bloklamasin.
const REGEX_WORKER =
  "let d='';process.stdin.setEncoding('utf8');process.stdin.on('data',c=>{d+=c});" +
  "process.stdin.on('end',()=>{let o;try{const q=JSON.parse(d);const re=new RegExp(q.p,q.f);const idx=[];" +
  'for(let i=0;i<q.l.length;i++){if(re.test(q.l[i]))idx.push(i)}o={ok:true,idx}}' +
  "catch(e){o={ok:false,error:String(e&&e.message||e).slice(0,200)}}process.stdout.write(JSON.stringify(o))});";

/**
 * Qatorlardan naqshga moslarini topadi (vaqt chegarasi bilan, alohida jarayonda).
 * JS'da kompilyatsiya bo'lmaydigan naqsh — moslik yo'q (xavfsiz tomonga).
 */
export function matchLinesSafely(
  pattern: string,
  ignoreCase: boolean,
  lines: string[],
): Promise<{ idx: number[] } | { error: string }> {
  if (!lines.length) return Promise.resolve({ idx: [] });
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { idx: number[] } | { error: string }) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    };
    let child: ReturnType<typeof spawn>;
    try {
      const env: Record<string, string> = {};
      if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
      child = spawn(process.execPath, ['--max-old-space-size=128', '-e', REGEX_WORKER], {
        stdio: ['pipe', 'pipe', 'ignore'],
        windowsHide: true,
        env,
      });
    } catch (e: any) {
      resolve({ error: `Qidiruv jarayoni ishga tushmadi: ${String(e?.message || e).slice(0, 100)}` });
      return;
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      finish({ error: "Naqsh juda og'ir (5 soniyada tugamadi) — soddaroq naqsh bering" });
    }, REGEX_TIMEOUT_MS);
    let out = '';
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (c: string) => {
      if (out.length < 2_000_000) out += c;
    });
    child.on('error', (e: any) => finish({ error: `Qidiruv jarayoni xatosi: ${String(e?.message || e).slice(0, 100)}` }));
    child.on('close', () => {
      try {
        const r = JSON.parse(out);
        if (r?.ok && Array.isArray(r.idx)) finish({ idx: r.idx.filter((i: any) => Number.isInteger(i) && i >= 0 && i < lines.length) });
        else finish({ idx: [] }); // JS'da noto'g'ri naqsh — sirli qatorlardan moslik yo'q
      } catch {
        finish({ error: 'Qidiruv jarayoni natija bermadi' });
      }
    });
    child.stdin!.on('error', () => undefined);
    child.stdin!.end(JSON.stringify({ p: ereToJs(pattern), f: ignoreCase ? 'i' : '', l: lines }));
  });
}

// ─── Yordamchilar ───────────────────────────────────────────────────────

function clampInt(v: any, min: number, max: number, def: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function cut(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

interface GitResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  overflow: boolean;
  timedOut: boolean;
}

/** Sir skaneri: fayl bo'yicha kesh (mtime+hajm o'zgarsa qayta o'qiladi). */
interface ScanEntry {
  mtimeMs: number;
  size: number;
  /** false — o'qilmadi (katta/binar/symlink): grep bu fayl qatorlarini ehtiyotkor rejimda beradi. */
  scanned: boolean;
  /** Fayldan topilgan qisqa kod literal'lari. */
  literals: string[];
  /** Qaysi literal ro'yxati bilan hisoblangan. */
  litKey: string;
  /** Redaksiyada o'zgargan qatorlar: raqam -> redaksiyalangan matn. */
  sensitive: Map<number, string> | null;
}

@Injectable()
export class LeaderCodeToolsService implements OnModuleInit {
  private readonly log = new Logger(LeaderCodeToolsService.name);
  private lsCache: { at: number; root: string; files: string[]; set: Set<string>; lower: Map<string, string> } | null = null;
  private scan = new Map<string, ScanEntry>();
  private scanRoot = '';
  private scanAt = 0;
  private scanInflight: Promise<void> | null = null;

  constructor(private readonly config: LeaderConfigService) {}

  /** Boot'dan keyin bir marta skaner (literal kodlar facts/xotira redaksiyasida ham ishlasin). */
  onModuleInit() {
    if (!this.config.enabled()) return; // bot o'chiq bo'lsa skaner ham ishlamaydi (asboblar birinchi chaqiruvda o'zi skanerlaydi)
    const t = setTimeout(() => {
      this.ensureScan().catch((e) => this.log.warn(`Sir skaneri ishlamadi: ${e?.message}`));
    }, 5000);
    t.unref?.();
  }

  tools(): ToolImpl[] {
    return [
      {
        name: 'list_files',
        description:
          "Repo'dagi git kuzatadigan fayllar ro'yxati (maxfiy fayllar ko'rsatilmaydi). " +
          "path_prefix — yo'l boshlanishi (masalan 'backend/src/sync'), contains — yo'l ichidagi so'z. Ko'pi bilan 300 ta.",
        input_schema: {
          type: 'object',
          properties: {
            path_prefix: { type: 'string', description: "Repo ildiziga nisbatan yo'l boshlanishi, masalan 'backend/src/leader'" },
            contains: { type: 'string', description: "Yo'l ichida bo'lishi kerak bo'lgan so'z (katta-kichik harfsiz)" },
          },
          additionalProperties: false,
        },
        run: (input) => this.safe('list_files', () => this.listFiles(input)),
      },
      {
        name: 'grep',
        description:
          "Kod ichidan qidirish (git grep, kengaytirilgan regex). Natija qatorlari 'yo'l:qator: matn' ko'rinishida, " +
          "ko'pi bilan 100 ta moslik. Sirlar *** bilan yashiriladi. Moslik bo'lmasa matches=0 (bu xato emas).",
        input_schema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Qidiruv naqshi (ERE regex, 200 belgigacha)' },
            path_prefix: { type: 'string', description: "Faqat shu papka/fayl ichida, masalan 'backend/src'" },
            ignore_case: { type: 'boolean', description: 'Katta-kichik harfni farqlamaslik' },
          },
          required: ['pattern'],
          additionalProperties: false,
        },
        run: (input) => this.safe('grep', () => this.grep(input)),
      },
      {
        name: 'read_file',
        description:
          "Faylni qator raqamlari bilan o'qish (faqat git kuzatadigan, maxfiy bo'lmagan fayl, 1 MB gacha). " +
          "offset — boshlang'ich qator (1 dan), limit — qatorlar soni (standart 200, ko'pi bilan 400). " +
          "truncated=true bo'lsa next_offset dan davom et. Sirlar *** bilan yashiriladi.",
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: "Repo ildiziga nisbatan yo'l, masalan 'backend/src/sync/sync.service.ts'" },
            offset: { type: 'integer', minimum: 1, description: "Boshlang'ich qator (1 dan)" },
            limit: { type: 'integer', minimum: 1, maximum: READ_MAX_LIMIT, description: 'Qatorlar soni (ko\'pi bilan 400)' },
          },
          required: ['path'],
          additionalProperties: false,
        },
        run: (input) => this.safe('read_file', () => this.readFile(input)),
      },
      {
        name: 'git_log',
        description:
          "Oxirgi commitlar: hash, sana, muallif, xabar. path berilsa — faqat shu fayl yoki papka tarixi. limit ko'pi bilan 20.",
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: "Ixtiyoriy: fayl yoki papka yo'li" },
            limit: { type: 'integer', minimum: 1, maximum: LOG_MAX_LIMIT, description: 'Commitlar soni (standart 10)' },
          },
          additionalProperties: false,
        },
        run: (input) => this.safe('git_log', () => this.gitLog(input)),
      },
    ];
  }

  // ─── Asboblar ─────────────────────────────────────────────────────────

  async listFiles(input: any): Promise<any> {
    const v = validateRelPath(input?.path_prefix, true);
    if (v.error) return { error: v.error };
    const prefix = (v.rel || '').toLowerCase();
    if (prefix && isDeniedPath(prefix)) return { error: "Bu yo'l yopiq (maxfiy yoki shaxsiy fayllar)" };
    const contains = typeof input?.contains === 'string' ? input.contains.trim().toLowerCase().slice(0, 100) : '';

    const ls = await this.trackedFiles();
    if ('error' in ls) return { error: ls.error };

    const matched = ls.files.filter((f) => {
      const lf = f.toLowerCase();
      if (prefix && !lf.startsWith(prefix)) return false;
      if (contains && !lf.includes(contains)) return false;
      return !isDeniedPath(f);
    });

    const files: string[] = [];
    let used = 0;
    for (const f of matched) {
      if (files.length >= LIST_LIMIT || used + f.length + 4 > OUT_CHAR_BUDGET) break;
      files.push(f);
      used += f.length + 4;
    }
    return { total: matched.length, shown: files.length, truncated: files.length < matched.length, files };
  }

  async grep(input: any): Promise<any> {
    const pattern = typeof input?.pattern === 'string' ? input.pattern : '';
    if (!pattern) return { error: 'pattern berilmadi' };
    if (pattern.length > 200) return { error: 'pattern 200 belgidan oshmasin' };
    if (/[\x00\r\n]/.test(pattern)) return { error: "pattern bir qatorli bo'lsin" };

    const v = validateRelPath(input?.path_prefix, true);
    if (v.error) return { error: v.error };
    const prefix = v.rel || '';
    if (prefix && isDeniedPath(prefix)) return { error: "Bu yo'l yopiq (maxfiy yoki shaxsiy fayllar)" };

    const ignoreCase = input?.ignore_case === true;
    const args = ['grep', '-n', '-I', '-E', '-z', '--no-color', '--full-name'];
    if (ignoreCase) args.push('-i');
    args.push('-e', pattern, '--');
    if (prefix) args.push(prefix);

    // Sir skaneri (fayl darajasidagi redaksiya) — xom moslik sirli qatorlar uchun ishlatilmaydi
    await this.ensureScan();

    const r = await this.git(args);
    if (r.timedOut) return { error: "Qidiruv 10 soniyada tugamadi — naqshni yoki path_prefix'ni toraytiring" };
    const notFound = !r.ok && !r.overflow && r.code === 1 && !r.stdout;
    if (!r.ok && !r.overflow && !notFound) {
      const msg = redactSecrets(String(r.stderr || '').split('\n')[0] || 'git grep xatosi').slice(0, 200);
      return { error: `Qidiruv xatosi: ${msg}` };
    }

    const hits: Array<{ file: string; n: number; text: string }> = [];
    // 1) git natijasi — faqat sirsiz qatorlar (ularda xom matn = redaksiyalangan matn)
    for (const raw of notFound ? [] : r.stdout.split('\n')) {
      if (!raw) continue;
      const i1 = raw.indexOf('\0');
      const i2 = i1 >= 0 ? raw.indexOf('\0', i1 + 1) : -1;
      if (i1 < 0 || i2 < 0) continue;
      const file = raw.slice(0, i1);
      if (isDeniedPath(file)) continue;
      const n = Number(raw.slice(i1 + 1, i2));
      const content = raw.slice(i2 + 1);
      const e = this.scan.get(file);
      if (e && e.scanned) {
        if (e.sensitive?.has(n)) continue; // pastda redaksiyalangan matn bo'yicha qidiriladi
      } else if (redactSecrets(content) !== content) {
        continue; // skanerlanmagan fayl: sirli qator umuman berilmaydi
      }
      hits.push({ file, n, text: content });
    }

    // 2) Sirli qatorlar — FAQAT redaksiyalangan matn bo'yicha (natija sirga bog'liq emas)
    const cand: Array<{ file: string; n: number; text: string }> = [];
    for (const [file, e] of this.scan) {
      if (!e.scanned || !e.sensitive?.size) continue;
      if (prefix && file !== prefix && !file.startsWith(`${prefix}/`)) continue;
      if (isDeniedPath(file)) continue;
      for (const [n, text] of e.sensitive) cand.push({ file, n, text });
    }
    if (cand.length) {
      const m = await matchLinesSafely(pattern, ignoreCase, cand.map((c) => c.text));
      if ('error' in m) return { error: m.error };
      for (const i of m.idx) hits.push(cand[i]);
    }
    hits.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.n - b.n));

    const results: string[] = [];
    let used = 0;
    let budgetHit = false;
    for (const h of hits) {
      if (results.length >= GREP_LIMIT || budgetHit) break;
      // Avval to'liq qatorni redaksiya, keyin kesish (sir yarmi ko'rinib qolmasin)
      const content = cut(redactSecrets(h.text).trim(), GREP_LINE_CHARS);
      const row = `${h.file}:${h.n}: ${content}`;
      if (used + row.length + 4 > OUT_CHAR_BUDGET) { budgetHit = true; break; }
      results.push(row);
      used += row.length + 4;
    }
    return {
      pattern,
      matches: results.length,
      total_found: hits.length,
      truncated: r.overflow || results.length < hits.length,
      results,
    };
  }

  async readFile(input: any): Promise<any> {
    const v = validateRelPath(input?.path, false);
    if (v.error) return { error: v.error };
    let rel = v.rel;
    // Deny — kuzatilishidan OLDIN (maxfiy fayl bor-yo'qligi ham oshkor bo'lmasin)
    if (isDeniedPath(rel)) return { error: "Bu fayl yopiq (maxfiy yoki shaxsiy)" };

    const ls = await this.trackedFiles();
    if ('error' in ls) return { error: ls.error };
    if (!ls.set.has(rel)) {
      const alt = ls.lower.get(rel.toLowerCase());
      if (!alt) return { error: "Fayl git'da kuzatilmaydi yoki topilmadi (list_files bilan tekshiring)" };
      rel = alt;
      if (isDeniedPath(rel)) return { error: "Bu fayl yopiq (maxfiy yoki shaxsiy)" };
    }

    const root = path.resolve(this.repoRoot());
    const abs = path.resolve(root, rel);
    if (!isInside(root, abs)) return { error: 'Fayl repo tashqarisida' };

    let lst: fs.Stats;
    try {
      lst = await fs.promises.lstat(abs);
    } catch {
      return { error: "Fayl diskda topilmadi" };
    }
    if (lst.isSymbolicLink()) return { error: "Symlink o'qilmaydi" };
    if (!lst.isFile()) return { error: 'Bu oddiy fayl emas' };

    // Real yo'l (parent papkalar symlink bo'lsa ham) repo ichida bo'lishi shart
    let realRoot: string;
    let realAbs: string;
    try {
      realRoot = await fs.promises.realpath(root);
      realAbs = await fs.promises.realpath(abs);
    } catch {
      return { error: "Fayl yo'li aniqlanmadi" };
    }
    if (!isInside(realRoot, realAbs)) return { error: 'Fayl repo tashqarisida' };
    const realRel = path.relative(realRoot, realAbs).split(path.sep).join('/');
    if (isDeniedPath(realRel)) return { error: "Bu fayl yopiq (maxfiy yoki shaxsiy)" };

    const st = await fs.promises.stat(realAbs);
    if (st.size > MAX_FILE_BYTES) {
      return { error: `Fayl juda katta (${Math.round(st.size / 1024)} KB, chegara 1024 KB) — grep bilan kerakli joyni toping` };
    }
    const buf = await fs.promises.readFile(realAbs);
    if (buf.subarray(0, 8000).includes(0)) return { error: "Binar fayl — matn sifatida o'qilmaydi" };

    // Literal kodlar ro'yxati tayyor bo'lsin (boshqa faylda e'lon qilingan kod shu faylda ham yashirilsin)
    await this.ensureScan().catch(() => undefined);
    const text = redactSecrets(buf.toString('utf8'));
    const lines = text.split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    const total = lines.length;

    const from = clampInt(input?.offset, 1, Math.max(1, total), 1);
    const limit = clampInt(input?.limit, 1, READ_MAX_LIMIT, READ_DEFAULT_LIMIT);
    const want = Math.min(total, from + limit - 1);

    const out: string[] = [];
    let used = 0;
    let to = from - 1;
    for (let n = from; n <= want; n++) {
      const row = `${n}: ${cut(lines[n - 1] ?? '', READ_LINE_CHARS)}`;
      if (used + row.length + 1 > OUT_CHAR_BUDGET && out.length > 0) break;
      out.push(row);
      used += row.length + 1;
      to = n;
    }
    const truncated = to < want;
    const res: any = { path: rel, total_lines: total, from, to, truncated, content: out.join('\n') };
    if (to < total) res.next_offset = to + 1;
    return res;
  }

  async gitLog(input: any): Promise<any> {
    const v = validateRelPath(input?.path, true);
    if (v.error) return { error: v.error };
    const p = v.rel || '';
    if (p && isDeniedPath(p)) return { error: "Bu yo'l yopiq (maxfiy yoki shaxsiy fayllar)" };
    const limit = clampInt(input?.limit, 1, LOG_MAX_LIMIT, LOG_DEFAULT_LIMIT);

    const args = ['log', '-n', String(limit), '--no-color', '--format=%h|%ad|%an|%s', '--date=iso', '--'];
    if (p) args.push(p);
    const r = await this.git(args);
    if (r.timedOut) return { error: 'git log 10 soniyada tugamadi' };
    if (!r.ok) {
      const msg = redactSecrets(String(r.stderr || '').split('\n')[0] || 'git log xatosi').slice(0, 200);
      return { error: `git log xatosi: ${msg}` };
    }
    const commits = r.stdout
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const [hash, date, author, ...rest] = l.split('|');
        return {
          hash,
          date,
          author: cut(String(author || ''), 60),
          subject: cut(redactSecrets(rest.join('|')), 200),
        };
      });
    return { path: p || null, count: commits.length, commits };
  }

  // ─── Ichki ────────────────────────────────────────────────────────────

  private repoRoot(): string {
    return this.config.repoDir();
  }

  /** Asbobni o'rab oladi: hech qachon throw qilmaydi. */
  private async safe(name: string, fn: () => Promise<any>): Promise<any> {
    try {
      return await fn();
    } catch (e: any) {
      this.log.warn(`${name} xato: ${e?.message}`);
      return { error: `${name} bajarilmadi: ${redactSecrets(String(e?.message || 'noma\'lum xato')).slice(0, 200)}` };
    }
  }

  /**
   * Sir skaneri: barcha kuzatiladigan (rad etilmagan) fayllarni o'qib, qisqa kod literal'larini topadi va
   * fayl darajasidagi redaksiyada o'zgargan qatorlarni eslab qoladi. 30 s kesh, fayl mtime/hajm bo'yicha.
   */
  private ensureScan(): Promise<void> {
    const root = path.resolve(this.repoRoot());
    if (this.scanRoot === root && Date.now() - this.scanAt < LS_CACHE_MS) return Promise.resolve();
    if (!this.scanInflight) {
      this.scanInflight = this.doScan(root).finally(() => {
        this.scanInflight = null;
      });
    }
    return this.scanInflight;
  }

  private async doScan(root: string): Promise<void> {
    const ls = await this.trackedFiles();
    if ('error' in ls) throw new Error(ls.error);
    if (this.scanRoot !== root) {
      this.scan.clear();
      this.scanRoot = root;
    }
    const files = ls.files.filter((f) => !isDeniedPath(f));
    const live = new Set(files);
    for (const k of [...this.scan.keys()]) if (!live.has(k)) this.scan.delete(k);

    const fresh = new Map<string, string>();
    // null — fayl yo'q; text null — o'qilmaydi (katta/binar/symlink); same — o'zgarmagan (kesh)
    const readText = async (rel: string): Promise<{ st: fs.Stats; text: string | null; same?: boolean } | null> => {
      const abs = path.resolve(root, rel);
      if (!isInside(root, abs)) return null;
      let st: fs.Stats;
      try {
        st = await fs.promises.lstat(abs);
      } catch {
        return null;
      }
      if (!st.isFile() || st.size > SCAN_MAX_BYTES) return { st, text: null };
      const prev = this.scan.get(rel);
      if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) return { st, text: null, same: true };
      try {
        const buf = await fs.promises.readFile(abs);
        if (buf.subarray(0, 8000).includes(0)) return { st, text: null };
        return { st, text: buf.toString('utf8') };
      } catch {
        return { st, text: null };
      }
    };

    // 1) O'zgargan fayllarni o'qish (8 tadan parallel)
    for (let i = 0; i < files.length; i += 8) {
      const batch = files.slice(i, i + 8);
      const got = await Promise.all(batch.map((f) => readText(f)));
      batch.forEach((f, j) => {
        const g = got[j];
        if (!g) {
          this.scan.delete(f);
          return;
        }
        if (g.same) return; // o'zgarmagan — kesh
        if (g.text === null) {
          this.scan.set(f, { mtimeMs: g.st.mtimeMs, size: g.st.size, scanned: false, literals: [], litKey: '', sensitive: null });
          return;
        }
        fresh.set(f, g.text);
        this.scan.set(f, {
          mtimeMs: g.st.mtimeMs,
          size: g.st.size,
          scanned: true,
          literals: discoverCodeLiterals(g.text),
          litKey: '',
          sensitive: null,
        });
      });
    }

    // 2) Umumiy literal ro'yxat, keyin sirli qatorlar (ro'yxat o'zgarsa hammasi qayta hisoblanadi)
    const lits = new Set<string>();
    for (const e of this.scan.values()) for (const l of e.literals) lits.add(l);
    setSecretLiterals(lits);
    const key = secretLiteralsKey();
    for (const [f, e] of this.scan) {
      if (!e.scanned || (e.sensitive && e.litKey === key)) continue;
      let text = fresh.get(f);
      if (text === undefined) {
        try {
          text = (await fs.promises.readFile(path.resolve(root, f))).toString('utf8');
        } catch {
          e.scanned = false;
          continue;
        }
      }
      e.sensitive = sensitiveLines(text);
      e.litKey = key;
    }
    this.scanAt = Date.now();
  }

  /** `git ls-files` (30 s kesh). */
  private async trackedFiles(): Promise<
    { files: string[]; set: Set<string>; lower: Map<string, string> } | { error: string }
  > {
    const root = this.repoRoot();
    const c = this.lsCache;
    if (c && c.root === root && Date.now() - c.at < LS_CACHE_MS) return c;
    const r = await this.git(['ls-files', '-z']);
    if (!r.ok) {
      const msg = r.timedOut ? 'vaqt tugadi' : String(r.stderr || '').split('\n')[0].slice(0, 200) || 'noma\'lum xato';
      return { error: `git ls-files ishlamadi: ${msg}` };
    }
    const files = r.stdout.split('\0').filter(Boolean);
    const lower = new Map<string, string>();
    const dup = new Set<string>();
    for (const f of files) {
      const k = f.toLowerCase();
      if (lower.has(k)) dup.add(k);
      else lower.set(k, f);
    }
    for (const k of dup) lower.delete(k); // noaniq (faqat harf katta-kichikligi farq) — taxmin qilmaymiz
    this.lsCache = { at: Date.now(), root, files, set: new Set(files), lower };
    return this.lsCache;
  }

  /** git'ni SHELL'siz ishga tushiradi. Hech qachon reject qilmaydi. */
  private git(args: string[]): Promise<GitResult> {
    return new Promise((resolve) => {
      try {
        execFile(
          'git',
          [...GIT_BASE_ARGS, ...args],
          {
            cwd: this.repoRoot(),
            timeout: GIT_TIMEOUT_MS,
            maxBuffer: GIT_MAX_BUFFER,
            windowsHide: true,
            encoding: 'utf8',
            env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', PAGER: 'cat' },
          },
          (err: any, stdout: string, stderr: string) => {
            if (!err) {
              resolve({ ok: true, code: 0, stdout: stdout || '', stderr: stderr || '', overflow: false, timedOut: false });
              return;
            }
            const overflow = err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(String(err.message));
            const sysErr = typeof err.code === 'string' && !overflow ? (err.code === 'ENOENT' ? 'git topilmadi' : err.code) : '';
            resolve({
              ok: false,
              code: typeof err.code === 'number' ? err.code : null,
              stdout: String(stdout || ''),
              stderr: String(stderr || '') || sysErr,
              overflow,
              timedOut: !overflow && !!err.killed,
            });
          },
        );
      } catch (e: any) {
        resolve({ ok: false, code: null, stdout: '', stderr: String(e?.message || ''), overflow: false, timedOut: false });
      }
    });
  }
}
