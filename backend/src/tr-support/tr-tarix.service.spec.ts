import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { TrTarixService } from './tr-tarix.service';

describe('TrTarixService (eski tarixni yuklash, bot orqali)', () => {
  let prisma: any;
  let sync: { resolveBackfillTargets: jest.Mock; runBackfill: jest.Mock };
  let svc: TrTarixService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.useFakeTimers({ now: new Date('2026-10-09T06:00:00Z') });   // Toshkent 11:00
    prisma = {
      syncLog: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
      bankAccount: { findFirst: jest.fn(async () => null) },
      bank: {
        findFirst: jest.fn(async ({ where }: any) => (where.OR.some((w: any) => /kapital/i.test(w.code?.equals || w.name?.contains || ''))
          ? { id: 'b1', name: 'Kapitalbank' } : null)),
        findMany: jest.fn(async () => [{ name: 'Hamkorbank' }, { name: 'Kapitalbank' }]),
      },
    };
    sync = {
      resolveBackfillTargets: jest.fn(async (o: any) => ({
        accounts: [{ id: 'a1', credentialId: 'c1' }, { id: 'a2', credentialId: 'c1' }],
        dates: ['01.10.2026', '02.10.2026', '03.10.2026'], syncMinDate: null, originalFromCount: 3, clampedCount: 0, _o: o,
      })),
      runBackfill: jest.fn(async () => undefined),
    };
    svc = new TrTarixService(prisma, sync as any);
  });
  afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

  it('bank bo\'yicha: panel bilan bir xil resolveBackfillTargets + runBackfill (fonda)', async () => {
    const r = await svc.boshla({ dan: '2026-10-01', gacha: '2026-10-03', bank: 'kapital' });
    expect(sync.resolveBackfillTargets).toHaveBeenCalledWith({ scope: 'bank', bankId: 'b1', accountId: undefined, dateFrom: '2026-10-01', dateTo: '2026-10-03' });
    expect(sync.runBackfill).toHaveBeenCalledWith([{ id: 'a1', credentialId: 'c1' }, { id: 'a2', credentialId: 'c1' }],
      ['01.10.2026', '02.10.2026', '03.10.2026']);
    expect(r).toMatchObject({ ok: true, qamrov: 'Kapitalbank (sync yoqilgan hisoblar)', hisoblar: 2, kunlar: 3,
      dan: '2026-10-01', gacha: '2026-10-03', ogohlantirish: null });
  });

  it('hisob bo\'yicha va hammasi; topilmasa tushunarli xato', async () => {
    prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'a9', accountNo: '20208000904900960001', ownerName: 'XON SAROY', bank: { name: 'Kapitalbank' } });
    let r = await svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01', hisob: '20208000904900960001' });
    expect(sync.resolveBackfillTargets).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'account', accountId: 'a9' }));
    expect(r.qamrov).toBe('20208000904900960001 — XON SAROY, Kapitalbank');
    r = await svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01' });
    expect(sync.resolveBackfillTargets).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'all' }));
    await expect(svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01', hisob: '20208000000000000000' })).rejects.toThrow('Hisob topilmadi');
    await expect(svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01', bank: 'Ipak' })).rejects.toThrow('Banklar: Hamkorbank, Kapitalbank');
  });

  it('sana tekshiruvlari: tartib, kelajak, 62 kun; bir vaqtda bitta', async () => {
    await expect(svc.boshla({ dan: '2026-10-05', gacha: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.boshla({ dan: '2026-10-08', gacha: '2026-10-10' })).rejects.toThrow('Kelajak');
    await expect(svc.boshla({ dan: '2026-07-01', gacha: '2026-10-01' })).rejects.toThrow("ko'pi bilan 62 kun");
    prisma.syncLog.findFirst.mockResolvedValueOnce({ source: '2020... · XON · backfill 01.10.2026–03.10.2026', startedAt: new Date('2026-10-09T05:30:00Z') });
    await expect(svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01' })).rejects.toBeInstanceOf(ConflictException);
    expect(sync.runBackfill).not.toHaveBeenCalled();
  });

  it('sync chegarasi: hammasi kesilsa xato, qisman bo\'lsa ogohlantirish', async () => {
    sync.resolveBackfillTargets.mockResolvedValueOnce({ accounts: [{ id: 'a1', credentialId: 'c1' }], dates: [], syncMinDate: new Date('2026-09-01'), originalFromCount: 3, clampedCount: 3 });
    await expect(svc.boshla({ dan: '2026-08-01', gacha: '2026-08-03' })).rejects.toThrow('sync chegarasidan (2026-09-01)');
    sync.resolveBackfillTargets.mockResolvedValueOnce({ accounts: [{ id: 'a1', credentialId: 'c1' }], dates: ['01.09.2026'], syncMinDate: new Date('2026-09-01'), originalFromCount: 3, clampedCount: 2 });
    const r = await svc.boshla({ dan: '2026-08-30', gacha: '2026-09-01' });
    expect(r.ogohlantirish).toBe("Sync chegarasi (2026-09-01) tufayli 2 kun o'tkazib yuborildi");
  });

  it('holat: since dan keyingi backfill loglari jamlanadi, xatolar hisob bilan', async () => {
    prisma.syncLog.findMany.mockResolvedValue([
      { source: '20208000904900960001 · XON · backfill 01.10.2026–03.10.2026', status: 'SUCCESS', fetched: 40, saved: 5, errors: 0, errorMessage: null, finishedAt: new Date('2026-10-09T06:02:00Z') },
      { source: '20208000205720456001 · VATAN · backfill 01.10.2026–03.10.2026', status: 'FAILED', fetched: 0, saved: 0, errors: 1, errorMessage: 'Kapitalbank 401: sessiya', finishedAt: new Date('2026-10-09T06:03:00Z') },
      { source: '22618000000000000001 · Z · backfill 01.10.2026–03.10.2026', status: 'RUNNING', fetched: 3, saved: 1, errors: 0, errorMessage: null, finishedAt: null },
    ]);
    const r = await svc.holat('2026-10-09T06:00:00.000Z');
    expect(r).toMatchObject({ boshlangan: 3, tugagan: 2, olindi: 43, yangi: 6, xato: 1, oxirgi: '2026-10-09T06:03:00.000Z' });
    expect(r.xatolar).toEqual([{ hisob: '20208000205720456001 · VATAN', xabar: 'Kapitalbank 401: sessiya' }]);
    await expect(svc.holat('bugun')).rejects.toBeInstanceOf(BadRequestException);
  });
});
