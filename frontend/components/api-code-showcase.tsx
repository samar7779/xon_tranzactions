'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, ArrowDown, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePrefersReducedMotion } from '@/lib/use-reduced-motion';

/**
 * Premium code editor showcase — Stripe/Resend/Vercel uslubida.
 * 3 tabli code window + animated flow + JSON response window.
 * Pure CSS + Framer Motion (no Three.js, fast).
 */

type Lang = 'curl' | 'node' | 'python';

const TABS: { key: Lang; label: string }[] = [
  { key: 'curl', label: 'cURL' },
  { key: 'node', label: 'Node.js' },
  { key: 'python', label: 'Python' },
];

function getCode(lang: Lang, origin: string): { lines: { txt: string; tokens?: Token[] }[] } {
  const u = `${origin}/api/v1/transactions`;
  if (lang === 'curl') {
    return {
      lines: [
        { txt: '# GET tranzaksiyalar (oxirgi 50)', tokens: [{ type: 'comment', start: 0, end: 31 }] },
        { txt: `curl ${u} \\`, tokens: [{ type: 'cmd', start: 0, end: 4 }, { type: 'url', start: 5, end: 5 + u.length }] },
        { txt: `  -H "X-API-Key: xk_live_..."  \\`, tokens: [{ type: 'flag', start: 2, end: 4 }, { type: 'string', start: 5, end: 32 }] },
        { txt: `  -H "X-API-Secret: xs_live_..."`, tokens: [{ type: 'flag', start: 2, end: 4 }, { type: 'string', start: 5, end: 33 }] },
      ],
    };
  }
  if (lang === 'node') {
    return {
      lines: [
        { txt: '// Node.js — fetch API', tokens: [{ type: 'comment', start: 0, end: 22 }] },
        { txt: `const r = await fetch("${u}", {`, tokens: [{ type: 'kw', start: 0, end: 5 }, { type: 'kw', start: 10, end: 15 }, { type: 'fn', start: 16, end: 21 }, { type: 'string', start: 22, end: 22 + u.length + 2 }] },
        { txt: '  headers: {', tokens: [] },
        { txt: '    "X-API-Key": "xk_live_...",', tokens: [{ type: 'string', start: 4, end: 16 }, { type: 'string', start: 18, end: 32 }] },
        { txt: '    "X-API-Secret": "xs_live_...",', tokens: [{ type: 'string', start: 4, end: 19 }, { type: 'string', start: 21, end: 35 }] },
        { txt: '  },', tokens: [] },
        { txt: '});', tokens: [] },
      ],
    };
  }
  return {
    lines: [
      { txt: '# Python — requests', tokens: [{ type: 'comment', start: 0, end: 19 }] },
      { txt: 'import requests', tokens: [{ type: 'kw', start: 0, end: 6 }] },
      { txt: '', tokens: [] },
      { txt: `r = requests.get("${u}",`, tokens: [{ type: 'fn', start: 13, end: 16 }, { type: 'string', start: 17, end: 19 + u.length } ] },
      { txt: '  headers={', tokens: [] },
      { txt: '    "X-API-Key": "xk_live_...",', tokens: [{ type: 'string', start: 4, end: 16 }, { type: 'string', start: 18, end: 32 }] },
      { txt: '    "X-API-Secret": "xs_live_..."', tokens: [{ type: 'string', start: 4, end: 19 }, { type: 'string', start: 21, end: 35 }] },
      { txt: '  })', tokens: [] },
    ],
  };
}

interface Token { type: 'cmd' | 'flag' | 'kw' | 'fn' | 'string' | 'comment' | 'url'; start: number; end: number; }

const TOKEN_CLS: Record<string, string> = {
  cmd: 'text-violet-300',
  flag: 'text-slate-500',
  kw: 'text-indigo-300',
  fn: 'text-cyan-300',
  string: 'text-emerald-300',
  comment: 'text-slate-500 italic',
  url: 'text-slate-200',
};

