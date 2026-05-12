import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { firstValueFrom } from 'rxjs';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Server Core integratsiyasi — bank/UPC/UZCARD'dan tranzaksiyalarni
 * sync qilish. Cron orqali har N daqiqada ishlaydi.
 */
@Injectable()
export class ServerCoreService {
  private readonly logger = new Logger(ServerCoreService.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;

  constructor(
    private http: HttpService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.baseUrl = this.config.get<string>('TXN_CORE_URL', '');
    this.token = this.config.get<string>('TXN_CORE_TOKEN', '');
    this.timeoutMs = this.config.get<number>('TXN_CORE_TIMEOUT_MS', 15000);
  }

  /**
   * Har 5 daqiqada (default) bank'dan tranzaksiyalar olish.
   * Cron .env TXN_SYNC_CRON orqali sozlanadi.
   */
  @Cron(process.env.TXN_SYNC_CRON || '*/5 * * * *')
  async syncFromCore() {
    if (!this.baseUrl) {
      this.logger.warn('TXN_CORE_URL sozlanmagan — sync o\'tkazib yuborildi');
      return;
    }
    const log = await this.prisma.syncLog.create({
      data: { source: 'CORE', status: 'RUNNING' },
    });
    const t0 = Date.now();
    try {
      const headers: any = {};
      if (this.token) headers.Authorization = `Bearer ${this.token}`;
      const resp = await firstValueFrom(
        this.http.get(`${this.baseUrl}/transactions/latest`, {
          headers,
          timeout: this.timeoutMs,
        }),
      );
      const items = resp.data?.items || resp.data?.data || resp.data || [];
      const saved = await this.upsertBatch(items);
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: saved > 0 ? 'SUCCESS' : 'SUCCESS',
          fetched: items.length,
          saved,
          finishedAt: new Date(),
          durationMs: Date.now() - t0,
        },
      });
      this.logger.log(`✓ Sync: ${items.length} kelgan, ${saved} saqlandi`);
    } catch (e: any) {
      const msg = e?.message?.slice(0, 500) || 'unknown';
      await this.prisma.syncLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          errorMessage: msg,
          finishedAt: new Date(),
          durationMs: Date.now() - t0,
        },
      });
      this.logger.error(`✗ Sync xato: ${msg}`);
    }
  }

  /**
   * Server core'dan kelgan ma'lumotlarni DB'ga upsert qilish.
   * externalId orqali dublikat tekshiriladi.
   */
  private async upsertBatch(items: any[]): Promise<number> {
    let saved = 0;
    for (const it of items) {
      try {
        const externalId = String(it.external_id || it.id);
        if (!externalId) continue;
        const exists = await this.prisma.transaction.findUnique({ where: { externalId } });
        if (exists) continue;
        await this.prisma.transaction.create({
          data: {
            externalId,
            type: it.type || 'OTHER',
            status: it.status || 'COMPLETED',
            direction: it.direction || (Number(it.amount) > 0 ? 'IN' : 'OUT'),
            amount: Math.abs(Number(it.amount) || 0),
            currency: it.currency || 'UZS',
            fromAccount: it.from_account || null,
            fromName: it.from_name || null,
            toAccount: it.to_account || null,
            toName: it.to_name || null,
            description: it.description || null,
            reference: it.reference || null,
            metadata: it,
            txnDate: it.txn_date ? new Date(it.txn_date) : new Date(),
          },
        });
        saved++;
      } catch (e: any) {
        this.logger.warn(`Upsert xato (${it?.id}): ${e?.message?.slice(0, 100)}`);
      }
    }
    return saved;
  }
}
