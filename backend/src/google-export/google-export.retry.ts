// Google Sheets vaqtinchalik xatolari uchun qayta urinish (retry) va Telegram ogohlantirish matni.
// Faqat IDEMPOTENT amallar uchun (replace: bir xil diapazonga bir xil qiymat yozish / tozalash) —
// qayta yuborish natijani o'zgartirmaydi.

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const TRANSIENT_NET = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'EPIPE', 'ESOCKETTIMEDOUT']);
const TRANSIENT_TEXT = /service unavailable|unavailable|backend error|internal error|rate limit|quota exceeded|timed? ?out|socket hang up/i;

/** Google API xatosi vaqtinchalikmi (qayta urinsa o'tib ketishi mumkin)? 4xx (403/404/400) — yo'q. */
export function isTransientGoogleError(e: any): boolean {
  if (!e) return false;
  // gaxios: code — son (503), raqamli satr ('503') yoki tarmoq kodi ('ECONNRESET')
  const numericCode = typeof e?.code === 'number' || /^\d{3}$/.test(String(e?.code ?? '')) ? Number(e.code) : NaN;
  const status = Number(e?.response?.status ?? e?.status ?? numericCode);
  if (Number.isFinite(status)) {
    if (TRANSIENT_STATUS.has(status)) return true;
    if (status >= 400 && status < 500) return false; // ruxsat/topilmadi/noto'g'ri so'rov — qayta urinish befoyda
  }
  if (typeof e?.code === 'string' && TRANSIENT_NET.has(e.code)) return true;
  const msg = String(e?.response?.data?.error?.message || e?.response?.data?.error?.status || e?.message || '');
  return TRANSIENT_TEXT.test(msg);
}

export const RETRY_DELAYS_MS = [2000, 5000, 15000];

/**
 * fn() ni bajaradi; vaqtinchalik Google xatosida delays bo'yicha kutib qayta urinadi
 * (jami 1 + delays.length urinish). Doimiy xato yoki urinishlar tugasa — oxirgi xatoni tashlaydi.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    delays?: number[];
    sleep?: (ms: number) => Promise<void>;
    onRetry?: (attempt: number, delayMs: number, err: any) => void;
  } = {},
): Promise<T> {
  const delays = opts.delays ?? RETRY_DELAYS_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delays.length || !isTransientGoogleError(e)) throw e;
      opts.onRetry?.(attempt + 1, delays[attempt], e);
      await sleep(delays[attempt]);
    }
  }
}

const STEP_LABEL: Record<string, string> = {
  auth: 'Google kaliti (service-account)',
  validate: 'sozlama tekshiruvi',
  fetch: "bazadan o'qish",
  write: 'sheetga yozish',
  clear: 'ortiqcha pastki qatorlarni tozalash',
};

/** Export yiqilganda egaga yuboriladigan Telegram matni (oddiy matn, parse_mode yo'q). */
export function formatExportFailureAlert(p: {
  name: string; tabName?: string | null; writeMode: string; mode: 'cron' | 'manual';
  step: string; error: string; nowMs: number;
}): string {
  const t = new Date(p.nowMs + 5 * 60 * 60 * 1000).toISOString(); // Toshkent UTC+5
  const when = `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)} ${t.slice(11, 16)}`;
  const sheetState =
    p.writeMode === 'upsert' ? "Upsert rejimi: sheet tozalanmaydi, eski qatorlar joyida."
    : p.step === 'clear' ? "Yangi ma'lumot yozildi, faqat pastdagi eski ortiqcha qatorlar qolgan bo'lishi mumkin."
    : "Sheetdagi eski ma'lumot o'chirilmagan (avval yozamiz, keyin tozalaymiz).";
  return [
    '⚠️ Google Sheets eksporti bajarilmadi',
    '',
    `Sheet: ${p.name}${p.tabName ? ` / ${p.tabName}` : ''}`,
    `Qachon: ${when} (${p.mode === 'cron' ? 'avtomatik' : "qo'lda"})`,
    `Bosqich: ${STEP_LABEL[p.step] || p.step}`,
    `Xato: ${String(p.error || '').slice(0, 300)}`,
    '',
    sheetState,
    "Qayta ishga tushirish: Admin > Export > shu sheet > Bajarish (yoki keyingi avtomatik urinishni kuting).",
  ].join('\n');
}
