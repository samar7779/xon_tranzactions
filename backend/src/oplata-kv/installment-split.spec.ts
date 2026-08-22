import { buildSchedule, allocatePayment, categoryOf, ScheduleBucket } from './installment-split';

// Haqiqiy misol — shartnoma 8755MSO264N:
//   Boshlang'ich (initial): 05.07 = 89 499 000, 06.10 = 11 188 000, 06.01 = 11 186 600
//   Oylik (monthly): 10.08, 10.09, 10.10, … har biri 7 056 000
const detail = {
  initial: { schedules: [
    { id: 'i1', date_payment: '2026-07-05', amount: 89499000 },
    { id: 'i2', date_payment: '2026-10-06', amount: 11188000 },
    { id: 'i3', date_payment: '2027-01-06', amount: 11186600 },
  ] },
  monthly: { schedules: [
    { id: 'm1', date_payment: '2026-08-10', amount: 7056000 },
    { id: 'm2', date_payment: '2026-09-10', amount: 7056000 },
    { id: 'm3', date_payment: '2026-10-10', amount: 7056000 },
    { id: 'm4', date_payment: '2026-11-10', amount: 7056000 },
  ] },
};

describe('buildSchedule — sana bo\'yicha ARALASH (initial + monthly)', () => {
  it('boshlang\'ich#1 → oylik#1 → oylik#2 → boshlang\'ich#2 (06.10) → oylik#3 …', () => {
    const s = buildSchedule(detail);
    expect(s.map((b) => `${b.kind}:${b.amount}`)).toEqual([
      'initial:89499000',  // 05.07
      'monthly:7056000',   // 10.08
      'monthly:7056000',   // 10.09
      'initial:11188000',  // 06.10  ← oylik#1,#2 dan KEYIN
      'monthly:7056000',   // 10.10
      'monthly:7056000',   // 10.11
      'initial:11186600',  // 06.01.2027
    ]);
  });
});

describe('allocatePayment — waterfall (8755MSO264N: 9 to\'lov)', () => {
  const schedule = buildSchedule(detail);
  // Bank tranzaksiyalari SANA tartibida (jami 96 555 000)
  const payments = [42000000, 8000000, 20000000, 16500000, 2998000, 1000, 4300000, 1200000, 1556000];

  it('birinchi 6 to\'lov (89 499 000) → FIRST, keyingi 3 (7 056 000) → MONTHLY', () => {
    let running = 0;
    let totFirst = 0;
    let totMonthly = 0;
    const cats: string[] = [];
    for (const amt of payments) {
      const { firstInstallment, monthlyAmount } = allocatePayment(schedule, running, amt);
      running += firstInstallment + monthlyAmount;
      totFirst += firstInstallment;
      totMonthly += monthlyAmount;
      cats.push(categoryOf(firstInstallment, monthlyAmount));
    }
    expect(totFirst).toBe(89499000);   // = boshlang'ich#1 (aynan CRM «Оплачено»)
    expect(totMonthly).toBe(7056000);  // = oylik#1 (aynan CRM «Оплачено»)
    expect(cats).toEqual(['FIRST', 'FIRST', 'FIRST', 'FIRST', 'FIRST', 'FIRST', 'MONTHLY', 'MONTHLY', 'MONTHLY']);
    // ESKI bug: hammasi FIRST bo'lardi (96 555 000 FIRST, 0 MONTHLY) — endi TO'G'RI.
  });

  it('chegarani kesib o\'tgan to\'lov — qismlarga bo\'linadi (initial + monthly)', () => {
    // 0 dan 90M — initial#1 (89.499M) to'ladi + qolgani (0.501M) oylik#1 boshlaydi
    const r = allocatePayment(schedule, 0, 90000000);
    expect(r.firstInstallment).toBe(89499000);
    expect(r.monthlyAmount).toBe(501000);
    expect(categoryOf(r.firstInstallment, r.monthlyAmount)).toBe('FIRST'); // dominant
  });

  it('refund (−) — grafikdan yuqoridan yechadi (oxirgi to\'langan qadam)', () => {
    // 96.555M to'langan holatda −2M refund → oylik#1 ichidan (89.499..96.555 = monthly)
    const r = allocatePayment(schedule, 96555000, -2000000);
    expect(r.firstInstallment).toBe(0);
    expect(r.monthlyAmount).toBe(-2000000);
  });

  it('grafikdan oshiq to\'lov → qolgani oylikka', () => {
    const totalSchedule = 89499000 + 7056000 * 4 + 11188000 + 11186600; // jami
    const r = allocatePayment(schedule, 0, totalSchedule + 5000000);
    expect(r.monthlyAmount).toBeGreaterThanOrEqual(5000000); // oshiq 5M oylikda
  });

  it('grafik bo\'sh (CRM da yo\'q) → hammasi oylik', () => {
    const empty: ScheduleBucket[] = [];
    const r = allocatePayment(empty, 0, 5000000);
    expect(r).toEqual({ firstInstallment: 0, monthlyAmount: 5000000 });
  });
});

