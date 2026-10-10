import { CrmService } from './crm.service';

// 10.10.2026: yangi CRM'da is_trashed=1 = FAQAT o'chirilganlar ("Удалено" tabi).
// Shartnoma qidiruvi avval faol ro'yxatdan, topilmasa is_trashed=1 bilan qidirishi kerak.
describe('CrmService — o\'chirilgan ("Удалено") shartnomalar', () => {
  let svc: CrmService;
  let call: jest.SpyInstance;
  const deleted = { id: 77, contract: '1689ZUR24NU', client_full_name: 'Abdukarimov Inomjon', object: { name: "Zo'rsan" } };
  const active = { id: 5, contract: '150VTN23CV', client_full_name: 'Faol Mijoz', object: { name: 'Vatan' } };

  // Soxta CRM: is_trashed=1 bo'lsa faqat o'chirilganlar, aks holda faqat faollar (yangi CRM xatti-harakati)
  const fakeCrm = (path: string, body: any) => {
    const pool = body.is_trashed ? [deleted] : [active];
    if (path === '/index') {
      const c = String(body.contract || '');
      return Promise.resolve({ ok: true, data: { data: pool.filter((x) => !c || x.contract === c) } });
    }
    if (path === '/show') {
      const hit = pool.find((x) => (body.id != null && x.id === body.id) || x.contract === body.contract);
      return Promise.resolve(hit ? { ok: true, data: { data: { ...hit, total: { paid: 1 } } } }
        : { ok: false, status: 422, error: 'The selected contract is invalid' });
    }
    return Promise.resolve({ ok: false, error: 'nomalum' });
  };

  beforeEach(() => {
    svc = new CrmService({ crmContract: { findMany: jest.fn().mockResolvedValue([]) } } as any);
    call = jest.spyOn(svc as any, 'call').mockImplementation(fakeCrm as any);
    jest.spyOn(svc as any, 'fetchClientExtras').mockResolvedValue(null);
  });
  afterEach(() => jest.restoreAllMocks());

  it('faol shartnoma — bitta so\'rov, is_trashed yuborilmaydi', async () => {
    const r: any = await svc.searchContracts('150VTN23CV');
    expect(r.items.map((x: any) => x.contract)).toEqual(['150VTN23CV']);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][1].is_trashed).toBeUndefined();
  });

  it('o\'chirilgan shartnoma — faolda yo\'q, is_trashed=1 bilan topiladi va belgilanadi', async () => {
    const r: any = await svc.searchContracts('1689ZUR24NU');
    expect(r.items).toEqual([expect.objectContaining({ contract: '1689ZUR24NU', isTrashed: true })]);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][1]).toMatchObject({ contract: '1689ZUR24NU', is_trashed: 1 });
  });

  it('show(contract) — o\'chirilgan shartnoma tafsiloti /index + /show(is_trashed) orqali keladi', async () => {
    const r: any = await svc.show({ contract: '1689ZUR24NU' });
    expect(r.ok).toBe(true);
    expect(r.detail).toMatchObject({ contract: '1689ZUR24NU', total: { paid: 1 } });
  });

  it('getContractMeta — o\'chirilgan shartnoma topiladi (avval found:false edi)', async () => {
    const r: any = await svc.getContractMeta('1689ZUR24NU');
    expect(r).toMatchObject({ ok: true, found: true, contract: '1689ZUR24NU' });
  });

  it('search — cancelled kabi qo\'shimcha param ikkinchi (o\'chirilganlar) so\'roviga o\'tmaydi', async () => {
    await svc.search('1689ZUR24NU');
    const second = call.mock.calls.find((c) => c[1].is_trashed);
    expect(second).toBeTruthy();
    expect(second![1].cancelled).toBeUndefined();
  });

  it('hech qayerda yo\'q — bo\'sh natija (xato emas)', async () => {
    const r: any = await svc.searchContracts('YOQ000');
    expect(r).toEqual({ ok: true, items: [] });
  });
});
