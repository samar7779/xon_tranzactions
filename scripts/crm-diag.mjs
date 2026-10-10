#!/usr/bin/env node
// CRM (crm-api.xonapps.uz) parametrlari diagnostikasi — FAQAT O'QISH.
// Har parametrni FAOL va O'CHIRILGAN ("Удалено") shartnoma bilan sinab, faqat HTTP holati va
// natijalar SONINI chiqaradi (kalit, ism, telefon chiqmaydi).
// Ishga tushirish (serverda):  node /var/www/xon_tranzactions/scripts/crm-diag.mjs
// Boshqa shartnomalar bilan:   node crm-diag.mjs <FAOL> <OCHIRILGAN> <YYYY-MM-DD>
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = join(ROOT, 'backend', '.env');
const env = { ...process.env };
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const ORDER = env.XONSAROY_API_URL || 'https://app-api.xonsaroy.uz/api/v4/client/order';
const CLIENT = env.XONSAROY_CLIENT_BASE || 'https://app-api.xonsaroy.uz/api/v4/client';
const AUTH = 'Basic ' + Buffer.from(`${env.XONSAROY_API_KEY || ''}:${env.XONSAROY_API_SECRET || ''}`).toString('base64');
const ACTIVE = process.argv[2] || '150VTN23CV';
const DELETED = process.argv[3] || '1689ZUR24NU';
const DAY = process.argv[4] || '2026-10-09';

console.log(`CRM: ${new URL(ORDER).host} | faol=${ACTIVE} | o'chirilgan=${DELETED} | kun=${DAY}`);
console.log(`kalit: ${env.XONSAROY_API_KEY ? 'bor' : "YO'Q"}\n`);

function count(j) {
  const d = j?.data;
  const arr = Array.isArray(d) ? d : (Array.isArray(d?.data) ? d.data : null);
  const pg = j?.pagination || d?.pagination || {};
  const total = pg.totalItem ?? pg.total_item ?? pg.total ?? null;
  if (arr) return `${arr.length} ta` + (total != null ? ` (jami ${total})` : '');
  if (d && typeof d === 'object') return `obyekt (contract=${d.contract ?? '-'}, id=${d.id ?? '-'})`;
  return '-';
}

async function post(base, path, body) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) if (v != null) form.set(k, String(v));
  try {
    const r = await fetch(base + path, { method: 'POST', body: form, signal: AbortSignal.timeout(60000),
      headers: { Authorization: AUTH, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch { /* json emas */ }
    return { s: r.status, j, t };
  } catch (e) { return { s: 'ERR', j: null, t: String(e?.message || e) }; }
}
async function get(base, path, params) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null) qs.set(k, String(v));
  try {
    const r = await fetch(`${base}${path}?${qs}`, { signal: AbortSignal.timeout(60000),
      headers: { Authorization: AUTH, Accept: 'application/json' } });
    const t = await r.text();
    let j = null; try { j = JSON.parse(t); } catch { /* json emas */ }
    return { s: r.status, j, t };
  } catch (e) { return { s: 'ERR', j: null, t: String(e?.message || e) }; }
}
function line(label, r) {
  const extra = r.j ? count(r.j) : (r.t || '').slice(0, 80).replace(/\s+/g, ' ');
  console.log(`  ${label.padEnd(58)} ${String(r.s).padEnd(4)} ${extra}`);
  return r;
}

const V = {
  '(param yo\'q)': {},
  'is_trashed=1': { is_trashed: 1 },
  'trashed_status=1 + with_trashed=1': { trashed_status: 1, with_trashed: 1 },
  'trashed_status=-1': { trashed_status: -1 },
};

console.log('A) /order/index — shartnomalar ro\'yxati');
let deletedId = null;
for (const c of [ACTIVE, DELETED]) {
  for (const [k, p] of Object.entries(V)) {
    const r = line(`${c} ${k}`, await post(ORDER, '/index', { contract: c, 'per-page': 10, ...p }));
    const it = (r.j?.data || []).find?.((x) => String(x.contract || '').toUpperCase() === c.toUpperCase());
    if (c === DELETED && it?.id != null) deletedId = it.id;
  }
}
for (const [k, p] of Object.entries({ ...V, 'is_archive=1': { is_archive: 1 } })) {
  line(`filtrsiz ${k}`, await post(ORDER, '/index', { 'per-page': 1, ...p }));
}

console.log('\nB) /order/show — shartnoma tafsiloti');
for (const [k, p] of Object.entries(V)) line(`${DELETED} ${k}`, await post(ORDER, '/show', { contract: DELETED, ...p }));
line(`${ACTIVE} (param yo'q)`, await post(ORDER, '/show', { contract: ACTIVE }));
if (deletedId != null) {
  line(`id=${deletedId} (param yo'q)`, await post(ORDER, '/show', { id: deletedId }));
  line(`id=${deletedId} is_trashed=1`, await post(ORDER, '/show', { id: deletedId, is_trashed: 1 }));
} else {
  console.log(`  (o'chirilgan shartnoma id si /index dan topilmadi — id bo'yicha /show sinalmadi)`);
}

