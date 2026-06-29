'use client';

/**
 * ThemeProvider — qora rejim (dark mode) holatini boshqaradi.
 *
 * Muammo: oddiy bootstrap script + suppressHydrationWarning yetarli emas.
 * Ba'zi hollarda React hydration paytida `<html>` dan dark class olib
 * tashlanadi va refresh'dan keyin dark rejim "yo'qoladi".
 *
 * Yechim — Client component:
 *   1. localStorage'dan 'theme' o'qiydi
 *   2. <html> elementga 'dark' class qo'yadi/olib tashlaydi (har render'da)
 *   3. localStorage o'zgarganda boshqa tab'larda ham sinxron yangilanadi
 *      (storage event listener)
 *   4. useTheme() hook export qiladi — komponentlarda toggle qilish uchun
 *
 * Bootstrap script (layout.tsx <head>) hali ham qoladi — FOUC oldini olish
 * uchun (theme darrov apply bo'lsin, JS yuklanguncha kutmasdan).
 */

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

type Theme = 'light' | 'dark';

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeToDom(theme: Theme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') root.classList.add('dark');
  else root.classList.remove('dark');
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const s = localStorage.getItem('theme');
    return s === 'dark' ? 'dark' : 'light';
  } catch { return 'light'; }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // SSR/hydration uchun 'light' default; mount'dan keyin localStorage'dan o'qiymiz
  const [theme, setThemeState] = useState<Theme>('light');

  // Mount: localStorage'dan o'qib qo'llaymiz
  useEffect(() => {
    const initial = readStoredTheme();
    setThemeState(initial);
    applyThemeToDom(initial);
  }, []);

  // Har theme o'zgarganda — DOM'ga qo'llaymiz va saqlaymiz
  // Bu React hydration'dan keyin ham class'ni qayta qo'shadi (FIX uchun muhim).
  useEffect(() => {
    applyThemeToDom(theme);
    try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
  }, [theme]);

  // Boshqa tab'larda o'zgarsa — bu yerda ham sinxron yangilaymiz
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'theme') return;
      const v = e.newValue === 'dark' ? 'dark' : 'light';
      setThemeState(v);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => setThemeState((p) => (p === 'dark' ? 'light' : 'dark')), []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** Theme'ni o'qish va boshqarish — har komponentdan. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Provider tashqarisida — graceful degradation
    return {
      theme: 'light',
      setTheme: () => {},
      toggleTheme: () => {},
    };
  }
  return ctx;
}