function renderLine(line: { txt: string; tokens?: Token[] }) {
  if (!line.tokens || line.tokens.length === 0) {
    return <span className="text-slate-300">{line.txt || ' '}</span>;
  }
  const parts: React.ReactNode[] = [];
  let pos = 0;
  // Sort by start
  const sorted = [...line.tokens].sort((a, b) => a.start - b.start);
  for (const tok of sorted) {
    if (tok.start > pos) parts.push(<span key={`p-${pos}`} className="text-slate-300">{line.txt.slice(pos, tok.start)}</span>);
    parts.push(<span key={`t-${tok.start}`} className={TOKEN_CLS[tok.type]}>{line.txt.slice(tok.start, tok.end)}</span>);
    pos = tok.end;
  }
  if (pos < line.txt.length) parts.push(<span key={`r-${pos}`} className="text-slate-300">{line.txt.slice(pos)}</span>);
  return <>{parts}</>;
}

// ────────────────────────────────────────────────────────
// Response preview — beautifully formatted JSON
// ────────────────────────────────────────────────────────
function ResponseWindow({ ms, status }: { ms: number; status: number }) {
  // Realistic mock response from /api/v1/transactions
  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
      <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300">
            {status}
          </span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">{ms}ms</span>
          <span className="text-[10.5px] uppercase tracking-widest font-bold text-slate-400 dark:text-slate-500">Response</span>
        </div>
        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">application/json</span>
      </div>
      <pre className="px-4 py-3 text-[11.5px] font-mono leading-relaxed text-slate-800 dark:text-slate-200 overflow-x-auto">
{`{
  `}<span className="text-rose-500 dark:text-rose-300">"ok"</span>{`: `}<span className="text-emerald-600 dark:text-emerald-300">true</span>{`,
  `}<span className="text-rose-500 dark:text-rose-300">"total"</span>{`: `}<span className="text-violet-600 dark:text-violet-300">12450</span>{`,
  `}<span className="text-rose-500 dark:text-rose-300">"page"</span>{`: `}<span className="text-violet-600 dark:text-violet-300">1</span>{`,
  `}<span className="text-rose-500 dark:text-rose-300">"items"</span>{`: [
    {
      `}<span className="text-rose-500 dark:text-rose-300">"id"</span>{`: `}<span className="text-emerald-600 dark:text-emerald-300">"clxk1..."</span>{`,
      `}<span className="text-rose-500 dark:text-rose-300">"direction"</span>{`: `}<span className="text-emerald-600 dark:text-emerald-300">"IN"</span>{`,
      `}<span className="text-rose-500 dark:text-rose-300">"amount"</span>{`: `}<span className="text-violet-600 dark:text-violet-300">2750000</span>{`,
      `}<span className="text-rose-500 dark:text-rose-300">"currency"</span>{`: `}<span className="text-emerald-600 dark:text-emerald-300">"UZS"</span>{`,
      `}<span className="text-rose-500 dark:text-rose-300">"txnDate"</span>{`: `}<span className="text-emerald-600 dark:text-emerald-300">"2026-06-17"</span>{`
    }
  ]
}`}
      </pre>
    </div>
  );
}

// ────────────────────────────────────────────────────────
// Animated request → response flow
// ────────────────────────────────────────────────────────
function FlowConnector({ animate }: { animate: boolean }) {
  return (
    <div className="relative h-10 flex items-center justify-center" aria-hidden="true">
      <div className="absolute inset-x-0 flex justify-center">
        <div className="w-px h-full bg-gradient-to-b from-indigo-300/0 via-indigo-400 to-indigo-300/0 dark:via-indigo-500" />
      </div>
      <motion.div
        animate={animate ? { y: [-8, 8, -8] } : {}}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        className="relative z-10 w-7 h-7 rounded-full bg-white dark:bg-slate-900 ring-1 ring-indigo-200 dark:ring-indigo-800 grid place-items-center shadow-sm"
      >
        <ArrowDown className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
      </motion.div>
    </div>
  );
}

