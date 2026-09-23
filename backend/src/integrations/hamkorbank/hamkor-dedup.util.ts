/**
 * HAMKORBANK DEDUP KALITI — import (vipiska) va byacc (sync) o'rtasida
 * dublikatni oldini olish uchun YAGONA, IZCHIL kalit.
 *
 * Nega kerak: byacc yozuvining externalId'si `HB_{general_id}_...` bilan boshlanadi,
 * lekin `general_id` bank ichki ID'si — u rasmiy vipiskada (выписка) YO'Q. Shu bois
 * import qilingan yozuv byacc externalId'sini AYNAN takrorlay olmaydi. Ikkala manba
 * ham hisoblay oladigan umumiy kalit kerak:
 *   - xonpay uuid bo'lsa  → `xp:<uuid>`  (karta to'lovlari — ~94%; sanaga bog'liq emas, eng ishonchli)
 *   - aks holda kompozit  → `cx:<num>_<ddate>_<accCt>_<accDt>_<tiyin>_<sign>`
 *                           (= byacc externalId'ning general_id'siz qismi; B2B o'tkazmalar uchun)
 *
 * Bu kalit 14 ta real vipiska (2622 yozuv) da har HISOB doirasida 100% NOYOB ekani
 * tekshirilgan — ikkala manbada bir xil qiymat beradi (5/5 DB cross-check).
 * FAQAT Hamkorbank uchun ishlatiladi.
 */

/** Purpos/izoh ichidan xonpay uuid'ni ajratadi (kichik harfda). Topilmasa undefined. */
export function extractXonpay(text?: string | null): string | undefined {
  const m = /xonpay:?\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/.exec(
    String(text ?? ''),
  );
  return m ? m[1].toLowerCase() : undefined;
}

/**
 * Kalitni tarkibiy qismlardan quradi (forward yo'nalish — sync VA import shuni chaqiradi).
 * @param purpose      to'lov maqsadi (nazpla/Назначение) — xonpay shu yerda bo'ladi
 * @param num          hujjat raqami (docNum / №док)
 * @param ddate        bank hujjat sanasi (docDate / Дата) — vaqt bilan, masalan "15.09.2026 09:37:00"
 * @param accCt        kredit hisob (accountCr)
 * @param accDt        debet hisob (accountDt)
 * @param amountTiyin  summa TIYINDA (byacc item.amount bilan bir xil birlik)
 * @param ownAccount   sync/import qilinayotgan hisobimiz (sign uchun — makeCompositeId bilan bir xil mantiq)
 */
export function hamkorDedupKey(parts: {
  purpose?: string | null;
  num?: string | null;
  ddate?: string | null;
  accCt?: string | null;
  accDt?: string | null;
  amountTiyin?: number | string | null;
  ownAccount: string;
}): string {
  const xp = extractXonpay(parts.purpose);
  if (xp) return 'xp:' + xp;
  // sign — makeCompositeId bilan AYNAN bir xil: acc_dt === ourAccount ? '+' : '-'
  const sign = parts.accDt && parts.accDt === parts.ownAccount ? '+' : '-';
  const amt =
    parts.amountTiyin != null && parts.amountTiyin !== ''
      ? String(parts.amountTiyin)
      : 'no_amount';
  return (
    'cx:' +
    [
      parts.num || 'no_num',
      parts.ddate || 'no_date',
      parts.accCt || 'no_acc_ct',
      parts.accDt || 'no_acc_dt',
      amt,
      sign,
    ].join('_')
  );
}

/**
 * Mavjud (bazadagi) yozuvdan kalitni aniqlaydi — import dublikat tekshiruvi uchun.
 * Ustuvorlik: (1) saqlangan hbDedupKey, (2) izohdagi xonpay, (3) externalId'dan kompozit.
 * externalId `HB_{gid|IMP}_{num}_{ddate}_{accCt}_{accDt}_{amount}_{sign}` — birinchi segment
 * (general_id yoki "IMP") tashlab yuboriladi, qolgani kompozit bo'ladi.
 */
export function hamkorDedupKeyFromExisting(row: {
  externalId?: string | null;
  description?: string | null;
  hbDedupKey?: string | null;
}): string | null {
  if (row.hbDedupKey) return row.hbDedupKey;
  const xp = extractXonpay(row.description);
  if (xp) return 'xp:' + xp;
  // externalId ikkala manbada bir xil TUZILISH: birinchi segment (byacc=general_id,
  // import="IMP") tashlanadi, qolgani kompozit bo'ladi.
  //   byacc:  "HB_{general_id}_{num}_{ddate}_{accCt}_{accDt}_{amount}_{sign}"
  //   import: "HB_IMP_{num}_{ddate}_{accCt}_{accDt}_{amount}_{sign}"
  const id = row.externalId || '';
  if (!id.startsWith('HB_')) return null;
  const parts = id.slice(3).split('_'); // "HB_" ni olib tashlaymiz
  if (parts.length < 7) return null;
  return 'cx:' + parts.slice(1).join('_'); // birinchi segment (general_id/IMP) tashlanadi
}
