/**
 * Login sahifasi uchun haptik (vibratsiya) effektlar.
 * Ilgari Web Audio tovush effektlari bor edi — endi tovush o'rniga
 * mobil qurilmalarda vibratsiya ishlatiladi (desktop'da no-op).
 *
 * navigator.vibrate — Android Chrome'da ishlaydi; iOS Safari va desktop'da
 * qo'llab-quvvatlanmaydi, bunday holatda jim e'tiborsiz qoldiriladi.
 */

/** Haptik vibratsiya — pattern (ms) yoki ms massivi [vibrate, pause, ...]. */
export function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* qo'llab-quvvatlanmasa — e'tiborsiz */
  }
}
