/**
 * Bank sverka Telegram DIGEST — sof (testlanadigan) render.
 *
 * Eski dizayn: har hisob = alohida xabar (guruh to'lardi, ajratib bo'lmasdi).
 * Yangi dizayn: har tekshiruvda BITTA yig'ma xabar — barcha farqlar raqamlangan
 * ro'yxat, ostida `✅ N` tugmalar (har farqni to'g'rilash) + 🔄 Yangilash / ❌ Yopish.
 * Tuzatilganда xabar JOYIDA yangilanadi; hammasi hal bo'lsa xabar o'chiriladi.
 */

export interface DigestAccount {
  accountId: string;
  accountNo?: string | null;
  ownerName?: string | null;
  bankName?: string | null;
  /** Farqning eng katta magnitudasi (so'm) — sarlavha raqami uchun. */
  totalFarq: number;
  /** AI ayb: bank | us | mixed | none | unknown. */
  culprit?: string;
  /** AI ishonch darajasi: high | medium | low. Faqat 'high' bo'lsa ayb ko'rsatiladi. */
  confidence?: string;
  /** Tugma orqali to'g'rilash mumkinmi (AI reja yoki qo'shish bor). */
  actionable?: boolean;
  /** Qaysi callback: 'ai' → apply:, 'add' → fix: (legacy qo'shish). */
  actionKind?: 'ai' | 'add';
}

/** Ru-uslubda raqam formatlash (1 234 567). */
export function fmtNum(n: number | undefined | null): string {
  if (n == null || !isFinite(Number(n))) return '0';
  return Number(n).toLocaleString('ru-RU');
}

/**
 * Ayb yorlig'i — FAQAT ishonchli (confidence='high') bo'lganda aniq ayb ko'rsatiladi.
 * Shubhali bo'lsa "⚔️ noaniq" — noto'g'ri ayb aytib chalkashtirmaslik uchun.
 */
export function faultLabel(culprit?: string, confidence?: string): string {
  if (confidence !== 'high') return "⚔️ noaniq — qo'lda";
  switch (culprit) {
    case 'bank': return '🔴 bank xatosi';
    case 'us': return '🔵 biz tomonda';
    case 'mixed': return '🟠 aralash';
    case 'none': return "🟢 farq yo'q";
    default: return "⚔️ noaniq — qo'lda";
  }
}

export interface RenderOpts {
  /** Ro'yxatda ko'rsatiladigan maksimal hisob (Telegram 4096 belgi limiti). */
  maxRows?: number;
  /** Tugma qo'yiladigan maksimal hisob. */
  maxButtons?: number;
  /** Vaqtinchalik izoh (masalan "✅ 3 qo'shildi") — keyingi yangilashda tozalanadi. */
  note?: string;
}

/**
 * Digest matni (HTML) + inline keyboard.
 * accounts BO'SH bo'lsa text='' qaytadi — chaqiruvchi xabarni o'chirishi kerak.
 */
export function renderDigest(
  accounts: DigestAccount[],
  date: string,
  nowTk: string,
  opts: RenderOpts = {},
): { text: string; keyboard: { inline_keyboard: any[] }; count: number } {
  const maxRows = opts.maxRows ?? 30;
  const maxButtons = opts.maxButtons ?? 12;

  // Eng katta farq tepada
  const list = [...accounts].sort((a, b) => (Number(b.totalFarq) || 0) - (Number(a.totalFarq) || 0));
  const count = list.length;
  if (count === 0) {
    return { text: '', keyboard: { inline_keyboard: [] }, count: 0 };
  }

  const shownList = list.slice(0, maxRows);
  const lines: string[] = [];
  lines.push(`🏦 <b>BANK SVERKA</b> — ${date}`);
  lines.push(`⚠️ <b>${count} ta</b> hisobda farq aniqlandi:`);
  lines.push('');

  shownList.forEach((a, i) => {
    const n = i + 1;
    const head = [a.bankName || '—', a.accountNo ? `<code>${a.accountNo}</code>` : null]
      .filter(Boolean)
      .join(' · ');
    lines.push(`<b>${n}.</b> ${head}`);
    const owner = a.ownerName ? `${a.ownerName} · ` : '';
    lines.push(`   ${owner}farq <code>${fmtNum(a.totalFarq)}</code> UZS · ${faultLabel(a.culprit, a.confidence)}`);
  });
  if (count > shownList.length) {
    lines.push('');
    lines.push(`… va yana <b>${count - shownList.length}</b> ta (saytda ko'ring)`);
  }
  if (opts.note) {
    lines.push('');
    lines.push(opts.note);
  }
  lines.push('');
  lines.push(`<i>✅ raqamni bosib to'g'rilang · to'liq: transactions.xonapps.uz/uz/check</i>`);
  lines.push(`<i>Yangilandi: ${nowTk}</i>`);

  // ── Keyboard ──
  const actionRows: any[][] = [];
  let row: any[] = [];
  let shownBtn = 0;
  shownList.forEach((a, i) => {
    if (!a.actionable || shownBtn >= maxButtons) return;
    const prefix = a.actionKind === 'add' ? 'fix' : 'apply';
    row.push({ text: `✅ ${i + 1}`, callback_data: `${prefix}:${a.accountId}:${date}` });
    shownBtn++;
    if (row.length === 4) {
      actionRows.push(row);
      row = [];
    }
  });
  if (row.length) actionRows.push(row);
  actionRows.push([
    { text: '🔄 Yangilash', callback_data: `refresh:${date}` },
    { text: '❌ Yopish', callback_data: `closeall:${date}` },
  ]);

  return { text: lines.join('\n'), keyboard: { inline_keyboard: actionRows }, count };
}
