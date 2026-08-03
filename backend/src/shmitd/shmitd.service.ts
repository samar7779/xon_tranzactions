import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { google } from 'googleapis';
import { PrismaService } from '../common/prisma/prisma.service';
import { SettingsService } from '../sync/settings.service';
import { CryptoService } from '../common/crypto/crypto.service';

/**
 * SHMITD — Google Sheets "SHMITD" varag'idan Shmidt bolg'a sinov natijalarini
 * o'qib, sana bo'yicha filtrlab, chiroyli HTML hisobot yasab Telegram guruhga
 * jo'natadi. Jadval (cron) bo'yicha avtomat, tarix (history) saqlanadi.
 *
 * Python skriptdan ko'chirilgan (create_html_table + send).
 */
@Injectable()
export class ShmitdService {
  private readonly log = new Logger(ShmitdService.name);
  private readonly K_TOKEN = 'shmitd.botToken';
  private readonly K_GROUP = 'shmitd.groupId';
  private readonly K_SPREADSHEET = 'shmitd.spreadsheetId';
  private readonly K_SHEET = 'shmitd.sheetName';
  private readonly K_SA = 'shmitd.saJson';
  private readonly K_OFFSET = 'shmitd.dateOffset';
  private readonly K_TIMES = 'shmitd.cronTimes';
  private readonly K_ENABLED = 'shmitd.enabled';
  private lastRunKey = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  // ─── Sozlama ──────────────────────────────────────────────────────
  async getConfig() {
    const [enc, groupId, spreadsheetId, sheetName, saEnc, offset, times, enabled] = await Promise.all([
      this.settings.get(this.K_TOKEN), this.settings.get(this.K_GROUP),
      this.settings.get(this.K_SPREADSHEET), this.settings.get(this.K_SHEET),
      this.settings.get(this.K_SA), this.settings.get(this.K_OFFSET),
      this.settings.get(this.K_TIMES), this.settings.get(this.K_ENABLED),
    ]);
    let hasToken = false; let tokenHint: string | null = null;
    if (enc) { try { const t = this.crypto.decrypt(enc); hasToken = !!t; tokenHint = t ? `…${t.slice(-4)}` : null; } catch { /* */ } }
    let hasSa = false; let saEmail: string | null = null;
    const creds = await this.resolveCreds();
    hasSa = !!creds; saEmail = creds?.client_email || null;
    return {
      ok: true,
      enabled: enabled === '1',
      hasToken, tokenHint,
      groupId: groupId || null,
      spreadsheetId: spreadsheetId || null,
      sheetName: sheetName || 'SHMITD',
      hasSa, saEmail,
      dateOffset: offset != null ? Number(offset) : -1,
      cronTimes: this.parseTimes(times),
    };
  }

  async saveConfig(
    body: { botToken?: string; groupId?: string; spreadsheetId?: string; sheetName?: string; saJson?: string; dateOffset?: number; cronTimes?: string[]; enabled?: boolean },
    by?: string,
  ) {
    if (body.botToken !== undefined && body.botToken.trim()) await this.settings.set(this.K_TOKEN, this.crypto.encrypt(body.botToken.trim()), by);
    if (body.groupId !== undefined) await this.settings.set(this.K_GROUP, body.groupId.trim() || null, by);
    if (body.spreadsheetId !== undefined) await this.settings.set(this.K_SPREADSHEET, body.spreadsheetId.trim() || null, by);
    if (body.sheetName !== undefined) await this.settings.set(this.K_SHEET, body.sheetName.trim() || null, by);
    if (body.saJson !== undefined && body.saJson.trim()) {
      try { const p = JSON.parse(body.saJson); if (!p?.client_email || !p?.private_key) throw new Error('bad'); await this.settings.set(this.K_SA, this.crypto.encrypt(JSON.stringify(p)), by); }
      catch { throw new Error('Service-account JSON noto\'g\'ri'); }
    }
    if (body.dateOffset !== undefined) await this.settings.set(this.K_OFFSET, String(Math.round(Number(body.dateOffset) || 0)), by);
    if (body.cronTimes !== undefined) await this.settings.set(this.K_TIMES, this.parseTimes(body.cronTimes).join(',') || null, by);
    if (body.enabled !== undefined) await this.settings.set(this.K_ENABLED, body.enabled ? '1' : null, by);
    return this.getConfig();
  }

