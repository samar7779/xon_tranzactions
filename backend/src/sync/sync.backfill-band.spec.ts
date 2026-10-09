import { Logger } from '@nestjs/common';
import { SyncService } from './sync.service';

/**
 * 2026-10-09: backfill paytida hisob avto-sync bilan band bo'lsa syncAccount jim o'tkazib yuborardi (log yo'q) —
 * shu hisob sanalari olinmay qolardi, panel/bot jarayoni "tugamadi" bo'lib ko'rinardi. Endi qayta urinadi,
 * baribir band bo'lsa FAILED log (sababi bilan).
 */
describe('SyncService.runBackfill — band hisob', () => {
  let svc: any;
  let prisma: any;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    prisma = {
      bankAccount: { findUnique: jest.fn(async () => ({ accountNo: '20208000904900960001', ownerName: 'XON' })) },
      syncLog: { create: jest.fn(async ({ data }: any) => data) },
    };
    svc = Object.create(SyncService.prototype);
    svc.prisma = prisma;
    svc.logger = new Logger('test');
    svc.backfillBandKutishMs = 0;
    svc.backfillBandUrinish = 3;
  });
  afterEach(() => jest.restoreAllMocks());

  it('band bo\'lsa kutib qayta uradi; bo\'shasa odatdagidek', async () => {
    svc.syncAccount = jest.fn()
      .mockResolvedValueOnce({ ok: true, skipped: true })
      .mockResolvedValueOnce({ ok: true, fetched: 4, saved: 1, errors: 0 });
    await svc.runBackfill([{ id: 'a1', credentialId: 'c1' }], ['01.10.2026', '02.10.2026']);
    expect(svc.syncAccount).toHaveBeenCalledTimes(2);
    expect(svc.syncAccount).toHaveBeenLastCalledWith('c1', 'a1', { dates: ['01.10.2026', '02.10.2026'] });
    expect(prisma.syncLog.create).not.toHaveBeenCalled();
  });

  it('baribir band — FAILED log sababi bilan (panel va bot ko\'radi), keyingi hisob davom etadi', async () => {
    svc.syncAccount = jest.fn(async (_c: string, id: string) => (id === 'a1' ? { ok: true, skipped: true } : { ok: true, fetched: 1, saved: 0, errors: 0 }));
    await svc.runBackfill([{ id: 'a1', credentialId: 'c1' }, { id: 'a2', credentialId: 'c1' }], ['01.10.2026', '03.10.2026']);
    expect(svc.syncAccount).toHaveBeenCalledTimes(1 + 3 + 1);
    expect(prisma.syncLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      source: '20208000904900960001 · XON · backfill 01.10.2026–03.10.2026', accountId: 'a1', status: 'FAILED',
      errorMessage: 'Hisob boshqa sync bilan band edi — shu hisob uchun qayta yuklang',
    }) });
  });
});
