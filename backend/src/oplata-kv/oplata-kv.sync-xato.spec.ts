import { Logger } from '@nestjs/common';
import { OplataKvService } from './oplata-kv.service';

/**
 * 2026-10-07: 34 ta CLIENT to'lov OplatyKv'ga tushmagan — createMany paketi bitta buzuq qator tufayli butunlay
 * yiqilardi (va skipDuplicates band ID'li qatorni jimgina tashlardi). Endi: paket yiqilsa qatorma-qator,
 * yozilmaganlar sabab bilan (`yozilmadi`) va settings 'oplatykv.syncXatolar' ga (bot o'qiydi).
 */
const tx = (id: string, contract: string, extra: any = {}) => ({
  id: `c_${id}`, externalId: id, txnDate: new Date('2026-10-07T04:00:00Z'), amount: '1000000', direction: 'IN',
  contractNumber: contract, isContractManual: false, description: 'oplata', fromName: 'MIJOZ', toName: 'XON',
  subcategory: { name: 'Взносы за квартиры' }, ...extra,
});

describe('OplataKvService.syncFromTransactions — yozilmagan to\'lovlar sababi bilan', () => {
  let prisma: any;
  let settings: { get: jest.Mock; set: jest.Mock };
  let svc: OplataKvService;
  const oldFill = (OplataKvService as any).fillingInProgress;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    (OplataKvService as any).fillingInProgress = true;          // fon fill/split ishga tushmasin
    prisma = {
      transaction: { findMany: jest.fn() },
      crmContract: { findMany: jest.fn(async () => []) },
      oplataKvObjectMapping: { findMany: jest.fn(async () => []) },
      oplataKv: { findMany: jest.fn(async () => []), createMany: jest.fn(), create: jest.fn(), update: jest.fn() },
      oplataKvHistory: { createMany: jest.fn(async () => ({ count: 0 })), create: jest.fn() },
    };
    settings = { get: jest.fn(async () => null), set: jest.fn(async () => undefined) };
    svc = new OplataKvService(prisma, {} as any, {} as any, settings as any, { get: () => undefined } as any,
      {} as any, {} as any, {} as any);
    jest.spyOn(svc as any, 'cleanupSplitsForXatoContracts').mockResolvedValue(0);
  });
  afterEach(() => {
    (OplataKvService as any).fillingInProgress = oldFill;
    jest.restoreAllMocks();
  });

  it('paket yiqilsa qatorma-qator: buzuq qator sabab bilan qoladi, qolganlari yoziladi; uzun shartnoma oldindan', async () => {
    const uzun = '1234ZUR24AB'.padEnd(60, 'X');
    prisma.transaction.findMany.mockResolvedValue([tx('A', '100ZUR24AA'), tx('B', '200ZUR24BB'), tx('C', uzun), tx('D', '300ZUR24DD')]);
    prisma.oplataKv.createMany.mockRejectedValue(Object.assign(new Error('Unique constraint failed on the fields: (`id`)'),
      { code: 'P2002', meta: { target: ['id'] } }));
    prisma.oplataKv.create.mockImplementation(async ({ data }: any) => {
      if (data.sourceTxId === 'B') throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002', meta: { target: ['id'] } });
      return data;
    });
    const r: any = await svc.syncFromTransactions({ limit: 1000, actor: { id: null, name: 'cron · day' } });
    expect(r.added).toBe(2);
    expect(prisma.oplataKv.create.mock.calls.map((c: any) => c[0].data.sourceTxId)).toEqual(['A', 'B', 'D']);  // C oldindan
    expect(r.yozilmadi).toEqual([
      { tx: 'C', shartnoma: uzun, sabab: "shartnoma raqami 50 belgidan uzun (60 belgi)" },
      { tx: 'B', shartnoma: '200ZUR24BB', sabab: expect.stringContaining("OplatyKv'da shu ID bilan qator allaqachon bor") },
    ]);
    // tarix faqat yozilganlar uchun
    expect(prisma.oplataKvHistory.createMany.mock.calls[0][0].data.map((h: any) => h.oplataKvId)).toEqual(['A', 'D']);
    // bot uchun saqlandi
    const [key, val] = settings.set.mock.calls[0];
    expect(key).toBe('oplatykv.syncXatolar');
    expect(JSON.parse(val)).toMatchObject({ soni: 2, actor: 'cron · day', namunalar: [{ tx: 'C' }, { tx: 'B' }] });
  });

  it('skipDuplicates jimgina tashlagan qator ham ko\'rinadi; ustun uzunligi xatosi tushunarli sabab', async () => {
    prisma.transaction.findMany.mockResolvedValue([tx('A', '100ZUR24AA'), tx('B', '200ZUR24BB')]);
    prisma.oplataKv.createMany.mockResolvedValue({ count: 1 });
    prisma.oplataKv.findMany
      .mockResolvedValueOnce([])                                   // mavjud qatorlar
      .mockResolvedValueOnce([{ sourceTxId: 'A' }]);               // yozilgandan keyin: B yo'q
    const r: any = await svc.syncFromTransactions({});
    expect(r.added).toBe(1);
    expect(r.yozilmadi).toEqual([{ tx: 'B', shartnoma: '200ZUR24BB', sabab: expect.stringContaining('ID (B) bilan boshqa qator bor') }]);
    expect(OplataKvService.syncXatoSababi({ code: 'P2000', meta: { column_name: 'contract_no' } }))
      .toBe('shartnoma raqami (50 belgigacha) uchun qiymat juda uzun');
    expect(OplataKvService.syncXatoSababi(new Error('boshqa'))).toBe('boshqa');
  });

  it('hammasi yozilsa eski xato yozuvi tozalanadi; mijoz nomi 255 belgidan kesiladi', async () => {
    settings.get.mockResolvedValue('{"soni":2}');
    prisma.transaction.findMany.mockResolvedValue([tx('A', '100ZUR24AA', { fromName: 'N'.repeat(300) })]);
    prisma.oplataKv.createMany.mockResolvedValue({ count: 1 });
    prisma.oplataKv.findMany.mockResolvedValue([]);
    const r: any = await svc.syncFromTransactions({});
    expect(r.yozilmadi).toEqual([]);
    expect(prisma.oplataKv.createMany.mock.calls[0][0].data[0].client).toHaveLength(255);
    expect(settings.set).toHaveBeenCalledWith('oplatykv.syncXatolar', null, expect.any(String));
  });
});
