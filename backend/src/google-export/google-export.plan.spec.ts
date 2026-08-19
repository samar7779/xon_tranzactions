import { planUpsertRows } from './google-export.plan';

// «Заявки» jadval tuzilishini AYNAN taqlid qiladi:
//   ustunlar: A(0)Дата B(1)Сумма C(2)Сумма D(3)Дог E(4)Тип F(5)К оплате G(6)ix_id H(7)№ заявка
//   payIdxs (to'lov, kalit G'dan tashqari) = [0,1,2,3,4] (A..E); keyIdx = 6 (G = ix_id)
const PAY = [0, 1, 2, 3, 4];
const KEY = 6;

function buildSheet() {
  const rows: any[][] = [];
  // 1) REAL to'lov bloki — 300 qator. To'lov (A..E)+status(F)+kalit(G=real-i)+№(H).
  //    Har 40-chi qator — ichki "gap" (faqat F,H; to'lov va kalit BO'SH) — real hayotdagidek.
  for (let i = 0; i < 300; i++) {
    const isGap = i % 40 === 39;
    if (isGap) rows.push(['', '', '', '', '', 'Оплачен', '', String(80000 + i)]);
    else rows.push(['01.01.2026', '100', '100', `DOG-${i}`, 'Переброска', 'Оплачен', `real-${i}`, String(80000 + i)]);
  }
  // 2) BRON zonasi — 7000 qator: faqat № (H) va status (F) oldindan to'ldirilgan; to'lov A..E va kalit G BO'SH.
  for (let i = 0; i < 7000; i++) rows.push(['', '', '', '', '', 'Оплачен', '', String(90000 + i)]);
  // 3) STRAY qoldiq — 6 qator (eski buzuq append): to'lov (A..E)+kalit(G=stray-i) bor, LEKIN status F va № H BO'SH.
  for (let i = 0; i < 6; i++) rows.push(['02.02.2026', '50', '50', `DOG-S${i}`, 'Переброска', '', `stray-${i}`, '']);
  return rows;
}

describe('planUpsertRows — «Заявки» (real to\'lov + 7000 bron + stray)', () => {
  it('append oxiri = REAL blok oxiri (bron va stray TASHLANADI)', () => {
    const { anchorLen } = planUpsertRows(buildSheet(), PAY, KEY, 200);
    // Real blok = 300 qator (0..299), oxirgi qator (i=299) to'lovli → anchorLen=300.
    // Undan keyingi 7000 bron va 6 stray HISOBGA OLINMAYDI.
    expect(anchorLen).toBe(300);
  });

  it('keyToIdx FAQAT blokdan — stray kalitlari MATCH QILINMAYDI', () => {
    const { keyToIdx } = planUpsertRows(buildSheet(), PAY, KEY, 200);
    // Blokda 300 qatordan 7 tasi gap (kalitsiz) → 293 ta kalit.
    expect(keyToIdx.size).toBe(293);
    expect(keyToIdx.has('real-0')).toBe(true);
    expect(keyToIdx.has('real-160')).toBe(true);
    expect(keyToIdx.has('stray-0')).toBe(false); // stray → "yo'q" → yangi bo'lib qo'shiladi
    expect(keyToIdx.has('stray-5')).toBe(false);
  });

  it('153 yozuv: HECH BIRI yo\'qolmaydi (blokdagi → update, stray/yangi → qo\'shiladi)', () => {
    const { keyToIdx } = planUpsertRows(buildSheet(), PAY, KEY, 200);
    const dbKeys = [
      ...Array.from({ length: 60 }, (_, i) => `real-${i * 4}`), // 60 ta blok kaliti (gap emas) → update
      ...Array.from({ length: 6 }, (_, i) => `stray-${i}`),     // 6 ta stray → keyToIdx'da yo'q → qo'shiladi
      ...Array.from({ length: 87 }, (_, i) => `brand-${i}`),    // 87 ta mutlaqo yangi → qo'shiladi
    ]; // jami 153
    let updated = 0;
    let added = 0;
    for (const k of dbKeys) (keyToIdx.has(k) ? updated++ : added++);
    expect(updated + added).toBe(153); // ← "kam yozildi" YO'Q: barcha 153 joylashadi
    expect(updated).toBe(60);
    expect(added).toBe(93);            // 6 stray + 87 yangi
  });

  it('ichki kichik "gap"lar blokni buzmaydi (GAP_LIMIT ichida)', () => {
    // 100 to'lov qator, o'rtada 150 ta ketma-ket bo'sh (GAP_LIMIT=200 ichida), keyin yana to'lov.
    const rows: any[][] = [];
    for (let i = 0; i < 100; i++) rows.push(['x', '', '', '', '', '', `k-${i}`, '']);
    for (let i = 0; i < 150; i++) rows.push(['', '', '', '', '', '', '', '']); // 150 < 200 → blok davom etadi
    for (let i = 0; i < 50; i++) rows.push(['y', '', '', '', '', '', `k2-${i}`, '']);
    const { anchorLen } = planUpsertRows(rows, PAY, KEY, 200);
    expect(anchorLen).toBe(300); // 100 + 150(gap) + 50 = 300 (bitta blok)
  });

  it('bo\'sh jadval → anchorLen 0 (startRow\'dan boshlab yoziladi)', () => {
    expect(planUpsertRows([], PAY, KEY, 200).anchorLen).toBe(0);
  });
});
