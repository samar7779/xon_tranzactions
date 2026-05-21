import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Deploy webhook xizmati — xonapp/backend/deploy.py pattern'ini takrorlaydi.
 *
 * GitHub push → POST /api/_deploy → HMAC tekshir → git pull → build → restart
 * → Telegram xabar.
 *
 * Build sekin (Next.js + Nest) shu sababli ish fonda bajariladi, webhook
 * darrov 200 qaytaradi. Natija Telegram'ga keladi.
 */
@Injectable()
export class DeployService {
  private readonly logger = new Logger(DeployService.name);

  private readonly repoDir: string;
  private readonly branch: string;
  private readonly secret: string;
  private readonly tgToken: string;
  private readonly tgChat: string;
  private readonly backendService: string;
  private readonly frontendService: string;
  private readonly logFile: string;

  constructor(private config: ConfigService) {
    this.repoDir = config.get<string>('DEPLOY_REPO_DIR', '/var/www/xon_tranzactions');
    this.branch = config.get<string>('DEPLOY_BRANCH', 'main');
    this.secret = config.get<string>('GH_DEPLOY_SECRET', '');
    this.tgToken = config.get<string>('TG_BOT_TOKEN', '');
    this.tgChat = config.get<string>('DEPLOY_NOTIFY_CHAT', '');
    this.backendService = config.get<string>('DEPLOY_BACKEND_SERVICE', 'xon-tranzactions-backend');
    this.frontendService = config.get<string>('DEPLOY_FRONTEND_SERVICE', 'xon-tranzactions-frontend');
    this.logFile = config.get<string>('DEPLOY_LOG', '/var/log/xon-tranzactions/deploy.log');
  }