  private parseTimes(v: string | string[] | null): string[] {
    const arr = Array.isArray(v) ? v : String(v || '').split(',');
    return arr.map((s) => String(s).trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s)).map((s) => (s.length === 4 ? `0${s}` : s));
  }

  private async resolveCreds(): Promise<{ client_email: string; private_key: string } | null> {
    // 1) SHMITD alohida SA JSON (DB)  2) app GOOGLE_SA_JSON env
    const saEnc = await this.settings.get(this.K_SA);
    let raw = '';
    if (saEnc) { try { raw = this.crypto.decrypt(saEnc); } catch { /* */ } }
    if (!raw) raw = this.config.get<string>('GOOGLE_SA_JSON') || '';
    if (!raw) return null;
    try {
      const p = JSON.parse(raw);
      if (!p?.client_email || !p?.private_key) return null;
      p.private_key = String(p.private_key).replace(/\\n/g, '\n');
      return p;
    } catch { return null; }
  }

  private async getToken(): Promise<string | null> {
    const enc = await this.settings.get(this.K_TOKEN);
    if (enc) { try { return this.crypto.decrypt(enc); } catch { /* */ } }
    return null;
  }

  // ─── Google Sheet o'qish ──────────────────────────────────────────
  private async readSheet(): Promise<string[][]> {
    const creds = await this.resolveCreds();
    if (!creds) throw new Error("Service-account topilmadi (SHMITD SA JSON yoki GOOGLE_SA_JSON kerak)");
    const spreadsheetId = await this.settings.get(this.K_SPREADSHEET);
    const sheetName = (await this.settings.get(this.K_SHEET)) || 'SHMITD';
    if (!spreadsheetId) throw new Error('Spreadsheet ID sozlanmagan');
    const auth = new google.auth.JWT({ email: creds.client_email, key: creds.private_key, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetName });
    return (res.data.values || []) as string[][];
  }

  private targetDateStr(offset: number): string {
    const d = new Date(Date.now() + 5 * 3600_000 + offset * 86400_000); // Toshkent UTC+5
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${d.getUTCFullYear()}`;
  }

  /** "dd.MM.yyyy" → Date (UTC yarim tun) — range filtr uchun. */
  private parseTarget(s: string): Date | null {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(s || '').trim());
    if (!m) return null;
    return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  }

  private num(v: any): number {
    if (v == null || String(v).trim() === '') return 0;
    const n = parseFloat(String(v).replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }

  // ─── Hisobot yasash (filtr + sariq/qizil) ─────────────────────────
  private buildReport(all: string[][], target: string) {
    const headers = all[0] || [];
    const rows: string[][] = [];
    let yellow = 0; let red = 0;
    for (const row of all.slice(1)) {
      if (!row[0] || String(row[0]).trim() === '') continue;
      if ((row[6] || '').trim() !== target) continue;
      rows.push(row);
      const k = this.num(row[10]); const l = this.num(row[11]); const j = this.num(row[9]);
      if (k > l && j < l) yellow++;
      else if (j > l) red++;
    }
    return { headers, rows, yellow, red };
  }

  // ─── Asosiy: hozir jo'natish ──────────────────────────────────────
  async sendNow(triggeredBy: string): Promise<{ ok: boolean; status: string; total?: number; yellow?: number; red?: number; error?: string }> {
    const token = await this.getToken();
    const groupId = await this.settings.get(this.K_GROUP);
    if (!token || !groupId) return { ok: false, status: 'error', error: 'Bot token yoki guruh ID yo\'q' };
    const offset = Number(await this.settings.get(this.K_OFFSET) ?? -1);
    const target = this.targetDateStr(offset);
    const targetAt = this.parseTarget(target);
    try {
      const all = await this.readSheet();
      const { headers, rows, yellow, red } = this.buildReport(all, target);
      if (rows.length === 0) {
        await this.tgText(token, groupId, `${target}\n\nНа данную дату результаты измерений отсутствуют. Замеры не проводились.`);
        await this.prisma.shmitdLog.create({ data: { targetDate: target, targetAt, totalCount: 0, yellowCount: 0, redCount: 0, status: 'empty', triggeredBy, groupId } });
        return { ok: true, status: 'empty', total: 0 };
      }
      const html = this.renderHtml(headers, rows, yellow, red, target);
      const fileName = `SHMITD_${target.replace(/\./g, '-')}.html`;
      await this.tgDocument(token, groupId, html, fileName, `Результаты испытаний молотком Шмидта — ${target}`);
      await this.prisma.shmitdLog.create({
        data: { targetDate: target, targetAt, totalCount: rows.length, yellowCount: yellow, redCount: red, status: 'sent', fileName, htmlContent: html.slice(0, 900_000), triggeredBy, groupId },
      });
      this.log.log(`SHMITD jo'natildi ${target}: ${rows.length} qator (${triggeredBy})`);
      return { ok: true, status: 'sent', total: rows.length, yellow, red };
    } catch (e: any) {
      await this.prisma.shmitdLog.create({ data: { targetDate: target, targetAt, status: 'error', error: String(e?.message || '').slice(0, 500), triggeredBy, groupId } }).catch(() => {});
      return { ok: false, status: 'error', error: e?.message };
    }
  }

  // ─── History ──────────────────────────────────────────────────────
  private backfilled = false;
  /** targetAt bo'sh (eski) yozuvlarni targetDate (dd.MM.yyyy) dan to'ldiradi — bir marta. */
  private async backfillTargetAt() {
    if (this.backfilled) return;
    this.backfilled = true;
    try {
      const nulls = await this.prisma.shmitdLog.findMany({ where: { targetAt: null }, select: { id: true, targetDate: true } });
      for (const r of nulls) {
        const d = this.parseTarget(r.targetDate);
        if (d) await this.prisma.shmitdLog.update({ where: { id: r.id }, data: { targetAt: d } });
      }
    } catch { /* skip */ }
  }

  async history(opts: { page?: number; perPage?: number; from?: string; to?: string; date?: string }) {
    await this.backfillTargetAt();
    const page = Math.max(1, Number(opts.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(opts.perPage) || 15));
    const where: any = {};
    if ((opts.from && opts.from.trim()) || (opts.to && opts.to.trim())) {
      // Sanadan sanagacha (hisobot sanasi = targetAt)
      where.targetAt = {};
      if (opts.from?.trim()) { const d = new Date(`${opts.from.trim()}T00:00:00Z`); if (!isNaN(d.getTime())) where.targetAt.gte = d; }
      if (opts.to?.trim()) { const d = new Date(`${opts.to.trim()}T23:59:59.999Z`); if (!isNaN(d.getTime())) where.targetAt.lte = d; }
    } else if (opts.date && opts.date.trim()) {
      where.targetDate = { contains: opts.date.trim() };
    }
    const [total, rows] = await Promise.all([
      this.prisma.shmitdLog.count({ where }),
      this.prisma.shmitdLog.findMany({ where, orderBy: { sentAt: 'desc' }, skip: (page - 1) * perPage, take: perPage,
        select: { id: true, targetDate: true, sentAt: true, totalCount: true, yellowCount: true, redCount: true, status: true, error: true, fileName: true, triggeredBy: true } }),
    ]);
    return { ok: true, total, page, perPage, rows };
  }

  async getHtml(id: string): Promise<{ ok: boolean; html?: string; error?: string }> {
    const row = await this.prisma.shmitdLog.findUnique({ where: { id }, select: { htmlContent: true } });
    if (!row?.htmlContent) return { ok: false, error: 'Hisobot topilmadi' };
    return { ok: true, html: row.htmlContent };
  }

  // ─── Cron — jadval bo'yicha ───────────────────────────────────────
  @Cron(CronExpression.EVERY_MINUTE)
  async cronTick() {
    try {
      if ((await this.settings.get(this.K_ENABLED)) !== '1') return;
      const times = this.parseTimes(await this.settings.get(this.K_TIMES));
      if (!times.length) return;
      const now = new Date(Date.now() + 5 * 3600_000);
      const hm = `${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
      if (!times.includes(hm)) return;
      const key = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()} ${hm}`;
      if (this.lastRunKey === key) return; // shu daqiqada jo'natildi
      this.lastRunKey = key;
      await this.sendNow('cron');
    } catch (e: any) {
      this.log.warn(`SHMITD cron xato: ${e?.message}`);
    }
  }

  // ─── Telegram ─────────────────────────────────────────────────────
  private async tgText(token: string, chatId: string, text: string) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }) }).catch(() => {});
  }
  private async tgDocument(token: string, chatId: string, html: string, fileName: string, caption: string) {
    const form = new FormData();
    form.append('chat_id', chatId);
    form.append('caption', caption);
    form.append('document', new Blob([html], { type: 'text/html' }), fileName);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form as any });
    const d: any = await res.json().catch(() => ({}));
    if (!d?.ok) throw new Error(`Telegram: ${d?.description || res.status}`);
  }

  // ─── HTML hisobot (Python create_html_table dan ko'chirilgan) ─────
  private esc(s: any): string { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  private renderHtml(headers: string[], rows: string[][], yellow: number, red: number, target: string): string {
    const cols = 12;
    const selHeaders = headers.slice(0, cols);
    const title = `Результаты испытаний молотком Шмидта - ${target}`;
    const rowsHtml = rows.map((row) => {
      const k = this.num(row[10]); const l = this.num(row[11]); const j = this.num(row[9]);
      const cls = (k > l && j < l) ? 'row-yellow' : (j > l ? 'row-red' : '');
      const tds = Array.from({ length: cols }, (_, i) => `<td>${this.esc(row[i] ?? '')}</td>`).join('');
      return `<tr class="${cls}">${tds}</tr>`;
    }).join('\n');
    const thHtml = selHeaders.map((h, i) => `<th data-column="${i}">${this.esc(h)} <i class="fas fa-filter filter-icon"></i></th>`).join('\n');

    return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${this.esc(title)}</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{--gold:#FFD700;--gold-dark:#B8860B;--purple:#8A2BE2;--purple-dark:#4B0082;--black:#0A0A0A;--black2:#1A1A1A;--black3:#2A2A2A;--white:#fff;--gray:#6C757D;--shadow:0 8px 32px rgba(0,0,0,.3);--radius:16px;--tr:all .3s cubic-bezier(.4,0,.2,1)}
body{font-family:Inter,sans-serif;background:linear-gradient(135deg,var(--black),var(--purple-dark) 50%,var(--black2));min-height:100vh;padding:20px;color:var(--white);background-attachment:fixed}
.container{max-width:100%;margin:0 auto;background:rgba(10,10,10,.9);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;border:1px solid rgba(255,215,0,.1)}
.header{background:linear-gradient(135deg,var(--black2),var(--purple-dark));padding:30px 20px;text-align:center;border-bottom:2px solid var(--gold)}
.header h1{font-size:24px;margin-bottom:10px;font-weight:700}
.header-subtitle{font-size:16px;color:var(--gold);font-weight:500}
.info-panel{display:flex;justify-content:center;gap:20px;padding:15px;background:rgba(255,255,255,.05);border-radius:10px;margin:20px 25px;border:1px solid rgba(255,215,0,.2)}
.info-number{font-size:24px;font-weight:700;color:var(--gold)}
.info-label{font-size:12px;color:#E9ECEF;text-transform:uppercase;letter-spacing:1px}
.filter-controls{padding:20px 25px}
.button-group{display:flex;gap:15px;flex-wrap:wrap;justify-content:center}
.btn{padding:12px 26px;border:none;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;transition:var(--tr);display:inline-flex;align-items:center;gap:10px;box-shadow:var(--shadow)}
.btn:hover{transform:translateY(-3px)}
.btn-yellow{background:linear-gradient(135deg,var(--gold),var(--gold-dark));color:var(--black)}
.btn-red{background:linear-gradient(135deg,#FF6B6B,#C44569);color:var(--white)}
.btn-clear{background:linear-gradient(135deg,#9370DB,var(--purple));color:var(--white)}
.btn.active{box-shadow:0 0 30px rgba(255,215,0,.5);transform:scale(1.05)}
.table-container{overflow-x:auto;padding:25px;background:var(--black);position:relative}
table{width:100%;border-collapse:collapse;background:rgba(255,255,255,.02);border-radius:var(--radius);overflow:hidden;border:1px solid rgba(255,215,0,.1)}
thead{background:linear-gradient(135deg,var(--purple),var(--purple-dark))}
th{padding:16px 12px;text-align:left;font-weight:700;font-size:12px;position:sticky;top:0;z-index:10;color:var(--white);text-transform:uppercase;border-right:1px solid rgba(255,255,255,.1);cursor:pointer;user-select:none}
th:hover{background:linear-gradient(135deg,var(--purple),var(--gold))}
th .filter-icon{float:right;opacity:.7;font-size:11px}
th.has-filter .filter-icon{opacity:1;color:var(--gold)}
td{padding:14px 12px;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px;color:var(--white)}
tbody tr:hover{background:rgba(255,215,0,.05)}
.row-yellow{background:linear-gradient(135deg,rgba(255,215,0,.15),rgba(255,193,7,.1))!important;border-left:4px solid var(--gold)}
.row-red{background:linear-gradient(135deg,rgba(255,107,107,.15),rgba(196,69,105,.1))!important;border-left:4px solid #ff4757}
.no-data{text-align:center;padding:60px 20px;color:var(--gray);font-size:16px}
.no-data i{font-size:48px;margin-bottom:20px;color:#9370DB;opacity:.5;display:block}
.filter-dropdown{position:absolute;background:var(--black3);border:2px solid var(--purple);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px;z-index:1000;min-width:240px;max-width:340px;display:none}
.filter-dropdown.show{display:block}
.filter-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid var(--gray)}
.filter-header h4{color:var(--gold);font-size:14px}
.filter-close{background:none;border:none;font-size:20px;cursor:pointer;color:var(--gray)}
.filter-search{width:100%;padding:10px;border:1px solid var(--gray);border-radius:8px;margin-bottom:12px;font-size:12px;background:var(--black);color:var(--white)}
.filter-options{max-height:240px;overflow-y:auto;margin-bottom:12px;border:1px solid var(--gray);border-radius:8px;background:var(--black)}
.filter-option{padding:10px;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:12px;border-bottom:1px solid var(--gray);color:var(--white)}
.filter-option:hover{background:var(--purple)}
.filter-actions{display:flex;gap:10px}
.filter-btn{flex:1;padding:10px;border:none;border-radius:8px;cursor:pointer;font-size:12px;font-weight:600}
.filter-btn-apply{background:linear-gradient(135deg,var(--purple),var(--purple-dark));color:var(--white)}
.filter-btn-clear{background:var(--gray);color:var(--white)}
::-webkit-scrollbar{width:8px;height:8px}::-webkit-scrollbar-track{background:var(--black3)}::-webkit-scrollbar-thumb{background:linear-gradient(135deg,var(--gold),var(--purple));border-radius:4px}
@media(max-width:768px){.button-group{flex-direction:column}.header h1{font-size:18px}}
</style></head><body>
<div class="container">
<div class="header"><h1><i class="fas fa-hammer"></i> Результаты испытаний молотком Шмидта</h1><div class="header-subtitle"><i class="fas fa-calendar-alt"></i> ${this.esc(target)}</div></div>
<div class="info-panel"><div class="info-item"><div class="info-number">${rows.length}</div><div class="info-label">Жами ўлчовлар</div></div></div>
<div class="filter-controls"><div class="button-group">
<button class="btn btn-yellow" id="yellowBtn"><i class="fas fa-exclamation-triangle"></i> Сариқ (${yellow})</button>
<button class="btn btn-red" id="redBtn"><i class="fas fa-times-circle"></i> Қизил (${red})</button>
<button class="btn btn-clear" id="clearBtn"><i class="fas fa-broom"></i> Тозалаш</button>
</div></div>
<div class="table-container"><table id="dataTable"><thead><tr id="headerRow">${thHtml}</tr></thead>
<tbody id="tableBody">${rowsHtml || `<tr><td colspan="${cols}" class="no-data"><i class="fas fa-inbox"></i><div>Маълумот топилмади</div></td></tr>`}</tbody></table>
<div id="filterDropdown" class="filter-dropdown"><div class="filter-header"><h4 id="filterTitle">Филтр</h4><button class="filter-close" id="filterCloseBtn">&times;</button></div><div id="filterContent"></div></div>
</div></div>
<script>
const originalRows=document.querySelectorAll('#tableBody tr');const headers=Array.from(document.querySelectorAll('#headerRow th'));const dateColumns=[5,6];
const activeFilters={dropdown:{},date:{},color:null};const tableData=[];
originalRows.forEach(r=>{const cells=Array.from(r.querySelectorAll('td')).map(c=>c.textContent);tableData.push({cells,rowClass:r.className})});
const dd=document.getElementById('filterDropdown'),ft=document.getElementById('filterTitle'),fc=document.getElementById('filterContent');let curCol=null;
headers.forEach(th=>th.addEventListener('click',()=>{const c=parseInt(th.dataset.column);if(curCol===c&&dd.classList.contains('show'))closeFilter();else showFilter(c,th)}));
function showFilter(c,el){curCol=c;ft.textContent=el.textContent.trim();const r=el.getBoundingClientRect(),cr=document.querySelector('.table-container').getBoundingClientRect();dd.style.left=(r.left-cr.left)+'px';dd.style.top=(r.bottom-cr.top+5)+'px';dateColumns.includes(c)?dateFilter(c):dropFilter(c);dd.classList.add('show')}
function closeFilter(){dd.classList.remove('show');curCol=null}
function dropFilter(col){const uniq=new Set();tableData.forEach(r=>{const v=r.cells[col];if(v&&v.trim())uniq.add(v)});const sel=activeFilters.dropdown[col]||[];let h='<input type="text" class="filter-search" id="fs" placeholder="Қидириш..."><div class="filter-options" id="fo">';Array.from(uniq).sort().forEach(v=>{h+='<label class="filter-option"><input type="checkbox" value="'+v.replace(/"/g,'&quot;')+'" '+(sel.includes(v)?'checked':'')+'><span>'+v+'</span></label>'});h+='</div><div class="filter-actions"><button class="filter-btn filter-btn-apply" id="af">Қўллаш</button><button class="filter-btn filter-btn-clear" id="cf">Тозалаш</button></div>';fc.innerHTML=h;document.getElementById('fs').addEventListener('input',e=>{const s=e.target.value.toLowerCase();document.querySelectorAll('.filter-option').forEach(o=>o.style.display=o.textContent.toLowerCase().includes(s)?'flex':'none')});document.getElementById('af').addEventListener('click',()=>{const sel=Array.from(document.querySelectorAll('#fo input:checked')).map(c=>c.value);if(sel.length){activeFilters.dropdown[col]=sel;headers[col].classList.add('has-filter')}else{delete activeFilters.dropdown[col];headers[col].classList.remove('has-filter')}applyAll();closeFilter()});document.getElementById('cf').addEventListener('click',()=>{delete activeFilters.dropdown[col];headers[col].classList.remove('has-filter');applyAll();closeFilter()})}
function dateFilter(col){const sel=activeFilters.date[col]||'';fc.innerHTML='<div class="filter-options"><div class="filter-option"><input type="date" id="di" value="'+sel+'" style="width:100%;padding:8px;background:var(--black);color:#fff;border:1px solid var(--gray);border-radius:4px"></div></div><div class="filter-actions"><button class="filter-btn filter-btn-apply" id="af">Қўллаш</button><button class="filter-btn filter-btn-clear" id="cf">Тозалаш</button></div>';document.getElementById('af').addEventListener('click',()=>{const v=document.getElementById('di').value;if(v){activeFilters.date[col]=v;headers[col].classList.add('has-filter')}else{delete activeFilters.date[col];headers[col].classList.remove('has-filter')}applyAll();closeFilter()});document.getElementById('cf').addEventListener('click',()=>{delete activeFilters.date[col];headers[col].classList.remove('has-filter');applyAll();closeFilter()})}
document.addEventListener('click',e=>{if(!dd.contains(e.target)&&!e.target.closest('th'))closeFilter()});
document.getElementById('filterCloseBtn').addEventListener('click',closeFilter);
function applyAll(){const tb=document.getElementById('tableBody');tb.innerHTML='';let n=0;tableData.forEach(r=>{let show=true;for(const c in activeFilters.dropdown){if(!activeFilters.dropdown[c].includes(r.cells[c])){show=false;break}}for(const c in activeFilters.date){const p=(r.cells[c]||'').split('.');if(p.length===3){const cd=p[2]+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0');if(cd!==activeFilters.date[c]){show=false;break}}else{show=false;break}}if(activeFilters.color&&r.rowClass!==activeFilters.color)show=false;if(show){const tr=document.createElement('tr');tr.className=r.rowClass;r.cells.forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.appendChild(td)});tb.appendChild(tr);n++}});if(!n)tb.innerHTML='<tr><td colspan="${cols}" class="no-data"><i class="fas fa-search"></i><div>Филтранган маълумот топилмади</div></td></tr>';updateCounts()}
function updateCounts(){document.getElementById('yellowBtn').innerHTML='<i class="fas fa-exclamation-triangle"></i> Сариқ ('+document.querySelectorAll('.row-yellow').length+')';document.getElementById('redBtn').innerHTML='<i class="fas fa-times-circle"></i> Қизил ('+document.querySelectorAll('.row-red').length+')'}
document.getElementById('yellowBtn').addEventListener('click',function(){this.classList.toggle('active');if(this.classList.contains('active')){document.getElementById('redBtn').classList.remove('active');activeFilters.color='row-yellow'}else activeFilters.color=null;applyAll()});
document.getElementById('redBtn').addEventListener('click',function(){this.classList.toggle('active');if(this.classList.contains('active')){document.getElementById('yellowBtn').classList.remove('active');activeFilters.color='row-red'}else activeFilters.color=null;applyAll()});
document.getElementById('clearBtn').addEventListener('click',function(){activeFilters.dropdown={};activeFilters.date={};activeFilters.color=null;document.getElementById('yellowBtn').classList.remove('active');document.getElementById('redBtn').classList.remove('active');headers.forEach(th=>th.classList.remove('has-filter'));applyAll();closeFilter()});
</script></body></html>`;
  }
}
