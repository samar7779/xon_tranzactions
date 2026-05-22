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
 * → Telegram xabar (yoki UI badge orqali GET /api/_deploy/status).
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
   * Har faza uchun taxminiy davomiylik (sekund) — real deploylar o'rta hisobi.
   * Eslatma: frontend build eng o'zgaruvchan — cache holatiga qarab 60-300s bo'lishi mumkin.
   */
  private readonly PHASE_DURATIONS: Record<string, number> = {
    'git fetch': 3,
    'git reset': 1,
    'git reset --hard origin/main': 1,
    'backend npm ci': 30,
    'backend prisma generate': 3,
    'backend prisma db push': 3,
    'backend prisma migrate deploy': 5,
    'backend prisma seed': 5,
    'backend build': 15,
    'frontend npm ci': 60,
    'frontend build': 180,
    'frontend build (→ .next-build)': 180,
    "frontend .next almashtirildi": 1,
    'restart xon-tranzactions-frontend': 3,
    'restart xon-tranzactions-backend': 1,
  };

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
      let lastStart: { time: string; raw: string; idx: number } | null = null;
      let lastEnd: { time: string; status: 'success' | 'failed'; message: string; raw: string; idx: number } | null = null;
      let lastError: string | null = null;

      for (let i = last500.length - 1; i >= 0; i--) {
        const line = last500[i];
        if (!lastEnd) {
          const okMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*DEPLOY OK\s*·?\s*(\d+s)?/);
          if (okMatch) {
            lastEnd = { time: okMatch[1], status: 'success', message: `Tugadi ${okMatch[2] || ''}`.trim(), raw: line, idx: i };
            continue;
          }
          const failMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*✗ FAIL:\s*(.+)/);
          if (failMatch) {
            lastEnd = { time: failMatch[1], status: 'failed', message: failMatch[2], raw: line, idx: i };
            continue;
          }
        }
        if (!lastStart) {
          const startMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*DEPLOY START/);
          if (startMatch) {
            lastStart = { time: startMatch[1], raw: line, idx: i };
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
        const age = (Date.now() - startTs) / 1000;
        if (age < 600) state = 'running';
        else state = lastEnd?.status || 'idle';
      } else if (lastEnd) {
        state = lastEnd.status;
      }

      // ─── Faza va progress (running state uchun) ───
      let currentPhase: string | null = null;
      let completedPhases: string[] = [];
      let elapsedSeconds = 0;
      let estimatedRemainingSeconds: number | null = null;
      let progressPercent: number | null = null;

      if (state === 'running' && lastStart) {
        elapsedSeconds = Math.round((Date.now() - startTs) / 1000);

        // START dan keyingi qatorlarni tahlil qilamiz
        const afterStart = last500.slice(lastStart.idx + 1);
        for (const line of afterStart) {
          // "→ <phase>" — yangi faza boshlandi
          const startPhase = line.match(/\[deploy\]\s*→\s*(.+?)(?:\s*$|\s*\(.*\))/);
          if (startPhase) currentPhase = startPhase[1].trim();
          // "✓ <phase>" — faza tugadi
          const donePhase = line.match(/\[deploy\]\s*✓\s*(.+?)(?:\s*$|\s*\(.*\))/);
          if (donePhase) {
            const ph = donePhase[1].trim();
            completedPhases.push(ph);
            if (currentPhase === ph) currentPhase = null;
          }
        }

        // ─ Estimation (yangi mantiq) ─
        // Qolgan fazalar = barcha fazalardan completed va current'ni chiqarib tashlash
        const completedSet = new Set(completedPhases);
        const allPhases = Object.keys(this.PHASE_DURATIONS);
        const remainingPhases = allPhases.filter(
          (p) => !completedSet.has(p) && p !== currentPhase,
        );
        const remainingPhasesDuration = remainingPhases.reduce(
          (s, p) => s + (this.PHASE_DURATIONS[p] || 5),
          0,
        );
        // Joriy faza uchun qolgan vaqt (tugamagani uchun half'iga oid)
        const currentPhaseRemaining = currentPhase
          ? Math.max(2, Math.round((this.PHASE_DURATIONS[currentPhase] || 10) / 2))
          : 0;

        const allPhasesTotal = Object.values(this.PHASE_DURATIONS).reduce((s, v) => s + v, 0);

        // Agar elapsed barcha taxminni jiddiy oshib ketgan bo'lsa — estimate uncertain
        if (elapsedSeconds > allPhasesTotal * 1.3 && remainingPhases.length === 0 && !currentPhase) {
          // Hech qanday qolgan faza yo'q, vaqt esa ko'p o'tdi — yakunlanmoqda
          estimatedRemainingSeconds = null;
        } else if (remainingPhases.length === 0 && !currentPhase) {
          // Hammasi tugagan — kichik buffer
          estimatedRemainingSeconds = 3;
        } else {
          estimatedRemainingSeconds = remainingPhasesDuration + currentPhaseRemaining;
        }

        // Progress: tugagan fazalar soni / jami fazalar soni — yana real ko'rinishda
        // (bu raqamlar emas, faqat percent)
        const completedTime = completedPhases.reduce(
          (s, ph) => s + (this.PHASE_DURATIONS[ph] || 5),
          0,
        );
        const elapsedRatio = completedTime / Math.max(1, allPhasesTotal);
        progressPercent = Math.min(95, Math.max(2, Math.round(elapsedRatio * 100)));
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
        // Running state uchun qoshimcha
        currentPhase,
        completedPhases,
        elapsedSeconds,
        estimatedRemainingSeconds,
        progressPercent,
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
