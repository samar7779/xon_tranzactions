'use client';

import { create } from 'zustand';

/**
 * Shaxsiy sozlamalar (har foydalanuvchi uchun) — accent rang + sevimli sahifalar.
 * localStorage'da saqlanadi (avatar bilan bir xil yondashuv), reaktiv (zustand).
 */

export type Accent = 'indigo' | 'violet' | 'emerald' | 'rose' | 'amber' | 'sky' | 'fuchsia' | 'teal';

export const ACCENTS: { key: Accent; label: string; hex: string }[] = [
  { key: 'indigo', label: 'Indigo', hex: '#6366f1' },
  { key: 'violet', label: 'Binafsha', hex: '#8b5cf6' },
  { key: 'emerald', label: 'Zumrad', hex: '#10b981' },
  { key: 'rose', label: 'Atirgul', hex: '#f43f5e' },
  { key: 'amber', label: 'Kahrabo', hex: '#f59e0b' },
  { key: 'sky', label: 'Osmon', hex: '#0ea5e9' },
  { key: 'fuchsia', label: 'Fuksiya', hex: '#d946ef' },
  { key: 'teal', label: 'Feruza', hex: '#14b8a6' },
];

export interface FavItem {
  href: string; // locale'siz app-yo'l, masalan "/oplatykv/xato-crm"
  label: string;
}

interface PrefsState {
  userId: string | null;
  accent: Accent;
  favorites: FavItem[];
  init: (userId: string | null) => void;
  setAccent: (a: Accent) => void;
  toggleFavorite: (item: FavItem) => void;
  isFavorite: (href: string) => boolean;
  removeFavorite: (href: string) => void;
  reset: () => void;
}

function applyAccent(accent: Accent) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (accent === 'indigo') root.removeAttribute('data-accent');
  else root.setAttribute('data-accent', accent);
}

const keyFor = (userId: string | null) => `xt_prefs_${userId || 'anon'}`;

function load(userId: string | null): { accent: Accent; favorites: FavItem[] } {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (raw) {
      const p = JSON.parse(raw);
      return {
        accent: (p.accent as Accent) || 'indigo',
        favorites: Array.isArray(p.favorites) ? p.favorites.filter((f: any) => f?.href && f?.label) : [],
      };
    }
  } catch { /* ignore */ }
  return { accent: 'indigo', favorites: [] };
}

function save(userId: string | null, accent: Accent, favorites: FavItem[]) {
  try { localStorage.setItem(keyFor(userId), JSON.stringify({ accent, favorites })); } catch { /* ignore */ }
}

export const usePrefs = create<PrefsState>((set, get) => ({
  userId: null,
  accent: 'indigo',
  favorites: [],

  init: (userId) => {
    const { accent, favorites } = load(userId);
    applyAccent(accent);
    set({ userId, accent, favorites });
  },

  setAccent: (accent) => {
    applyAccent(accent);
    set({ accent });
    const { userId, favorites } = get();
    save(userId, accent, favorites);
  },

  toggleFavorite: (item) => {
    const { userId, favorites, accent } = get();
    const exists = favorites.some((f) => f.href === item.href);
    const next = exists ? favorites.filter((f) => f.href !== item.href) : [...favorites, item];
    set({ favorites: next });
    save(userId, accent, next);
  },

  removeFavorite: (href) => {
    const { userId, favorites, accent } = get();
    const next = favorites.filter((f) => f.href !== href);
    set({ favorites: next });
    save(userId, accent, next);
  },

  isFavorite: (href) => get().favorites.some((f) => f.href === href),

  reset: () => {
    applyAccent('indigo');
    const { userId } = get();
    set({ accent: 'indigo', favorites: [] });
    save(userId, 'indigo', []);
  },
}));

/** pathname'dan locale prefiksini olib tashlaydi → app-yo'l ("/uz/oplatykv" → "/oplatykv"). */
export function stripLocale(pathname: string): string {
  return pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '') || '/';
}