export function ApiCodeShowcase() {
  const [tab, setTab] = useState<Lang>('curl');
  const [copied, setCopied] = useState(false);
  const reduced = usePrefersReducedMotion();
  const [origin, setOrigin] = useState('https://transactions.xonapps.uz');

  useEffect(() => {
    if (typeof window !== 'undefined') setOrigin(window.location.origin);
  }, []);

  const code = useMemo(() => getCode(tab, origin), [tab, origin]);

  const copy = async () => {
    const text = code.lines.map((l) => l.txt).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative max-w-[600px] mx-auto lg:max-w-none">
      {/* Decorative gradient blobs */}
      <div className="absolute -top-12 -left-12 w-72 h-72 bg-gradient-to-br from-indigo-300/30 to-violet-300/20 dark:from-indigo-600/15 dark:to-violet-600/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />
      <div className="absolute -bottom-12 -right-12 w-72 h-72 bg-gradient-to-br from-cyan-300/25 to-indigo-300/15 dark:from-cyan-600/12 dark:to-indigo-600/10 rounded-full blur-3xl pointer-events-none" aria-hidden="true" />

      <div className="relative">
        {/* Code editor window */}
        <div className="rounded-xl overflow-hidden bg-slate-950 ring-1 ring-slate-800 shadow-2xl shadow-indigo-500/10 dark:shadow-violet-900/20">
          {/* Window chrome */}
          <div className="px-3 py-2 bg-slate-900/80 border-b border-slate-800 flex items-center gap-2">
            <div className="flex items-center gap-1.5" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
            </div>
            {/* Language tabs */}
            <div className="flex items-center ml-3 -mb-2">
              {TABS.map((tb) => {
                const active = tb.key === tab;
                return (
                  <button
                    key={tb.key}
                    onClick={() => setTab(tb.key)}
                    className={cn(
                      'px-3 py-2 text-[11px] font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-t border-b-2',
                      active ? 'border-emerald-400 text-emerald-300' : 'border-transparent text-slate-500 hover:text-slate-300',
                    )}
                    aria-pressed={active}
                  >
                    {tb.label}
                  </button>
                );
              })}
            </div>
            <button
              onClick={copy}
              className="ml-auto h-7 px-2 inline-flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-emerald-300 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
              aria-label="Copy code"
            >
              {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>

          {/* Code body — with line numbers */}
          <div className="flex text-[12px] font-mono">
            {/* Gutter */}
            <div className="select-none pl-3 pr-2 py-3 text-right text-slate-600 dark:text-slate-700 leading-[1.75]">
              {code.lines.map((_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.pre
                key={tab}
                initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -6 }}
                transition={{ duration: reduced ? 0 : 0.18 }}
                className="flex-1 py-3 pr-4 leading-[1.75] overflow-x-auto"
              >
                {code.lines.map((line, i) => (
                  <div key={i}>{renderLine(line)}</div>
                ))}
                {/* Blinking cursor at end */}
                {!reduced && (
                  <motion.span
                    animate={{ opacity: [1, 0.3, 1] }}
                    transition={{ duration: 1.1, repeat: Infinity }}
                    className="inline-block w-1.5 h-3.5 bg-emerald-400 align-middle ml-px"
                    aria-hidden="true"
                  />
                )}
              </motion.pre>
            </AnimatePresence>
          </div>
        </div>

        <FlowConnector animate={!reduced} />

        {/* Response */}
        <ResponseWindow ms={42} status={200} />

        {/* Live indicator below */}
        <div className="flex items-center justify-center gap-2 mt-4 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="relative flex h-2 w-2" aria-hidden="true">
            <span className={cn('absolute inline-flex h-full w-full rounded-full bg-emerald-400', !reduced && 'animate-ping opacity-75')} />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-medium">Operational</span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span><b className="text-slate-700 dark:text-slate-300 tabular-nums">14</b> endpoints</span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span><b className="text-slate-700 dark:text-slate-300 tabular-nums">&lt;100ms</b> p95</span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3 text-amber-500" /> v1</span>
        </div>
      </div>
    </div>
  );
}
