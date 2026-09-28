import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../common/prisma/prisma.service';
import { LeaderConfigService } from './leader-config.service';
import { LeaderHealthService } from './leader-health.service';
import { LeaderTelegramApi } from './leader-telegram.api';
import { CheckResult } from './leader.types';

/**
 * Checker alertlari — har 15 daqiqada deterministik tekshiruv (LLM'siz), faqat CRITICAL egasiga ketadi.
 *
 *  - Bir key uchun oxirgi 4 soatda critical yuborilgan bo'lsa — jim (faqat uzluksiz muammo uchun:
 *    orada "Tiklandi" yuborilgan bo'lsa, qaytalangan critical darhol yuboriladi).
 *  - Oldin yuborilgan critical'dan keyin 'ok' bo'lsa — bitta "Tiklandi" xabari.
 *  - sent=true faqat Telegram haqiqatan yetkazganda (aks holda keyingi tsiklda qayta urinadi).
 *  - Xabar qisqa, faqat fakt: taklif/savol YO'Q.
 *  - Boot'dan keyingi 10 daqiqa alert yo'q (restart shovqini: RUNNING/orphan qatorlar, API qayta ko'tarilishi).
 *  - LeaderAlert'ga faqat level o'zgarganda yoki xabar yuborilganda yoziladi (jadval shishmasin).
 */

const BOOT_GRACE_MS = 10 * 60_000;
const RESEND_AFTER_MS = 4 * 60 * 60_000;
const TZ_MS = 5 * 60 * 60 * 1000;
/** Kunlik holatli tekshiruvlar: kun almashganda 'ok' bo'lishi tiklanish emas — "Tiklandi" yuborilmaydi. */
const DAY_SCOPED_KEYS = new Set(['sverka']);

function tkDay(d: Date): string {
  return new Date(d.getTime() + TZ_MS).toISOString().slice(0, 10);
}
function esc(s: any): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

interface AlertPlan {
  r: CheckResult;
  /** Oxirgi yozilgan level'dan farq qiladi. */
  changed: boolean;
  /** Critical xabar yuborilsin. */
  alert: boolean;
  /** "Tiklandi" xabari yuborilsin. */
  recover: boolean;
}

@Injectable()
export class LeaderAlertService {
  private readonly log = new Logger(LeaderAlertService.name);
  private readonly bootAt = Date.now();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: LeaderConfigService,
    private readonly health: LeaderHealthService,
    private readonly tg: LeaderTelegramApi,
  ) {}

  @Cron('*/15 * * * *', { name: 'leaderAlerts', timeZone: 'Asia/Tashkent' })
  async tick(): Promise<void> {
    if (!this.config.enabled() || !this.config.alertsEnabled()) return;
    if (Date.now() - this.bootAt < BOOT_GRACE_MS) return;
    if (this.running) {
      this.log.warn("leaderAlerts: oldingi run hali tugamadi — o'tkazib yuborildi");
      return;
    }
    this.running = true;
    try {
      await this.runOnce();
    } catch (e: any) {
      this.log.warn(`leaderAlerts xato: ${e?.message}`);
    } finally {
      this.running = false;
    }
  }

  /** Bitta tsikl: tekshir -> reja -> (bitta) xabar -> LeaderAlert yozuvlari. */
  async runOnce(now: Date = new Date()): Promise<{ sent: boolean; critical: string[]; recovered: string[] }> {
    const results = await this.health.runAll();
    const plans = await Promise.all(results.map((r) => this.plan(r, now)));
    const toAlert = plans.filter((p) => p.alert).map((p) => p.r);
    const toRecover = plans.filter((p) => p.recover).map((p) => p.r);

    let sent = false;
    if (toAlert.length || toRecover.length) {
      const keys = `critical=[${toAlert.map((r) => r.key).join(',')}] tiklandi=[${toRecover.map((r) => r.key).join(',')}]`;
      try {
        sent = (await this.tg.sendToOwners(this.render(toAlert, toRecover))) === true;
      } catch (e: any) {
        this.log.warn(`Alert yuborilmadi: ${e?.message}`);
      }
      if (sent) this.log.log(`Alert yuborildi: ${keys}`);
      else this.log.warn(`Alert yetkazilmadi (keyingi tsiklda qayta urinadi): ${keys}`);
    }

    const rows: Array<{ checkKey: string; level: string; message: string; sent: boolean }> = [];
    for (const p of plans) {
      const wasSent = sent && (p.alert || p.recover);
      // "Tiklandi" yuborilmagan bo'lsa ok qatorini yozmaymiz — keyingi tsiklda qayta urinadi
      if (p.recover && !sent) continue;
      if (!wasSent && !p.changed) continue;
      rows.push({
        checkKey: p.r.key.slice(0, 64),
        level: p.r.level,
        message: `${p.r.title}: ${p.r.summary}`.slice(0, 1000),
        sent: wasSent,
      });
    }
    if (rows.length) {
      try {
        await this.prisma.leaderAlert.createMany({ data: rows });
      } catch (e: any) {
        this.log.warn(`LeaderAlert yozilmadi: ${e?.message}`);
      }
    }
    return { sent, critical: toAlert.map((r) => r.key), recovered: toRecover.map((r) => r.key) };
  }

  private async plan(r: CheckResult, now: Date): Promise<AlertPlan> {
    const key = r.key;
    const last = await this.prisma.leaderAlert.findFirst({
      where: { checkKey: key },
      orderBy: { createdAt: 'desc' },
      select: { level: true },
    });
    const changed = !last || last.level !== r.level;
    let alert = false;
    let recover = false;

    if (r.level === 'critical') {
      const recentSent = await this.prisma.leaderAlert.findFirst({
        where: { checkKey: key, level: 'critical', sent: true, createdAt: { gte: new Date(now.getTime() - RESEND_AFTER_MS) } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      let throttled = !!recentSent;
      if (recentSent) {
        // Orada "Tiklandi" yuborilgan bo'lsa — bu yangi muammo, 4 soat kutilmaydi
        const recoveredAfter = await this.prisma.leaderAlert.findFirst({
          where: { checkKey: key, level: 'ok', sent: true, createdAt: { gt: recentSent.createdAt } },
          select: { id: true },
        });
        if (recoveredAfter) throttled = false;
      }
      alert = !throttled;
    } else if (r.level === 'ok' && changed) {
      const lastSentCrit = await this.prisma.leaderAlert.findFirst({
        where: { checkKey: key, level: 'critical', sent: true },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      if (lastSentCrit) {
        const okAfter = await this.prisma.leaderAlert.findFirst({
          where: { checkKey: key, level: 'ok', createdAt: { gt: lastSentCrit.createdAt } },
          select: { id: true },
        });
        const dayRolled = DAY_SCOPED_KEYS.has(key) && tkDay(new Date(lastSentCrit.createdAt)) !== tkDay(now);
        recover = !okAfter && !dayRolled;
      }
    }
    return { r, changed, alert, recover };
  }

  /** Deterministik, qisqa, faqat fakt (taklif/savol yo'q). */
  private render(critical: CheckResult[], recovered: CheckResult[]): string {
    const parts: string[] = [];
    if (critical.length) {
      parts.push(['<b>Diqqat shefim</b>', ...critical.map((r) => `${esc(r.title)}: ${esc(r.summary)}`)].join('\n'));
    }
    if (recovered.length) {
      parts.push(['<b>Tiklandi</b>', ...recovered.map((r) => `${esc(r.title)}: ${esc(r.summary)}`)].join('\n'));
    }
    return parts.join('\n\n');
  }
}
