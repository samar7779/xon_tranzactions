'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Loader2, User, Building2, Home, Calendar, FileText,
  Check, X, AlertTriangle, Save, Phone, Coins,
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

interface CrmMeta {
  ok: boolean;
  found?: boolean;
  manager?: string | null;
  managerPhone?: string | null;
  branchName?: string | null;
  object?: string | null;
}

export function BazaTab({ lang }: { lang: ChekLang }) {
  const t = makeT(lang);

  const [contract, setContract] = useState('');
  const [manager, setManager] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [branchName, setBranchName] = useState('');
  const [objectName, setObjectName] = useState('');
  const [crmLoaded, setCrmLoaded] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [vidDogovora, setVidDogovora] = useState<string>('');
  const [kontrolyor, setKontrolyor] = useState<string>('');
  const [prichina, setPrichina] = useState('');
  const [shtrafy, setShtrafy] = useState('');

  function resetCrm() {
    setManager(''); setManagerPhone(''); setBranchName(''); setObjectName(''); setCrmLoaded(false);
  }

  const lookup = useMutation({
    mutationFn: (c: string) =>
      api.get<CrmMeta>(`/chek/crm-lookup?contract=${encodeURIComponent(c)}`, { timeout: 25_000 }),
    onSuccess: (r) => {
      if (r?.ok && r.found) {
        setManager(r.manager || '');
        setManagerPhone(r.managerPhone || '');
        setBranchName(r.branchName || '');
        setObjectName(r.object || '');
        setCrmLoaded(true);
        toast.success(t('crmLoaded'));
      } else {
        resetCrm();
        toast.warning(t('crmNotFound'));
      }
    },
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  const create = useMutation({
    mutationFn: (body: any) => api.post('/chek', body),
    onSuccess: () => {
      toast.success(t('saved'));
      // Formani tozalash (sana bugungi holicha qoladi)
      setContract(''); resetCrm();
      setVidDogovora(''); setKontrolyor(''); setPrichina(''); setShtrafy('');
      setDate(todayISO());
    },
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  function runLookup() {
    const c = contract.trim();
    if (!c) { toast.warning(t('fillContract')); return; }
    lookup.mutate(c);
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
      vidDogovora,
      kontrolyor,
      prichinaOtkaza: prichina || undefined,
      shtrafy: shtrafy ? Math.round(Number(shtrafy)) : undefined,
    });
  }

  return (
    <div className="space-y-5 max-w-3xl">
      {/* ── Shartnoma qidiruv ── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5">
        <label className="text-[11px] uppercase tracking-[0.15em] font-bold text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5" /> {t('contractNumber')}
        </label>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={contract}
              onChange={(e) => { setContract(e.target.value); if (crmLoaded) resetCrm(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') runLookup(); }}
              placeholder={t('contractPlaceholder')}
              className="pl-9 h-11 font-mono"
            />
          </div>
          <Button onClick={runLookup} disabled={lookup.isPending || !contract.trim()} className="h-11 px-4 gap-1.5">
            {lookup.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {lookup.isPending ? t('loading') : t('load')}
          </Button>
        </div>

        {/* CRM natijalari (o'qish uchun) */}
        {crmLoaded && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CrmField icon={<User className="h-4 w-4" />} label={t('manager')} value={manager} sub={managerPhone} subIcon={<Phone className="h-3 w-3" />} />
            <CrmField icon={<Building2 className="h-4 w-4" />} label={t('salesOffice')} value={branchName} accent="violet" />
            <CrmField icon={<Home className="h-4 w-4" />} label={t('object')} value={objectName} accent="emerald" />
          </div>
        )}
      </div>

      {/* ── Forma ── */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Sana */}
          <Field label={t('date')} icon={<Calendar className="h-3.5 w-3.5" />}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11" />
          </Field>

          {/* Вид договора */}
          <Field label={t('vidDogovora')} icon={<FileText className="h-3.5 w-3.5" />} required>
            <Select value={vidDogovora} onValueChange={setVidDogovora}>
              <SelectTrigger className="h-11">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                {VID_DOGOVORA_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>{vidLabel(lang, k)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {/* Контролёр — 2 tugma (effekt bilan) */}
        <Field label={t('kontrolyor')} icon={<Check className="h-3.5 w-3.5" />} required>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setKontrolyor('prinyat')}
              className={cn(
                'flex items-center justify-center gap-2 h-12 rounded-xl border-2 font-bold text-sm transition-all',
                kontrolyor === 'prinyat'
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 shadow-md shadow-emerald-500/20 scale-[1.02]'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-emerald-300',
              )}
            >
              <Check className={cn('h-5 w-5', kontrolyor === 'prinyat' && 'animate-in zoom-in')} />
              {t('kontrolyor_prinyat')}
            </button>
            <button
              type="button"
              onClick={() => setKontrolyor('otkaz')}
              className={cn(
                'flex items-center justify-center gap-2 h-12 rounded-xl border-2 font-bold text-sm transition-all',
                kontrolyor === 'otkaz'
                  ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 shadow-md shadow-rose-500/20 scale-[1.02]'
                  : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-rose-300',
              )}
            >
              <X className={cn('h-5 w-5', kontrolyor === 'otkaz' && 'animate-in zoom-in')} />
              {t('kontrolyor_otkaz')}
            </button>
          </div>
        </Field>

        {/* Причина отказа — otkaz tanlansa ajratib ko'rsatamiz */}
        <Field
          label={t('prichinaOtkaza')}
          icon={<AlertTriangle className={cn('h-3.5 w-3.5', kontrolyor === 'otkaz' && 'text-rose-500')} />}
        >
          <textarea
            value={prichina}
            onChange={(e) => setPrichina(e.target.value)}
            placeholder={t('prichinaPlaceholder')}
            rows={2}
            className={cn(
              'w-full rounded-lg border bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1',
              kontrolyor === 'otkaz' ? 'border-rose-300 dark:border-rose-800' : 'border-input',
            )}
          />
        </Field>

        {/* Штрафы (ixtiyoriy) */}
        <Field label={t('shtrafy')} icon={<Coins className="h-3.5 w-3.5" />} hint={t('shtrafyHint')}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={shtrafy}
            onChange={(e) => setShtrafy(e.target.value)}
            placeholder="0"
            className="h-11 tabular-nums max-w-xs"
          />
        </Field>

        {/* Saqlash */}
        <div className="pt-2 flex justify-end">
          <Button onClick={submit} disabled={create.isPending} className="h-11 px-6 gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {create.isPending ? t('saving') : t('save')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, icon, required, hint, children,
}: {
  label: string; icon?: React.ReactNode; required?: boolean; hint?: string; children: React.ReactNode;
}) {
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

function CrmField({
  icon, label, value, sub, subIcon, accent = 'indigo',
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; subIcon?: React.ReactNode;
  accent?: 'indigo' | 'violet' | 'emerald';
}) {
  const map = {
    indigo: 'text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40',
    violet: 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/40',
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40',
  } as const;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mb-1">
        <span className={cn('w-5 h-5 rounded-md grid place-items-center', map[accent])}>{icon}</span>
        {label}
      </div>
      <div className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate" title={value}>{value || '—'}</div>
      {sub && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1 font-mono">
          {subIcon}{sub}
        </div>
      )}
    </div>
  );
}
