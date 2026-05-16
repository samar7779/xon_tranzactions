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
    this.log.log('Cron boshlandi: kontragentlarni DIDOX\'dan yangilash');
    try {
      const r = await this.svc.refreshAll();
      this.log.log(`Cron tugadi: ${r.updated}/${r.total} yangilandi (${r.failed} xato)`);
    } catch (e: any) {
      this.log.error(`Cron xatosi: ${e?.message || e}`);
    }
  }
}
