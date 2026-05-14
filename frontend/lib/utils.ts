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

export function formatDate(iso?: string | Date | null) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('uz-UZ', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function formatDateTime(iso?: string | Date | null) {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('uz-UZ', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).format(d);
}
