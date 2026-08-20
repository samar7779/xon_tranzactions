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

// ─────────────── Rolni JUMLADAN aniqlash ───────────────
//
// Model matnni to'g'ri ko'chiradi, lekin hukmni (qaysi summa nima) chalkashtiradi
// (2026-08: 70 944 290 ni "qaytarilgan", 34 942 710 ni "o'tkazma" deb belgilagan —
// arizada esa aksi). Shuning uchun rolni MODEL EMAS, jumladagi kalit so'z belgilaydi.

export type AmountRole = 'transfer' | 'refunded' | 'repay' | 'contract_total' | 'other';

/** Rol → o'sha bandga xos kalit so'zlar (o'zbek kirill/lotin + rus) */
const ROLE_KEYWORDS: Array<{ role: AmountRole; words: string[] }> = [
  {
    role: 'refunded',
    words: ['қайтарилган', 'қайтариб берилган', 'qaytarilgan', 'qaytarib berilgan', 'возвращен', 'возврат'],
  },
  {
    role: 'repay',
    words: [
      'қайта тўлаш', 'қайта тўлаб', 'мажбуриятини оламан', 'банк куни ичида',
      'qayta tolash', "qayta to'lash", 'majburiyatini olaman', 'bank kuni ichida',
      'обязуюсь', 'банковских дней',
    ],
  },
  {
    role: 'transfer',
    words: [
      'қабул қилиш', 'қабул қилишингизни', 'тўлов ҳисобида', 'ҳисобига ўтказ', 'ўтказишингизни',
      'qabul qilish', 'qabul qilishingizni', 'tolov hisobida', "to'lov hisobida", 'hisobiga otkaz',
      'в счет оплаты', 'в счёт оплаты', 'зачесть', 'принять в счет', 'перевести',
    ],
  },
  {
    role: 'contract_total',
    words: ['шартнома қиймати', 'умумий қиймат', 'shartnoma qiymati', 'umumiy qiymat', 'стоимость договора'],
  },
];

