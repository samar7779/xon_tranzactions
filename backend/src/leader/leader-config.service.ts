import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { PrismaService } from '../common/prisma/prisma.service';
import { CryptoService } from '../common/crypto/crypto.service';
import { ModelKind } from './leader.types';

/**
 * Leader agentlar sozlamasi — hammasi env'dan (token faqat .env: LEADER_BOT_TOKEN).
 * AI kalit mavjud naqsh bo'yicha: Setting 'agent.aiKey' (shifrlangan) yoki env ANTHROPIC_API_KEY.
 * Kalit/token hech qachon log'ga yozilmaydi.
 */
@Injectable()
export class LeaderConfigService {
  private readonly log = new Logger(LeaderConfigService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  botToken(): string | null {
    const t = String(process.env.LEADER_BOT_TOKEN || '').trim();
    return t || null;
  }

  /** Egasi Telegram ID'lari (vergulli ro'yxat) — faqat raqamlar. */
  ownerIds(): string[] {
    return String(process.env.LEADER_OWNER_TG_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^\d{3,20}$/.test(s));
  }

  enabled(): boolean {
    return process.env.LEADER_ENABLED !== '0' && !!this.botToken() && this.ownerIds().length > 0;
  }

  alertsEnabled(): boolean {
    return process.env.LEADER_ALERTS !== '0';
  }

  model(kind: ModelKind): string {
    if (kind === 'strong') return String(process.env.LEADER_MODEL_STRONG || '').trim() || 'claude-opus-5-5';
    return String(process.env.LEADER_MODEL || '').trim() || 'claude-sonnet-5';
  }

  /** Kunlik token chegarasi (input+output, bugun Toshkent). */
  dailyTokenCap(): number {
    const n = Number(process.env.LEADER_DAILY_TOKENS);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3_000_000;
  }

  repoDir(): string {
    return process.env.LEADER_REPO_DIR || path.resolve(process.cwd(), '..');
  }

  agentsDir(): string {
    return process.env.LEADER_AGENTS_DIR || path.resolve(process.cwd(), 'agents');
  }

  /** ANTHROPIC kalit — agent.aiKey (shifrlangan) yoki env (chek-order / sverka-agent bilan bir xil). */
  async apiKey(): Promise<string | null> {
    try {
      const row = await this.prisma.setting.findUnique({ where: { key: 'agent.aiKey' } });
      if (row?.value) {
        try {
          const k = this.crypto.decrypt(row.value);
          if (k) return k;
        } catch {
          this.log.warn("agent.aiKey deshifrlanmadi — env ANTHROPIC_API_KEY ga o'tildi");
        }
      }
    } catch (e: any) {
      this.log.warn(`agent.aiKey o'qilmadi: ${e?.message}`);
    }
    return process.env.ANTHROPIC_API_KEY || null;
  }
}

// ─── Toshkent vaqti yordamchilari (UTC+5, DST yo'q) ──────────────────
const TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const WEEKDAYS = ['yakshanba', 'dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba'];

/** Toshkent bo'yicha 'YYYY-MM-DD'. */
export function tashkentDay(d: Date = new Date()): string {
  return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** Toshkent bo'yicha 'HH:MM'. */
export function tashkentTime(d: Date = new Date()): string {
  return new Date(d.getTime() + TZ_OFFSET_MS).toISOString().slice(11, 16);
}

/** 'YYYY-MM-DD HH:MM, shanba' — kontekst prefiksi uchun. */
export function tashkentStamp(d: Date = new Date()): string {
  const t = new Date(d.getTime() + TZ_OFFSET_MS);
  return `${t.toISOString().slice(0, 10)} ${t.toISOString().slice(11, 16)}, ${WEEKDAYS[t.getUTCDay()]}`;
}

/** Toshkent kuni chegaralari (UTC Date). */
export function tashkentDayRange(day: string = tashkentDay()): { from: Date; to: Date } {
  return {
    from: new Date(`${day}T00:00:00+05:00`),
    to: new Date(`${day}T23:59:59.999+05:00`),
  };
}
