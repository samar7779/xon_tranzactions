import { CrmService } from './crm.service';

// 10.10.2026 serverdagi diagnostika (scripts/crm-diag.mjs) natijasiga mos soxta CRM:
//  - /order/index: faqat FAOL shartnomalar, har qanday parametr bilan (o'chirilgan → 0)
//  - /order/show: o'chirilgan → 404
//  - GET /payment-history → 404 (yangi xostda yo'q)
//  - POST /payment-history/excel: o'chirilgan shartnoma to'lovlari BOR
describe('CrmService — o\'chirilgan ("Удалено") shartnomalar (yangi CRM)', () => {
  let svc: CrmService;
  let call: jest.SpyInstance;
  let callClient: jest.SpyInstance;
  let callClientGet: jest.SpyInstance;
  const active = { id: 7194, contract: '150VTN23CV', client_full_name: 'Faol Mijoz', object: { name: 'Vatan' },
    initial: { schedules: [{ id: 1, date_payment: '2026-01-01', amount: 100, amount_paid: 100 }] } };
  const payRows = [
    { external_id: 'e1', contract: '1689ZUR24NU', amount: 50000000, date_paid: '2024-09-06', initial_amount: 50000000,
      monthly_amount: 0, full_name: 'Abdukarimov Inomjon Ibraximjanovich', object_name: { name: { ru: 'ЗУРСАН' } }, order_id: 4321 },
    { external_id: 'e2', contract: '1689ZUR24NU', amount: -113087000, date_paid: '2026-10-09', full_name: '',
      object_name: { name: { ru: 'ЗУРСАН' } }, order_id: 4321 },
    { external_id: 'e3', contract: '1689ZUR24NU1', amount: 1, full_name: 'Boshqa', order_id: 1 },   // LIKE shovqini
  ];

  beforeEach(() => {
    svc = new CrmService({ crmContract: { findMany: jest.fn().mockResolvedValue([]) } } as any);
    call = jest.spyOn(svc as any, 'call').mockImplementation((path: any, body: any) => {
      if (path === '/index') {
        const c = String(body.contract || '');
        return Promise.resolve({ ok: true, data: { data: [active].filter((x) => !c || x.contract === c) } });
      }
      if (path === '/show') {
        const hit = [active].find((x) => (body.id != null && x.id === body.id) || x.contract === body.contract);
        return Promise.resolve(hit ? { ok: true, data: { data: hit } } : { ok: false, status: 404, error: 'not found' });
      }
      return Promise.resolve({ ok: false, error: 'nomalum' });
    });
    callClient = jest.spyOn(svc as any, 'callClient').mockImplementation((path: any, body: any) => {
      if (path === '/payment-history/excel') {
        const c = String(body.contract || '');
        return Promise.resolve({ ok: true, data: { data: payRows.filter((p) => !c || p.contract.startsWith(c)) } });
      }
      return Promise.resolve({ ok: false, error: 'nomalum' });
    });
    callClientGet = jest.spyOn(svc as any, 'callClientGet').mockResolvedValue({ ok: false, status: 404, error: 'Not Found' });
    jest.spyOn(svc as any, 'fetchClientExtras').mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  it('faol shartnoma — bitta /index so\'rovi, to\'lovlar tarixiga murojaat yo\'q', async () => {
    const r: any = await svc.searchContracts('150VTN23CV');
    expect(r.items.map((x: any) => x.contract)).toEqual(['150VTN23CV']);
    expect(call).toHaveBeenCalledTimes(1);
    expect(callClient).not.toHaveBeenCalled();
  });

  it('o\'chirilgan shartnoma — to\'lovlar tarixidan topiladi (mijoz, obyekt, o\'chirilgan belgisi)', async () => {
    const r: any = await svc.searchContracts('1689ZUR24NU');
    expect(r.items).toEqual([expect.objectContaining({
      contract: '1689ZUR24NU', clientFullName: 'Abdukarimov Inomjon Ibraximjanovich', object: 'ЗУРСАН',
      isTrashed: true, status: "O'chirilgan (CRM)",
    })]);
  });

  it('getContractMeta — o\'chirilgan shartnoma found:true (avval found:false → XATO edi)', async () => {
    const r: any = await svc.getContractMeta('1689ZUR24NU');
    expect(r).toMatchObject({ ok: true, found: true, contract: '1689ZUR24NU', clientFullName: 'Abdukarimov Inomjon Ibraximjanovich' });
  });

  it('show() — o\'chirilgan shartnoma uchun GRAFIKSIZ tiklangan yozuvni tafsilot sifatida QAYTARMAYDI', async () => {
    // Chaqiruvchilar `resp?.ok ? resp.detail : null` qiladi — 404 da ok:false (avvaldan shunday)
    const r: any = await svc.show({ contract: '1689ZUR24NU' });
    expect(r.detail ?? null).toBeNull();
    const r2: any = await svc.show({ contract: '1689ZUR24NU', payerHint: 'Abdukarimov Inomjon' });
    expect(r2.detail ?? null).toBeNull();
  });

  it('show() — faol shartnoma to\'liq tafsilot bilan (o\'zgarmagan)', async () => {
    const r: any = await svc.show({ contract: '150VTN23CV' });
    expect(r.detail).toMatchObject({ contract: '150VTN23CV', id: 7194 });
  });

  it('getContractSchedules — o\'chirilgan: grafik yo\'q (bo\'sh grafik bilan noto\'g\'ri bo\'linish yo\'q)', async () => {
    const r: any = await svc.getContractSchedules('1689ZUR24NU');
    expect(r).toEqual({ ok: false, status: null, schedules: [] });
  });

  it('paymentsByContract — GET 404 bo\'lsa ham POST /excel dan, faqat aniq shartnoma qatorlari', async () => {
    const rows = await svc.paymentsByContract('1689ZUR24NU');
    expect(rows.map((p: any) => p.external_id)).toEqual(['e1', 'e2']);
    expect(callClientGet).not.toHaveBeenCalled();
  });

  it('hech qayerda yo\'q — bo\'sh natija (xato emas)', async () => {
    const r: any = await svc.searchContracts('YOQ000');
    expect(r).toEqual({ ok: true, items: [] });
    expect(await svc.paymentsByContract('YOQ000')).toEqual([]);
  });
});