// ─────────────────────────────────────────────────────────────────
// REAL HODISA — 1220ORZ23FP (2026-08-22): boshlang'ich 100% YOPILGAN,
// keyingi 9 035 000 to'lov "1 взнос" bo'lib chiqqan edi.
// Sabab: grafik SANA tartibida to'ldiriladi va bu shartnomada boshlang'ich
// qadamlari oxirroqda turadi — kumulyativ pozitsiya boshlang'ichga tushib qolgan.
// ─────────────────────────────────────────────────────────────────
describe("yopilgan boshlang'ichga yangi to'lov tushmasligi (clamp)", () => {
  // Boshlang'ich qadamlari grafik OXIRIDA (sana bo'yicha kech) turgan holat
  const detailLateInitial = {
    initial: { schedules: [
      { id: 'i1', date_payment: '2024-01-10', amount: 100_000_000 },
      { id: 'i2', date_payment: '2026-09-10', amount: 80_310_004 }, // kech sana — oxirida
    ] },
    monthly: { schedules: Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`, date_payment: `2024-0${i + 2}-10`, amount: 20_000_000,
    })) },
  };
  const schedule = buildSchedule(detailLateInitial);
  const initialPlan = 180_310_004;

  it("boshlang'ich reja to'liq to'langan bo'lsa — yangi to'lov OYLIKKA ketadi", () => {
    // Bizdagi holat: boshlang'ich = reja (yopilgan), oylik = 90M (5-qadam qolgan)
    const runningInitial = initialPlan;
    const runningMonthly = 90_000_000;
    const r = allocatePayment(schedule, runningInitial + runningMonthly, 9_035_000, runningInitial);
    expect(r.firstInstallment).toBe(0);
    expect(r.monthlyAmount).toBe(9_035_000);
    expect(categoryOf(r.firstInstallment, r.monthlyAmount)).toBe('MONTHLY');
  });

  it("boshlang'ich qisman to'langan bo'lsa — faqat QOLDIG'i boshlang'ichga, ortig'i oylikka", () => {
    const runningInitial = initialPlan - 2_000_000; // 2M qoldi
    const r = allocatePayment(schedule, runningInitial + 90_000_000, 9_035_000, runningInitial);
    expect(r.firstInstallment).toBe(2_000_000);
    expect(r.monthlyAmount).toBe(7_035_000);
  });

  it("paidInitial berilmasa — eski xatti-harakat saqlanadi (orqaga moslik)", () => {
    const r = allocatePayment(schedule, initialPlan + 90_000_000, 9_035_000);
    expect(r.firstInstallment + r.monthlyAmount).toBe(9_035_000);
  });

  it("refund (manfiy) clamp'ga tushmaydi", () => {
    const r = allocatePayment(schedule, initialPlan + 90_000_000, -5_000_000, initialPlan);
    expect(r.firstInstallment + r.monthlyAmount).toBe(-5_000_000);
  });
});
