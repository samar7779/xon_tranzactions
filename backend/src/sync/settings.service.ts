import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Umumiy key/value sozlamalar uchun service.
 *
 * Hozir asosiy ishlatuvchi — sync (syncMinDate). Kelajakda boshqa sozlamalar
 * ham shu yerga qo'shilishi mumkin.
 */
@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string | null, updatedBy?: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value, updatedBy },
      update: { value, updatedBy },
    });
  }

  /**
   * Sync minimal sanasi (ISO yoki YYYY-MM-DD). Bu sanadan oldingi tranzaksiyalar
   * sync orqali olinmaydi. Foydalanuvchi qo'lda import qilgan tarixiy
   * ma'lumotlarni himoya qilish uchun.
   */
  async getSyncMinDate(): Promise<Date | null> {
    const s = await this.get('sync.minDate');
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  async setSyncMinDate(value: string | null, updatedBy?: string): Promise<void> {
    if (value) {
      const d = new Date(value);
      if (isNaN(d.getTime())) throw new Error(`Noto'g'ri sana: ${value}`);
    }
    await this.set('sync.minDate', value, updatedBy);
  }

  /**
   * OplatyKv tranzaksiyadan auto-import minimal sanasi.
   * Bu sanadan keyingi (kiritilgan sanadan yangi) tranzaksiyalar OplatyKv'ga
   * avtomatik qo'shiladi (CLIENT kategoriya, IN direction).
   */
  async getOplatyKvTxMinDate(): Promise<Date | null> {
    const s = await this.get('oplatykv.txMinDate');
    if (!s) return null;
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }

  async setOplatyKvTxMinDate(value: string | null, updatedBy?: string): Promise<void> {
    if (value) {
      const d = new Date(value);
      if (isNaN(d.getTime())) throw new Error(`Noto'g'ri sana: ${value}`);
    }
    await this.set('oplatykv.txMinDate', value, updatedBy);
  }

  /**
   * OplatyKv auto-sync interval daqiqada.
   * 0 yoki null -> auto-sync o'chirilgan.
   * Misol: 30 -> har 30 daqiqada bir marta avtomatik sync.
   */
  async getOplatyKvAutoSyncMinutes(): Promise<number> {
    const s = await this.get('oplatykv.txAutoSyncMinutes');
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async setOplatyKvAutoSyncMinutes(value: number | null, updatedBy?: string): Promise<void> {
    const v = value && value > 0 ? String(Math.floor(value)) : null;
    await this.set('oplatykv.txAutoSyncMinutes', v, updatedBy);
  }

  /**
   * OplatyKv auto-sync vaqt sozlamalari (HH:MM formatda)
   */
  private async getTimeStr(key: string, def: string): Promise<string> {
    const v = await this.get(key);
    if (v && /^\d{1,2}:\d{2}$/.test(v)) return v;
    return def;
  }
  async getOplatyKvDayStart(): Promise<string>   { return this.getTimeStr('oplatykv.dayStart',   '08:00'); }
  async getOplatyKvDayEnd():   Promise<string>   { return this.getTimeStr('oplatykv.dayEnd',     '22:00'); }
  async getOplatyKvNightStart(): Promise<string> { return this.getTimeStr('oplatykv.nightStart', '01:00'); }
  async getOplatyKvNightEnd():   Promise<string> { return this.getTimeStr('oplatykv.nightEnd',   '07:50'); }
  async setOplatyKvTimeWindows(vals: { dayStart?: string; dayEnd?: string; nightStart?: string; nightEnd?: string }, updatedBy?: string) {
    const validate = (s?: string) => {
      if (!s) return null;
      if (!/^\d{1,2}:\d{2}$/.test(s)) throw new Error(`Noto'g'ri vaqt format (HH:MM): ${s}`);
      return s;
    };
    if (vals.dayStart   !== undefined) await this.set('oplatykv.dayStart',   validate(vals.dayStart),   updatedBy);
    if (vals.dayEnd     !== undefined) await this.set('oplatykv.dayEnd',     validate(vals.dayEnd),     updatedBy);
    if (vals.nightStart !== undefined) await this.set('oplatykv.nightStart', validate(vals.nightStart), updatedBy);
    if (vals.nightEnd   !== undefined) await this.set('oplatykv.nightEnd',   validate(vals.nightEnd),   updatedBy);
  }

  /**
   * Auto XATO cleanup — sync ichida CRM da topilmaganlarni avtomatik o'chirish
   */
  async getOplatyKvAutoXatoCleanup(): Promise<boolean> {
    const v = await this.get('oplatykv.autoXatoCleanup');
    return v === '1' || v === 'true';
  }
  async setOplatyKvAutoXatoCleanup(value: boolean, updatedBy?: string): Promise<void> {
    await this.set('oplatykv.autoXatoCleanup', value ? '1' : null, updatedBy);
  }

  /**
   * Bulk sync rejasi — barcha hisoblar bo'yicha orqa sanaga sync'ni avtomatik
   * ravishda ishga tushirish.
   *   enabled       — yoqilgan/o'chirilgan
   *   intervalDays  — har necha kunda (1..365)
   *   timeOfDay     — Tashkent vaqti "HH:MM" (masalan "18:00")
   *   daysBack      — har ishga tushganda necha kun orqaga sync qiladi
   *                  (default: intervalDays + 1, lekin minimum 2)
   *   lastRunAt     — oxirgi marotaba ishga tushgan vaqt (ISO)
   */
  async getBulkSyncSchedule(): Promise<{
    enabled: boolean;
    intervalDays: number;
    timeOfDay: string;
    daysBack: number | null;
    lastRunAt: string | null;
  }> {
    const [enabled, interval, time, daysBack, lastRun] = await Promise.all([
      this.get('bulkSync.enabled'),
      this.get('bulkSync.intervalDays'),
      this.get('bulkSync.timeOfDay'),
      this.get('bulkSync.daysBack'),
      this.get('bulkSync.lastRunAt'),
    ]);
    const intervalN = Math.max(1, Math.min(365, Number(interval) || 1));
    const dbN = daysBack ? Math.max(1, Math.min(365, Number(daysBack))) : null;
    return {
      enabled: enabled === '1',
      intervalDays: intervalN,
      timeOfDay: time && /^\d{1,2}:\d{2}$/.test(time) ? time : '18:00',
      daysBack: dbN,
      lastRunAt: lastRun,
    };
  }

  async setBulkSyncSchedule(
    vals: { enabled?: boolean; intervalDays?: number; timeOfDay?: string; daysBack?: number | null },
    updatedBy?: string,
  ): Promise<void> {
    if (vals.enabled !== undefined) {
      await this.set('bulkSync.enabled', vals.enabled ? '1' : null, updatedBy);
    }
    if (vals.intervalDays !== undefined) {
      const n = Math.max(1, Math.min(365, Math.floor(vals.intervalDays)));
      await this.set('bulkSync.intervalDays', String(n), updatedBy);
    }
    if (vals.timeOfDay !== undefined) {
      if (vals.timeOfDay && !/^\d{1,2}:\d{2}$/.test(vals.timeOfDay)) {
        throw new Error(`Noto'g'ri vaqt format (HH:MM): ${vals.timeOfDay}`);
      }
      await this.set('bulkSync.timeOfDay', vals.timeOfDay || null, updatedBy);
    }
    if (vals.daysBack !== undefined) {
      const v = vals.daysBack && vals.daysBack > 0
        ? String(Math.max(1, Math.min(365, Math.floor(vals.daysBack))))
        : null;
      await this.set('bulkSync.daysBack', v, updatedBy);
    }
  }

  async setBulkSyncLastRunAt(iso: string): Promise<void> {
    await this.set('bulkSync.lastRunAt', iso, 'system');
  }
}
