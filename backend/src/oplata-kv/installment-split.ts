// ОплатыКв boshlang'ich (1-взнос) / oylik (ежемесячный) SPLIT — SOF funksiyalar (test qilinadi).
// MUHIM: auto (splitInstallments) va qo'lda tugma (splitSingleRow) — IKKISI HAM shu yerni ishlatadi,
// shuning uchun qoida har doim bir xil.
//
// Muammo (eski logika): butun boshlang'ich reja BITTA yaxlit summa (initial.total) deb olinardi va
// to'lov shu chegara ichida bo'lsa — HAMMASI 1-взносга ketardi. Aslida CRM grafigi boshlang'ich va
// oylik qadamlarni SANA bo'yicha ARALASH beradi (boshlang'ich#1 → oylik#1 → boshlang'ich#2 → ...).
// Yechim: to'lovlarni grafik qadamlari bo'ylab SANA TARTIBIDA "waterfall" qilib taqsimlash.

export type ScheduleBucket = { amount: number; kind: 'initial' | 'monthly' };

/**
 * CRM /order/show detail → SANA tartibidagi to'lov grafigi (initial + monthly aralash).
 * Har qadam { amount, kind }. Sana o'sish tartibida; bir xil sanada boshlang'ich (initial) oldin.
 */
export function buildSchedule(detail: any): ScheduleBucket[] {
  const rows: Array<{ dueDate: string; amount: number; kind: 'initial' | 'monthly' }> = [];
  const push = (arr: any, kind: 'initial' | 'monthly') => {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      const dp = s?.date_payment ? String(s.date_payment).slice(0, 10) : null;
      const amount = Number(s?.amount || 0);
      if (dp && amount > 0) rows.push({ dueDate: dp, amount, kind });
    }
  };
  push(detail?.initial?.schedules, 'initial');
  push(detail?.monthly?.schedules, 'monthly');
  rows.sort((a, b) =>
    a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1
      : a.kind === b.kind ? 0 : a.kind === 'initial' ? -1 : 1,
  );
  return rows.map((r) => ({ amount: r.amount, kind: r.kind }));
}

/**
 * Bitta to'lovni grafik bo'ylab TAQSIMLASH (waterfall).
 *   schedule    — SANA tartibidagi qadamlar (buildSchedule).
 *   alreadyPaid — shu shartnomada shu to'lovgacha jami NET to'langan (running first + monthly).
 *   amount      — shu to'lov summasi (manfiy = refund; grafikdan yuqoridan "yechadi").
 * Qaytaradi: { firstInstallment, monthlyAmount } — shu to'lovning boshlang'ich/oylik ulushi.
 * To'lov bir necha qadamni kesib o'tsa — qismlarga bo'linadi (masalan boshlang'ich#1 tugab, oylik#1
 * boshlanishi). Grafik jamisidan oshsa — qolgani oylikka yoziladi.
 */
export function allocatePayment(
  schedule: ScheduleBucket[],
  alreadyPaid: number,
  amount: number,
): { firstInstallment: number; monthlyAmount: number } {
  const lo = Math.min(alreadyPaid, alreadyPaid + amount);
  const hi = Math.max(alreadyPaid, alreadyPaid + amount);
  const sign = amount >= 0 ? 1 : -1;
  let first = 0;
  let monthly = 0;
  let cum = 0;
  for (const b of schedule) {
    const bStart = cum;
    const bEnd = cum + b.amount;
    cum = bEnd;
    const overlap = Math.min(hi, bEnd) - Math.max(lo, bStart);
    if (overlap > 0) {
      const v = sign * overlap;
      if (b.kind === 'initial') first += v; else monthly += v;
    }
  }
  // Grafikdan tashqari (oshiq to'lov yoki grafik yetmadi) → oylik
  if (hi > cum) monthly += sign * (hi - Math.max(lo, cum));
  return { firstInstallment: first, monthlyAmount: monthly };
}

/** Split natijasidan Оплата kategoriyasi — dominant (ko'proq) ulush; teng bo'lsa boshlang'ich. */
export function categoryOf(first: number, monthly: number): 'FIRST' | 'MONTHLY' {
  if (first !== 0 && monthly === 0) return 'FIRST';
  if (first === 0 && monthly !== 0) return 'MONTHLY';
  if (first === 0 && monthly === 0) return 'MONTHLY';
  return Math.abs(monthly) > Math.abs(first) ? 'MONTHLY' : 'FIRST';
}