  verifySignature(rawBody: Buffer, sigHeader?: string): boolean {
    if (!this.secret || !sigHeader || !sigHeader.startsWith('sha256=')) return false;
    const expected = 'sha256=' + crypto
      .createHmac('sha256', this.secret)
      .update(rawBody)
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigHeader));
    } catch {
      return false;
    }
  }

  /**
   * Qaysi service'larni restart qilish kerak — fayl o'zgarishlariga qarab.
   * Faqat docs → hech qaysi. Faqat frontend/ → frontend. Backend ham aralash → ikkalasi.
   */
  servicesToRestart(files: string[]): string[] {
    if (!files || files.length === 0) return [];
    let hasBackend = false;
    let hasFrontend = false;
    let hasCode = false;
    for (const f of files) {
      if (!f) continue;
      const lower = f.toLowerCase();
      if (
        lower.endsWith('.md') ||
        lower.endsWith('.txt') ||
        lower.startsWith('docs/') ||
        lower.startsWith('.github/') ||
        lower.startsWith('tz/')
      ) continue;
      hasCode = true;
      if (f.startsWith('frontend/')) hasFrontend = true;
      else if (f.startsWith('backend/')) hasBackend = true;
      else {
        // Aralash / root o'zgarishlar — ikkala service ham
        hasBackend = true;
        hasFrontend = true;
      }
    }
    if (!hasCode) return [];
    const services: string[] = [];
    if (hasBackend) services.push(this.backendService);
    if (hasFrontend) services.push(this.frontendService);
    return services;
  }

  changedFilesFromPayload(payload: any): string[] {
    const files = new Set<string>();
    for (const c of payload?.commits || []) {
      for (const k of ['added', 'modified', 'removed']) {
        for (const f of c?.[k] || []) files.add(f);
      }
    }
    return [...files].sort();
  }

  /**
   * Fonda detached process orqali deploy ishlatadi.
   * Webhook controller darrov 200 qaytaradi, deploy esa o'z holida davom etadi.
   */
  triggerAsync(opts: { pushedBranch: string; pusher: string; services: string[]; commit?: string; files?: string[] }) {
    const scriptPath = path.join(this.repoDir, 'scripts', 'deploy.sh');
    const env = {
      ...process.env,
      DEPLOY_FROM_WEBHOOK: '1',
      DEPLOY_REPO_DIR: this.repoDir,
      DEPLOY_BRANCH: this.branch,
      DEPLOY_BACKEND_SERVICE: this.backendService,
      DEPLOY_FRONTEND_SERVICE: this.frontendService,
      DEPLOY_LOG: this.logFile,
      DEPLOY_SERVICES: opts.services.join(','),
      DEPLOY_FILES: (opts.files || []).join(','),
      TG_BOT_TOKEN: this.tgToken,
      DEPLOY_NOTIFY_CHAT: this.tgChat,
      DEPLOY_PUSHER: opts.pusher || '?',
      DEPLOY_PUSHED_BRANCH: opts.pushedBranch || this.branch,
      DEPLOY_COMMIT: opts.commit || '',
    };
    // /bin/sh -c "..." orqali nohup bilan detached
    const proc = spawn('/bin/sh', ['-c', `nohup "${scriptPath}" >> "${this.logFile}" 2>&1 &`], {
      env,
      detached: true,
      stdio: 'ignore',
    });
    proc.unref();
    this.logger.log(`Deploy script fonda ishga tushdi: ${scriptPath}`);
  }

  /** /api/_deploy/health */
  health() {
    return {
      ok: true,
      branch: this.branch,
      repo: this.repoDir,
      secretConfigured: !!this.secret,
      telegramConfigured: !!this.tgToken && !!this.tgChat,
    };
  }

  async tail(lines = 200) {
    try {
      const buf = await fs.readFile(this.logFile, 'utf8');
      const all = buf.split('\n');
      return all.slice(Math.max(0, all.length - lines)).join('\n');
    } catch (e: any) {
      return `log fayli yo'q: ${this.logFile}\n(${e?.message})`;
    }
  }

  /**
   * Log'ning oxirgi yozuvlaridan deploy holatini aniqlaydi.
   * Telegram bilan ulanish bo'lmasa ham, UI shu yerdan status ola oladi.
   */
  async status() {
    try {
      const buf = await fs.readFile(this.logFile, 'utf8');
      const lines = buf.split('\n').filter((l) => l.trim());
      const last500 = lines.slice(-500);

      // Oxirgi DEPLOY START, OK yoki FAIL'ni topamiz
      let lastStart: { time: string; raw: string } | null = null;
      let lastEnd: { time: string; status: 'success' | 'failed'; message: string; raw: string } | null = null;
      let lastError: string | null = null;

      for (let i = last500.length - 1; i >= 0; i--) {
        const line = last500[i];
        if (!lastEnd) {
          const okMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*DEPLOY OK\s*·?\s*(\d+s)?/);
          if (okMatch) {
            lastEnd = { time: okMatch[1], status: 'success', message: `Tugadi ${okMatch[2] || ''}`.trim(), raw: line };
            continue;
          }
          const failMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*✗ FAIL:\s*(.+)/);
          if (failMatch) {
            lastEnd = { time: failMatch[1], status: 'failed', message: failMatch[2], raw: line };
            continue;
          }
        }
        if (!lastStart) {
          const startMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*DEPLOY START/);
          if (startMatch) {
            lastStart = { time: startMatch[1], raw: line };
            // Topdik — oxirgi start
          }
        }
        if (lastEnd && lastStart) break;
      }

      // Xato qatorni ham olamiz (TS xato bo'lsa foydali)
      if (lastEnd?.status === 'failed') {
        for (let i = last500.length - 1; i >= 0; i--) {
          const line = last500[i];
          if (/error TS\d+|Cannot find|Module not found/i.test(line)) {
            lastError = line;
            break;
          }
        }
      }

      // Joriy holat
      let state: 'idle' | 'running' | 'success' | 'failed' = 'idle';
      const startTs = lastStart ? new Date(lastStart.time).getTime() : 0;
      const endTs = lastEnd ? new Date(lastEnd.time).getTime() : 0;

      if (lastStart && startTs > endTs) {
        // Start oxirgi event — hali davom etyapti (yoki crashed)
        const age = (Date.now() - startTs) / 1000;
        if (age < 600) state = 'running';
        else state = lastEnd?.status || 'idle';
      } else if (lastEnd) {
        state = lastEnd.status;
      }

      // Joriy git HEAD
      let currentCommit = '';
      try {
        const headPath = path.join(this.repoDir, '.git/HEAD');
        const headRef = (await fs.readFile(headPath, 'utf8')).trim();
        if (headRef.startsWith('ref: ')) {
          const refPath = path.join(this.repoDir, '.git', headRef.slice(5));
          currentCommit = (await fs.readFile(refPath, 'utf8')).trim().slice(0, 8);
        } else {
          currentCommit = headRef.slice(0, 8);
        }
      } catch { /* ignore */ }

      return {
        ok: true,
        state,
        currentCommit,
        startedAt: lastStart?.time || null,
        finishedAt: lastEnd?.time || null,
        message: lastEnd?.message || null,
        error: lastError,
      };
    } catch (e: any) {
      return {
        ok: false,
        state: 'idle' as const,
        error: e?.message || 'log fayli o\'qilmadi',
      };
    }
  }
}