function normText(s: string | null | undefined): string {
  return String(s || '').toLowerCase().replace(/[''`ʻʼ’‘]/g, '');
}

/**
 * Iqtibosdagi summaga ENG YAQIN kalit so'z bo'yicha rol.
 * Bitta jumlada bir nechta summa bo'lishi mumkin ("...qaytarilgan 34 942 710 sum.
 * Yangi Shartnoma 12 922 910 bo'yicha 3 bank kuni ichida qayta to'lash...") —
 * shuning uchun masofa bo'yicha eng yaqini olinadi.
 */
export function classifyRoleFromQuote(quote: string | null | undefined, amount: number): AmountRole | null {
  const q = normText(quote);
  if (!q) return null;

  // Summa raqamini bo'shliq/nuqta/vergul bilan ajratilgan holda ham topamiz: "70 944 290"
  const digits = String(Math.round(Math.abs(amount)));
  const pattern = digits.split('').join('[\\s.,\\u00a0]*');
  let pos = -1;
  try {
    const m = q.match(new RegExp(pattern));
    pos = m?.index ?? -1;
  } catch { pos = -1; }

  let best: { role: AmountRole; dist: number } | null = null;
  const rolesSeen = new Set<AmountRole>();
  for (const { role, words } of ROLE_KEYWORDS) {
    for (const w of words) {
      let idx = q.indexOf(w);
      while (idx !== -1) {
        rolesSeen.add(role);
        const dist = pos < 0 ? 0 : Math.abs(idx - pos);
        if (!best || dist < best.dist) best = { role, dist };
        idx = q.indexOf(w, idx + 1);
      }
    }
  }
  // Summa iqtibosda topilmasa va bir nechta xil rol uchrasa — taxmin qilmaymiz
  if (pos < 0 && rolesSeen.size > 1) return null;
  return best?.role ?? null;
}

/**
 * Matndan pul summalarini ajratish. Shartnoma raqamlari (24SRH24EF, №4105SRH26RL)
 * va sana/band raqamlari tushib qolishi uchun: harfga yopishgan raqamlar OLINMAYDI,
 * faqat guruhlangan (70 944 290) yoki 6+ xonali raqamlar olinadi.
 */
export function extractAmountsFromText(text: string | null | undefined): number[] {
  const s = String(text || '');
  const out: number[] = [];
  const re = /(?<![\p{L}\d])(\d{1,3}(?:[\s., ]\d{3})+|\d{6,})(?![\p{L}\d])/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const n = Number(m[1].replace(/[\s., ]/g, ''));
    if (isFinite(n) && n > 0) out.push(n);
  }
  return out;
}

// ─────────────── Ism solishtirish (kirill ↔ lotin) ───────────────

const TRANSLIT: Record<string, string> = {
  А: 'A', Б: 'B', В: 'V', Г: 'G', Д: 'D', Е: 'E', Ё: 'E', Ж: 'J', З: 'Z', И: 'I',
  Й: 'Y', К: 'K', Л: 'L', М: 'M', Н: 'N', О: 'O', П: 'P', Р: 'R', С: 'S', Т: 'T',
  У: 'U', Ф: 'F', Х: 'X', Ц: 'S', Ч: 'C', Ш: 'S', Щ: 'S', Ъ: '', Ы: 'I', Ь: '',
  Э: 'E', Ю: 'U', Я: 'A', Ў: 'O', Қ: 'Q', Ғ: 'G', Ҳ: 'H',
};

/** "Ахмедова Анбар" → "AXMEDOVA ANBAR" (lotin bilan solishtirish uchun) */
export function translitName(s: string | null | undefined): string {
  let out = '';
  for (const ch of String(s || '').toUpperCase()) out += TRANSLIT[ch] !== undefined ? TRANSLIT[ch] : ch;
  return out.replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Ikki ism mohiyatan bir odammi (kirill/lotin, tartib farqi hisobga olinadi).
 * Kamida 2 ta umumiy bo'lak (familya+ism) kerak; bo'laklardan biri bitta bo'lsa — 1 ta yetadi.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = translitName(a).split(' ').filter((t) => t.length >= 4);
  const tb = translitName(b).split(' ').filter((t) => t.length >= 4);
  if (!ta.length || !tb.length) return false;
  // "AXMEDOVA" ↔ "AHMEDOVA": X/H farqini yumshatamiz
  const soft = (t: string) => t.replace(/X/g, 'H');
  const sa = ta.map(soft);
  const sb = tb.map(soft);
  const common = sa.filter((t) => sb.includes(t)).length;
  return common >= Math.min(sa.length, sb.length, 2);
}

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
  /** Arizadagi o'tkazmani so'ragan JUMLA (model verbatim ko'chiradi) */
  transferQuote?: string | null,
): AmountDecision {
  const warnings: string[] = [];
  const list = (Array.isArray(found) ? found : [])
    .map((f) => {
      const amount = Number(f?.amount) || 0;
      const modelRole = String(f?.role || 'other');
      // ROLNI MODEL EMAS, IQTIBOS BELGILAYDI — model rollarni almashtirib yuborishi aniqlangan
      const quoteRole = classifyRoleFromQuote(f?.quote, amount);
      return {
        amount,
        words: f?.amountWords ?? null,
        role: (quoteRole || modelRole) as string,
        modelRole,
        roleFromQuote: !!quoteRole,
        quote: f?.quote ?? null,
      };
    })
    .filter((f) => f.amount > 0);

  let amount = Number(aiAmount) || 0;
  let corrected = false;

  // ── 0) Eng ishonchli manba: o'tkazmani so'ragan JUMLADAGI summa ──
  // Model rollarni chalkashtirsa ham, jumla matni yolg'on gapirmaydi.
  let quoteAmount: number | null = null;
  const fromQuotes = list.filter((f) => f.roleFromQuote && f.role === 'transfer');
  if (fromQuotes.length === 1) {
    quoteAmount = fromQuotes[0].amount;
  } else if (transferQuote) {
    const inQuote = extractAmountsFromText(transferQuote).filter((n) => n >= 10_000);
    // Ro'yxatda ham bor summalarni afzal ko'ramiz (tasodifiy raqamlar chiqib ketsin)
    const known = inQuote.filter((n) => list.some((f) => Math.abs(f.amount - n) <= 0.5));
    const pick = known.length ? known : inQuote;
    const uniq = Array.from(new Set(pick));
    // Jumla haqiqatan o'tkazma haqidami — kalit so'z bilan tekshiramiz
    if (uniq.length === 1 && classifyRoleFromQuote(transferQuote, uniq[0]) === 'transfer') {
      quoteAmount = uniq[0];
    }
  }

  if (quoteAmount != null && Math.abs(quoteAmount - amount) > 0.5) {
    const src = fromQuotes.length === 1 ? fromQuotes[0].quote : transferQuote;
    warnings.push(
      `O'tkazma summasi tuzatildi: agent ${money(amount)} bergan edi, arizada esa ` +
      `o'tkaziladigan summa ${money(quoteAmount)}` +
      (src ? ` — "${String(src).slice(0, 90)}"` : ''),
    );
    amount = quoteAmount;
    corrected = true;
  }

  // Model rolni chalkashtirgan bo'lsa — buni ochiq aytamiz (operator bilib tursin)
  const swapped = list.filter((f) => f.roleFromQuote && f.modelRole !== f.role && f.modelRole !== 'other');
  if (swapped.length > 0) {
    warnings.push(
      "Agent summa rollarini noto'g'ri belgilagan, ariza matni bo'yicha tuzatildi: " +
      swapped.map((f) => `${money(f.amount)} → ${ROLE_LABEL[f.role] || f.role}`).join(', '),
    );
  }

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

  // ── 2) ZAXIRA: iqtibos hal qilmagan bo'lsa — "transfer" rolli summa bo'yicha ──
  const transfers = list.filter((f) => f.role === 'transfer');
  if (quoteAmount == null && transfers.length === 1 && Math.abs(transfers[0].amount - amount) > 0.5) {
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
