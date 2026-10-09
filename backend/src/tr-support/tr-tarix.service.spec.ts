import { BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { TrTarixService } from './tr-tarix.service';

const flush = () => new Promise((r) => setImmediate(r));

describe('TrTarixService (eski tarixni yuklash, bot orqali)', () => {
  let prisma: any;
  let sync: { resolveBackfillTargets: jest.Mock; runBackfill: jest.Mock };
  let oplataKv: { syncNowRespectingSettings: jest.Mock };
  let svc: TrTarixService;
  const BANKS = [
    { id: 'b1', name: 'Kapitalbank', code: 'KAPITALBANK' },
    { id: 'b2', name: "Ipak Yo'li bank", code: 'IPAK_YOLI' },
    { id: 'b3', name: 'Hamkorbank', code: 'HAMKORBANK' },
  ];

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-09T06:00:00Z').getTime());   // Toshkent 11:00
    prisma = {
      syncLog: {
        findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []),
        aggregate: jest.fn(async () => ({ _sum: { saved: 7 } })),
      },
      bankAccount: { findFirst: jest.fn(async () => null) },
      bank: {
        findMany: jest.fn(async ({ where }: any) => {
          if (!where) return BANKS.map((b) => ({ name: b.name }));
          const q = String(where.OR[0].code.equals).toLowerCase();
          return BANKS.filter((b) => b.code.toLowerCase() === q || b.name.toLowerCase().includes(q));
        }),
      },
    };
    sync = {
      resolveBackfillTargets: jest.fn(async () => ({
        accounts: [{ id: 'a1', credentialId: 'c1' }, { id: 'a2', credentialId: 'c1' }],
        dates: ['01.10.2026', '02.10.2026', '03.10.2026'], syncMinDate: null, originalFromCount: 3, clampedCount: 0,
      })),
      runBackfill: jest.fn(async () => undefined),
    };
    oplataKv = { syncNowRespectingSettings: jest.fn(async () => ({ added: 5, updated: 1, yozilmadi: [] })) };
    svc = new TrTarixService(prisma, sync as any, oplataKv as any);
  });
  afterEach(() => jest.restoreAllMocks());

  it('bank bo\'yicha: panel bilan bir xil resolveBackfillTargets + runBackfill, keyin bitta OplatyKv sync', async () => {
    const r = await svc.boshla({ dan: '2026-10-01', gacha: '2026-10-03', bank: 'kapital' });
    expect(sync.resolveBackfillTargets).toHaveBeenCalledWith({ scope: 'bank', bankId: 'b1', accountId: undefined, dateFrom: '2026-10-01', dateTo: '2026-10-03' });
    expect(sync.runBackfill).toHaveBeenCalledWith([{ id: 'a1', credentialId: 'c1' }, { id: 'a2', credentialId: 'c1' }],
      ['01.10.2026', '02.10.2026', '03.10.2026']);
    expect(r).toMatchObject({ ok: true, qamrov: 'Kapitalbank (sync yoqilgan hisoblar)', hisoblar: 2, kunlar: 3,
      dan: '2026-10-01', gacha: '2026-10-03', ogohlantirish: null });
    await flush(); await flush();
    expect(oplataKv.syncNowRespectingSettings).toHaveBeenCalledWith({ id: null, name: 'TR Support · eski tarix' });
    const h = await svc.holat(r.startedAt);
    expect(h.ish).toEqual({ tugadi: true, okv: { qoshildi: 5, yangilandi: 1, yozilmadi: 0 }, okvXato: null });
  });

  it('yangi to\'lov bo\'lmasa OplatyKv sync chaqirilmaydi; restartdan keyin ish=null', async () => {
    prisma.syncLog.aggregate.mockResolvedValue({ _sum: { saved: 0 } });
    const r = await svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01' });
    await flush(); await flush();
    expect(oplataKv.syncNowRespectingSettings).not.toHaveBeenCalled();
    expect((await svc.holat(r.startedAt)).ish).toMatchObject({ tugadi: true, okv: null });
    expect((await svc.holat('2026-10-09T01:00:00.000Z')).ish).toBeNull();
  });

  it('hisob bo\'yicha va hammasi; bank topilmasa yoki aniq bo\'lmasa tushunarli xato', async () => {
    prisma.bankAccount.findFirst.mockResolvedValueOnce({ id: 'a9', accountNo: '20208000904900960001', ownerName: 'XON SAROY', bank: { name: 'Kapitalbank' } });
    let r = await svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01', hisob: '20208000904900960001' });
    expect(sync.resolveBackfillTargets).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'account', accountId: 'a9' }));
    expect(r.qamrov).toBe('20208000904900960001 — XON SAROY, Kapitalbank');
    r = await svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01' });
    expect(sync.resolveBackfillTargets).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'all' }));
    await expect(svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01', hisob: '20208000000000000000' })).rejects.toThrow('Hisob topilmadi');
    await expect(svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01', bank: 'Xalq' }))
      .rejects.toThrow("Banklar: Kapitalbank, Ipak Yo'li bank, Hamkorbank");
    await expect(svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01', bank: 'bank' })).rejects.toThrow('Bank aniq emas');
    await svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01', bank: 'hamkorbank' });          // aniq nom — bittasi
    expect(sync.resolveBackfillTargets).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'bank', bankId: 'b3' }));
  });

  it('sana tekshiruvlari; bir vaqtda bitta, lekin restartdan qolgan yetim log bloklamaydi', async () => {
    await expect(svc.boshla({ dan: '2026-10-05', gacha: '2026-10-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.boshla({ dan: '2026-10-08', gacha: '2026-10-10' })).rejects.toThrow('Kelajak');
    await expect(svc.boshla({ dan: '2026-07-01', gacha: '2026-10-01' })).rejects.toThrow("ko'pi bilan 62 kun");
    prisma.syncLog.findFirst.mockResolvedValueOnce({ source: '2020 · XON · backfill 01.10.2026–03.10.2026', startedAt: new Date('2026-10-09T05:50:00Z') });
    await expect(svc.boshla({ dan: '2026-10-01', gacha: '2026-10-01' })).rejects.toBeInstanceOf(ConflictException);
    // so'rov oynasi: faqat so'nggi 20 daqiqa (yetim RUNNING log hisobga olinmaydi)
    expect(prisma.syncLog.findFirst.mock.calls[0][0].where.startedAt.gte).toEqual(new Date('2026-10-09T05:40:00Z'));
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
      { source: '20208000205720456001 · VATAN · backfill 01.10.2026–03.10.2026', status: 'FAILED', fetched: 0, saved: 0, errors: 0, errorMessage: 'Hisob boshqa sync bilan band edi — shu hisob uchun qayta yuklang', finishedAt: new Date('2026-10-09T06:03:00Z') },
      { source: '22618000000000000001 · Z · backfill 01.10.2026–03.10.2026', status: 'RUNNING', fetched: 3, saved: 1, errors: 0, errorMessage: null, finishedAt: null },
    ]);
    const r = await svc.holat('2026-10-09T06:00:00.000Z');
    expect(r).toMatchObject({ boshlangan: 3, tugagan: 2, olindi: 43, yangi: 6, xato: 0, oxirgi: '2026-10-09T06:03:00.000Z', ish: null });
    expect(r.xatolar).toEqual([{ hisob: '20208000205720456001 · VATAN', xabar: 'Hisob boshqa sync bilan band edi — shu hisob uchun qayta yuklang' }]);
    await expect(svc.holat('bugun')).rejects.toBeInstanceOf(BadRequestException);
  });
});
