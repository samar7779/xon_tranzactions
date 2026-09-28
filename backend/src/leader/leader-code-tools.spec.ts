import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  LeaderCodeToolsService,
  discoverCodeLiterals,
  isCodeName,
  isDeniedPath,
  isSensitiveName,
  matchLinesSafely,
  redactSecrets,
  validateRelPath,
} from './leader-code-tools.service';

/**
 * Kod asboblari XAVFSIZLIK yadrosi: deny, redaksiya, path traversal, symlink.
 *
 * Muhim: sir tekshiruvlari `expect(re.test(x)).toBe(false)` ko'rinishida — test yiqilsa ham
 * jest sirli matnni konsolga CHIQARMAYDI (faqat true/false).
 */

// Mock qiymatlar — haqiqiy sirlar bilan bir xil SHAKL (qiymat o'ylab topilgan).
const MOCK_FWD = 'xt_' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6'; // xt_ + 32 ta [a-z0-9]
const MOCK_FWD_PLAIN = 'q9w8e7r6t5y4u3i2o1p0l9k8'; // prefikssiz (faqat tayinlash qoidasi ushlasin)
const MOCK_TG = '1234567890:' + 'AAHmockmockmockmockmockmockmockmock12';
const MOCK_ANT = 'sk-ant-' + 'api03-mockMOCKmock_mock-1234567890';

const DEPLOY_SH = [
  '#!/usr/bin/env bash',
  'set -euo pipefail',
  'TG_BOT_TOKEN="${TG_BOT_TOKEN:-' + MOCK_TG + '}"',
  'DEPLOY_NOTIFY_CHAT="${DEPLOY_NOTIFY_CHAT:--1001234567890}"',
  'export TG_BOT_TOKEN DEPLOY_NOTIFY_CHAT',
  '',
  '# Xon bank API forwarder',
  'BANK_FORWARDER_URL="https://example.uz/xt-forwarder.php"',
  'BANK_FORWARDER_SECRET="' + MOCK_FWD + '"',
  'export BANK_FORWARDER_URL BANK_FORWARDER_SECRET',
  '  ensure_env_var "$ROOT/backend/.env" "BANK_FORWARDER_SECRET" "$BANK_FORWARDER_SECRET"',
  '',
].join('\n');

const FORWARDER_PHP = [
  '<?php',
  '// SOZLAMALAR',
  '// 32 belgili tasodifiy parol — Xon backend bilan bir xil bo\'lsin',
  "$SHARED_SECRET = '" + MOCK_FWD + "';",
  '',
  '$providedSecret = $_SERVER[\'HTTP_X_XT_SECRET\'] ?? \'\';',
  'if (!hash_equals($SHARED_SECRET, $providedSecret)) {',
  "    http_response_code(403);",
  '}',
  '',
].join('\n');

// Qisqa darvoza kodi (mock) va ko'p qatorli tayinlash qiymati (mock)
const MOCK_GATE = '4' + '826';
const MOCK_MULTI = 'mlsecret' + 'value123';

const has = (s: any, needle: string) => JSON.stringify(s).includes(needle);
const XT_SHAPE = /xt_[A-Za-z0-9]{20,}/;

function git(cwd: string, args: string[]) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'safe.directory=*', ...args], {
    cwd,
    stdio: 'pipe',
    windowsHide: true,
  }).toString();
}

