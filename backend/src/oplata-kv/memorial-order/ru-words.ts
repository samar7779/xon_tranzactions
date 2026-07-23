/**
 * Summani rus tilida so'z bilan yozish — "Сумма прописью" uchun.
 * Namuna: 1450000.00 -> "Один миллион четыреста пятьдесят тысяч сум ноль тийин"
 *
 * Butun qism — сум, kasr qism (2 xona) — тийин.
 * Rod (jins): тысяча — ayol rodi (одна/две тысячи), миллион/миллиард — erkak rodi,
 * сум/тийин — erkak rodi (invariabel — turlanmaydi).
 */

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

/** 0..999 -> so'z (feminine=true bo'lsa 1/2 ayol rodida) */
function triad(n: number, feminine: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h) out.push(HUNDREDS[h]);
  if (rest >= 10 && rest <= 19) {
    out.push(TEENS[rest - 10]);
  } else {
    const t = Math.floor(rest / 10);
    const o = rest % 10;
    if (t) out.push(TENS[t]);
    if (o) out.push((feminine ? ONES_F : ONES_M)[o]);
  }
  return out;
}

/** Ruscha ko'plik shakli: 1->one, 2..4->few, boshqa->many (11..14 -> many) */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && !(m100 >= 12 && m100 <= 14)) return few;
  return many;
}

/** Butun sonni so'z bilan (0 -> "ноль"). units bo'yicha rod hisobga olinadi. */
function intToWords(num: number): string {
  if (num === 0) return 'ноль';
  const parts: string[] = [];

  const scales: { div: number; fem: boolean; forms?: [string, string, string] }[] = [
    { div: 1_000_000_000, fem: false, forms: ['миллиард', 'миллиарда', 'миллиардов'] },
    { div: 1_000_000, fem: false, forms: ['миллион', 'миллиона', 'миллионов'] },
    { div: 1_000, fem: true, forms: ['тысяча', 'тысячи', 'тысяч'] },
    { div: 1, fem: false }, // сум triadasi — erkak rodi
  ];

  let remainder = num;
  for (const s of scales) {
    const cnt = Math.floor(remainder / s.div);
    remainder = remainder % s.div;
    if (cnt === 0) continue;
    const words = triad(cnt, s.fem);
    parts.push(...words);
    if (s.forms) parts.push(plural(cnt, s.forms[0], s.forms[1], s.forms[2]));
  }
  return parts.filter(Boolean).join(' ');
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * amount (сум, kasr = тийин) -> "Один миллион ... сум NN тийин"
 * amount — number yoki string (Decimal). Manfiy bo'lsa "минус" qo'shiladi.
 */
export function amountToWordsRu(amount: number | string): string {
  let n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) n = 0;
  const neg = n < 0;
  n = Math.abs(n);
  const som = Math.floor(n + 1e-9);
  const tiyin = Math.round((n - som) * 100);

  const somWords = intToWords(som);
  // тийин — invariabel; son 0 bo'lsa "ноль"
  const tiyinWords = tiyin === 0 ? 'ноль' : intToWords(tiyin);

  const body = `${somWords} сум ${tiyinWords} тийин`;
  const withSign = neg ? `минус ${body}` : body;
  // Faqat birinchi harf katta ("Один ... тийин")
  return capitalize(withSign);
}
