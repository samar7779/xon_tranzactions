import { ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { TrSupportService, harfFarqiMos } from './tr-support.service';

// Kategoriya daraxti (seed bilan bir xil kodlar)
const CATS = [
  { id: 'c_client', code: 'CLIENT', name: 'Клиент / Физ.Л / Юр.Л', parentId: null },
  { id: 's_kv', code: 'CLIENT_VZNOS_KV', name: 'Взносы за квартиры', parentId: 'c_client' },
  { id: 's_avto', code: 'CLIENT_VZNOS_AVTO', name: 'Взносы за автостоянку', parentId: 'c_client' },
  { id: 's_sch', code: 'CLIENT_SCHETCHIK', name: 'За счетчик', parentId: 'c_client' },
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
      crmContract: { findMany: jest.fn(async () => []) },
      transaction: {
        findFirst: jest.fn(async ({ where }: any) => (where.OR.some((w: any) => w.id === tx.id || w.externalId === tx.externalId) ? txRow() : null)),
        findMany: jest.fn(async ({ where }: any) => (where.bankGeneralId === tx.bankGeneralId
          && (!where.txnDate || (tx.txnDate >= where.txnDate.gte && tx.txnDate < where.txnDate.lt)) ? [txRow()] : [])),
      },
      trSupportEdit: {
        create: jest.fn(async ({ data }: any) => { const r = { id: `e${rows.length + 1}`, ...data }; rows.push(r); return r; }),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUnique: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) || null),
        update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
      },
    };
    cat = {
      setManual: jest.fn(async (_id: string, b: any) => { tx.categoryId = b.categoryId; tx.subcategoryId = b.subcategoryId; return { ok: true, oplataKvUpdated: true }; }),
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

  describe('CRM bank hujjat raqami va lotincha kategoriya (05.10: 488ZUR235K, За счетчик)', () => {
    beforeEach(() => { tx.bankGeneralId = '6617414180'; tx.txnDate = new Date('2026-09-30T06:05:43Z'); tx.contractNumber = '488ZUR235K'; });

    it('6617414180 yoki 6617414180_30.09.2026 → to\'lov; "Za schetchik" → За счетчик; faqat sub-kategoriya', async () => {
      for (const ref of ['6617414180', '6617414180_30.09.2026', '6617414180/30.09.2026']) {
        const p = await svc.preview(ref, { kontragent: 'qolsin', kategoriya: 'Za schetchik', shartnoma: 'qolsin' });
        expect(p.valid).toBe(true);
        expect(p.tx).toMatchObject({ id: 'ctx1', externalId: tx.externalId });
        expect(p.changes).toEqual([{ field: 'kategoriya', from: 'Взносы за квартиры', to: 'За счетчик' }]);
        expect(p.plan).toMatchObject({ categoryId: 'c_client', subcategoryId: 's_sch' });
        expect(p.plan).not.toHaveProperty('contract');
      }
      expect((await svc.preview('6617414180_01.10.2026', { kategoriya: 'Za schetchik' })).errors[0]).toContain("To'lov topilmadi");
    });

    it('bir nechta to\'lov → sanasini so\'raydi; apply OplatyKv yangilanganini qaytaradi', async () => {
      prisma.transaction.findMany.mockResolvedValueOnce([txRow(), { ...txRow(), id: 'ctx2' }]);
      const p = await svc.preview('6617414180', { kategoriya: 'Za schetchik' });
      expect(p.errors[0]).toContain("Bu raqam bilan 2 ta to'lov bor");
      expect(p.errors[0]).toContain('6617414180_30.09.2026');
      const r = await svc.apply([{ tx: tx.externalId, kategoriya: 'За счетчик' }], { approvedBy: 'Samar' });
      expect(r.results[0]).toMatchObject({ status: 'applied', oplataKv: true });
      expect(cat.setManual).toHaveBeenCalledWith('ctx1', { categoryId: 'c_client', subcategoryId: 's_sch' }, null, 'TR Support · tasdiq: Samar');
      expect(cat.setContract).not.toHaveBeenCalled();
      expect(oplataKv.syncNowRespectingSettings).toHaveBeenCalledTimes(1);
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
      // 206FZO25A2 CRM'da bor, lekin obyekt boshqa (VHA -> FZO): ulanmaydi, ariza orqali
      expect(p.ulash).toBeNull();
      expect(p.errors[1]).toContain("Obyekt boshqa: to'lov VHA obyektiniki, 206FZO25A2 — FZO obyekti");
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

  describe('harf farqi qoidasi (XATO to\'lov, oxirgi 1-2 harf) — arizasiz', () => {
    const CRM: Record<string, any> = {
      '217AFS24YL': { contractNumber: '217AFS24YL', found: true, customerName: 'KARIMOV', objectName: 'AFS' },
      '656AFS25ZU': { contractNumber: '656AFS25ZU', found: true, customerName: 'TOSHEV', objectName: 'AFS' },
    };
    beforeEach(() => {
      tx.contractNumber = '217AFS24YK';
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv9', contractNo: '217AFS24YK', date: new Date() });
      crmCache.lookup.mockImplementation(async (c: string) => CRM[c] || { contractNumber: c, found: false });
    });

    it('harfFarqiMos: faqat oxirgi harflar (almashgan, ortiqcha, tushgan, <=2); raqam/obyekt/yil o\'zgarmas', () => {
      expect(harfFarqiMos('217AFS24YK', '217AFS24YL')).toBe(true);    // 1 harf almashgan
      expect(harfFarqiMos('656AFS25AB', '656AFS25ZU')).toBe(true);    // 2 harf
      expect(harfFarqiMos('656AFS25UZ', '656AFS25ZU')).toBe(true);    // o'rni almashgan
      expect(harfFarqiMos('217AFS24YIL', '217AFS24YL')).toBe(true);   // ortiqcha harf (03.10 holati)
      expect(harfFarqiMos('217AFS24YLAB', '217AFS24YL')).toBe(true);  // 2 ortiqcha harf
      expect(harfFarqiMos('217AFS24Y', '217AFS24YL')).toBe(true);     // tushib qolgan harf
      expect(harfFarqiMos('217AFS24YKOP', '217AFS24YL')).toBe(false); // 3 farq
      expect(harfFarqiMos('217AFS24', '217AFS24YL')).toBe(false);     // ikkala harf ham yo'q
      expect(harfFarqiMos('217AFS24YL', '217AFS24YL')).toBe(false);   // bir xil
      expect(harfFarqiMos('217AFS24Y1', '217AFS24YL')).toBe(false);   // raqam <-> harf emas
      expect(harfFarqiMos('217AFS24YK', '217AFS25YK')).toBe(false);   // yil
      expect(harfFarqiMos('217AFS24YK', '217AFT24YK')).toBe(false);   // obyekt
      expect(harfFarqiMos('217AFS24YK', '218AFS24YL')).toBe(false);   // raqam
      expect(harfFarqiMos('XATO', 'XATU')).toBe(false);
    });

    it('ortiqcha harf: XATO 217AFS24YIL -> 217AFS24YL (03.10 dagi 2 to\'lov)', async () => {
      tx.contractNumber = '217AFS24YIL';
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv9', contractNo: '217AFS24YIL', date: new Date() });
      const p = await svc.preview('ctx1', { shartnoma: '217AFS24YL' });
      expect(p.valid).toBe(true);
      expect(p.harf).toEqual({ from: '217AFS24YIL', to: '217AFS24YL' });
    });

    it('XATO ro\'yxatida, oxirgi harf farqi, CRM\'da yagona → valid; apply qo\'lda (setContractManual) + sync', async () => {
      const p = await svc.preview(tx.externalId, { kontragent: 'qolsin', kategoriya: 'qolsin', shartnoma: '217afs24yl' });
      expect(p.valid).toBe(true);
      expect(p.harf).toEqual({ from: '217AFS24YK', to: '217AFS24YL' });
      expect(p.changes).toEqual([{ field: 'shartnoma', from: '217AFS24YK', to: '217AFS24YL' }]);
      expect(p.crm).toMatchObject({ contract: '217AFS24YL', found: true, customerName: 'KARIMOV' });
      expect(p.plan).toMatchObject({ contract: '217AFS24YL', contractManual: true });
      expect(prisma.crmContract.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { found: true, contractNumber: { startsWith: '217AFS24' } } }));
      const r = await svc.apply([{ tx: tx.externalId, shartnoma: '217AFS24YL' }], { approvedBy: 'Egasi · harf qoidasi' });
      expect(r.results[0].status).toBe('applied');
      expect(cat.setContractManual).toHaveBeenCalledWith('ctx1', '217AFS24YL', null, 'TR Support · tasdiq: Egasi · harf qoidasi');
      expect(cat.setContract).not.toHaveBeenCalled();
      expect(oplataKv.syncNowRespectingSettings).toHaveBeenCalledTimes(1);
    });

    it('2 harf farqi; noto\'g\'ri raqam izohda bo\'lsa ham (shartnoma "XATO" qo\'yilgan)', async () => {
      tx.contractNumber = 'XATO'; tx.isContractManual = true; tx.description = 'Oplata po dogovoru 656AFS25AB za kv';
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv9', contractNo: 'XATO', date: new Date() });
      const p = await svc.preview('ctx1', { shartnoma: '656AFS25ZU' });
      expect(p.valid).toBe(true);
      expect(p.harf).toEqual({ from: '656AFS25AB', to: '656AFS25ZU' });
      expect(p.changes).toEqual([{ field: 'shartnoma', from: 'XATO', to: '656AFS25ZU' }]);
    });

    it('harf emas va CRM\'da yo\'q → ariza (sabab bilan); XATO/qolsin → CRM so\'ralmaydi', async () => {
      for (const s of ['217AFS25YL', '206FZO25A2', '217AFS24Y1']) {
        const p = await svc.preview('ctx1', { shartnoma: s });
        expect(p.valid).toBe(false);
        expect(p.harf).toBeNull();
        expect(p.ulash).toBeNull();
        expect(p.errors[0]).toContain("XATO to'lovlar ro'yxatidan ariza biriktiring");
        expect(p.errors[1]).toContain(`Shartnoma ${s} CRM'da topilmadi`);
      }
      crmCache.lookup.mockClear();
      let p = await svc.preview('ctx1', { shartnoma: 'qolsin' });
      expect(p).toMatchObject({ valid: false, xatoQoladi: true });
      expect(p.errors).toEqual(["Hech narsa o'zgarmaydi: tanlangan qiymatlar hozirgisi bilan bir xil"]);
      p = await svc.preview('ctx1', { shartnoma: 'XATO' });                  // XATO deb belgilash: ro'yxatda qoladi
      expect(p).toMatchObject({ valid: true, xatoQoladi: true, plan: { contract: 'XATO', contractXato: true } });
      expect(crmCache.lookup).not.toHaveBeenCalled();
    });

    it('CRM\'da yo\'q, aniq emas (boshqa mos shartnoma), ariza kutilmoqda, kontragent o\'zgarsa → rad', async () => {
      let p = await svc.preview('ctx1', { shartnoma: '217AFS24YM' });
      expect(p.valid).toBe(false);
      expect(p.errors[1]).toContain("Shartnoma 217AFS24YM CRM'da topilmadi");

      // harf bo'yicha aniq emas (CRM'da 2 ta mos) — avtomat ko'chirilmaydi, lekin egasi aniq aytgan: TASDIQ bilan ulanadi
      prisma.crmContract.findMany.mockResolvedValueOnce([{ contractNumber: '217AFS24YL' }, { contractNumber: '217AFS24YZ' }]);
      p = await svc.preview('ctx1', { shartnoma: '217AFS24YL' });
      expect(p.valid).toBe(true);
      expect(p.harf).toBeNull();
      expect(p.ulash).toEqual({ from: '217AFS24YK', to: '217AFS24YL', obyekt: 'AFS' });

      p = await svc.preview('ctx1', { kontragent: 'Банк', kategoriya: 'Услуги банка', shartnoma: '217AFS24YL' });
      expect(p.valid).toBe(false);

      crmCache.lookup.mockClear();
      prisma.xatoCorrectionRequest.findFirst.mockResolvedValue({ submittedByName: 'Dilnoza', submittedAt: new Date(), proposedContractNo: '217AFS24YL' });
      p = await svc.preview('ctx1', { shartnoma: '217AFS24YL' });
      expect(p.valid).toBe(false);
      expect(p.errors[0]).toContain('tasdiqlanishini kuting');
      expect(crmCache.lookup).not.toHaveBeenCalled();
    });
  });

  describe('XATO to\'lovni tasdiq bilan ulash (2026-10-05) — 2118MSO252POT', () => {
    const CRM2: Record<string, any> = {
      '2118MSO252P': { contractNumber: '2118MSO252P', found: true, customerName: 'ALIYEV', objectName: 'MSO' },
      '217AFS24YL': { contractNumber: '217AFS24YL', found: true, customerName: 'KARIMOV', objectName: 'AFS' },
    };
    beforeEach(() => {
      tx.contractNumber = '2118MSO252POT'; tx.description = 'Оплата по договору №2118MSO252Pот 10.05.2026';
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv7', contractNo: '2118MSO252POT', date: new Date() });
      crmCache.lookup.mockImplementation(async (c: string) => CRM2[c] || { contractNumber: c, found: false });
    });

    it('CRM\'da aniq, obyekt bir xil → valid, harf emas (tasdiq kerak); apply qo\'lda + log (ex_id, kim)', async () => {
      const p = await svc.preview(tx.externalId, { kontragent: 'qolsin', kategoriya: 'qolsin', shartnoma: '2118MSO252P' });
      expect(p.valid).toBe(true);
      expect(p.harf).toBeNull();
      expect(p.ulash).toEqual({ from: '2118MSO252POT', to: '2118MSO252P', obyekt: 'MSO' });
      expect(p.changes).toEqual([{ field: 'shartnoma', from: '2118MSO252POT', to: '2118MSO252P' }]);
      expect(p.crm).toMatchObject({ contract: '2118MSO252P', customerName: 'ALIYEV' });
      expect(p.plan).toMatchObject({ contract: '2118MSO252P', contractManual: true });
      const r = await svc.apply([{ tx: tx.externalId, shartnoma: '2118MSO252P' }], { approvedBy: 'Samar', comment: 'chek bor' });
      expect(r.results[0].status).toBe('applied');
      expect(cat.setContractManual).toHaveBeenCalledWith('ctx1', '2118MSO252P', null, 'TR Support · tasdiq: Samar');
      expect(cat.setContract).not.toHaveBeenCalled();
      expect(rows[0]).toMatchObject({ txExternalId: tx.externalId, approvedBy: 'Samar', comment: 'chek bor', changed: ['shartnoma'] });
      expect(oplataKv.syncNowRespectingSettings).toHaveBeenCalledTimes(1);
    });

    it('obyekt boshqa → rad, ariza orqali', async () => {
      const p = await svc.preview('ctx1', { shartnoma: '217AFS24YL' });
      expect(p.valid).toBe(false);
      expect(p.ulash).toBeNull();
      expect(p.errors[1]).toContain("Obyekt boshqa: to'lov MSO obyektiniki, 217AFS24YL — AFS obyekti");
      const r = await svc.apply([{ tx: 'ctx1', shartnoma: '217AFS24YL' }], { approvedBy: 'Samar' });
      expect(r.results[0].status).toBe('skipped');
      expect(cat.setContractManual).not.toHaveBeenCalled();
    });

    it('XATO raqamda ham, izohda ham obyekt kodi yo\'q → solishtirilmaydi (obyekt null), tasdiq bilan', async () => {
      tx.contractNumber = 'XATO'; tx.description = 'kvartira uchun';
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv7', contractNo: 'XATO', date: new Date() });
      const p = await svc.preview('ctx1', { shartnoma: '2118MSO252P' });
      expect(p.valid).toBe(true);
      expect(p.ulash).toEqual({ from: 'XATO', to: '2118MSO252P', obyekt: null });
    });
  });

  describe('XATO to\'lovda faqat kontragent/kategoriya (05.10, tasdiq bilan; XATO\'da qoladi)', () => {
    beforeEach(() => {
      tx.contractNumber = 'XATO'; tx.isContractManual = true; tx.subcategoryId = 's_avto';
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv4', contractNo: 'XATO', date: new Date() });
    });

    it('kategoriya -> Взносы за квартиры: valid, xatoQoladi, shartnoma o\'zgarmaydi, CRM so\'ralmaydi', async () => {
      const p = await svc.preview('ctx1', { kontragent: 'Клиент / Физ.Л / Юр.Л', kategoriya: 'vznosy za kvartiry', shartnoma: 'qolsin' });
      expect(p).toMatchObject({ valid: true, xatoQoladi: true, harf: null, ulash: null });
      expect(p.changes).toEqual([{ field: 'kategoriya', from: 'Взносы за автостоянку', to: 'Взносы за квартиры' }]);
      expect(p.plan).not.toHaveProperty('contract');
      expect(crmCache.lookup).not.toHaveBeenCalled();
      const r = await svc.apply([{ tx: 'ctx1', kategoriya: 'Взносы за квартиры', shartnoma: 'XATO' }], { approvedBy: 'Salokhiddin' });
      expect(r.results[0]).toMatchObject({ status: 'applied', oplataKv: true, okv: null });
      expect(cat.setManual).toHaveBeenCalledWith('ctx1', { categoryId: 'c_client', subcategoryId: 's_kv' }, null, 'TR Support · tasdiq: Salokhiddin');
      expect(cat.setContractManual).not.toHaveBeenCalled();
    });

    it('boshqa kontragentga — rad; ariza kutilayotgan bo\'lsa — rad', async () => {
      let p = await svc.preview('ctx1', { kontragent: 'Банк', kategoriya: 'Услуги банка' });
      expect(p.valid).toBe(false);
      expect(p.errors[0]).toContain("XATO ro'yxatidagi to'lov \"Клиент / Физ.Л / Юр.Л\" kontragentida qoladi");
      prisma.xatoCorrectionRequest.findFirst.mockResolvedValue({ submittedByName: 'D', submittedAt: new Date(), proposedContractNo: null });
      p = await svc.preview('ctx1', { kategoriya: 'Взносы за квартиры' });
      expect(p).toMatchObject({ valid: false, xatoQoladi: false });
      expect(p.errors[0]).toContain('tasdiqlanishini kuting');
    });

    it('shartnoma ulanganda natijada OplatyKv qatori (shartnoma, mijoz, obyekt) va CRM', async () => {
      tx.contractNumber = '2118MSO252POT'; tx.isContractManual = false; tx.description = 'dog 2118MSO252Pот';
      oplataKv.findXatoRowForTx.mockResolvedValue({ id: 'okv4', contractNo: '2118MSO252POT', date: new Date() });
      crmCache.lookup.mockImplementation(async (c: string) => (c === '2118MSO252P'
        ? { contractNumber: c, found: true, customerName: 'XODJIMURATOV', objectName: 'MUHABBAT SHAHRI' } : { contractNumber: c, found: false }));
      cat.setContractManual.mockImplementationOnce(async (_id: string, c: string) => {
        tx.contractNumber = c; tx.isContractManual = true;
        return { ok: true, contractNumber: c, oplataKvSync: { updated: true, contractNo: c, client: 'XODJIMURATOV S', object: 'MUHABBAT SHAHRI' } };
      });
      const r = await svc.apply([{ tx: 'ctx1', shartnoma: '2118MSO252P' }], { approvedBy: 'Salokhiddin' });
      expect(r.results[0]).toMatchObject({
        status: 'applied', oplataKv: true,
        okv: { contractNo: '2118MSO252P', client: 'XODJIMURATOV S', object: 'MUHABBAT SHAHRI' },
        crm: { customerName: 'XODJIMURATOV', objectName: 'MUHABBAT SHAHRI' },
      });
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