function write(root: string, rel: string, content: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// ═══════════════════════════════════════════════════════════════════════
describe('isDeniedPath', () => {
  it.each([
    '.env',
    'backend/.env',
    'backend/.env.production',
    'frontend/.ENV.local',
    'backend/.env.example',
    'certs/server.pem',
    'keys/app.KEY',
    'x/cert.p12',
    'backend/src/bank-credentials/bank-credentials.service.ts',
    'gcp-service-account.json',
    'config/my_Secret.json',
    '.git/config',
    'node_modules/a/index.js',
    'backend/dist/main.js',
    'frontend/.next/server/app.js',
    'frontend/.next-build/x.js',
    'uploads/a.pdf',
    'backend/uploads/b.png',
    'tz/1.jpeg',
    'tz',
    'data/db.sqlite',
    'logs/app.log',
    'home/.npmrc',
    'scripts/xt-forwarder.php',
    'scripts/bank-proxy.php',
    'scripts/setup-bank-proxy.sh',
  ])('rad: %s', (p) => {
    expect(isDeniedPath(p)).toBe(true);
  });

  it.each([
    'backend/src/leader/leader.types.ts',
    'scripts/deploy.sh',
    'scripts/forwarder-demo.php',
    'README.md',
    'frontend/next.config.js',
    'docs/tz-notes.md',
    'backend/src/auth/token.util.ts',
    'backend/prisma/schema.prisma',
  ])('ruxsat: %s', (p) => {
    expect(isDeniedPath(p)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('validateRelPath', () => {
  it.each([
    '../etc/passwd',
    'backend/../../outside.txt',
    'backend\\..\\..\\x.txt',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'c:/x.txt',
    '~/x',
    ':(glob)**/.env',
    'a\u0000b',
  ])('rad: %s', (p) => {
    expect(validateRelPath(p, false).error).toBeTruthy();
  });

  it('normallashtiradi', () => {
    expect(validateRelPath('./backend//src/./app.module.ts', false).rel).toBe('backend/src/app.module.ts');
    expect(validateRelPath('backend\\src\\main.ts', false).rel).toBe('backend/src/main.ts');
    expect(validateRelPath('', true).rel).toBe('');
    expect(validateRelPath('', false).error).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('redactSecrets', () => {
  it('scripts/deploy.sh shaklidagi forwarder secret yashiriladi', () => {
    const out = redactSecrets(DEPLOY_SH);
    expect(out.includes(MOCK_FWD)).toBe(false);
    expect(XT_SHAPE.test(out)).toBe(false);
    expect(out).toContain('BANK_FORWARDER_SECRET="***"');
    expect(out.includes(MOCK_TG)).toBe(false);
    // Qatorlar soni o'zgarmaydi
    expect(out.split('\n').length).toBe(DEPLOY_SH.split('\n').length);
    // Sir bo'lmagan qiymat qoladi
    expect(out).toContain('BANK_FORWARDER_URL="https://example.uz/xt-forwarder.php"');
  });

  it('scripts/xt-forwarder.php shaklidagi forwarder secret yashiriladi', () => {
    const out = redactSecrets(FORWARDER_PHP);
    expect(out.includes(MOCK_FWD)).toBe(false);
    expect(XT_SHAPE.test(out)).toBe(false);
    expect(out).toContain("$SHARED_SECRET = '***';");
    expect(out).toContain('hash_equals($SHARED_SECRET, $providedSecret)');
  });

  it('prefikssiz qiymat ham faqat tayinlash qoidasi bilan ushlanadi', () => {
    const sh = redactSecrets('BANK_FORWARDER_SECRET="' + MOCK_FWD_PLAIN + '"');
    const php = redactSecrets("$SHARED_SECRET = '" + MOCK_FWD_PLAIN + "';");
    const grepLine = redactSecrets('scripts/deploy.sh:42:BANK_FORWARDER_SECRET="' + MOCK_FWD_PLAIN + '"');
    expect(sh.includes(MOCK_FWD_PLAIN)).toBe(false);
    expect(php.includes(MOCK_FWD_PLAIN)).toBe(false);
    expect(grepLine.includes(MOCK_FWD_PLAIN)).toBe(false);
  });

  it('turli tayinlash shakllari', () => {
    const cases = [
      `const JWT_SECRET = '${MOCK_FWD_PLAIN}';`,
      `  password: "${MOCK_FWD_PLAIN}",`,
      `{"apiKey": "${MOCK_FWD_PLAIN}"}`,
      `'db_password' => '${MOCK_FWD_PLAIN}',`,
      `export DIDOX_LOGIN_PASSWORD=${MOCK_FWD_PLAIN}`,
      `ANTHROPIC_API_KEY=${MOCK_FWD_PLAIN}`,
      `const pw = process.env.SEED_ADMIN_PASSWORD || '${MOCK_FWD_PLAIN}';`,
      `this.secret = config.get<string>('GH_DEPLOY_SECRET', '${MOCK_FWD_PLAIN}');`,
      `  CRED_ENC_KEY: ${MOCK_FWD_PLAIN}`,
      `XON_KEY="${MOCK_FWD_PLAIN}"`,
      `DATABASE_URL="postgres://xon:${MOCK_FWD_PLAIN}@localhost:5432/db"`,
      `Authorization: Bearer ${MOCK_FWD_PLAIN}${MOCK_FWD_PLAIN}`,
      `if (token === '${MOCK_FWD_PLAIN}') {}`,
    ];
    for (const c of cases) {
      const out = redactSecrets(c);
      if (out.includes(MOCK_FWD_PLAIN)) throw new Error(`yashirilmadi (shakl #${cases.indexOf(c)})`);
    }
  });

  it("ma'lum token naqshlari", () => {
    const src = [
      `const t = "${MOCK_TG}";`,
      `key: ${MOCK_ANT}`,
      `x = 'xs_live_ab12cd34ef56'`,
      `y = xk_live_zz99yy88`,
      `gh = ghp_abcdefghijklmnop1234`,
      `jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U`,
    ].join('\n');
    const out = redactSecrets(src);
    for (const needle of [MOCK_TG, MOCK_ANT, 'xs_live_ab12', 'xk_live_zz99', 'ghp_abcdef', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIi']) {
      if (out.includes(needle)) throw new Error(`yashirilmadi: ${needle.slice(0, 6)}`);
    }
  });

  it('private key bloki — qator soni saqlanadi', () => {
    const src = [
      'a',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEAmockmockmockmockmockmockmockmock1234567890abcdefABCDEF',
      'Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6',
      '-----END RSA PRIVATE KEY-----',
      'b',
    ].join('\n');
    const out = redactSecrets(src);
    expect(out.includes('MIIEowIBAAKCAQEA')).toBe(false);
    expect(out.includes('Zm9vYmFy')).toBe(false);
    expect(out.split('\n')).toHaveLength(6);
    expect(out.split('\n')[0]).toBe('a');
    expect(out.split('\n')[5]).toBe('b');
  });

  it("ortiqcha yashirmaydi (setting kalitlari, oddiy kod)", () => {
    const keep = [
      "private static readonly KEY_BOT_TOKEN = 'sverka.telegram.botToken';",
      "authMode: 'IP_WHITELIST',",
      "keyField: 'contractNo',",
      "const row = await this.prisma.setting.findUnique({ where: { key: 'agent.aiKey' } });",
      "const ENV_NAME = 'LEADER_BOT_TOKEN';",
      'const token = await this.cfg.getToken();',
      "this.log.warn('token xato');",
      'return process.env.ANTHROPIC_API_KEY || null;',
    ];
    for (const line of keep) expect(redactSecrets(line)).toBe(line);
  });

  it('qisqa darvoza kodi (GATE/KOD/PIN) yashiriladi, oddiy raqam qoladi', () => {
    const cases = [
      `private readonly GATE = '${MOCK_GATE}';`,
      `const IMPORT_KOD = "${MOCK_GATE}";`,
      `pinCode: '${MOCK_GATE}',`,
      `GATE_CODE=${MOCK_GATE}`,
    ];
    for (const c of cases) {
      if (redactSecrets(c).includes(MOCK_GATE)) throw new Error(`yashirilmadi (shakl #${cases.indexOf(c)})`);
    }
    expect(discoverCodeLiterals(cases.join('\n'))).toEqual([MOCK_GATE]);
    for (const line of ["const timeout = '5000';", "limit: '2000',", "kod: 'VTN',"]) expect(redactSecrets(line)).toBe(line);
  });

  it('matchLinesSafely: moslik va og\'ir naqshda vaqt chegarasi', async () => {
    expect(await matchLinesSafely('ab+c', true, ['xABBC', 'yoq'])).toEqual({ idx: [0] });
    expect(await matchLinesSafely('[[:digit:]]{3}', false, ['a12', 'b123'])).toEqual({ idx: [1] });
    expect(await matchLinesSafely('(', false, ['('])).toEqual({ idx: [] }); // JS'da noto'g'ri — moslik yo'q
    const t0 = Date.now();
    const r: any = await matchLinesSafely('(a+)+$', false, ['a'.repeat(60) + 'b']);
    expect(r.error).toBeTruthy();
    expect(Date.now() - t0).toBeLessThan(12_000);
  }, 20_000);

  it('isCodeName', () => {
    for (const n of ['GATE', 'IMPORT_KOD', 'pinCode', 'PIN', 'GATE_CODE', 'PASSCODE']) expect(isCodeName(n)).toBe(true);
    for (const n of ['PINFL', 'pipeline', 'kodlar', 'objectCode', 'spinner']) expect(isCodeName(n)).toBe(false);
  });

  it('isSensitiveName', () => {
    for (const n of ['BANK_FORWARDER_SECRET', '$SHARED_SECRET', 'apiKey', 'botToken', 'password', 'CRED_ENC_KEY', 'XON_KEY', 'DIDOX_PARTNER_AUTH', 'privateKey'])
      expect(isSensitiveName(n)).toBe(true);
    for (const n of ['keyField', 'authMode', 'credit', 'passport', 'BANK_FORWARDER_URL', 'description'])
      expect(isSensitiveName(n)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe('LeaderCodeToolsService (vaqtinchalik git repo)', () => {
  jest.setTimeout(60_000);

  let base: string;
  let repo: string;
  let outsideFile: string;
  let svc: LeaderCodeToolsService;
  let tool: (name: string) => (input: any) => Promise<any>;
  let symlinkOk = false;

  beforeAll(() => {
    base = fs.mkdtempSync(path.join(os.tmpdir(), 'leader-code-tools-'));
    repo = path.join(base, 'repo');
    fs.mkdirSync(repo);
    outsideFile = path.join(base, 'outside.txt');
    fs.writeFileSync(outsideFile, 'TASHQI_FAYL_MAZMUNI\n');

    git(repo, ['init', '-q']);
    write(repo, 'scripts/deploy.sh', DEPLOY_SH);
    write(repo, 'scripts/xt-forwarder.php', FORWARDER_PHP);
    write(repo, 'scripts/forwarder-demo.php', FORWARDER_PHP);
    // Ko'p qatorli tayinlash va boshqa faylda e'lon qilingan qisqa kod
    write(repo, 'backend/src/multi.ts', `export const API_SECRET =\n  '${MOCK_MULTI}';\nexport const OCHIQ = 1;\n`);
    write(repo, 'backend/src/gate.service.ts', `export class Gate {\n  private readonly GATE = '${MOCK_GATE}';\n}\n`);
    write(repo, 'frontend/page.tsx', `// ${MOCK_GATE} kodi bilan ochiladi\nif (v.trim() === '${MOCK_GATE}') ok();\n`);
    write(repo, 'backend/src/app.ts', Array.from({ length: 50 }, (_, i) => `// qator ${i + 1} UNIQMARK`).join('\n') + '\n');
    write(repo, 'backend/.env', 'UNIQMARK_TOKEN=envdagiqiymat123456\n');
    write(repo, 'backend/.env.example', 'UNIQMARK=1\n');
    write(repo, 'backend/src/bank-credentials/creds.ts', '// UNIQMARK credentials\n');
    write(repo, 'tz/notes.txt', 'UNIQMARK shaxsiy\n');
    write(repo, 'untracked.txt', 'UNIQMARK\n');

    try {
      fs.symlinkSync(outsideFile, path.join(repo, 'link-out.txt'), 'file');
      fs.symlinkSync(path.join(repo, 'backend', '.env'), path.join(repo, 'link-env.txt'), 'file');
      symlinkOk = true;
    } catch {
      symlinkOk = false; // Windows'da ruxsat yo'q bo'lishi mumkin — pastda realpath mock testi bor
    }

    const toAdd = ['scripts', 'backend', 'tz', 'frontend'];
    if (symlinkOk) toAdd.push('link-out.txt', 'link-env.txt');
    git(repo, ['add', '--', ...toAdd]);
    git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init ' + MOCK_FWD_PLAIN.replace(/^/, 'SECRET=')]);

    svc = new LeaderCodeToolsService({ repoDir: () => repo } as any);
    const tools = svc.tools();
    tool = (name) => tools.find((t) => t.name === name)!.run;
  });

  afterAll(() => {
    try { fs.rmSync(base, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  afterEach(() => jest.restoreAllMocks());

  it('4 ta asbob, tavsif va schema bor', () => {
    const names = svc.tools().map((t) => t.name);
    expect(names).toEqual(['list_files', 'grep', 'read_file', 'git_log']);
    for (const t of svc.tools()) {
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.input_schema.type).toBe('object');
    }
  });

  it("list_files: rad fayllar ro'yxatda yo'q", async () => {
    const r = await tool('list_files')({});
    expect(r.error).toBeUndefined();
    expect(r.files).toContain('scripts/deploy.sh');
    expect(r.files).toContain('backend/src/app.ts');
    for (const f of r.files) expect(isDeniedPath(f)).toBe(false);
    expect(r.files).not.toContain('backend/.env');
    expect(r.files).not.toContain('backend/.env.example');
    expect(r.files).not.toContain('tz/notes.txt');
    expect(r.files).not.toContain('untracked.txt');
  });

  it('list_files: filtrlar va rad prefiks', async () => {
    const r = await tool('list_files')({ path_prefix: 'scripts', contains: 'FORWARDER' });
    expect(r.files).toEqual(['scripts/forwarder-demo.php']); // xt-forwarder.php — rad
    expect((await tool('list_files')({ path_prefix: 'tz' })).error).toBeTruthy();
    expect((await tool('list_files')({ path_prefix: '../' })).error).toBeTruthy();
  });

  it('read_file: deploy.sh va forwarder php — secret natijada YO\'Q; xt-forwarder.php rad', async () => {
    expect((await tool('read_file')({ path: 'scripts/xt-forwarder.php' })).error).toBeTruthy();
    for (const p of ['scripts/deploy.sh', 'scripts/forwarder-demo.php']) {
      const r = await tool('read_file')({ path: p, limit: 400 });
      expect(r.error).toBeUndefined();
      expect(has(r, MOCK_FWD)).toBe(false);
      expect(XT_SHAPE.test(JSON.stringify(r))).toBe(false);
      expect(has(r, MOCK_TG)).toBe(false);
      expect(r.content).toContain('***');
    }
  });

  it('read_file: qator raqamlari, offset/limit, next_offset', async () => {
    const r = await tool('read_file')({ path: 'backend/src/app.ts', offset: 10, limit: 5 });
    expect(r.total_lines).toBe(50);
    expect(r.from).toBe(10);
    expect(r.to).toBe(14);
    expect(r.next_offset).toBe(15);
    expect(r.content.split('\n')[0]).toBe('10: // qator 10 UNIQMARK');
    const big = await tool('read_file')({ path: 'backend/src/app.ts', limit: 100000 });
    expect(big.to).toBe(50);
    expect(big.next_offset).toBeUndefined();
  });

  it('read_file: path traversal va absolyut yo\'l rad', async () => {
    const bad = [
      '../outside.txt',
      'backend/../../outside.txt',
      'backend\\..\\..\\outside.txt',
      outsideFile,
      outsideFile.replace(/\\/g, '/'),
      '/etc/passwd',
    ];
    for (const p of bad) {
      const r = await tool('read_file')({ path: p });
      expect(r.error).toBeTruthy();
      expect(has(r, 'TASHQI_FAYL_MAZMUNI')).toBe(false);
    }
  });

  it('read_file: deny va kuzatilmaydigan fayl rad', async () => {
    for (const p of ['backend/.env', 'BACKEND/.ENV', 'backend/.env.example', 'tz/notes.txt', 'backend/src/bank-credentials/creds.ts']) {
      const r = await tool('read_file')({ path: p });
      expect(r.error).toBeTruthy();
      expect(has(r, 'envdagiqiymat')).toBe(false);
    }
    expect((await tool('read_file')({ path: 'untracked.txt' })).error).toBeTruthy();
    expect((await tool('read_file')({ path: 'yoq/fayl.ts' })).error).toBeTruthy();
  });

  it('read_file: symlink rad (repo tashqarisiga va .env ga)', async () => {
    if (!symlinkOk) return; // Windows'da symlink yaratib bo'lmadi — keyingi test mock bilan tekshiradi
    for (const p of ['link-out.txt', 'link-env.txt']) {
      const r = await tool('read_file')({ path: p });
      expect(r.error).toBeTruthy();
      expect(has(r, 'TASHQI_FAYL_MAZMUNI')).toBe(false);
      expect(has(r, 'envdagiqiymat')).toBe(false);
    }
  });

  it('read_file: real yo\'l repo tashqarisiga chiqsa rad (realpath mock)', async () => {
    const orig = fs.promises.realpath;
    jest.spyOn(fs.promises, 'realpath').mockImplementation(((p: any, ...rest: any[]) => {
      if (String(p).replace(/\\/g, '/').endsWith('backend/src/app.ts')) return Promise.resolve(outsideFile);
      return (orig as any).call(fs.promises, p, ...rest);
    }) as any);
    const r = await tool('read_file')({ path: 'backend/src/app.ts' });
    expect(r.error).toBeTruthy();
    expect(has(r, 'UNIQMARK')).toBe(false);
  });

  it('read_file: real yo\'l repo ichidagi rad faylga olib borsa rad (realpath mock)', async () => {
    const orig = fs.promises.realpath;
    jest.spyOn(fs.promises, 'realpath').mockImplementation(((p: any, ...rest: any[]) => {
      if (String(p).replace(/\\/g, '/').endsWith('backend/src/app.ts')) {
        return (orig as any).call(fs.promises, path.join(repo, 'backend', '.env'));
      }
      return (orig as any).call(fs.promises, p, ...rest);
    }) as any);
    const r = await tool('read_file')({ path: 'backend/src/app.ts' });
    expect(r.error).toBeTruthy();
    expect(has(r, 'envdagiqiymat')).toBe(false);
  });

  it('grep: secret yashiriladi, rad fayllar natijada yo\'q', async () => {
    const r = await tool('grep')({ pattern: 'FORWARDER_SECRET|SHARED_SECRET' });
    expect(r.error).toBeUndefined();
    expect(r.matches).toBeGreaterThan(0);
    expect(has(r, MOCK_FWD)).toBe(false);
    expect(XT_SHAPE.test(JSON.stringify(r))).toBe(false);

    const x = await tool('grep')({ pattern: 'xt_[a-z0-9]+' });
    expect(XT_SHAPE.test(JSON.stringify(x))).toBe(false);

    const u = await tool('grep')({ pattern: 'UNIQMARK', ignore_case: true });
    expect(u.error).toBeUndefined();
    for (const line of u.results) {
      const file = String(line).split(':')[0];
      expect(isDeniedPath(file)).toBe(false);
    }
    expect(has(u, 'envdagiqiymat')).toBe(false);
    expect(u.results.some((l: string) => l.startsWith('backend/src/app.ts:'))).toBe(true);
  });

  it('read_file: ko\'p qatorli tayinlash va boshqa fayldagi darvoza kodi yashiriladi', async () => {
    const m = await tool('read_file')({ path: 'backend/src/multi.ts' });
    expect(m.error).toBeUndefined();
    expect(has(m, MOCK_MULTI)).toBe(false);
    for (const p of ['backend/src/gate.service.ts', 'frontend/page.tsx']) {
      const r = await tool('read_file')({ path: p });
      expect(r.error).toBeUndefined();
      expect(has(r, MOCK_GATE)).toBe(false);
      expect(r.content).toContain('***');
    }
  });

  it('grep: sir oracle yo\'q — natija xom sirga bog\'liq emas', async () => {
    // Redaksiyalangan shaklga ham mos keladigan "ayyor" naqsh: ikkala variant bir xil natija berishi shart
    const a = await tool('grep')({ pattern: "SHARED_SECRET = '(\\*\\*\\*|xt_a)" });
    const b = await tool('grep')({ pattern: "SHARED_SECRET = '(\\*\\*\\*|xt_z)" });
    expect(a.error).toBeUndefined();
    expect(a.matches).toBeGreaterThan(0);
    expect(JSON.stringify(a.results)).toBe(JSON.stringify(b.results));
    expect(a.total_found).toBe(b.total_found);
    // Sirning boshi bilan qidirish — hech narsa topilmaydi
    for (const pattern of ['xt_a1b2', "SHARED_SECRET = 'xt_a", 'SECRET="xt_[a-z]', MOCK_MULTI.slice(0, 10), MOCK_GATE, '48[0-9]6']) {
      const r = await tool('grep')({ pattern });
      expect(r.error).toBeUndefined();
      expect(r.matches).toBe(0);
      expect(r.total_found).toBe(0);
    }
    // Sirli qatorning sirsiz qismi bilan qidirish ishlaydi (qiymat ***)
    const g = await tool('grep')({ pattern: 'readonly GATE' });
    expect(g.matches).toBe(1);
    expect(g.results[0]).toContain("GATE = '***'");
    expect(has(g, MOCK_GATE)).toBe(false);
  });

  it('grep: topilmadi = xato emas; noto\'g\'ri kirish rad', async () => {
    const r = await tool('grep')({ pattern: 'HECH_QACHON_UCHRAMAYDI_42' });
    expect(r.error).toBeUndefined();
    expect(r.matches).toBe(0);
    expect((await tool('grep')({ pattern: 'x'.repeat(201) })).error).toBeTruthy();
    expect((await tool('grep')({ pattern: '' })).error).toBeTruthy();
    expect((await tool('grep')({ pattern: 'UNIQMARK', path_prefix: 'tz' })).error).toBeTruthy();
    expect((await tool('grep')({ pattern: 'UNIQMARK', path_prefix: '../' })).error).toBeTruthy();
    // '-' bilan boshlanadigan naqsh opsiya sifatida talqin qilinmaydi (-e bilan uzatiladi)
    const opt = await tool('grep')({ pattern: '--version' });
    expect(opt.error).toBeUndefined();
    expect(opt.matches).toBe(0);
  });

  it('git_log: commitlar, xabardagi sir yashiriladi', async () => {
    const r = await tool('git_log')({ limit: 5 });
    expect(r.error).toBeUndefined();
    expect(r.count).toBe(1);
    expect(r.commits[0].author).toBe('Test');
    expect(has(r, MOCK_FWD_PLAIN)).toBe(false);
    expect((await tool('git_log')({ path: 'backend/.env' })).error).toBeTruthy();
    expect((await tool('git_log')({ path: '../x' })).error).toBeTruthy();
  });

  it('asbob hech qachon throw qilmaydi', async () => {
    const broken = new LeaderCodeToolsService({ repoDir: () => path.join(base, 'yoq-papka') } as any);
    for (const t of broken.tools()) {
      const r = await t.run({ path: 'a.ts', pattern: 'x' });
      expect(r.error).toBeTruthy();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Haqiqiy repo: scripts/deploy.sh va scripts/xt-forwarder.php dagi forwarder secret
// read_file/grep natijasida KO'RINMASLIGI (qiymat testga yozilmagan — faqat shakli tekshiriladi).
describe('Haqiqiy repo: forwarder secret natijada yo\'q', () => {
  jest.setTimeout(60_000);
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const svc = new LeaderCodeToolsService({ repoDir: () => repoRoot } as any);
  const run = (name: string, input: any) => svc.tools().find((t) => t.name === name)!.run(input);

  it.each(['scripts/deploy.sh', 'scripts/xt-forwarder.php', 'scripts/bank-proxy.php'])('read_file %s', async (p) => {
    if (!fs.existsSync(path.join(repoRoot, p))) return;
    let offset = 1;
    for (let i = 0; i < 20; i++) {
      const r = await run('read_file', { path: p, offset, limit: 400 });
      if (r.error) return; // kuzatilmasa — tekshiradigan narsa yo'q
      expect(XT_SHAPE.test(JSON.stringify(r))).toBe(false);
      if (!r.next_offset) break;
      offset = r.next_offset;
    }
  });

  it('grep FORWARDER_SECRET / SHARED_SECRET / xt_', async () => {
    for (const pattern of ['FORWARDER_SECRET', 'SHARED_SECRET', 'xt_[A-Za-z0-9]{10,}']) {
      const r = await run('grep', { pattern, path_prefix: 'scripts' });
      if (r.error) continue;
      expect(XT_SHAPE.test(JSON.stringify(r))).toBe(false);
    }
  });
});
