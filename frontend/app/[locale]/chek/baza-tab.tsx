'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Loader2, User, Building2, Home, Calendar, FileText,
  Check, X, AlertTriangle, Save, Phone, Coins, Sparkles, CornerDownLeft,
  ChevronRight, BadgeCheck,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  makeT, vidLabel, VID_DOGOVORA_KEYS, type ChekLang,
} from './i18n';

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

interface Suggestion {
  contract: string;
  clientFullName: string | null;
  object: string | null;
  apartmentNumber: string | null;
  status: string | null;
  isTrashed: boolean;
  manager: string | null;
  managerPhone: string | null;
  branchName: string | null;
}

export function BazaTab({ lang }: { lang: ChekLang }) {
  const t = makeT(lang);

  const [contract, setContract] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [focused, setFocused] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const searchRef = useRef<HTMLDivElement>(null);

  const [manager, setManager] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [branchName, setBranchName] = useState('');
  const [objectName, setObjectName] = useState('');
  const [clientName, setClientName] = useState('');
  const [crmLoaded, setCrmLoaded] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [vidDogovora, setVidDogovora] = useState<string>('');
  const [kontrolyor, setKontrolyor] = useState<string>('');
  const [prichina, setPrichina] = useState('');
  const [shtrafy, setShtrafy] = useState('');

  // Debounce
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(contract.trim()), 250);
    return () => clearTimeout(id);
  }, [contract]);

  // Outside click yopadi
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setFocused(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const { data: suggData, isFetching: suggesting } = useQuery({
    queryKey: ['chek-crm-search', debouncedQ],
    queryFn: () => api.get<{ ok: boolean; items?: Suggestion[] }>(
      `/chek/crm-search?contract=${encodeURIComponent(debouncedQ)}`, { timeout: 20_000 },
    ),
    enabled: debouncedQ.length >= 3 && focused && !crmLoaded,
    staleTime: 30_000,
  });
  const suggestions = suggData?.items || [];
  const showDropdown = focused && !crmLoaded && debouncedQ.length >= 3;

  function resetCrm() {
    setManager(''); setManagerPhone(''); setBranchName(''); setObjectName(''); setClientName(''); setCrmLoaded(false);
  }

  function pick(s: Suggestion) {
    setContract(s.contract);
    setManager(s.manager || '');
    setManagerPhone(s.managerPhone || '');
    setBranchName(s.branchName || '');
    setObjectName(s.object || '');
    setClientName(s.clientFullName || '');
    setCrmLoaded(true);
    setFocused(false);
    setHighlight(-1);
  }

  // Fallback — to'liq raqam yozib "Yuklash" bosilganda (yoki Enter tanlovsiz)
  const lookup = useMutation({
    mutationFn: (c: string) => api.get<any>(`/chek/crm-lookup?contract=${encodeURIComponent(c)}`, { timeout: 25_000 }),
    onSuccess: (r) => {
      if (r?.ok && r.found) {
        setManager(r.manager || ''); setManagerPhone(r.managerPhone || '');
        setBranchName(r.branchName || ''); setObjectName(r.object || '');
        setClientName(r.clientFullName || ''); setCrmLoaded(true); setFocused(false);
        toast.success(t('crmLoaded'));
      } else {
        toast.warning(t('crmNotFound'));
      }
    },
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  const create = useMutation({
    mutationFn: (body: any) => api.post('/chek', body),
    onSuccess: () => {
      toast.success(t('saved'));
      setContract(''); setDebouncedQ(''); resetCrm();
      setVidDogovora(''); setKontrolyor(''); setPrichina(''); setShtrafy('');
      setDate(todayISO());
    },
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || suggestions.length === 0) {
      if (e.key === 'Enter' && contract.trim()) lookup.mutate(contract.trim());
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(suggestions.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(-1, h - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlight >= 0 && suggestions[highlight]) pick(suggestions[highlight]);
      else if (suggestions[0]) pick(suggestions[0]);
    } else if (e.key === 'Escape') { setFocused(false); setHighlight(-1); }
  }

  function submit() {
    const c = contract.trim();
    if (!c) { toast.warning(t('fillContract')); return; }
    if (!date || !vidDogovora || !kontrolyor) { toast.warning(t('fillRequired')); return; }
    create.mutate({
      contractNumber: c,
      manager: manager || undefined,
      managerPhone: managerPhone || undefined,
      branchName: branchName || undefined,
      objectName: objectName || undefined,
      data: date,
      vidDogovora, kontrolyor,
      prichinaOtkaza: prichina || undefined,
      shtrafy: shtrafy ? Math.round(Number(shtrafy)) : undefined,
    });
  }

  const canSave = !!contract.trim() && !!date && !!vidDogovora && !!kontrolyor && !create.isPending;

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* ═══ HERO — gradient banner + illustration + search ═══ */}
      <div className="relative rounded-[28px] overflow-visible bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 shadow-[0_30px_60px_-25px_rgba(124,58,237,0.7)]">
        {/* Dekoratsiya (kesilgan qatlam) */}
        <div className="absolute inset-0 rounded-[28px] overflow-hidden">
          <img src="/chek-hero.svg" alt="" aria-hidden
            className="absolute -right-4 top-1/2 -translate-y-1/2 h-[150%] max-w-none opacity-30 mix-blend-luminosity pointer-events-none select-none" />
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-800/50 via-violet-700/10 to-transparent" />
          <div className="absolute -top-16 -left-12 w-56 h-56 rounded-full bg-white/15 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.07]"
            style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '22px 22px' }} />
        </div>

        <div className="relative z-10 p-6 sm:p-7">
          <div className="flex items-center gap-2 mb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 backdrop-blur ring-1 ring-white/25 text-white text-[10px] uppercase tracking-[0.18em] font-bold">
              <Sparkles className="h-3 w-3" /> XonSaroy CRM
            </span>
          </div>
          <div className="text-white/90 text-[11px] uppercase tracking-[0.18em] font-bold mb-2.5 flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5" /> {t('contractNumber')}
          </div>

          <div className="relative" ref={searchRef}>
            {/* Glow ring focus */}
            <span aria-hidden className={cn('pointer-events-none absolute -inset-px rounded-2xl transition-opacity duration-300', focused ? 'opacity-100' : 'opacity-0')}
              style={{ background: 'conic-gradient(from var(--a,0deg),#6366f1,#a855f7,#ec4899,#6366f1)', filter: 'blur(1px)', animation: 'chekRing 6s linear infinite' }} />
            <style jsx>{`
              @keyframes chekRing { to { --a: 360deg; } }
              @property --a { syntax: '<angle>'; initial-value: 0deg; inherits: false; }
            `}</style>

            <div className="relative flex items-center gap-2">
              <div className="relative flex-1">
                <Search className={cn('absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 z-10 transition-colors', focused || contract ? 'text-indigo-500' : 'text-slate-400')} />
                <Input
                  value={contract}
                  onChange={(e) => { setContract(e.target.value); setHighlight(-1); if (crmLoaded) resetCrm(); }}
                  onFocus={() => setFocused(true)}
                  onKeyDown={onKeyDown}
                  placeholder={t('contractPlaceholder')}
                  className="relative pl-12 pr-4 text-base rounded-2xl font-mono bg-white dark:bg-slate-900 border-0 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 shadow-[0_10px_30px_-10px_rgba(0,0,0,0.4)] focus-visible:ring-0 focus-visible:shadow-[0_12px_35px_-8px_rgba(0,0,0,0.45)]"
                  style={{ height: 52 }}
                />
              </div>
              {contract && !crmLoaded && (
                <Button onClick={() => contract.trim() && lookup.mutate(contract.trim())} disabled={lookup.isPending}
                  className="px-4 gap-1.5 rounded-2xl bg-white text-indigo-700 hover:bg-white/90 font-bold shadow-lg" style={{ height: 52 }}>
                  {lookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {lookup.isPending ? t('loading') : t('load')}
                </Button>
              )}
            </div>

            {/* Autocomplete dropdown */}
            {showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 z-30 rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.4)] overflow-hidden">
                {suggesting && suggestions.length === 0 ? (
                  <div className="px-4 py-3 text-[12px] text-slate-500 flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('loading')}
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="px-4 py-6 text-[12px] text-slate-500 text-center">
                    <Search className="h-6 w-6 text-slate-300 mx-auto mb-1.5" /> {t('crmNotFound')}
                  </div>
                ) : (
                  <>
                    <div className="px-4 py-2 text-[10px] uppercase tracking-[0.15em] font-bold text-slate-400 bg-slate-50/70 dark:bg-slate-800/60 flex items-center justify-between">
                      <span>{suggestions.length}</span>
                      <span className="flex items-center gap-1 normal-case tracking-normal font-medium"><CornerDownLeft className="h-2.5 w-2.5" /> Enter</span>
                    </div>
                    <div className="max-h-[340px] overflow-y-auto divide-y divide-slate-50 dark:divide-slate-800">
                      {suggestions.map((s, i) => (
                        <button key={s.contract + i} type="button"
                          onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                          onMouseEnter={() => setHighlight(i)}
                          className={cn('w-full px-4 py-2.5 text-left flex items-center gap-3 transition-colors', highlight === i ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-slate-50 dark:hover:bg-slate-800')}>
                          <div className={cn('w-9 h-9 rounded-xl grid place-items-center shrink-0', highlight === i ? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500')}>
                            <FileText className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={cn('font-mono text-[13px] font-bold truncate', s.isTrashed ? 'text-rose-600 line-through' : 'text-slate-800 dark:text-slate-200')}>{s.contract}</span>
                              {s.status && <span className="text-[9px] px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold shrink-0">{s.status}</span>}
                            </div>
                            <div className="text-[11px] text-slate-500 truncate mt-0.5">
                              {[s.clientFullName, s.object].filter(Boolean).join(' · ') || '—'}
                            </div>
                          </div>
                          <ChevronRight className={cn('h-4 w-4 shrink-0', highlight === i ? 'text-indigo-500' : 'text-slate-300')} />
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* CRM natijasi — premium chips */}
          {crmLoaded && (
            <div className="mt-4 animate-in fade-in slide-in-from-top-1 duration-300">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-emerald-100 mb-2.5">
                <BadgeCheck className="h-3.5 w-3.5" /> {t('crmLoaded')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <CrmCard icon={<User className="h-4 w-4" />} label={t('manager')} value={manager} sub={managerPhone} subIcon={<Phone className="h-3 w-3" />} accent="indigo" />
                <CrmCard icon={<Building2 className="h-4 w-4" />} label={t('salesOffice')} value={branchName} accent="violet" />
                <CrmCard icon={<Home className="h-4 w-4" />} label={t('object')} value={objectName} sub={clientName} subIcon={<User className="h-3 w-3" />} accent="emerald" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Forma — glassmorphism ═══ */}
      <div className="rounded-3xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl ring-1 ring-white/60 dark:ring-slate-800 shadow-[0_20px_50px_-25px_rgba(79,70,229,0.35)] p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={t('date')} icon={<Calendar className="h-3.5 w-3.5 text-indigo-500" />}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 rounded-xl" />
          </Field>
          <Field label={t('vidDogovora')} icon={<FileText className="h-3.5 w-3.5 text-violet-500" />} required>
            <Select value={vidDogovora} onValueChange={setVidDogovora}>
              <SelectTrigger className="h-11 rounded-xl"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {VID_DOGOVORA_KEYS.map((k) => <SelectItem key={k} value={k}>{vidLabel(lang, k)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label={t('kontrolyor')} icon={<Check className="h-3.5 w-3.5 text-emerald-500" />} required>
          <div className="grid grid-cols-2 gap-3">
            <KontrolyorBtn active={kontrolyor === 'prinyat'} tone="ok" label={t('kontrolyor_prinyat')} onClick={() => setKontrolyor('prinyat')} />
            <KontrolyorBtn active={kontrolyor === 'otkaz'} tone="no" label={t('kontrolyor_otkaz')} onClick={() => setKontrolyor('otkaz')} />
          </div>
        </Field>

        <Field label={t('prichinaOtkaza')} icon={<AlertTriangle className={cn('h-3.5 w-3.5', kontrolyor === 'otkaz' ? 'text-rose-500' : 'text-slate-400')} />}>
          <textarea value={prichina} onChange={(e) => setPrichina(e.target.value)} placeholder={t('prichinaPlaceholder')} rows={2}
            className={cn('w-full rounded-xl border bg-background px-3 py-2.5 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400/40 transition-all',
              kontrolyor === 'otkaz' ? 'border-rose-300 dark:border-rose-800 bg-rose-50/30 dark:bg-rose-950/20' : 'border-input')} />
        </Field>

        <Field label={t('shtrafy')} icon={<Coins className="h-3.5 w-3.5 text-amber-500" />} hint={t('shtrafyHint')}>
          <div className="relative max-w-xs">
            <Input type="number" inputMode="numeric" min={0} value={shtrafy} onChange={(e) => setShtrafy(e.target.value)} placeholder="0" className="h-11 rounded-xl tabular-nums pr-12" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-slate-400">UZS</span>
          </div>
        </Field>

        <div className="pt-1 flex justify-end">
          <Button onClick={submit} disabled={!canSave}
            className="h-12 px-7 gap-2 rounded-2xl text-[14px] font-bold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 shadow-lg shadow-indigo-500/25 disabled:opacity-50 disabled:shadow-none">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {create.isPending ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function KontrolyorBtn({ active, tone, label, onClick }: { active: boolean; tone: 'ok' | 'no'; label: string; onClick: () => void }) {
  const ok = tone === 'ok';
  return (
    <button type="button" onClick={onClick}
      className={cn('relative flex items-center justify-center gap-2 h-14 rounded-2xl border-2 font-bold text-sm transition-all overflow-hidden',
        active
          ? ok
            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 shadow-lg shadow-emerald-500/20 scale-[1.02]'
            : 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 shadow-lg shadow-rose-500/20 scale-[1.02]'
          : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300')}>
      <span className={cn('grid place-items-center w-7 h-7 rounded-full transition-transform', active && 'scale-110', ok ? (active ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-800') : (active ? 'bg-rose-500 text-white' : 'bg-slate-100 dark:bg-slate-800'))}>
        {ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
      </span>
      {label}
    </button>
  );
}

function Field({ label, icon, required, hint, children }: { label: string; icon?: React.ReactNode; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
        {icon} {label}
        {required && <span className="text-rose-500">*</span>}
        {hint && <span className="ml-1 normal-case tracking-normal font-medium text-slate-400 lowercase">({hint})</span>}
      </label>
      {children}
    </div>
  );
}

function CrmCard({ icon, label, value, sub, subIcon, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; subIcon?: React.ReactNode;
  accent: 'indigo' | 'violet' | 'emerald';
}) {
  const map = {
    indigo: 'from-indigo-500 to-blue-600 shadow-indigo-500/25',
    violet: 'from-violet-500 to-purple-600 shadow-violet-500/25',
    emerald: 'from-emerald-500 to-teal-600 shadow-emerald-500/25',
  } as const;
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-3.5 bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-800/30">
      <div className="flex items-center gap-2 mb-1.5">
        <span className={cn('w-7 h-7 rounded-lg grid place-items-center text-white shrink-0 bg-gradient-to-br shadow-md', map[accent])}>{icon}</span>
        <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500">{label}</span>
      </div>
      <div className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate" title={value}>{value || '—'}</div>
      {sub && <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 truncate">{subIcon}{sub}</div>}
    </div>
  );
}
