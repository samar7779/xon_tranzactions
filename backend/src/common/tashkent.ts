/**
 * Toshkent vaqti bo'yicha KUN (UTC+5, yozgi vaqt yo'q).
 *
 * ⚠️ NEGA KERAK: bank to'lov vaqtini MAHALLIY (Toshkent) vaqtda beradi va
 * sync uni `...T<vaqt>+05:00` qilib o'qiydi — ya'ni bazada to'g'ri LAHZA
 * saqlanadi. Lekin o'sha lahzadan kunni olishda `toISOString()` ishlatilsa,
 * u UTC kunini beradi:
 *
 *   05.10.2026 02:00 Toshkent  →  04.10.2026 21:00 UTC  →  "2026-10-04"  ❌
 *
 * Ya'ni yarim tundan 05:00 gacha tushgan har bir to'lov BIR KUN OLDIN
 * ko'rinadi. Vipiskada, sverkada, eksportda va AI ga beriladigan ma'lumotda
 * shu xato chiqadi. Shuning uchun kun doim shu funksiya orqali olinadi.
 */
export const TOSHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/** Date → "YYYY-MM-DD" (Toshkent kuni). */
export function tashkentKun(d: Date | string | number): string {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
  return new Date(t + TOSHKENT_OFFSET_MS).toISOString().slice(0, 10);
}

/** "YYYY-MM-DD" → o'sha Toshkent kunining boshi va oxiri (UTC lahzalar). */
export function tashkentKunOraligi(kun: string): { from: Date; to: Date } {
  return {
    from: new Date(`${kun}T00:00:00+05:00`),
    to: new Date(`${kun}T23:59:59.999+05:00`),
  };
}