const PV = {
  '(param yo\'q)': {},
  'order[is_trashed]=1': { 'order[is_trashed]': 1 },
  'is_trashed=1': { is_trashed: 1 },
  'trashed_status=1': { trashed_status: 1 },
  'trashed_status=1 + order[is_trashed]=1': { trashed_status: 1, 'order[is_trashed]': 1 },
};
console.log('\nC) /payment-history (GET) — shartnoma to\'lovlari');
for (const c of [DELETED, ACTIVE]) {
  for (const [k, p] of Object.entries(PV)) line(`${c} ${k}`, await get(CLIENT, '/payment-history', { contract: c, limit: 500, ...p }));
}

console.log('\nD) /payment-history/excel (POST) — XonPay sync / sverka / XATO moslashtirish manbai');
for (const [k, p] of Object.entries(PV)) line(`${DELETED} ${k}`, await post(CLIENT, '/payment-history/excel', { page: 1, limit: 500, contract: DELETED, ...p }));
for (const [k, p] of Object.entries(PV)) line(`kun ${DAY} ${k}`, await post(CLIENT, '/payment-history/excel', { page: 1, limit: 5000, date_from: DAY, date_to: DAY, ...p }));

// F) To'lov qatorlarining asosiy maydonlari — "o'chirilgan shartnoma" qat'iy qoidasini tekshirish
// (order_id, obyekt, mijoz nomi bank emasmi). 5-argument: vergul bilan qo'shimcha raqamlar.
console.log('\nF) /payment-history/excel qatorlari — order_id / obyekt / nom (shartnoma belgilari)');
const EXTRA = (process.argv[5] || '667308ZUR23ES').split(',').map((s) => s.trim()).filter(Boolean);
const objText = (o) => (typeof o === 'string' ? o : (o?.name?.ru || o?.name?.uz || o?.name || '')) || '';
for (const c of [DELETED, ...EXTRA]) {
  const r = await post(CLIENT, '/payment-history/excel', { page: 1, limit: 500, contract: c });
  const raw = r.j?.data;
  const rows = (Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []))
    .filter((p) => String(p.contract || '').replace(/[\s\-_./]/g, '').toUpperCase() === c.replace(/[\s\-_./]/g, '').toUpperCase());
  const ids = [...new Set(rows.map((p) => p.order_id ?? 'YOQ'))].slice(0, 5);
  const names = [...new Set(rows.map((p) => p.full_name || p.client_full_name || '-'))].slice(0, 3);
  const objs = [...new Set(rows.map((p) => objText(p.object_name ?? p.object) || '-'))].slice(0, 3);
  console.log(`  ${c}: ${rows.length} ta | order_id: ${ids.join(', ')} | obyekt: ${objs.join(', ')} | nom: ${names.join(' / ')}`);
  if (rows[0]) console.log(`     maydonlar: ${Object.keys(rows[0]).slice(0, 30).join(', ')}`);
}

console.log('\nE) MySQL (XONAPP_MYSQL_*) — mijoz qo\'shimcha ma\'lumoti manbai');
if (!env.XONAPP_MYSQL_USER || !env.XONAPP_MYSQL_PASSWORD) {
  console.log('  MySQL sozlanmagan (XONAPP_MYSQL_USER/PASSWORD yo\'q) — fetchClientExtras ishlamaydi');
} else {
  try {
    const require = createRequire(join(ROOT, 'backend', 'package.json'));
    const mysql = require('mysql2/promise');
    const c = await mysql.createConnection({ host: env.XONAPP_MYSQL_HOST || 'localhost', port: Number(env.XONAPP_MYSQL_PORT || 3306),
      user: env.XONAPP_MYSQL_USER, password: env.XONAPP_MYSQL_PASSWORD, database: env.XONAPP_MYSQL_DB || 'xonappuz_crm', connectTimeout: 8000 });
    const [cols] = await c.query("SHOW COLUMNS FROM contracts");
    const names = cols.map((x) => x.Field);
    const dcol = ['updated_at', 'created_at', 'contract_date'].find((x) => names.includes(x));
    const [[agg]] = await c.query(`SELECT COUNT(*) n${dcol ? `, MAX(${dcol}) last` : ''} FROM contracts`);
    console.log(`  contracts: ${agg.n} ta${dcol ? `, eng oxirgi ${dcol}: ${agg.last}` : ''}`);
    for (const cn of [ACTIVE, DELETED]) {
      const [rows] = await c.query('SELECT COUNT(*) n FROM contracts WHERE contract_number = ?', [cn]);
      console.log(`  ${cn}: ${rows[0].n ? 'bor' : "YO'Q"}`);
    }
    await c.end();
  } catch (e) { console.log(`  MySQL xato: ${String(e?.message || e).slice(0, 160)}`); }
}
console.log('\nTayyor. Natijani to\'liq nusxalab yuboring.');
