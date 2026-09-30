import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { TrSupportService } from './tr-support.service';

// Kategoriya daraxti (seed bilan bir xil kodlar)
const CATS = [
  { id: 'c_client', code: 'CLIENT', name: 'Клиент / Физ.Л / Юр.Л', parentId: null },
  { id: 's_kv', code: 'CLIENT_VZNOS_KV', name: 'Взносы за квартиры', parentId: 'c_client' },
  { id: 's_avto', code: 'CLIENT_VZNOS_AVTO', name: 'Взносы за автостоянку', parentId: 'c_client' },
  { id: 'c_bank', code: 'BANK', name: 'Банк', parentId: null },
  { id: 's_usl', code: 'BANK_USLUGI', name: 'Услуги банка', parentId: 'c_bank' },
  { id: 'c_salary', code: 'SALARY', name: 'Зарплата', parentId: null },
  { id: 'c_cp', code: 'COUNTERPARTY', name: 'Контрагент', parentId: null },   // yashirin
];
const NAME: Record<string, any> = Object.fromEntries(CATS.map((c) => [c.id, { code: c.code, name: c.name }]));

describe('TrSupportService', () => {
  let tx: any;
  let prisma: any;
  let cat: { setManual: jest.Mock; setContract: jest.Mock; setContractManual: jest.Mock; restoreSnapshot: jest.Mock };
  let crmCache: { lookup: jest.Mock };
  let oplataKv: { syncNowRespectingSettings: jest.Mock; findXatoRowForTx: jest.Mock };
  let rows: any[];
  let svc: TrSupportService;

  const txRow = () => ({
    ...tx, category: tx.categoryId ? NAME[tx.categoryId] : null, subcategory: tx.subcategoryId ? NAME[tx.subcategoryId] : null,
  });

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    tx = {
      id: 'ctx1', externalId: '1069900024938_10904304_29.09.2026_A_B_813200000_-', txnDate: new Date('2026-09-29T05:00:00Z'),
      amount: 8132000, direction: 'IN', source: 'SYNC', description: "... от G'AYBULLAYEVA",
      categoryId: 'c_client', subcategoryId: 's_kv', contractNumber: null, isContractManual: false,
    };
    rows = [];
    prisma = {
      category: { findMany: jest.fn(async () => CATS) },
      setting: { findUnique: jest.fn(async () => ({ value: '2026-07-01' })) },
      xatoCorrectionRequest: { findFirst: jest.fn(async () => null) },
      transaction: { findFirst: jest.fn(async ({ where }: any) => (where.OR.some((w: any) => w.id === tx.id || w.externalId === tx.externalId) ? txRow() : null)) },
      trSupportEdit: {
        create: jest.fn(async ({ data }: any) => { const r = { id: `e${rows.length + 1}`, ...data }; rows.push(r); return r; }),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) || null),
        update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
      },
    };
    cat = {
      setManual: jest.fn(async (_id: string, b: any) => { tx.categoryId = b.categoryId; tx.subcategoryId = b.subcategoryId; return { ok: true }; }),
      setContract: jest.fn(async (_id: string, c: string | null) => { tx.contractNumber = c; tx.isContractManual = false; return { ok: true }; }),
      setContractManual: jest.fn(async (_id: string, c: string | null) => { tx.contractNumber = c; tx.isContractManual = !!c; return { ok: true }; }),
      restoreSnapshot: jest.fn(async (_id: string, s: any) => {
        Object.assign(tx, { categoryId: s.categoryId, subcategoryId: s.subcategoryId, contractNumber: s.contractNumber, isContractManual: s.isContractManual });
        return { ok: true };
      }),
    };
    crmCache = { lookup: jest.fn(async (c: string) => (c === '206FZO25A2' || c === '206FZ025A2'
      ? { contractNumber: '206FZO25A2', found: true, customerName: 'ISM', objectName: 'FZO' } : { contractNumber: c, found: false })) };
    oplataKv = {
      syncNowRespectingSettings: jest.fn(async () => ({ ok: true, added: 1, updated: 0, skipped: 0, objectsBackground: true })),
      findXatoRowForTx: jest.fn(async () => null),
    };
    svc = new TrSupportService(prisma, cat as any, crmCache as any, oplataKv as any, { get: () => undefined } as any);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('preview', () => {
    it('shartnoma CRM\'da bor → valid, kanonik shakl (0→O), kontragent/kategoriya qolsin', async () => {
      const p = await svc.preview(tx.externalId, { shartnoma: '206FZ025A2' });
      expect(p.valid).toBe(true);
      expect(p.changes).toEqual([{ field: 'shartnoma', from: null, to: '206FZO25A2' }]);
      expect(p.crm).toMatchObject({ contract: '206FZO25A2', found: true, customerName: 'ISM' });
      expect(crmCache.lookup).toHaveBeenCalledWith('206FZ025A2', { forceRefresh: true });
    });

    it('shartnoma CRM\'da yo\'q → "boshqa shartnoma bering"', async () => {
      const p = await svc.preview('ctx1', { shartnoma: '999XXX99' });
      expect(p.valid).toBe(false);
      expect(p.errors[0]).toContain("CRM'da topilmadi — boshqa shartnoma bering");
    });

    it('kontragent o\'zgarsa kategoriya ham tanlanishi shart; nom yoki kod bilan', async () => {
      let p = await svc.preview('ctx1', { kontragent: 'Банк' });
      expect(p.valid).toBe(false);
      expect(p.errors[0]).toContain('kategoriyani ham tanlang: Услуги банка');
      p = await svc.preview('ctx1', { kontragent: 'BANK', kategoriya: 'услуги банка' });
      expect(p.valid).toBe(true);
      expect(p.changes.map((c) => c.field)).toEqual(['kontragent', 'kategoriya']);
      // bolasiz kontragent: kategoriya o'zi bo'sh bo'ladi
      p = await svc.preview('ctx1', { kontragent: 'Зарплата' });
      expect(p.valid).toBe(true);
      expect(p.plan).toMatchObject({ categoryId: 'c_salary', subcategoryId: null });
    });

    it('yashirin kontragent, boshqa kontragentdagi kategoriya, shartnoma CLIENT emas → xato', async () => {
      expect((await svc.preview('ctx1', { kontragent: 'COUNTERPARTY', kategoriya: 'x' })).errors[0]).toContain('topilmadi');
      expect((await svc.preview('ctx1', { kategoriya: 'Услуги банка' })).errors[0]).toContain('ichida yo\'q');
      const p = await svc.preview('ctx1', { kontragent: 'Зарплата', shartnoma: '206FZO25A2' });
      expect(p.errors).toContain("Shartnoma faqat \"Клиент / Физ.Л / Юр.Л\" yoki \"Переброска\" kontragentida qo'yiladi");
    });

    it('hech narsa o\'zgarmasa, to\'lov yo\'q, Aloqa Bank → xato', async () => {
      expect((await svc.preview('ctx1', { kontragent: 'qolsin', kategoriya: "Взносы за квартиры" })).errors[0]).toContain("Hech narsa o'zgarmaydi");
      expect((await svc.preview('yoq_id_123', {})).errors[0]).toContain("To'lov topilmadi");
      tx.source = 'ALOQA_BANK';
      expect((await svc.preview('ctx1', { shartnoma: '206FZO25A2' })).valid).toBe(false);
    });
  });

  describe('apply', () => {
    it('bir nechta tahrir: panel yo\'llari (label bilan), tarix qatori, BITTA sync', async () => {
      const r = await svc.apply(
        [{ tx: tx.externalId, shartnoma: '206FZO25A2' }, { tx: 'yoq_id_123', shartnoma: '206FZO25A2' }],
        { approvedBy: 'Samar', comment: 'chek bo\'yicha', requestedBy: 'Telegram' },
      );
      expect(r.results.map((x) => x.status)).toEqual(['applied', 'skipped']);
      expect(cat.setManual).not.toHaveBeenCalled();                  // kontragent/kategoriya qolsin
      expect(cat.setContract).toHaveBeenCalledWith('ctx1', '206FZO25A2', null, 'TR Support · tasdiq: Samar');
      expect(oplataKv.syncNowRespectingSettings).toHaveBeenCalledTimes(1);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        txId: 'ctx1', approvedBy: 'Samar', comment: "chek bo'yicha", status: 'applied', changed: ['shartnoma'],
        before: expect.objectContaining({ contractNumber: null, subcategoryName: 'Взносы за квартиры' }),
        after: expect.objectContaining({ contractNumber: '206FZO25A2' }),
      });
      expect(prisma.trSupportEdit.updateMany).toHaveBeenCalledWith({ where: { batchId: r.batchId }, data: { syncResult: r.sync } });
    });

    it('avval kategoriya, keyin shartnoma; yiqilsa failed yoziladi, sync baribir', async () => {
      tx.categoryId = 'c_bank'; tx.subcategoryId = 's_usl';
      cat.setContract.mockRejectedValueOnce(new Error('CRM timeout'));
      const r = await svc.apply([{ tx: 'ctx1', kontragent: 'CLIENT', kategoriya: 'CLIENT_VZNOS_KV', shartnoma: '206FZO25A2' }], { approvedBy: 'Samar' });
      expect(cat.setManual.mock.invocationCallOrder[0]).toBeLessThan(cat.setContract.mock.invocationCallOrder[0]);
      expect(r.results[0]).toMatchObject({ status: 'failed', errors: ['CRM timeout'] });
      expect(rows[0].after).toMatchObject({ categoryId: 'c_client', contractNumber: null });
      expect(oplataKv.syncNowRespectingSettings).toHaveBeenCalledTimes(1);
    });

    it('hammasi rad → sync chaqirilmaydi; approvedBy majburiy', async () => {
      const r = await svc.apply([{ tx: 'ctx1', shartnoma: '999XXX99' }], { approvedBy: 'Samar' });
      expect(r.results[0].status).toBe('skipped');
      expect(oplataKv.syncNowRespectingSettings).not.toHaveBeenCalled();
      await expect(svc.apply([{ tx: 'ctx1', shartnoma: '206FZO25A2' }], { approvedBy: ' ' })).rejects.toThrow('approvedBy');
    });
  });

  describe('rollback', () => {
    it('oldingi holat tiklanadi + sync; ikkinchi marta — 409', async () => {
      await svc.apply([{ tx: 'ctx1', shartnoma: '206FZO25A2' }], { approvedBy: 'Samar' });
      oplataKv.syncNowRespectingSettings.mockClear();
      const r = await svc.rollback('e1', 'Admin', 'xato edi');
      expect(cat.restoreSnapshot).toHaveBeenCalledWith('ctx1',
        { categoryId: 'c_client', subcategoryId: 's_kv', contractNumber: null, isContractManual: false }, 'TR Support · ortga: Admin');
      expect(tx.contractNumber).toBeNull();
      expect(oplataKv.syncNowRespectingSettings).toHaveBeenCalledTimes(1);
      expect(r.item).toMatchObject({ status: 'rolled_back', rolledBackBy: 'Admin', rollbackNote: 'xato edi' });
      await expect(svc.rollback('e1', 'Admin')).rejects.toBeInstanceOf(ConflictException);
    });

    it('keyin boshqa o\'zgargan bo\'lsa — qaytarilmaydi (409), hech narsa yozilmaydi', async () => {
      await svc.apply([{ tx: 'ctx1', shartnoma: '206FZO25A2' }], { approvedBy: 'Samar' });
      tx.contractNumber = 'BOSHQA1';
      await expect(svc.rollback('e1', 'Admin')).rejects.toThrow("yana o'zgargan");
      expect(cat.restoreSnapshot).not.toHaveBeenCalled();
    });
  });

  describe('XATO to\'lovlar ro\'yxati', () => {
    it('ro\'yxatda bo\'lsa tahrir yo\'q — "ariza biriktiring"; filtr xato-list bilan bir xil (dateFrom)', async () => {
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv9', contractNo: '217VHA23EU', date: new Date() });
      const p = await svc.preview(tx.externalId, { shartnoma: '206FZO25A2' });
      expect(p.valid).toBe(false);
      expect(p.xato).toMatchObject({ inList: true, contractNo: '217VHA23EU', pending: false });
      expect(p.errors[0]).toContain("XATO to'lovlar ro'yxatidan ariza biriktiring");
      expect(oplataKv.findXatoRowForTx).toHaveBeenCalledWith([tx.externalId, 'ctx1'], '2026-07-01');
      expect(prisma.setting.findUnique).toHaveBeenCalledWith({ where: { key: 'agent.dateFrom' } });
      expect(crmCache.lookup).not.toHaveBeenCalled();
      const r = await svc.apply([{ tx: 'ctx1', shartnoma: '206FZO25A2' }], { approvedBy: 'Samar' });
      expect(r.results[0].status).toBe('skipped');
      expect(cat.setContract).not.toHaveBeenCalled();
      expect(oplataKv.syncNowRespectingSettings).not.toHaveBeenCalled();
    });

    it('ariza allaqachon yuborilgan — "tasdiqlanishini kuting"', async () => {
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv9', contractNo: '217VHA23EU', date: new Date() });
      prisma.xatoCorrectionRequest.findFirst.mockResolvedValue({ submittedByName: 'Dilnoza', submittedAt: new Date('2026-09-30T08:00:00Z'), proposedContractNo: '217VHA26EU' });
      const o = await svc.options('ctx1');
      expect(o.xato).toMatchObject({ inList: true, pending: true, pendingBy: 'Dilnoza', pendingContract: '217VHA26EU' });
      expect(o.xato!.xabar).toContain('ariza allaqachon yuborilgan (Dilnoza, 2026-09-30, taklif: 217VHA26EU)');
      expect(o.xato!.xabar).toContain('tasdiqlanishini kuting');
    });

    it("ro'yxatda yo'q — xato null emas, inList=false, tahrir oqimi davom etadi", async () => {
      const o = await svc.options('ctx1');
      expect(o.xato).toMatchObject({ inList: false, xabar: null });
      expect((await svc.preview('ctx1', { shartnoma: '206FZO25A2' })).valid).toBe(true);
    });
  });

  describe('XATO rejimi (to\'lovni XATO ro\'yxatiga tushirish)', () => {
    it('shartnoma=XATO: aynan "XATO" CRM\'siz (qo\'lda) yoziladi, CRM so\'ralmaydi, sync bitta', async () => {
      tx.categoryId = null; tx.subcategoryId = null;
      const p = await svc.preview('ctx1', { kontragent: 'CLIENT', kategoriya: 'CLIENT_VZNOS_KV', shartnoma: 'XATO' });
      expect(p.valid).toBe(true);
      expect(p.changes).toContainEqual({ field: 'shartnoma', from: null, to: 'XATO' });
      expect(p.plan).toMatchObject({ contract: 'XATO', contractXato: true });
      expect(crmCache.lookup).not.toHaveBeenCalled();
      const r = await svc.apply([{ tx: 'ctx1', kontragent: 'CLIENT', kategoriya: 'CLIENT_VZNOS_KV', shartnoma: 'xato' }], { approvedBy: 'Samar' });
      expect(r.results[0].status).toBe('applied');
      expect(cat.setContractManual).toHaveBeenCalledWith('ctx1', 'XATO', null, 'TR Support · tasdiq: Samar');
      expect(cat.setContract).not.toHaveBeenCalled();
      expect(oplataKv.syncNowRespectingSettings).toHaveBeenCalledTimes(1);
      expect(rows[0].after).toMatchObject({ contractNumber: 'XATO', isContractManual: true });
    });

    it("raqam qo'shilsa ham 'XATO' saqlanadi; kontragent CLIENT emas bo'lsa rad", async () => {
      let p = await svc.preview('ctx1', { shartnoma: 'XATO:467RZM26HA' });
      expect(p.plan).toMatchObject({ contract: 'XATO', contractXato: true });
      expect(crmCache.lookup).not.toHaveBeenCalled();
      p = await svc.preview('ctx1', { kontragent: 'Зарплата', shartnoma: 'XATO' });
      expect(p.errors[0]).toContain("faqat \"Клиент / Физ.Л / Юр.Л\" kontragentli");
      // oddiy shartnoma baribir CRM'da tekshiriladi
      p = await svc.preview('ctx1', { shartnoma: '999XXX99' });
      expect(p.errors[0]).toContain("CRM'da topilmadi");
    });
  });

  it('checkCode: 7779 (yoki TR_SUPPORT_CODE env), boshqasi 403', () => {
    expect(() => svc.checkCode('7779')).not.toThrow();
    expect(() => svc.checkCode(' 7779 ')).not.toThrow();
    for (const bad of ['', '7778', undefined, 7779]) expect(() => svc.checkCode(bad)).toThrow(ForbiddenException);
    const s2 = new TrSupportService(prisma, cat as any, crmCache as any, oplataKv as any, { get: (k: string) => (k === 'TR_SUPPORT_CODE' ? '1234' : undefined) } as any);
    expect(() => s2.checkCode('7779')).toThrow(ForbiddenException);
    expect(() => s2.checkCode('1234')).not.toThrow();
  });
});
