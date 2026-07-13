import * as ExcelJS from 'exceljs';

/**
 * Ma'lumotni turli formatlarga o'giradigan generic serializerlar.
 * Har bir dataset { table, columns, rows } shaklida beriladi.
 */
export interface ExportColumn { key: string; header: string; }
export interface Dataset {
  table: string;              // jadval nomi (SQL/XML uchun)
  columns: ExportColumn[];
  rows: Record<string, any>[];
}

export const FORMATS: Record<string, { ext: string; mime: string; label: string }> = {
  json:           { ext: 'json', mime: 'application/json; charset=utf-8',  label: 'JSON' },
  csv:            { ext: 'csv',  mime: 'text/csv; charset=utf-8',          label: 'CSV' },
  xlsx:           { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
  'sql-mysql':    { ext: 'sql',  mime: 'application/sql; charset=utf-8',    label: 'SQL (MariaDB/MySQL)' },
  'sql-postgres': { ext: 'sql',  mime: 'application/sql; charset=utf-8',    label: 'SQL (PostgreSQL)' },
  txt:            { ext: 'txt',  mime: 'text/plain; charset=utf-8',         label: 'TXT (bloknot)' },
  xml:            { ext: 'xml',  mime: 'application/xml; charset=utf-8',     label: 'XML' },
  html:           { ext: 'html', mime: 'text/html; charset=utf-8',          label: 'HTML' },
  md:             { ext: 'md',   mime: 'text/markdown; charset=utf-8',       label: 'Markdown' },
  yaml:           { ext: 'yaml', mime: 'application/x-yaml; charset=utf-8',  label: 'YAML' },
};

// Hujayra qiymatini string'ga (Date → ISO, obyekt → JSON)
function cell(v: any): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ─── CSV ───
function csv(ds: Dataset): string {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
  const head = ds.columns.map((c) => esc(c.header)).join(',');
  const body = ds.rows.map((r) => ds.columns.map((c) => esc(cell(r[c.key]))).join(',')).join('\r\n');
  return '﻿' + head + '\r\n' + body; // BOM — Excel kirill uchun
}

// ─── TXT (tekislangan jadval) ───
function txt(ds: Dataset): string {
  const widths = ds.columns.map((c) =>
    Math.max(c.header.length, ...ds.rows.map((r) => cell(r[c.key]).length), 0),
  );
  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length));
  const row = (cells: string[]) => cells.map((s, i) => pad(s, widths[i])).join('  |  ');
  const head = row(ds.columns.map((c) => c.header));
  const sep = widths.map((w) => '-'.repeat(w)).join('--+--');
  const body = ds.rows.map((r) => row(ds.columns.map((c) => cell(r[c.key])))).join('\n');
  return [head, sep, body].join('\n');
}

// ─── XML ───
function xml(ds: Dataset): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = ds.rows
    .map((r) => {
      const cols = ds.columns.map((c) => `    <${c.key}>${esc(cell(r[c.key]))}</${c.key}>`).join('\n');
      return `  <row>\n${cols}\n  </row>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<${ds.table}>\n${rows}\n</${ds.table}>`;
}

// ─── HTML ───
function html(ds: Dataset): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const th = ds.columns.map((c) => `<th>${esc(c.header)}</th>`).join('');
  const trs = ds.rows
    .map((r) => '<tr>' + ds.columns.map((c) => `<td>${esc(cell(r[c.key]))}</td>`).join('') + '</tr>')
    .join('\n');
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(ds.table)}</title>
<style>body{font-family:system-ui,sans-serif}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #cbd5e1;padding:4px 8px;text-align:left}th{background:#eef2ff}tr:nth-child(even){background:#f8fafc}</style>
</head><body><h3>${esc(ds.table)} — ${ds.rows.length} qator</h3><table><thead><tr>${th}</tr></thead><tbody>
${trs}
</tbody></table></body></html>`;
}

// ─── Markdown ───
function md(ds: Dataset): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const head = '| ' + ds.columns.map((c) => esc(c.header)).join(' | ') + ' |';
  const sep = '| ' + ds.columns.map(() => '---').join(' | ') + ' |';
  const body = ds.rows.map((r) => '| ' + ds.columns.map((c) => esc(cell(r[c.key]))).join(' | ') + ' |').join('\n');
  return [head, sep, body].join('\n');
}

// ─── YAML ───
function yaml(ds: Dataset): string {
  const q = (s: string) => {
    if (s === '') return '""';
    if (/[:#\-?\[\]{}&*!|>'"%@`]/.test(s) || /^\s|\s$|\n/.test(s)) return JSON.stringify(s);
    return s;
  };
  return ds.rows
    .map((r) =>
      ds.columns.map((c, i) => `${i === 0 ? '- ' : '  '}${c.key}: ${q(cell(r[c.key]))}`).join('\n'),
    )
    .join('\n');
}

