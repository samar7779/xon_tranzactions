'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Loader2, Pencil, Trash2, Check, X, Save, Calendar,
  FileText, Coins, AlertTriangle, Inbox, MoreVertical, ChevronDown, CheckCheck, User,
  Building2, Home, RotateCcw, FileSpreadsheet, ArrowRight, Send, SendHorizontal,
} from 'lucide-react';
import { api, apiDownload } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  makeT, vidLabel, kontrolyorLabel, VID_DOGOVORA_KEYS, type ChekLang,
} from './i18n';

interface ChekRow {
  id: string;
  contractNumber: string;
  manager: string | null;
  managerPhone: string | null;
  branchName: string | null;
  objectName: string | null;
  data: string;
  vidDogovora: string;
  kontrolyor: string;
  prichinaOtkaza: string | null;
  shtrafy: number | null;
  dobavilName: string | null;
  tgSend: boolean;
  tgSentAt: string | null;
  createdAt: string;
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  return y && m && dd ? `${dd}.${m}.${y}` : s;
}
function fmtMoney(n?: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('ru-RU').format(n);
}

export function TarixTab({ lang, canEdit }: { lang: ChekLang; canEdit?: boolean }) {
  const t = makeT(lang);
  const qc = useQueryClient();

  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data, isFetching } = useQuery({
    queryKey: ['chek-list', debouncedQ],
    queryFn: () => api.get<{ ok: boolean; total: number; items: ChekRow[] }>(
      `/chek?q=${encodeURIComponent(debouncedQ)}&perPage=200`,
    ),
    staleTime: 10_000,
  });

  const allRows = data?.items || [];
  const [editing, setEditing] = useState<ChekRow | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filtrlar
  const [fManager, setFManager] = useState('');
  const [fBranch, setFBranch] = useState('');
  const [fObject, setFObject] = useState('');
  const [fKontrolyor, setFKontrolyor] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const uniq = (arr: (string | null)[]) => Array.from(new Set(arr.filter(Boolean) as string[])).sort();
  const managerOpts = uniq(allRows.map((r) => r.manager)).map((v) => ({ value: v, label: v }));
  const branchOpts = uniq(allRows.map((r) => r.branchName)).map((v) => ({ value: v, label: v }));
  const objectOpts = uniq(allRows.map((r) => r.objectName)).map((v) => ({ value: v, label: v }));
  const kontrolyorOpts = [
    { value: 'prinyat', label: kontrolyorLabel(lang, 'prinyat') },
    { value: 'otkaz', label: kontrolyorLabel(lang, 'otkaz') },
  ];

  const rows = allRows.filter((r) => {
    if (fManager && r.manager !== fManager) return false;
    if (fBranch && r.branchName !== fBranch) return false;
    if (fObject && r.objectName !== fObject) return false;
    if (fKontrolyor && r.kontrolyor !== fKontrolyor) return false;
    const d = String(r.data).slice(0, 10);
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  });
  const anyFilter = !!(fManager || fBranch || fObject || fKontrolyor || dateFrom || dateTo);
  function clearAll() { setFManager(''); setFBranch(''); setFObject(''); setFKontrolyor(''); setDateFrom(''); setDateTo(''); }

  // Excel eksport — icon + loading/done animatsiya
  const [exp, setExp] = useState<'idle' | 'loading' | 'done'>('idle');
  async function doExport() {
    if (exp === 'loading') return;
    setExp('loading');
    const p = new URLSearchParams();
    if (debouncedQ) p.set('q', debouncedQ);
    if (fManager) p.set('manager', fManager);
    if (fBranch) p.set('branch', fBranch);
    if (fObject) p.set('object', fObject);
    if (fKontrolyor) p.set('kontrolyor', fKontrolyor);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    p.set('lang', lang);
    try {
      await apiDownload(`/chek/export?${p.toString()}`, 'chek.xlsx');
      setExp('done');
      setTimeout(() => setExp('idle'), 1600);
    } catch (e: any) {
      toast.error(e?.message || t('error'));
      setExp('idle');
    }
  }

  // "To'g'rlandi" tasdiq modali
  const [correcting, setCorrecting] = useState<ChekRow | null>(null);

  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/chek/${id}`),
    onSuccess: () => { toast.success(t('deleted')); qc.invalidateQueries({ queryKey: ['chek-list'] }); },
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  // "To'g'rlandi" — rad etilgan yozuvni qabul qilingan holatiga o'tkazadi
  const correct = useMutation({
    mutationFn: (id: string) => api.patch(`/chek/${id}`, { kontrolyor: 'prinyat' }),
    onSuccess: () => { toast.success(t('corrected')); setCorrecting(null); qc.invalidateQueries({ queryKey: ['chek-list'] }); },
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  // Qo'lda TG yuborish (force — oldin yuborilgan bo'lsa ham qayta yuboradi)
  const sendTg = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; error?: string }>(`/chek/${id}/send-tg`, {}),
    onSuccess: (r: any) => { r?.ok ? toast.success(t('sent')) : toast.error(r?.error || t('error')); qc.invalidateQueries({ queryKey: ['chek-list'] }); },
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  const cols = canEdit ? 8 : 7; // chevron + contract + manager + branch + object + kontrolyor + yuborilgan (+actions)

  return (
    <div className="space-y-4">
      {/* Qidiruv + filtrlar — z-30: dropdown'lar jadval ustida chiqishi uchun */}
      <div className="relative z-30 rounded-2xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl ring-1 ring-white/60 dark:ring-slate-800 shadow-[0_10px_30px_-20px_rgba(79,70,229,0.4)] p-3 flex items-center gap-2 flex-wrap">
        {/* Kichik search — shartnoma raqami */}
        <div className="relative w-full sm:w-64">
          <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white shadow-sm">
            <Search className="h-3 w-3" />
          </div>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')}
            className="pl-9 pr-8 h-9 rounded-lg bg-white/80 dark:bg-slate-900 border-0 ring-1 ring-slate-200 dark:ring-slate-700 font-mono text-[13px] focus-visible:ring-2 focus-visible:ring-indigo-400" />
          {q && (
            <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* 4 ta qiymatli filtr */}
        <FilterCombo icon={<User className="h-3.5 w-3.5" />} label={t('manager')} value={fManager} options={managerOpts} onChange={setFManager} searchAll={t('all')} />
        <FilterCombo icon={<Building2 className="h-3.5 w-3.5" />} label={t('salesOffice')} value={fBranch} options={branchOpts} onChange={setFBranch} searchAll={t('all')} />
        <FilterCombo icon={<Home className="h-3.5 w-3.5" />} label={t('object')} value={fObject} options={objectOpts} onChange={setFObject} searchAll={t('all')} />
        <FilterCombo icon={<Check className="h-3.5 w-3.5" />} label={t('kontrolyor')} value={fKontrolyor} options={kontrolyorOpts} onChange={setFKontrolyor} searchAll={t('all')} searchable={false} />

        {/* Sana oralig'i filtri (icon) */}
        <DateFilter from={dateFrom} to={dateTo} setFrom={setDateFrom} setTo={setDateTo} t={t} />

        {/* Excel eksport (icon + loading/done animatsiya) */}
        <button onClick={doExport} disabled={exp === 'loading'} title={t('exportExcel')}
          className={cn('w-9 h-9 rounded-lg grid place-items-center ring-1 transition-all shrink-0',
            exp === 'done'
              ? 'bg-emerald-500 text-white ring-emerald-400 shadow-md shadow-emerald-500/30 scale-105'
              : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900 hover:bg-emerald-100 dark:hover:bg-emerald-900/40')}>
          {exp === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" />
            : exp === 'done' ? <Check className="h-4 w-4 animate-in zoom-in duration-300" />
              : <FileSpreadsheet className="h-4 w-4" />}
        </button>

        {anyFilter && (
          <button onClick={clearAll} title={t('clearFilters')}
            className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg text-[12px] font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors">
            <RotateCcw className="h-3.5 w-3.5" /> {t('clearFilters')}
          </button>
        )}

        <div className="ml-auto text-[12px] text-slate-500 dark:text-slate-400 font-medium px-2">
          {t('total')}: <span className="font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">{rows.length}</span>
          {isFetching && <Loader2 className="inline h-3.5 w-3.5 animate-spin ml-2 text-slate-400" />}
        </div>
      </div>

      {/* Jadval — z-10: filtr dropdown'laridan past */}
      <div className="relative z-10 rounded-2xl bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl ring-1 ring-white/60 dark:ring-slate-800 shadow-[0_20px_50px_-25px_rgba(79,70,229,0.35)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-indigo-50/40 dark:from-slate-800/60 dark:to-slate-800/60 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <Th className="w-8">{''}</Th>
                <Th>{t('contractNumber')}</Th>
                <Th>{t('manager')}</Th>
                <Th>{t('salesOffice')}</Th>
                <Th>{t('object')}</Th>
                <Th>{t('kontrolyor')}</Th>
                <Th>{t('sent')}</Th>
                {canEdit && <Th className="text-right">{t('actions')}</Th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={cols} className="py-16 text-center">
                    <Inbox className="h-9 w-9 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <div className="text-sm text-slate-400 dark:text-slate-500">{t('noData')}</div>
                  </td>
                </tr>
              ) : rows.map((r) => {
                const open = expandedId === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr className={cn('cursor-pointer transition-colors', open ? 'bg-indigo-50/60 dark:bg-indigo-950/20' : 'hover:bg-slate-50 dark:hover:bg-slate-800/40')}
                      onClick={() => setExpandedId(open ? null : r.id)}>
                      <Td className="text-center">
                        <ChevronDown className={cn('h-4 w-4 mx-auto transition-transform', open ? 'rotate-180 text-indigo-500' : 'text-slate-400')} />
                      </Td>
                      <Td className="font-mono font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">{r.contractNumber}</Td>
                      <Td className="max-w-[150px] truncate" title={r.manager || ''}>{r.manager || '—'}</Td>
                      <Td>{r.branchName || '—'}</Td>
                      <Td className="max-w-[160px] truncate" title={r.objectName || ''}>{r.objectName || '—'}</Td>
                      <Td><KontrolyorBadge value={r.kontrolyor} lang={lang} /></Td>
                      <Td>
                        {r.tgSend ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ring-1 ring-inset bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 ring-sky-200 dark:ring-sky-900" title={r.tgSentAt ? fmtDate(r.tgSentAt) : ''}>
                            <Send className="h-3 w-3" />{t('sent')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium text-slate-400 dark:text-slate-500">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600" />{t('notSent')}
                          </span>
                        )}
                      </Td>
                      {canEdit && (
                        <Td className="text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            {r.kontrolyor === 'otkaz' && (
                              <button onClick={() => setCorrecting(r)}
                                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900 text-[11px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-colors">
                                <CheckCheck className="h-3.5 w-3.5" /> {t('corrected')}
                              </button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button className="w-8 h-8 rounded-lg grid place-items-center text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                  <MoreVertical className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuItem onSelect={() => setEditing(r)} className="gap-2 cursor-pointer">
                                  <Pencil className="h-4 w-4 text-indigo-500" /> {t('edit')}
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => sendTg.mutate(r.id)} className="gap-2 cursor-pointer text-sky-600 focus:text-sky-600">
                                  <SendHorizontal className="h-4 w-4" /> {t('sendTg')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => { if (confirm(t('confirmDelete'))) del.mutate(r.id); }} className="gap-2 cursor-pointer text-rose-600 focus:text-rose-600">
                                  <Trash2 className="h-4 w-4" /> {t('del')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </Td>
                      )}
                    </tr>
                    {open && (
                      <tr className="bg-indigo-50/30 dark:bg-indigo-950/10">
                        <td colSpan={cols} className="px-4 pb-4 pt-1">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <DetailItem icon={<Calendar className="h-3.5 w-3.5" />} label={t('date')} value={fmtDate(r.data)} />
                            <DetailItem icon={<FileText className="h-3.5 w-3.5" />} label={t('vidDogovora')} value={vidLabel(lang, r.vidDogovora)} />
                            <DetailItem icon={<Coins className="h-3.5 w-3.5" />} label={t('shtrafy')} value={r.shtrafy != null ? `${fmtMoney(r.shtrafy)} UZS` : '—'} />
                            <DetailItem icon={<User className="h-3.5 w-3.5" />} label={t('addedBy')} value={r.dobavilName || '—'} />
                          </div>
                          {r.prichinaOtkaza && (
                            <div className="mt-2.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 ring-1 ring-rose-100 dark:ring-rose-900 px-3 py-2">
                              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-rose-500 mb-0.5">
                                <AlertTriangle className="h-3 w-3" /> {t('prichinaOtkaza')}
                              </div>
                              <div className="text-[13px] text-slate-700 dark:text-slate-300">{r.prichinaOtkaza}</div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDialog
          lang={lang}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['chek-list'] }); }}
        />
      )}

      {/* "To'g'rlandi" tasdiq modali — premium */}
      {correcting && (
        <Dialog open onOpenChange={(o) => { if (!o) setCorrecting(null); }}>
          <DialogContent className="max-w-md p-0 overflow-hidden rounded-3xl border-0 [&>button]:text-white/80 [&>button]:hover:text-white [&>button]:z-20">
            <DialogTitle className="sr-only">{t('corrected')}</DialogTitle>
            {/* Gradient hero */}
            <div className="relative bg-gradient-to-br from-emerald-500 via-emerald-500 to-teal-600 px-6 pt-8 pb-7 text-center overflow-hidden">
              <div className="absolute -top-12 -right-10 w-40 h-40 rounded-full bg-white/15 blur-2xl" />
              <div className="absolute -bottom-14 -left-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
              <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #fff 1px, transparent 0)', backgroundSize: '18px 18px' }} />
              <div className="relative mx-auto w-16 h-16 grid place-items-center">
                <span className="absolute inset-0 rounded-2xl bg-white/25 animate-ping opacity-60" />
                <div className="relative w-16 h-16 rounded-2xl bg-white/25 backdrop-blur grid place-items-center ring-1 ring-white/50 shadow-lg">
                  <CheckCheck className="h-8 w-8 text-white" strokeWidth={2.4} />
                </div>
              </div>
              <div className="relative mt-3.5 text-lg font-black text-white tracking-tight">{t('corrected')}</div>
              <div className="relative text-[13px] text-white/90 mt-1 max-w-[280px] mx-auto leading-snug">{t('confirmCorrect')}</div>
            </div>

            {/* Body */}
            <div className="px-6 py-5">
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 ring-1 ring-slate-200 dark:ring-slate-700 p-4">
                <div className="text-center font-mono font-black text-[15px] text-slate-800 dark:text-slate-100 mb-3">{correcting.contractNumber}</div>
                <div className="flex items-center justify-center gap-2.5">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 ring-1 ring-rose-200 dark:ring-rose-900 line-through decoration-rose-400">
                    <X className="h-3.5 w-3.5" />{kontrolyorLabel(lang, 'otkaz')}
                  </span>
                  <span className="w-8 h-8 rounded-full bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 grid place-items-center shadow-sm shrink-0">
                    <ArrowRight className="h-4 w-4 text-emerald-500" />
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 ring-1 ring-emerald-200 dark:ring-emerald-900">
                    <Check className="h-3.5 w-3.5" />{kontrolyorLabel(lang, 'prinyat')}
                  </span>
                </div>
              </div>

              <div className="mt-5 flex gap-3">
                <Button variant="outline" onClick={() => setCorrecting(null)} className="flex-1 h-11 rounded-xl gap-1.5 font-semibold">
                  <X className="h-4 w-4" />{t('cancel')}
                </Button>
                <Button onClick={() => correct.mutate(correcting.id)} disabled={correct.isPending}
                  className="flex-1 h-11 rounded-xl gap-1.5 font-bold bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-lg shadow-emerald-500/30">
                  {correct.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}{t('confirm')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DetailItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/70 dark:bg-slate-900/60 ring-1 ring-slate-200/70 dark:ring-slate-700 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mb-0.5">
        {icon}{label}
      </div>
      <div className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 truncate" title={value}>{value}</div>
    </div>
  );
}

function FilterCombo({ icon, label, value, options, onChange, searchAll, searchable = true }: {
  icon: React.ReactNode; label: string; value: string;
  options: { value: string; label: string }[]; onChange: (v: string) => void;
  searchAll: string; searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const cur = options.find((o) => o.value === value);
  const filtered = q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options;
  const active = !!value;
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={cn('inline-flex items-center gap-1.5 h-9 pl-2.5 pr-2 rounded-lg text-[12px] font-semibold transition-colors ring-1',
          active ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-800' : 'bg-white/70 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300')}>
        <span className={active ? 'text-indigo-500' : 'text-slate-400'}>{icon}</span>
        <span className="max-w-[120px] truncate">{cur ? cur.label : label}</span>
        {active ? (
          <span role="button" onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); }}
            className="w-4 h-4 rounded-full grid place-items-center hover:bg-indigo-100 dark:hover:bg-indigo-900">
            <X className="h-3 w-3" />
          </span>
        ) : (
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        )}
      </button>
      {open && (
        <div className="absolute z-40 mt-1.5 left-0 w-56 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.4)] overflow-hidden">
          {searchable && (
            <div className="p-2 border-b border-slate-100 dark:border-slate-800">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} autoFocus className="h-8 pl-8 text-[12px] rounded-lg" />
              </div>
            </div>
          )}
          <div className="max-h-[240px] overflow-y-auto p-1">
            <button onClick={() => { onChange(''); setOpen(false); setQ(''); }}
              className={cn('w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] flex items-center gap-2', !value ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300')}>
              {searchAll}
            </button>
            {filtered.map((o) => (
              <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); setQ(''); }}
                className={cn('w-full text-left px-2.5 py-1.5 rounded-lg text-[12px] flex items-center gap-2', value === o.value ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-semibold' : 'hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300')}>
                <span className="flex-1 truncate">{o.label}</span>
                {value === o.value && <Check className="h-3.5 w-3.5" />}
              </button>
            ))}
            {filtered.length === 0 && <div className="px-2.5 py-3 text-[12px] text-slate-400 text-center">—</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function DateFilter({ from, to, setFrom, setTo, t }: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void; t: (k: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onClick(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  const active = !!(from || to);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className={cn('inline-flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-[12px] font-semibold transition-colors ring-1',
          active ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 ring-indigo-200 dark:ring-indigo-800' : 'bg-white/70 dark:bg-slate-900 text-slate-600 dark:text-slate-300 ring-slate-200 dark:ring-slate-700 hover:ring-slate-300')}>
        <Calendar className={cn('h-4 w-4', active ? 'text-indigo-500' : 'text-slate-400')} />
        {active && <span className="tabular-nums">{from ? fmtDate(from) : '…'} – {to ? fmtDate(to) : '…'}</span>}
      </button>
      {open && (
        <div className="absolute z-40 mt-1.5 right-0 w-64 rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-[0_20px_50px_-20px_rgba(15,23,42,0.4)] p-3 space-y-2.5">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1 block">{t('fromDate')}</label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 text-[12px] rounded-lg" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-bold text-slate-400 mb-1 block">{t('toDate')}</label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 text-[12px] rounded-lg" />
          </div>
          {active && (
            <button onClick={() => { setFrom(''); setTo(''); }} className="w-full h-8 rounded-lg text-[12px] font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 inline-flex items-center justify-center gap-1">
              <X className="h-3.5 w-3.5" /> {t('clearFilters')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EditDialog({
  lang, row, onClose, onSaved,
}: { lang: ChekLang; row: ChekRow; onClose: () => void; onSaved: () => void }) {
  const t = makeT(lang);
  const [contract, setContract] = useState(row.contractNumber);
  const [manager, setManager] = useState(row.manager || '');
  const [branchName, setBranchName] = useState(row.branchName || '');
  const [objectName, setObjectName] = useState(row.objectName || '');
  const [date, setDate] = useState(String(row.data).slice(0, 10));
  const [vidDogovora, setVidDogovora] = useState(row.vidDogovora);
  const [kontrolyor, setKontrolyor] = useState(row.kontrolyor);
  const [prichina, setPrichina] = useState(row.prichinaOtkaza || '');
  const [shtrafy, setShtrafy] = useState(row.shtrafy != null ? String(row.shtrafy) : '');

  const upd = useMutation({
    mutationFn: (body: any) => api.patch(`/chek/${row.id}`, body),
    onSuccess: () => { toast.success(t('updated')); onSaved(); },
    onError: (e: any) => toast.error(e?.message || t('error')),
  });

  function save() {
    upd.mutate({
      contractNumber: contract.trim(),
      manager: manager || null,
      branchName: branchName || null,
      objectName: objectName || null,
      data: date,
      vidDogovora,
      kontrolyor,
      prichinaOtkaza: prichina || null,
      shtrafy: shtrafy ? Math.round(Number(shtrafy)) : null,
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4 text-indigo-500" /> {t('edit')} — <span className="font-mono">{row.contractNumber}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="grid grid-cols-2 gap-3">
            <Lbl label={t('contractNumber')}>
              <Input value={contract} onChange={(e) => setContract(e.target.value)} className="h-10 font-mono" />
            </Lbl>
            <Lbl label={t('date')} icon={<Calendar className="h-3 w-3" />}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
            </Lbl>
            <Lbl label={t('manager')}>
              <Input value={manager} onChange={(e) => setManager(e.target.value)} className="h-10" />
            </Lbl>
            <Lbl label={t('salesOffice')}>
              <Input value={branchName} onChange={(e) => setBranchName(e.target.value)} className="h-10" />
            </Lbl>
            <Lbl label={t('object')} className="col-span-2">
              <Input value={objectName} onChange={(e) => setObjectName(e.target.value)} className="h-10" />
            </Lbl>
            <Lbl label={t('vidDogovora')} icon={<FileText className="h-3 w-3" />}>
              <Select value={vidDogovora} onValueChange={setVidDogovora}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VID_DOGOVORA_KEYS.map((k) => <SelectItem key={k} value={k}>{vidLabel(lang, k)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Lbl>
            <Lbl label={t('kontrolyor')}>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setKontrolyor('prinyat')} className={cn('flex items-center justify-center gap-1 h-10 rounded-lg border-2 text-[13px] font-bold', kontrolyor === 'prinyat' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' : 'border-slate-200 dark:border-slate-700 text-slate-500')}>
                  <Check className="h-4 w-4" />{t('kontrolyor_prinyat')}
                </button>
                <button type="button" onClick={() => setKontrolyor('otkaz')} className={cn('flex items-center justify-center gap-1 h-10 rounded-lg border-2 text-[13px] font-bold', kontrolyor === 'otkaz' ? 'border-rose-500 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' : 'border-slate-200 dark:border-slate-700 text-slate-500')}>
                  <X className="h-4 w-4" />{t('kontrolyor_otkaz')}
                </button>
              </div>
            </Lbl>
          </div>
          <Lbl label={t('prichinaOtkaza')} icon={<AlertTriangle className={cn('h-3 w-3', kontrolyor === 'otkaz' && 'text-rose-500')} />}>
            <textarea value={prichina} onChange={(e) => setPrichina(e.target.value)} rows={2} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring" />
          </Lbl>
          <Lbl label={t('shtrafy')} icon={<Coins className="h-3 w-3" />} hint={t('shtrafyHint')}>
            <Input type="number" min={0} value={shtrafy} onChange={(e) => setShtrafy(e.target.value)} className="h-10 tabular-nums max-w-[200px]" />
          </Lbl>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="gap-1.5"><X className="h-4 w-4" />{t('cancel')}</Button>
          <Button onClick={save} disabled={upd.isPending} className="gap-1.5 bg-gradient-to-r from-indigo-600 to-violet-600">
            {upd.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KontrolyorBadge({ value, lang }: { value: string; lang: ChekLang }) {
  const isOk = value === 'prinyat';
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ring-1 ring-inset',
      isOk
        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 ring-emerald-200 dark:ring-emerald-900'
        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 ring-rose-200 dark:ring-rose-900',
    )}>
      {isOk ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      {kontrolyorLabel(lang, value)}
    </span>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('px-3 py-2.5 text-left font-bold', className)}>{children}</th>;
}
function Td({ children, className, title }: { children: React.ReactNode; className?: string; title?: string }) {
  return <td title={title} className={cn('px-3 py-2.5 text-slate-700 dark:text-slate-300', className)}>{children}</td>;
}
function Lbl({
  label, icon, hint, className, children,
}: { label: string; icon?: React.ReactNode; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label className="text-[10px] uppercase tracking-wider font-bold text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
        {icon}{label}{hint && <span className="normal-case tracking-normal text-slate-400 lowercase">({hint})</span>}
      </label>
      {children}
    </div>
  );
}
