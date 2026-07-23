/**
 * MFO (bank kodi) -> bank/filial nomi.
 *
 * Bank API tranzaksiyada faqat MFO kodni beradi (mfo_dt/mfo_ct), bank NOMINI emas.
 * Мемориальный ордер hujjatida "Наименование банка" ko'rsatish uchun shu jadval.
 *
 * Kengaytириladi: yangi MFO uchraganда shu yerга qo'shiladi. Topilmasa — bo'sh
 * qaytaradi (hujjatда faqat "Код банка" ko'rinadi).
 */
const MFO_BANKS: Record<string, string> = {
  // KAPITALBANK — Toshkent (namunadan)
  '01158': 'ТОШКЕНТ Ш., "КАПИТАЛБАНК" АТ БАНКИНИНГ ЯГОНА ФИЛИАЛИ',
  '00974': 'ТОШКЕНТ Ш., "КАПИТАЛБАНК" АТ БАНКИНИНГ АМАЛИЁТ БОШКАРМАСИ',
};

/** MFO bo'yicha bank nomi (topilmasa bo'sh string) */
export function mfoToBankName(mfo?: string | null): string {
  if (!mfo) return '';
  return MFO_BANKS[String(mfo).trim()] || '';
}