// ─── JSON ───
function json(ds: Dataset): string {
  const out = ds.rows.map((r) => {
    const o: Record<string, any> = {};
    for (const c of ds.columns) o[c.key] = r[c.key] ?? null;
    return o;
  });
  return JSON.stringify(out, (_k, v) => (v instanceof Date ? v.toISOString() : v), 2);
}

// ─── SQL (MySQL/MariaDB yoki PostgreSQL) ───
function sqlValue(v: any, dialect: 'mysql' | 'postgres'): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return dialect === 'postgres' ? (v ? 'TRUE' : 'FALSE') : v ? '1' : '0';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  s = s.replace(/'/g, "''");
  if (dialect === 'mysql') s = s.replace(/\\/g, '\\\\');
  return `'${s}'`;
}
function sql(ds: Dataset, dialect: 'mysql' | 'postgres'): string {
  const q = dialect === 'mysql' ? (id: string) => '`' + id + '`' : (id: string) => '"' + id + '"';
  const cols = ds.columns.map((c) => q(c.key));
  const createCols = ds.columns.map((c) => `  ${q(c.key)} TEXT`).join(',\n');
  const create = `DROP TABLE IF EXISTS ${q(ds.table)};\nCREATE TABLE ${q(ds.table)} (\n${createCols}\n);`;
  const inserts = ds.rows
    .map(
      (r) =>
        `INSERT INTO ${q(ds.table)} (${cols.join(', ')}) VALUES (${ds.columns
          .map((c) => sqlValue(r[c.key], dialect))
          .join(', ')});`,
    )
    .join('\n');
  return `-- ${ds.table} export (${ds.rows.length} qator) · ${dialect}\n${create}\n\n${inserts}\n`;
}

// ─── Excel (.xlsx) ───
async function xlsx(ds: Dataset): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Xon Tranzaksiyalar';
  const ws = wb.addWorksheet(ds.table.slice(0, 31));
  ws.columns = ds.columns.map((c) => ({ header: c.header, key: c.key, width: 20 }));
  ws.getRow(1).font = { bold: true };
  for (const r of ds.rows) {
    const row: Record<string, any> = {};
    for (const c of ds.columns) {
      const v = r[c.key];
      row[c.key] =
        v instanceof Date
          ? v.toISOString().slice(0, 10)
          : typeof v === 'object' && v !== null
            ? JSON.stringify(v)
            : v;
    }
    ws.addRow(row);
  }
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

/** Datasetni tanlangan formatga o'girib Buffer qaytaradi. */
export async function serialize(format: string, ds: Dataset): Promise<Buffer> {
  switch (format) {
    case 'json':          return Buffer.from(json(ds), 'utf8');
    case 'csv':           return Buffer.from(csv(ds), 'utf8');
    case 'txt':           return Buffer.from(txt(ds), 'utf8');
    case 'xml':           return Buffer.from(xml(ds), 'utf8');
    case 'html':          return Buffer.from(html(ds), 'utf8');
    case 'md':            return Buffer.from(md(ds), 'utf8');
    case 'yaml':          return Buffer.from(yaml(ds), 'utf8');
    case 'sql-mysql':     return Buffer.from(sql(ds, 'mysql'), 'utf8');
    case 'sql-postgres':  return Buffer.from(sql(ds, 'postgres'), 'utf8');
    case 'xlsx':          return xlsx(ds);
    default: throw new Error(`Nomaʼlum format: ${format}`);
  }
}
