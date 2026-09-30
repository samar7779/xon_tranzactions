import { CrmService } from './crm.service';

// lookupForAgent — FAQAT O'QISH: faqat /payment-history/excel (POST form = o'qish) chaqiriladi.
describe('CrmService.lookupForAgent', () => {
  const ID = '3734765350_2730_29.09.2026_20208000305742909002_29824000300001188002_813200000_-';
  const row = (ext: string, contract: string, amount = 8132000, extra: any = {}) => ({
    external_id: ext, contract, amount, date_paid: '2026-09-29 10:00:00', initial_amount: amount, monthly_amount: 0,
    other_amount: 0, object_name: { name: { ru: 'Obj' } }, full_name: 'ISM FAMILIYA', purpose: 'p', order_id: 7, ...extra,
  });
  let svc: CrmService;
  let call: jest.SpyInstance;

  beforeEach(() => {
    svc = new CrmService({} as any);
    call = jest.spyOn(svc as any, 'callClient');
  });
  afterEach(() => jest.restoreAllMocks());

  it('sana bo\'yicha yadro mos → exact (via sana), transaction_id so\'ralmaydi', async () => {
    call.mockResolvedValueOnce({ ok: true, data: { data: [
      row('3734765350_2730_29.09.2026_X_Y_813200000_-', 'ABC123'),   // yadro mos (hisoblar boshqacha yozilgan)
      row('999_1_29.09.2026_A_B_813200000_-', 'ZZZ999'),             // shu summa, boshqa to'lov
    ] } });
    const r = await svc.lookupForAgent(ID, '2026-09-29', 8132000);
    expect(r).toMatchObject({ ok: true, via: 'sana', checkedDate: '2026-09-29', sameAmount: [] });
    expect(r.exact).toEqual([expect.objectContaining({ contract: 'ABC123', client: 'ISM FAMILIYA', initialAmount: 8132000 })]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call.mock.calls[0][0]).toBe('/payment-history/excel');
    expect(call.mock.calls[0][1]).toMatchObject({ date_from: '2026-09-29', date_to: '2026-09-29' });
  });

  it('sanada yo\'q → transaction_id filtri; filtr e\'tiborsiz qolsa ham faqat yadro mos olinadi', async () => {
    call
      .mockResolvedValueOnce({ ok: true, data: { data: [row('999_1_29.09.2026_A_B_813200000_-', 'ZZZ999')] } })
      .mockResolvedValueOnce({ ok: true, data: { data: [
        row('111_5_01.10.2026_A_B_1_-', 'NOPE'),
        { ...row(ID, 'ABC123'), date_paid: '2026-10-01' },
      ] } });
    const r = await svc.lookupForAgent(ID, null, null);
    expect(r.via).toBe('transaction_id');
    expect(r.exact.map((x: any) => x.contract)).toEqual(['ABC123']);
    expect(call.mock.calls[1][1]).toMatchObject({ transaction_id: '3734765350' });
    expect(r.sameAmount).toEqual([]);   // aniq topilgach nomzodlar kerak emas
  });

  it('hech qayerda yo\'q → shu kuni shu summa nomzodlar (summa kompozitdan, tiyin → so\'m)', async () => {
    call
      .mockResolvedValueOnce({ ok: true, data: { data: [row('999_1_29.09.2026_A_B_813200000_-', 'ZZZ999'), row('', 'QOLDA1'), row('', 'BOSHQA', 5)] } })
      .mockResolvedValueOnce({ ok: true, data: { data: [] } });
    const r = await svc.lookupForAgent(ID, null, null);
    expect(r).toMatchObject({ ok: true, via: null, exact: [] });
    expect(r.sameAmount.map((x: any) => x.contract)).toEqual(['ZZZ999', 'QOLDA1']);
  });

  it('CRM javob bermasa → ok:false', async () => {
    call.mockResolvedValue({ ok: false, error: 'timeout' });
    const r = await svc.lookupForAgent(ID, '2026-09-29', 8132000);
    expect(r).toMatchObject({ ok: false, error: 'timeout' });
  });
});
