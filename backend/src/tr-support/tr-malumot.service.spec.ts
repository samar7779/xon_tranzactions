import { Logger } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { TrMalumotService } from './tr-malumot.service';

const ACC = '20208000904900960001';

describe('TrMalumotService', () => {
  let prisma: any;
  let oplataKv: { getXatoListForAgent: jest.Mock };
  let correction: { pendingInfoByOplataKvId: jest.Mock; rejectedOplataKvIds: jest.Mock };
  let svc: TrMalumotService;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    prisma = {
      bankAccount: { findMany: jest.fn(async () => []) },
      counterparty: { findMany: jest.fn(async () => []) },
      setting: { findUnique: jest.fn(async () => ({ value: '2026-07-01' })) },
      $queryRaw: jest.fn(async () => []),
    };
    oplataKv = { getXatoListForAgent: jest.fn(async () => ({ rows: [], count: 0 })) };
    correction = { pendingInfoByOplataKvId: jest.fn(async () => new Map()), rejectedOplataKvIds: jest.fn(async () => new Set()) };
    svc = new TrMalumotService(prisma, oplataKv as any, correction as any);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('hisob', () => {
    it('to\'lovlardagi nom/MFO/INN chastota bo\'yicha, ikki tomon jamisi, shartnomalar, korxona, valyuta', async () => {
      const sql = (s: TemplateStringsArray) => s.join('?');
      prisma.$queryRaw.mockImplementation(async (s: TemplateStringsArray) => {
        const q = sql(s);
        if (q.includes('GROUP BY 1')) {
          return [{ jonatuvchi: true, soni: 15, summa: '293188000', birinchi: new Date('2026-05-04'), oxirgi: new Date('2026-10-02') }];
        }
        if (q.includes('counterparties')) return [{ id: 'cp1' }];
        return [
          { id: 't2', external_id: 'G2_X', txn_date: new Date('2026-10-02T06:00:00Z'), amount: '9942000', yon: 'IN', contract_number: '2118MSO252POT',
            jonatuvchi: true, from_name: 'XODJIMURATOV SIROJIDDIN', from_mfo: '01158', from_inn: '512345678901234', to_name: 'XON SAROY', izoh: 'oplata' },
          { id: 't1', external_id: 'G1_X', txn_date: new Date('2026-08-26T06:00:00Z'), amount: '9942000', yon: 'IN', contract_number: '2118MSO252P',
            jonatuvchi: true, from_name: 'XODJIMURATOV SIROJIDDIN', from_mfo: '01158', from_inn: '512345678901234', to_name: 'XON SAROY', izoh: 'oplata' },
          { id: 't0', external_id: null, txn_date: new Date('2026-05-04T06:00:00Z'), amount: '154000000', yon: 'IN', contract_number: '2118MSO252P',
            jonatuvchi: true, from_name: 'XODJIMURATOV S', from_mfo: '01158', from_inn: '512345678901234', to_name: 'XON SAROY', izoh: null },
        ];
      });
      prisma.counterparty.findMany.mockResolvedValue([{
        inn: '512345678901234', name: 'Xodjimuratov', fullName: 'XODJIMURATOV SIROJIDDIN NURILLO O\'G\'LI', director: null, phone: '+998901234567',
        address: 'Toshkent', vatStatus: null, oked: null, registrationDate: null, isActive: true,
        bankAccounts: [{ account: ACC, mfo: '01158', bankName: 'KAPITALBANK' }],
      }]);
      const r = await svc.hisob(ACC);
      expect(r).toMatchObject({ ok: true, hisob: ACC, balansKod: '20208', valyuta: 'UZS', bizniki: [], topildi: true, kesilgan: false });
      expect(r.nomlar[0]).toMatchObject({ nom: 'XODJIMURATOV SIROJIDDIN', mfo: '01158', inn: '512345678901234', soni: 2 });
      expect(r.nomlar[0].bankNomi).toContain('КАПИТАЛБАНК');                       // MFO ma'lumotnomasi
      expect(r.jonatuvchi).toMatchObject({ soni: 15, summa: 293188000 });
      expect(r.qabulQiluvchi).toMatchObject({ soni: 0, summa: 0 });
      expect(r.shartnomalar).toEqual([{ shartnoma: '2118MSO252P', soni: 2 }, { shartnoma: '2118MSO252POT', soni: 1 }]);
      expect(r.oxirgi[0]).toMatchObject({ id: 'G2_X', summa: 9942000, jonatuvchi: true, qarshi: 'XON SAROY', shartnoma: '2118MSO252POT' });
      expect(r.oxirgi[2].id).toBe('t0');                                            // external_id yo'q -> ichki id
      expect(r.korxonalar[0]).toMatchObject({ toliqNom: "XODJIMURATOV SIROJIDDIN NURILLO O'G'LI", bankNomi: 'KAPITALBANK', mfo: '01158' });
      expect(prisma.counterparty.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { OR: [{ inn: { in: ['512345678901234'] } }, { id: { in: ['cp1'] } }] } }));
    });

    it('bizning hisob: bank, MFO, egasi; hech narsa topilmasa topildi=false', async () => {
      prisma.bankAccount.findMany.mockImplementation(async ({ where }: any) => (where.accountNo === ACC
        ? [{ branch: '01158', ownerName: 'XON SAROY', currency: 'UZS', syncEnabled: true, lastSyncedAt: new Date('2026-10-05T08:40:00Z'), bank: { name: 'Kapitalbank', code: 'KAPITALBANK' } }]
        : []));
      const r = await svc.hisob(ACC);
      expect(r.bizniki).toEqual([expect.objectContaining({ bank: 'Kapitalbank', mfo: '01158', egasi: 'XON SAROY', sync: true })]);
      expect(r.topildi).toBe(true);
      prisma.bankAccount.findMany.mockResolvedValue([]);
      const r2 = await svc.hisob('20208840123456789012');
      expect(r2).toMatchObject({ topildi: false, valyuta: 'USD', nomlar: [], oxirgi: [] });
    });
  });

  describe('xatoFayl', () => {
    const ROWS = [
      { id: 'okv1', date: new Date('2026-10-02'), contractNo: '2118MSO252POT', paymentAmount: '9942000', client: 'XODJIMURATOV',
        object: null, txType: 'Взносы за квартиры', purpose: 'oplata 2118MSO252Pот', sourceTxId: 'G2_X', account: 'MUHABBAT SHAHRI' },
      { id: 'okv2', date: new Date('2026-09-30'), contractNo: '217VHA23EU', paymentAmount: '5000000', client: 'ALIYEV',
        object: null, txType: null, purpose: 'kv', sourceTxId: 'G3_X', account: 'VATAN RESIDENCE' },
    ];
    beforeEach(() => {
      oplataKv.getXatoListForAgent.mockResolvedValue({ rows: ROWS, count: 2 });
      correction.pendingInfoByOplataKvId.mockResolvedValue(new Map([['okv2', {
        by: 'Dilnoza', at: new Date('2026-10-01'), contractNo: '217VHA26EU', attachmentId: null, attachmentName: null }]]));
    });

    it('xato-list bilan bir xil manba (dateFrom), Excel: sarlavha + qatorlar, jamilar, ariza holati', async () => {
      const r = await svc.xatoFayl(null);
      expect(oplataKv.getXatoListForAgent).toHaveBeenCalledWith({ dateFrom: '2026-07-01', limit: 2000 });
      expect(r).toMatchObject({ ok: true, soni: 2, jami: 2, summa: 14942000, kutilmoqda: 1, rad: 0, filtr: null, kesilgan: false });
      expect(r.filename).toMatch(/^xato-tolovlar_\d{4}-\d{2}-\d{2}\.xlsx$/);
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(Buffer.from(r.base64, 'base64') as any);
      const ws = wb.worksheets[0];
      expect(ws.getRow(1).getCell(4).value).toBe('XATO shartnoma');
      expect(ws.getRow(2).getCell(4).value).toBe('2118MSO252POT');
      expect(ws.getRow(2).getCell(3).value).toBe(9942000);
      expect(ws.getRow(3).getCell(10).value).toBe('Kutilmoqda');
      expect(ws.getRow(3).getCell(12).value).toBe('217VHA26EU');
      expect(ws.getRow(2).getCell(14).value).toBe('G2_X');
      expect(ws.rowCount).toBe(3);
    });

    it('filtr: hisob/obyekt/shartnoma/mijoz/maqsad bo\'yicha (katta-kichik harf farqsiz)', async () => {
      const r = await svc.xatoFayl('vatan');
      expect(r).toMatchObject({ soni: 1, jami: 2, summa: 5000000, filtr: 'vatan' });
      expect(r.filename).toMatch(/_filtr\.xlsx$/);
      expect(correction.pendingInfoByOplataKvId).toHaveBeenCalledWith(['okv2']);
    });
  });
});
