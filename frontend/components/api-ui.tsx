'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Developer API sahifasining qayta ishlatiladigan UI primitivlari.
 * Yagona dizayn tili: dense, indigo+neutrals+semantic accents only,
 * rounded-md/lg/xl scale, focus-visible:ring-2 indigo.
 */

// ─── ICON BUTTON ─────────────────────────────────────────────────
export const iconBtnCls =
  'inline-flex items-center justify-center w-9 h-9 rounded-md text-slate-600 dark:text-slate-300 ' +
  'hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-indigo-500 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 ' +
  'outline-none transition-colors disabled:opacity-50 disabled:pointer-events-none';

export const IconBtn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'default' | 'rose' }>(
  ({ className, tone = 'default', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        iconBtnCls,
        tone === 'rose' && 'hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300',
        className,
      )}
      {...props}
    />
  ),
);
IconBtn.displayName = 'IconBtn';

// ─── PRIMARY BUTTON ──────────────────────────────────────────────
export const PrimaryBtn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { size?: 'sm' | 'md' }>(
  ({ className, size = 'md', children, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-all',
        'bg-indigo-600 hover:bg-indigo-700 text-white',
        'focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ' +
          'focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950 outline-none',
        'disabled:opacity-50 disabled:pointer-events-none',
        'shadow-sm hover:shadow',
        size === 'sm' && 'h-9 px-3 text-[12.5px]',
        size === 'md' && 'h-10 px-4 text-[13px]',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
);
PrimaryBtn.displayName = 'PrimaryBtn';

// ─── METHOD BADGE ────────────────────────────────────────────────
export function MethodBadge({ method, size = 'md' }: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT'; size?: 'sm' | 'md' }) {
  const colorCls: Record<string, string> = {
    GET: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    POST: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    PATCH: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    DELETE: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
    PUT: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
  };
  return (
    <span
      className={cn(
        'rounded font-mono font-bold whitespace-nowrap',
        size === 'sm' && 'px-1 py-px text-[9px] w-9 text-center',
        size === 'md' && 'px-1.5 py-0.5 text-[10px]',
        colorCls[method] || colorCls.GET,
      )}
    >
      {method}
    </span>
  );
}

// ─── EYEBROW (small uppercase label) ─────────────────────────────
export const eyebrow = 'text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400';

// ─── KBD KEY (keyboard shortcut hint) ────────────────────────────
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[18px] px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-[10px] font-mono text-slate-500 dark:text-slate-400">
      {children}
    </kbd>
  );
}
