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
}
