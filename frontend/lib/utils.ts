import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatMoney(value: number | string, currency = 'UZS') {
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) return '—';
  // Format: 2 702 948 489,61 — bo'sh joy = mingliklar, vergul = kasr
  const fixed = Math.abs(n).toFixed(2);                       // "2702948489.61"
  const [intPart, decPart] = fixed.split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' '); // "2 702 948 489"
  const sign = n < 0 ? '−' : '';
  const dec = decPart === '00' ? '' : ',' + decPart;          // butun bo'lsa kasr ko'rsatilmaydi
  return `${sign}${grouped}${dec}${currency ? ' ' + currency : ''}`;
}

// DD.MM.YYYY format
export function formatDate(iso?: string | Date | null) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

// DD.MM.YYYY HH:mm format
export function formatDateTime(iso?: string | Date | null) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()} ${hh}:${min}`;
}
