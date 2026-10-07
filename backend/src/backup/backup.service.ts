import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { createWriteStream, openAsBlob } from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { PrismaService } from '../common/prisma/prisma.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const archiver = require('archiver'); // CommonJS — loyihada shu uslub ishlatiladi (oplata-kv.service)

export interface BackupStatus {
  running: boolean;
  phase: string | null;
  lastRunAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
  lastSizeBytes: number | null;
  lastParts: number | null;
  lastDurationMs: number | null;
  lastTrigger: 'cron' | 'manual' | null;
}

export interface BackupConfig {
  enabled: boolean;
  timesRaw: string;   // "21:00" yoki "09:00,21:00"
  times: string[];    // normalizatsiya qilingan HH:MM ro'yxati
  botToken: string;
  chatId: string;
}

function normalizeHHMM(s: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/**
 * To'liq loyiha backup'i → Telegram arxiv kanaliga (har kuni belgilangan vaqtda).
 *
 * NIMA backup bo'ladi (shifrsiz ZIP — foydalanuvchi tanlovi):
 *   1) BAZA    — pg_dump -Fc (butun PostgreSQL, siqilgan custom format) → db.dump
 *   2) KOD     — git archive HEAD (FAQAT git fayllar → .env/node_modules/dist AVTOMAT chiqadi;
 *                sirlar Telegramga KETMAYDI) → code.zip
 *   3) FAYLLAR — UPLOADS_DIR (ariza/PDF/rasm) → uploads.zip
 *   Hammasi bitta `xon-backup-YYYY-MM-DD.zip` ichida + MANIFEST.txt + RESTORE.txt.
 *
 * Bot/guruh/vaqt — UI'dan (Setting jadvali, backup.* kalitlar). Env ham zaxira sifatida.
 * Telegram bot fayl limiti 50MB → katta bo'lsa .001/.002… bo'laklarga bo'linadi.
 * Yuborilgach lokal temp O'CHIRILADI → serverda joy olmaydi.
 */
@Injectable()
export class BackupService {
  private readonly log = new Logger(BackupService.name);

  private status: BackupStatus = {
    running: false,
    phase: null,
    lastRunAt: null,
    lastOkAt: null,
    lastError: null,
    lastSizeBytes: null,
    lastParts: null,
    lastDurationMs: null,
    lastTrigger: null,
  };

  // Joriy run uchun yuklangan token/chat (sendDocument/sendMessage shulardan foydalanadi)
  private curToken = '';
  private curChat = '';

  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  // ─── Infra sozlamalari (env — server darajasi) ───
  private get projectDir(): string {
    return this.config.get<string>('BACKUP_PROJECT_DIR') || '/var/www/xon_tranzactions';
  }
  private get uploadsDir(): string {
    return this.config.get<string>('UPLOADS_DIR') || '/var/www/xon_tranzactions/uploads';
  }
  private get maxPartBytes(): number {
    return Math.max(5, Number(this.config.get('BACKUP_MAX_PART_MB') || 45)) * 1024 * 1024;
  }
  private get pgDumpBin(): string {
    return this.config.get<string>('BACKUP_PG_DUMP') || 'pg_dump';
  }
  private get tmpBase(): string {
    return this.config.get<string>('BACKUP_TMP_DIR') || os.tmpdir();
  }

  // ─────────────────────── Setting (key/value) ───────────────────────
  private async settingGet(key: string): Promise<string | null> {
    const r = await this.prisma.setting.findUnique({ where: { key } }).catch(() => null);
    return r?.value ?? null;
  }
  private async settingSet(key: string, value: string | null, updatedBy = 'backup'): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    });
  }

  /** UI/cron uchun to'liq config (token bilan). */
  async getConfig(): Promise<BackupConfig> {
    const [enabled, times, token, chat] = await Promise.all([
      this.settingGet('backup.enabled'),
      this.settingGet('backup.times'),
      this.settingGet('backup.botToken'),
      this.settingGet('backup.chatId'),
    ]);
    const timesRaw = times && times.trim() ? times.trim() : '21:00';
    const parsed = timesRaw.split(',').map((s) => normalizeHHMM(s)).filter(Boolean);
    return {
      enabled: enabled === '1',
      timesRaw,
      times: parsed.length ? parsed : ['21:00'],
      botToken: token || this.config.get<string>('ARCHIVE_BOT_TOKEN') || '',
      chatId: chat || this.config.get<string>('ARCHIVE_CHAT_ID') || '',
    };
  }

  /** API uchun — TOKEN maskalanadi (hech qachon to'liq qaytmaydi). */
  async getConfigForApi() {
    const c = await this.getConfig();
    return {
      enabled: c.enabled,
      times: c.timesRaw,
      chatId: c.chatId,
      tokenSet: !!c.botToken,
      tokenHint: c.botToken ? `…${c.botToken.slice(-4)}` : '',
      status: this.getStatus(),
    };
  }

  async setConfig(
    vals: { enabled?: boolean; times?: string; botToken?: string; chatId?: string },
    updatedBy?: string,
  ): Promise<void> {
    if (vals.enabled !== undefined) {
      await this.settingSet('backup.enabled', vals.enabled ? '1' : null, updatedBy);
    }
    if (vals.times !== undefined) {
      const clean = (vals.times || '').split(',').map((s) => normalizeHHMM(s)).filter(Boolean);
      if ((vals.times || '').trim() && !clean.length) {
        throw new Error("Noto'g'ri vaqt format — HH:MM (masalan 21:00)");
      }
      await this.settingSet('backup.times', clean.join(',') || null, updatedBy);
    }
    // Token: bo'sh kelsa O'ZGARTIRILMAYDI (eski token qoladi) — maskalanganidan keyin qayta yozmaslik uchun
    if (vals.botToken !== undefined && vals.botToken.trim() !== '') {
      await this.settingSet('backup.botToken', vals.botToken.trim(), updatedBy);
    }
    if (vals.chatId !== undefined) {
      await this.settingSet('backup.chatId', (vals.chatId || '').trim() || null, updatedBy);
    }
  }

  getStatus(): BackupStatus {
    return { ...this.status };
  }

  // ─── CRON tick: har daqiqa tekshiradi, belgilangan vaqtda (Toshkent) kuniga bir marta ishlaydi ───
  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (this.status.running) return;
    // Tez tekshiruv — o'chirilgan bo'lsa (ko'p holat) ortiqcha o'qimaymiz
    let enabled: string | null;
    try {
      enabled = await this.settingGet('backup.enabled');
    } catch {
      return;
    }
    if (enabled !== '1') return;
    let cfg: BackupConfig;
    try {
      cfg = await this.getConfig();
    } catch {
      return;
    }
    if (!cfg.enabled || !cfg.botToken || !cfg.chatId) return;
    const now = this.tashkentHHMM();
    if (!cfg.times.includes(now)) return;
    const slot = `${this.tashkentDateStr()}_${now}`;
    const last = await this.settingGet('backup.lastRunSlot');
    if (last === slot) return; // shu slot allaqachon bajarildi (takror emas)
    await this.settingSet('backup.lastRunSlot', slot);
    this.log.log(`Backup cron trigger: ${slot}`);
    await this.runBackup('cron').catch((e) => this.log.error(`Backup cron xato: ${e?.message}`));
  }

  /** Backup'ni ishga tushiradi (cron yoki qo'lda). Bir vaqtda bitta. */
  async runBackup(trigger: 'cron' | 'manual'): Promise<BackupStatus> {
    if (this.status.running) {
      this.log.warn("Backup allaqachon ishlayapti — yangi urinish o'tkazib yuborildi");
      return this.getStatus();
    }
    const cfg = await this.getConfig();
    if (!cfg.botToken || !cfg.chatId) {
      this.status.lastError = 'Telegram token yoki guruh ID kiritilmagan';
      return this.getStatus();
    }
    this.curToken = cfg.botToken;
    this.curChat = cfg.chatId;

    const t0 = Date.now();
    this.status.running = true;
    this.status.lastTrigger = trigger;
    this.status.lastRunAt = new Date().toISOString();
    this.status.lastError = null;
    this.status.phase = 'boshlanish';

    const stamp = this.dateStamp();
    const workDir = await fsp.mkdtemp(path.join(this.tmpBase, 'xon-backup-'));
    this.log.log(`Backup boshlandi (${trigger}) — ish papkasi: ${workDir}`);

    try {
      // 1) BAZA
      this.status.phase = 'baza (pg_dump)';
      const dbPath = path.join(workDir, 'db.dump');
      await this.dumpDatabase(dbPath);

      // 2) KOD — git archive (faqat git fayllar; .env/node_modules chiqmaydi)
      this.status.phase = 'kod (git archive)';
      const codePath = path.join(workDir, 'code.zip');
      const commit = await this.archiveCode(codePath);

      // 3) FAYLLAR — yuklangan fayllar
      this.status.phase = 'fayllar (uploads)';
      const uploadsPath = path.join(workDir, 'uploads.zip');
      const uploadsIncluded = await this.archiveUploads(uploadsPath);

      // 4) MANIFEST + RESTORE
      this.status.phase = 'manifest';
      const manifestPath = path.join(workDir, 'MANIFEST.txt');
      const restorePath = path.join(workDir, 'RESTORE.txt');
      await fsp.writeFile(manifestPath, await this.buildManifest(stamp, commit, { dbPath, codePath, uploadsPath, uploadsIncluded }));
      await fsp.writeFile(restorePath, this.buildRestoreGuide());

      // 5) BUNDLE — bitta zip (ichidagilar siqilgan → store rejimi, tez)
      this.status.phase = 'bundle (zip)';
      const bundlePath = path.join(workDir, `xon-backup-${stamp}.zip`);
      const entries = [
        { file: dbPath, name: 'db.dump' },
        { file: codePath, name: 'code.zip' },
        { file: manifestPath, name: 'MANIFEST.txt' },
        { file: restorePath, name: 'RESTORE.txt' },
      ];
      if (uploadsIncluded) entries.push({ file: uploadsPath, name: 'uploads.zip' });
      await this.zipStore(bundlePath, entries);

      const bundleSize = (await fsp.stat(bundlePath)).size;

      // 6) SPLIT — 50MB bot limiti
      this.status.phase = "bo'lish (split)";
      const parts = await this.splitIfNeeded(bundlePath, this.maxPartBytes);

      // 7) UPLOAD → Telegram
      this.status.phase = `yuborish (${parts.length} bo'lak)`;
      await this.uploadParts(parts, stamp, commit, bundleSize, uploadsIncluded);

      this.status.lastOkAt = new Date().toISOString();
      this.status.lastSizeBytes = bundleSize;
      this.status.lastParts = parts.length;
      this.status.lastError = null;
      this.status.phase = 'tayyor';
      await this.settingSet('backup.lastOkAt', this.status.lastOkAt, 'system');
      this.log.log(`Backup tayyor: ${this.humanSize(bundleSize)} (${parts.length} bo'lak)`);
    } catch (e: any) {
      const msg = e?.message || String(e);
      this.status.lastError = msg;
      this.status.phase = 'xato';
      this.log.error(`Backup xato: ${msg}`);
      await this.sendMessage(
        `❌ <b>Backup XATO</b>\n🗓 ${stamp}\n⚠️ ${this.escapeHtml(msg).slice(0, 500)}`,
      ).catch(() => { /* ignore */ });
    } finally {
      // Lokal temp O'CHIRILADI → serverda joy olmaydi
      await fsp.rm(workDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
      this.status.running = false;
      this.status.lastDurationMs = Date.now() - t0;
    }
    return this.getStatus();
  }

  // ─────────────────────── Bosqichlar ───────────────────────

  /** pg_dump -Fc (custom, siqilgan) — DATABASE_URL'dan ulanish. */
  private async dumpDatabase(outPath: string): Promise<void> {
    const url = this.config.get<string>('DATABASE_URL') || process.env.DATABASE_URL || '';
    if (!url) throw new Error('DATABASE_URL topilmadi');
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new Error("DATABASE_URL formati noto'g'ri");
    }
    const dbName = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
    const args = [
      '-h', u.hostname || 'localhost',
      '-p', u.port || '5432',
      '-U', decodeURIComponent(u.username || 'postgres'),
      '-d', dbName,
      '-Fc', // custom format (siqilgan) — restore: pg_restore
      '--no-owner', '--no-privileges',
      '-f', outPath,
    ];
    const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password || '') };
    const { code, stderr } = await this.run(this.pgDumpBin, args, { env, timeoutMs: 20 * 60 * 1000 });
    if (code !== 0) {
      throw new Error(`pg_dump xato (code ${code}): ${(stderr || '').slice(0, 300)}`);
    }
    const sz = (await fsp.stat(outPath)).size;
    if (sz < 100) throw new Error("pg_dump bo'sh fayl berdi");
    this.log.log(`Baza dump: ${this.humanSize(sz)}`);
  }

  /** git archive HEAD → zip (faqat kuzatilayotgan fayllar). Commit hash qaytaradi. */
  private async archiveCode(outPath: string): Promise<string> {
    let commit = 'unknown';
    try {
      const r = await this.run('git', ['rev-parse', 'HEAD'], { cwd: this.projectDir, timeoutMs: 30_000 });
      if (r.code === 0) commit = (r.stdout || '').trim().slice(0, 40);
    } catch { /* ignore */ }

    const { code, stderr } = await this.run(
      'git',
      ['archive', '--format=zip', '-o', outPath, 'HEAD'],
      { cwd: this.projectDir, timeoutMs: 5 * 60 * 1000 },
    );
    if (code !== 0) {
      this.log.warn(`git archive xato: ${(stderr || '').slice(0, 200)} — kod o'tkazib yuborildi`);
      await fsp.writeFile(outPath, 'git archive ishlamadi — kod GitHub origin/main da.\n');
    } else {
      this.log.log(`Kod arxivi: ${this.humanSize((await fsp.stat(outPath)).size)} (commit ${commit.slice(0, 8)})`);
    }
    return commit;
  }

  /** UPLOADS_DIR → uploads.zip. Papka yo'q/bo'sh bo'lsa false. */
  private async archiveUploads(outPath: string): Promise<boolean> {
    try {
      const st = await fsp.stat(this.uploadsDir);
      if (!st.isDirectory()) return false;
      const entries = await fsp.readdir(this.uploadsDir);
      if (!entries.length) return false;
    } catch {
      return false; // papka yo'q
    }
    await this.zipDir(outPath, this.uploadsDir);
    this.log.log(`Yuklangan fayllar: ${this.humanSize((await fsp.stat(outPath)).size)}`);
    return true;
  }

  // ─────────────────────── Zip yordamchilari ───────────────────────

  private zipDir(outPath: string, dir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const out = createWriteStream(outPath);
      const arch = archiver('zip', { zlib: { level: 6 } });
      out.on('close', () => resolve());
      arch.on('error', (e: any) => reject(e));
      arch.pipe(out);
      arch.directory(dir, false);
      arch.finalize();
    });
  }

  private zipStore(outPath: string, files: Array<{ file: string; name: string }>): Promise<void> {
    return new Promise((resolve, reject) => {
      const out = createWriteStream(outPath);
      const arch = archiver('zip', { store: true });
      out.on('close', () => resolve());
      arch.on('error', (e: any) => reject(e));
      arch.pipe(out);
      for (const f of files) arch.file(f.file, { name: f.name });
      arch.finalize();
    });
  }

  /** Fayl maxBytes'dan katta bo'lsa .001/.002… bo'laklarga bo'ladi (stream, kam xotira). */
  private async splitIfNeeded(filePath: string, maxBytes: number): Promise<string[]> {
    const { size } = await fsp.stat(filePath);
    if (size <= maxBytes) return [filePath];

    const parts: string[] = [];
    const readBuf = Buffer.alloc(4 * 1024 * 1024);
    const fd = await fsp.open(filePath, 'r');
    try {
      let pos = 0;
      let idx = 0;
      while (pos < size) {
        idx++;
        const partPath = `${filePath}.${String(idx).padStart(3, '0')}`;
        const out = createWriteStream(partPath);
        let written = 0;
        while (written < maxBytes && pos < size) {
          const toRead = Math.min(readBuf.length, maxBytes - written, size - pos);
          const { bytesRead } = await fd.read(readBuf, 0, toRead, pos);
          if (bytesRead <= 0) break;
          await new Promise<void>((res, rej) =>
            out.write(readBuf.subarray(0, bytesRead), (err) => (err ? rej(err) : res())),
          );
          written += bytesRead;
          pos += bytesRead;
        }
        await new Promise<void>((res) => out.end(res));
        parts.push(partPath);
      }
    } finally {
      await fd.close();
    }
    this.log.log(`${this.humanSize(size)} → ${parts.length} bo'lakka bo'lindi`);
    return parts;
  }

  // ─────────────────────── Telegram ───────────────────────

  private async uploadParts(
    parts: string[],
    stamp: string,
    commit: string,
    totalSize: number,
    uploadsIncluded: boolean,
  ): Promise<void> {
    const multi = parts.length > 1;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const name = path.basename(p);
      const caption =
        i === 0
          ? [
              `📦 <b>Xon Tranzaksiyalar — Backup</b>`,
              `🗓 ${stamp}`,
              `📊 Baza + Kod${uploadsIncluded ? ' + Fayllar' : ''}  ·  commit <code>${this.escapeHtml(commit.slice(0, 8))}</code>`,
              `💾 Hajmi: ${this.humanSize(totalSize)}${multi ? `  ·  ${parts.length} bo'lak` : ''}`,
              multi
                ? `♻️ Tiklash: barcha bo'laklarni ketma-ket birlashtiring (RESTORE.txt)`
                : `♻️ Tiklash: RESTORE.txt (zip ichida)`,
            ].join('\n')
          : undefined;
      await this.sendDocument(p, name, caption);
      this.log.log(`Yuborildi: ${name} (${i + 1}/${parts.length})`);
    }
  }

  private async sendDocument(filePath: string, fileName: string, caption?: string): Promise<void> {
    const blob = await openAsBlob(filePath); // Node 19+ — fayldan oqim, katta buferiz
    const form = new FormData();
    form.append('chat_id', this.curChat);
    form.append('document', blob, fileName);
    if (caption) {
      form.append('caption', caption);
      form.append('parse_mode', 'HTML');
    }
    // Timeout — yuborish osilib qolsa backup abadiy "running" bo'lib qolmasin (10 daq/bo'lak)
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 10 * 60 * 1000);
    try {
      const res = await fetch(`https://api.telegram.org/bot${this.curToken}/sendDocument`, {
        method: 'POST',
        body: form,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Telegram sendDocument ${res.status}: ${txt.slice(0, 200)}`);
      }
    } finally {
      clearTimeout(tm);
    }
  }

  private async sendMessage(text: string): Promise<void> {
    if (!this.curToken || !this.curChat) return;
    const ctrl = new AbortController();
    const tm = setTimeout(() => ctrl.abort(), 30_000);
    try {
      await fetch(`https://api.telegram.org/bot${this.curToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.curChat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: ctrl.signal,
      });
    } catch { /* alert xabari — xato bo'lsa jim */ } finally {
      clearTimeout(tm);
    }
  }

  // ─────────────────────── Matnlar ───────────────────────

  private async buildManifest(
    stamp: string,
    commit: string,
    f: { dbPath: string; codePath: string; uploadsPath: string; uploadsIncluded: boolean },
  ): Promise<string> {
    const sizeOf = async (p: string) => {
      try {
        return this.humanSize((await fsp.stat(p)).size);
      } catch {
        return '—';
      }
    };
    let counts = '';
    try {
      const [oplata, tx] = await Promise.all([
        this.prisma.oplataKv.count(),
        this.prisma.transaction.count().catch(() => null),
      ]);
      counts = `  oplata_kv qatorlar  : ${oplata}\n` + (tx != null ? `  transaction qatorlar: ${tx}\n` : '');
    } catch { /* ignore */ }

    return (
      [
        'XON TRANZAKSIYALAR — BACKUP MANIFEST',
        '====================================',
        `Sana        : ${stamp}`,
        `Git commit  : ${commit}`,
        '',
        'Ichidagilar :',
        `  db.dump     (PostgreSQL pg_dump -Fc) : ${await sizeOf(f.dbPath)}`,
        `  code.zip    (git archive HEAD)       : ${await sizeOf(f.codePath)}`,
        f.uploadsIncluded
          ? `  uploads.zip (yuklangan fayllar)      : ${await sizeOf(f.uploadsPath)}`
          : "  uploads.zip : (yo'q — papka bo'sh/topilmadi)",
        '',
        counts ? 'Baza hajmi :' : '',
        counts,
        "Eslatma: .env va sirlar QO'SHILMAGAN (git archive faqat kuzatilayotgan fayllar).",
        'Tiklash yo\'riqnomasi: RESTORE.txt',
        '',
      ]
        .filter((l) => l !== '')
        .join('\n') + '\n'
    );
  }

  private buildRestoreGuide(): string {
    return [
      "XON TRANZAKSIYALAR — TIKLASH (RESTORE) YO'RIQNOMASI",
      '===================================================',
      '',
      "0) Agar bir nechta bo'lak bo'lsa (xon-backup-*.zip.001, .002 ...) — avval birlashtiring:",
      '     Linux/Mac : cat xon-backup-*.zip.* > xon-backup.zip',
      '     Windows   : copy /b xon-backup-*.zip.001+...+.00N xon-backup.zip',
      "   Bitta bo'lak bo'lsa — bu qadam shart emas.",
      '',
      '1) Zipni oching:',
      '     unzip xon-backup.zip',
      '   Natija: db.dump, code.zip, uploads.zip (bor bo\'lsa), MANIFEST.txt',
      '',
      '2) BAZANI tiklash (yangi/bo\'sh bazaga tavsiya etiladi):',
      '     createdb xon_tranzactions_restore',
      '     pg_restore --no-owner --no-privileges -d xon_tranzactions_restore db.dump',
      '   (Mavjud bazaga: pg_restore --clean --if-exists -d <baza> db.dump)',
      '',
      '3) KODni tiklash:',
      '     unzip code.zip -d xon_tranzactions_code',
      '   (yoki: git clone <GitHub repo> — kod GitHub origin/main da ham bor)',
      "   Keyin .env ni qaytadan sozlang (backup ichida YO'Q — xavfsizlik uchun).",
      '',
      "4) YUKLANGAN FAYLLARni tiklash (uploads.zip bo'lsa):",
      '     unzip uploads.zip -d uploads',
      '   Serverdagi UPLOADS_DIR ga ko\'chiring.',
      '',
      'Tayyor. Baza + kod + fayllar tiklandi.',
      '',
    ].join('\n');
  }

  // ─────────────────────── Util ───────────────────────

  private run(
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number },
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env || process.env });
      let stdout = '';
      let stderr = '';
      let done = false;
      const finish = (code: number) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      };
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch { /* ignore */ }
        stderr += `\n[timeout ${opts.timeoutMs}ms]`;
        finish(124);
      }, opts.timeoutMs || 10 * 60 * 1000);
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (e) => {
        stderr += `\n${e.message}`;
        finish(127);
      });
      child.on('close', (code) => finish(code ?? 0));
    });
  }

  private tashkentNow(): Date {
    return new Date(Date.now() + 5 * 60 * 60 * 1000); // UTC+5
  }
  private tashkentHHMM(): string {
    return this.tashkentNow().toISOString().slice(11, 16); // "HH:MM"
  }
  private tashkentDateStr(): string {
    return this.tashkentNow().toISOString().slice(0, 10); // "YYYY-MM-DD"
  }

  private dateStamp(): string {
    return this.tashkentNow().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');
  }

  private humanSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = bytes / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i++;
    }
    return `${v.toFixed(1)} ${units[i]}`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
