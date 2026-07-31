import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CounterpartiesService } from './counterparties.service';

/**
 * Avto-yangilash:
 *   Toshkent vaqti bilan har soatning 0-daqiqasida (08:00 dan 22:00 gacha).
 *   Kuniga 15 marta: 08:00, 09:00, 10:00, ..., 22:00.
 *   Tunda (22:00–08:00) — tinch.
 */
@Injectable()
export class CounterpartiesCron {
  private readonly log = new Logger(CounterpartiesCron.name);

  constructor(private svc: CounterpartiesService) {}

  @Cron('0 8-22 * * *', { name: 'counterparties-refresh', timeZone: 'Asia/Tashkent' })
  async refreshHourly() {
    // FIX (A5): butun cron try/catch — sozlama o'qish yoki refreshAll xatosi unhandled rejection bo'lmasin.
    try {
      const enabled = await this.svc.isAutoRefreshEnabled();
      if (!enabled) {
        this.log.log('Cron: kontragentlarni yangilash O\'CHIRILGAN (settings) — skip');
        return;
      }
      this.log.log('Cron: kontragentlarni yangilash boshlandi');
      // refreshAll background'da — xatoni yutmay logga yozamiz
      Promise.resolve(this.svc.refreshAll()).catch((e: any) => this.log.warn(`refreshAll xato: ${e?.message}`));
    } catch (e: any) {
      this.log.warn(`counterparties refreshHourly cron xato: ${e?.message}`);
    }
  }

  /**
   * Xontaminot cron — har 5 daqiqada tekshiradi, sozlamalardagi
   * interval/soat oraliqlariga ko'ra ishga tushadi yoki o'tkazib yuboradi.
   */
  @Cron('*/5 * * * *', { name: 'counterparties-xontaminot-sync', timeZone: 'Asia/Tashkent' })
  async xontaminotSyncTick() {
    try {
      const shouldRun = await this.svc.shouldRunXontaminotCron();
      if (!shouldRun) return;
      this.log.log('Xontaminot cron: sync boshlanmoqda');
      await this.svc.syncFromXontaminot({ id: null, name: 'cron' });
    } catch (e: any) {
      this.log.error(`Xontaminot cron xato: ${e?.message}`);
    }
  }
}
