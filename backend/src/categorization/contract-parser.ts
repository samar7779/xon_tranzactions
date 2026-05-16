/**
 * Shartnoma raqamini bank tranzaksiyasi izohidan ajratish.
 *
 * Misol matnlar (real bank vyaginlardan):
 *   "Оплата по договору №1234 ZUR ABCD от 10.05.2026"
 *   "ВЗНОСЫ ПО ДОГ.567VTNXYZ123"
 *   "за квартиру 89 MS0 AAA"
 *
 * Format: <1–4 raqam><3–4 harf (obyekt kodi)><3–4 harf yoki raqam (tail)>
 *
 * Obyekt kodlari (Xon Saroy obyektlari):
 *   AFS, YLZ, MSO, FZO, VDY, ZUR, SLQ, OCN, VTN, PRL, ORZ, SRH, BHR, RMZ
 *
 * Eslatma: O (latin), 0 (raqam), О (kirill) — bir xil deb qaraladi, chunki bank
 * izohlarida ularni aralashtirib yozadilar (masalan, "MS0" va "MSO").
 */

// Yangi obyekt qo'shilsa shu ro'yxatga qo'shing.
const OBJECT_CODES = [
  'AFS', 'YLZ', 'MSO', 'FZO', 'VDY', 'ZUR', 'SLQ', 'OCN',
  'VTN', 'PRL', 'ORZ', 'SRH', 'BHR', 'RMZ',
];

// O/0/О almashinuvchi (latin O, raqam 0, kirill О)
const OSET = '[O0О]';
const CODE_PATTERN = OBJECT_CODES
  .map((code) => code.replace(/[O0]/g, OSET))
  .join('|');

// Asosiy regex — 1-4 raqam + obyekt kodi + 3-4 harf/raqam
const CONTRACT_RE = new RegExp(
  `(\\d{1,4})\\s*(${CODE_PATTERN})\\s*([A-Z0-9]{3,4})`,
  'i',
);

// Kirill harflarni Lotinga moslashtirish (matnda aralash kelganda)
const CYR_TO_LAT: Record<string, string> = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M', 'Н': 'H', 'О': 'O',
  'Р': 'P', 'С': 'C', 'Т': 'T', 'У': 'Y', 'Х': 'X', 'Ё': 'E',
  'а': 'A', 'в': 'B', 'е': 'E', 'к': 'K', 'м': 'M', 'н': 'H', 'о': 'O',
  'р': 'P', 'с': 'C', 'т': 'T', 'у': 'Y', 'х': 'X', 'ё': 'E',
};

function transliterate(s: string): string {
  let out = '';
  for (const ch of s) {
    out += CYR_TO_LAT[ch] ?? ch;
  }
  return out.toUpperCase();
}

/**
 * Tranzaksiya izohidan shartnoma raqamini ajratib oladi.
 * Topilsa normalizatsiya qilingan (UPPER, bo'shliqsiz) ko'rinishida qaytaradi.
 * Misol: "Оплата 1234 ZUR ABCD" → "1234ZURABCD"
 */
export function extractContractNumber(description: string | null | undefined): string | null {
  if (!description) return null;

  // 1) Kirillni Lotinga, № belgilarini olib tashlash, upper case
  const clean = transliterate(String(description))
    .replace(/№/g, '')
    .replace(/N°/g, '');

  // 2) Regex orqali izlash
  const m = CONTRACT_RE.exec(clean);
  if (!m) return null;

  // 3) Bo'shliqsiz birlashtiramiz
  const normalized = (m[1] + m[2] + m[3]).replace(/\s+/g, '').toUpperCase();

  // 4) O/0 variantlarini ham birga qaytaramiz (kim chaqiruvchi qaror qiladi qaysi DB'ga mos)
  return normalized;
}

/**
 * Bitta shartnoma raqamining muqobil yozilishlari (O↔0) — DB qidiruvi uchun.
 *   "1234ZURABCD" → ["1234ZURABCD", "1234ZURABC0", "1234ZURAB0D", ...]
 *
 * Bank izohlarida O va 0 aralashib ketadi, shuning uchun bir necha variantni
 * sinab ko'rishimiz kerak.
 */
export function contractVariants(normalized: string): string[] {
  const variants = new Set<string>([normalized]);
  variants.add(normalized.replace(/0/g, 'O'));
  variants.add(normalized.replace(/O/g, '0'));
  // Qisman almashtirishlar — har bir 0/O ni alohida-alohida almashtirish
  const indices: number[] = [];
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i] === '0' || normalized[i] === 'O') indices.push(i);
  }
  // 2^n ko'p bo'lib ketmasin — max 6 ta almashinish bo'lsa to'xtaymiz
  if (indices.length <= 6) {
    const n = 1 << indices.length;
    for (let mask = 0; mask < n; mask++) {
      const arr = normalized.split('');
      for (let bit = 0; bit < indices.length; bit++) {
        arr[indices[bit]] = ((mask >> bit) & 1) ? '0' : 'O';
      }
      variants.add(arr.join(''));
    }
  }
  return Array.from(variants);
}
