/**
 * UPSERT append REJASI — SOF funksiya (Google Sheets API'dan mustaqil, oson test qilinadi).
 *
 * «Заявки» kabi murakkab jadval tuzilishini hisobga oladi:
 *   1) tepada REAL to'lovlar bloki — TO'LOV ustunlarida (payIdxs) ma'lumot bor (kichik ichki
 *      "gap" qatorlar bo'lishi mumkin — faqat №/status),
 *   2) keyin KATTA bo'sh zona — "bron"/formula qatorlar (№, status oldindan to'ldirilgan, LEKIN
 *      to'lov ustunlari BO'SH),
 *   3) undan ham past — eski buzuq append'dan qolgan "stray" (to'lov + kalit bor, lekin №/status yo'q).
 *
 * Natija:
 *   - `anchorLen` = birinchi UZLUKSIZ to'lov blokining uzunligi. GAP_LIMIT'dan katta ketma-ket
 *     to'lovsiz bo'shliq kelsa — blok tugadi (undan keyingi bron/stray e'tiborsiz qoldiriladi).
 *     Yangi qatorlar shu blokdan KEYIN yoziladi.
 *   - `keyToIdx` = FAQAT shu blok ichidagi kalitlar. Blokdan tashqari (bron/stray) qatorlar
 *     MATCH QILINMAYDI — aks holda yozuv o'sha eski/qoldiq pozitsiyada yangilanib, blok tepasiga
 *     qo'shilmasdan qolardi ("kam yozildi"dek ko'rinardi).
 */
export function planUpsertRows(
  existing: any[][],
  payIdxs: number[],
  keyIdx: number,
  gapLimit = 200,
): { anchorLen: number; keyToIdx: Map<string, number> } {
  const filled = (r: any[] | undefined, c: number): boolean => {
    const v = r?.[c];
    return v != null && String(v).trim() !== '';
  };

  // Birinchi uzluksiz to'lov blokining oxiri (0-based indeks).
  let lastPayIdx = -1;
  let gap = 0;
  for (let i = 0; i < existing.length; i++) {
    if (payIdxs.some((c) => filled(existing[i], c))) {
      lastPayIdx = i;
      gap = 0;
    } else if (lastPayIdx >= 0 && ++gap > gapLimit) {
      break; // katta bo'shliq → real blok tugadi
    }
  }

  // Kalit → indeks, FAQAT blok ichidan (0..lastPayIdx).
  const keyToIdx = new Map<string, number>();
  for (let i = 0; i <= lastPayIdx; i++) {
    const v = existing[i]?.[keyIdx];
    const k = v != null ? String(v).trim() : '';
    if (k && !keyToIdx.has(k)) keyToIdx.set(k, i);
  }

  return { anchorLen: lastPayIdx + 1, keyToIdx };
}
