/**
 * ═══════════════════════════════════════════════════════════════════
 *  ПЕРЕБРОСКА — summani ishonchli aniqlash (AI'ga ko'r-ko'rona ishonmaymiz)
 * ═══════════════════════════════════════════════════════════════════
 *
 *  Arizada odatda 3 xil summa uchraydi va ular chalkashtiriladi:
 *    · o'tkazma      — "Shartnoma bo'yicha QOLGAN [X] ni yangi shartnomaga
 *                       to'lov hisobida QABUL QILISHINGIZNI so'rayman"  ← kerakli
 *    · qaytarilgan   — "bekor qilish kelishuvi asosida menga QAYTARILGAN [Y]"
 *    · qayta to'lov  — "[Z] ni 3 bank kuni ichida qayta to'lash majburiyati"
 *
 *  Real hodisa (2026-08): agent o'zi "34 942 710 — qaytarilgan, buni o'tkazma
 *  qilib olmaslik kerak" deb yozgan-u, aynan shuni o'tkazma qilib qo'ygan
 *  (to'g'risi 70 944 290 edi). Shuning uchun bu yerdagi tekshiruvlar SOF
 *  funksiya — model xatosini dastur tutadi.
 */

// ─────────────── Summa so'z bilan → raqam ───────────────

/** Birlik/o'nlik so'zlar (o'zbek lotin + kirill + rus) */
const WORD_VALUES: Record<string, number> = {
  // ── O'zbek (lotin) ──
  nol: 0, bir: 1, ikki: 2, uch: 3, tort: 4, besh: 5, olti: 6, yetti: 7, etti: 7,
  sakkiz: 8, toqqiz: 9, on: 10, yigirma: 20, ottiz: 30, qirq: 40, ellik: 50,
  oltmish: 60, yetmish: 70, etmish: 70, sakson: 80, toqson: 90,
  // ── O'zbek (kirill) ──
  ноль: 0, бир: 1, икки: 2, уч: 3, тўрт: 4, турт: 4, беш: 5, олти: 6, етти: 7,
  саккиз: 8, тўққиз: 9, туккиз: 9, ўн: 10, ун: 10, йигирма: 20, ўттиз: 30, уттиз: 30,
  қирқ: 40, кирк: 40, эллик: 50, олтмиш: 60, етмиш: 70, саксон: 80, тўқсон: 90, туксон: 90,
  // ── Rus ──
  один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6,
  семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11, двенадцать: 12,
  тринадцать: 13, четырнадцать: 14, пятнадцать: 15, шестнадцать: 16,
  семнадцать: 17, восемнадцать: 18, девятнадцать: 19, двадцать: 20, тридцать: 30,
  сорок: 40, пятьдесят: 50, шестьдесят: 60, семьдесят: 70, восемьдесят: 80, девяносто: 90,
  сто: 100, двести: 200, триста: 300, четыреста: 400, пятьсот: 500,
  шестьсот: 600, семьсот: 700, восемьсот: 800, девятьсот: 900,
};

/** "yuz" — ko'paytiruvchi (o'zbekcha: "to'qqiz yuz" = 900) */
const HUNDRED = new Set(['yuz', 'юз']);

/** Ming / million / milliard — guruh yopuvchi ko'paytiruvchilar */
const GROUP_MULTIPLIERS: Array<{ words: string[]; mult: number }> = [
  { words: ['milliard', 'миллиард', 'миллиарда', 'миллиардов'], mult: 1_000_000_000 },
  { words: ['million', 'миллион', 'миллиона', 'миллионов'], mult: 1_000_000 },
  { words: ['ming', 'минг', 'тысяча', 'тысячи', 'тысяч'], mult: 1_000 },
];

/** Hisobga olinmaydigan so'zlar (valyuta, "va", tinish belgilari) */
const IGNORED = new Set([
  'som', 'sum', 'сўм', 'сум', 'сом', 'рубль', 'рублей', 'va', 'ва', 'и',
  'uzs', 'so', 'm', 'ming\'', '',
]);

/**
 * Matnni normallashtirish: apostrof variantlari (ʻ ' ' `) olib tashlanadi,
 * shunda "to'qqiz" va "toqqiz" bir xil kalitga tushadi.
 *
 * DIQQAT: o'zbek kirillidagi ў/қ/ғ/ҳ harflari `а-я` oralig'iga KIRMAYDI
 * (Cyrillic Extended blokida). Shuning uchun harf filtri `\p{L}` bo'yicha —
 * aks holda "тўққиз" → "тиз" bo'lib tanilmay qoladi.
 */
function normWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[''`ʻʼ’‘]/g, '')
    .replace(/[^\p{L}]/gu, '');
}

/**
 * "Етмиш миллион тўққиз юз қирқ тўрт минг икки юз тўқсон сўм" → 70944290
 * Tushunib bo'lmasa (notanish so'z, bo'sh) — null (tekshiruv o'tkazib yuboriladi,
 * yolg'on ogohlantirish bermaslik uchun).
 */
export function parseAmountWords(text: string | null | undefined): number | null {
  if (!text) return null;
  const rawTokens = String(text).split(/[\s,.\-—()]+/).map(normWord).filter(Boolean);
  if (rawTokens.length === 0) return null;

  let total = 0;
  let current = 0;
  let seenAny = false;

  for (const w of rawTokens) {
    if (IGNORED.has(w)) continue;

    if (HUNDRED.has(w)) {
      current = (current === 0 ? 1 : current) * 100;
      seenAny = true;
      continue;
    }

    const group = GROUP_MULTIPLIERS.find((g) => g.words.includes(w));
    if (group) {
      total += (current === 0 ? 1 : current) * group.mult;
      current = 0;
      seenAny = true;
      continue;
    }

    const v = WORD_VALUES[w];
    if (v === undefined) return null; // notanish so'z — ishonchsiz, tekshirmaymiz
    current += v;
    seenAny = true;
  }

  if (!seenAny) return null;
  return total + current;
}

// ─────────────── O'tkazma summasini tanlash ───────────────

export type AmountRole = 'transfer' | 'refunded' | 'repay' | 'contract_total' | 'other';

export interface FoundAmount {
  amount: number;
  /** Hujjatda qavs ichida so'z bilan yozilgani (bo'lsa) */
  amountWords?: string | null;
  role?: AmountRole | string | null;
  /** Hujjatdagi jumla — operator tekshira olishi uchun */
  quote?: string | null;
}

export interface AmountDecision {
  /** Yakuniy o'tkazma summasi */
  amount: number;
  /** AI bergan summa tuzatildimi */
  corrected: boolean;
  warnings: string[];
  /** UI'da ko'rsatiladigan variantlar (operator bir bosishda almashtirsin) */
  alternatives: Array<{ amount: number; role: string; quote?: string | null }>;
}

const ROLE_LABEL: Record<string, string> = {
  transfer: "o'tkazma",
  refunded: 'qaytarilgan',
  repay: "qayta to'lov",
  contract_total: 'shartnoma summasi',
  other: 'boshqa',
};

const money = (n: number) => Math.round(n).toLocaleString('ru-RU');

/**
 * AI qaytargan summa va topilgan summalar ro'yxatidan HAQIQIY o'tkazma
 * summasini tanlaydi + nomuvofiqliklarni ogohlantirish qilib qaytaradi.
 *
 * @param aiAmount     AI bergan totalAmount
 * @param found        AI hujjatdan topgan barcha summalar (rol bilan)
 * @param sourceBalance Manba shartnomaning bizdagi qoldig'i (bo'lsa)
 */
export function decideTransferAmount(
  aiAmount: number,
  found: FoundAmount[] | null | undefined,
  sourceBalance: number | null,
): AmountDecision {
  const warnings: string[] = [];
  const list = (Array.isArray(found) ? found : [])
    .map((f) => ({
      amount: Number(f?.amount) || 0,
      words: f?.amountWords ?? null,
      role: String(f?.role || 'other'),
      quote: f?.quote ?? null,
    }))
    .filter((f) => f.amount > 0);

  let amount = Number(aiAmount) || 0;
  let corrected = false;

  // ── 1) Raqam ↔ so'z mosligi (hujjatda summa so'z bilan ham yoziladi) ──
  for (const f of list) {
    const fromWords = parseAmountWords(f.words);
    if (fromWords != null && Math.abs(fromWords - f.amount) > 0.5) {
      warnings.push(
        `Summa raqam va so'z bilan mos emas: ${money(f.amount)} (raqamda) ≠ ${money(fromWords)} (so'z bilan)` +
        (f.quote ? ` — "${String(f.quote).slice(0, 90)}"` : ''),
      );
    }
  }

  // ── 2) AI o'zi "o'tkazma" deb belgilagan summani olganmi? ──
  const transfers = list.filter((f) => f.role === 'transfer');
  if (transfers.length === 1 && Math.abs(transfers[0].amount - amount) > 0.5) {
    warnings.push(
      `O'tkazma summasi tuzatildi: agent ${money(amount)} bergan edi, arizada esa ` +
      `o'tkaziladigan summa ${money(transfers[0].amount)}` +
      (transfers[0].quote ? ` — "${String(transfers[0].quote).slice(0, 90)}"` : ''),
    );
    amount = transfers[0].amount;
    corrected = true;
  }

  // ── 3) AI qaytarilgan/qayta to'lov summasini o'tkazma qilib olganmi? ──
  const wrongRole = list.find(
    (f) => (f.role === 'refunded' || f.role === 'repay') && Math.abs(f.amount - amount) <= 0.5,
  );
  if (wrongRole && transfers.length === 0) {
    warnings.push(
      `DIQQAT: olingan summa (${money(amount)}) arizada "${ROLE_LABEL[wrongRole.role] || wrongRole.role}" ` +
      `deb ko'rsatilgan — o'tkazma summasi emas bo'lishi mumkin. Arizani tekshiring.`,
    );
  }

  // ── 4) Manba qoldig'i bilan solishtirish ──
  // Ariza odatda "shartnoma bo'yicha QOLGAN X" deydi — bu bizdagi qoldiqqa teng bo'ladi.
  if (sourceBalance != null && sourceBalance > 0) {
    const matchesBalance = list.find((f) => Math.abs(f.amount - sourceBalance) <= 1);
    if (matchesBalance && Math.abs(amount - sourceBalance) > 1) {
      warnings.push(
        `Manba qoldig'i ${money(sourceBalance)} — arizadagi ${money(matchesBalance.amount)} summasiga teng, ` +
        `lekin o'tkazma ${money(amount)} qilib olindi. Qaysi biri to'g'ri ekanini tekshiring.`,
      );
    }
  }

  return {
    amount,
    corrected,
    warnings,
    alternatives: list.map((f) => ({ amount: f.amount, role: f.role, quote: f.quote })),
  };
}
