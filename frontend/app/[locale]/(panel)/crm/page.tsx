'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Search, Loader2, Briefcase, Home, Building2, User, Calendar,
  Wallet, FileText, CheckCircle2, AlertCircle, Clock, X, History,
  CreditCard, Phone, MapPin, Hash, BookOpen, ChevronRight, ChevronDown,
  Receipt, Sparkles, Banknote, Tag,
} from 'lucide-react';
import { Topbar } from '@/components/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/skeleton';
import { api } from '@/lib/api';
import { cn, formatMoney } from '@/lib/utils';

interface ContractDetail {
  contract_date?: string;
  price?: number;
  status?: { key?: string; value?: { name?: Record<string, string> } };
  client?: any;
  info?: any;
  initial?: { total?: { paid?: number; left?: number }; schedules?: any[] };
  monthly?: { total?: { paid?: number; left?: number; amount?: number }; schedules?: any[] };
  payment_histories?: any[];
}

const STATUS_TONE: Record<string, { cls: string; dot: string }> = {
  paid:       { cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  partially:  { cls: 'bg-amber-50 text-amber-700 ring-amber-200',       dot: 'bg-amber-500' },
  waiting:    { cls: 'bg-slate-50 text-slate-700 ring-slate-200',       dot: 'bg-slate-400' },
  overdue:    { cls: 'bg-rose-50 text-rose-700 ring-rose-200',          dot: 'bg-rose-500' },
  sold:       { cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200',    dot: 'bg-indigo-500' },
};

const LS_RECENT = 'crm.recentContracts';

export default function CrmPage() {
  const t = useTranslations('crm');
  const tc = useTranslations('common');
  const locale = useLocale();
  const apiLang: 'uz' | 'ru' = locale === 'ru' ? 'ru' : 'uz';

  const [q, setQ] = useState('');
  const [detail, setDetail] = useState<ContractDetail | null>(null);
  const [activeContract, setActiveContract] = useState<string>('');
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_RECENT);
      if (raw) setRecent(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  function pushRecent(contract: string) {
    const next = [contract, ...recent.filter((x) => x !== contract)].slice(0, 8);
    setRecent(next);
    try { localStorage.setItem(LS_RECENT, JSON.stringify(next)); } catch {}
  }

  const showMut = useMutation({
    mutationFn: (contract: string) =>
      api.get<{ ok: boolean; detail?: ContractDetail; error?: string }>(
        `/crm/show?contract=${encodeURIComponent(contract)}`,
      ),
    onSuccess: (r, contract) => {
      if (r?.ok && r.detail) {
        setDetail(r.detail);
        setActiveContract(contract);
        pushRecent(contract);
      } else {
        setDetail(null);
        toast.error(r?.error || t('notFound'));
      }
    },
    onError: (e: any) => {
      setDetail(null);
      toast.error(e?.message || tc('error'));
    },
  });

  function runSearch(value?: string) {
    const c = (value ?? q).trim();
    if (!c) return;
    setQ(c);
    showMut.mutate(c);
  }

  function clearRecent() {
    setRecent([]);
    try { localStorage.removeItem(LS_RECENT); } catch {}
  }

  // ─── Derived data ───
  const client = detail?.client || {};
  const info = detail?.info || {};
  const statusKey = detail?.status?.key || '';
  const statusName = detail?.status?.value?.name?.[apiLang] || statusKey || '—';
  const statusTone = STATUS_TONE[statusKey] || { cls: 'bg-slate-50 text-slate-700 ring-slate-200', dot: 'bg-slate-400' };

  const initialTotal = detail?.initial?.total || {};
  const monthlyTotal = detail?.monthly?.total || {};
  const totalPaid = Number(initialTotal.paid || 0) + Number(monthlyTotal.paid || 0);
  const totalLeft = Number(initialTotal.left || 0) + Number(monthlyTotal.left || 0);
  const totalPrice = Number(detail?.price || 0);
  const paidPct = totalPrice > 0 ? Math.min(100, (totalPaid / totalPrice) * 100) : 0;

  const overdueSum = useMemo(() => {
    if (!detail) return 0;
    const today = new Date().toISOString().slice(0, 10);
    let sum = 0;
    const all = [
      ...(detail.monthly?.schedules || []),
      ...(detail.initial?.schedules || []),
    ];
    for (const s of all) {
      const d = String(s?.date_payment || '').slice(0, 10);
      if (d && d <= today && Number(s?.left || 0) > 0) sum += Number(s.left || 0);
    }
    return sum;
  }, [detail]);

  const fullName = useMemo(() => {
    function pick(f: any): string {
      if (!f) return '';
      if (typeof f === 'string') return f;
      return f.lotin || f.kirill || '';
    }
    return [pick(client.last_name), pick(client.first_name), pick(client.middle_name)]
      .filter(Boolean).join(' ').trim();
  }, [client]);

  return (
    <>
      <Topbar title={t('title')} subtitle={t('subtitle')} />

      <div className="flex-1 p-6 lg:p-8 w-full">
        <div className="w-full space-y-6">

          {/* ═══ Search hero ═══ */}
          <Card className="border-0 shadow-soft overflow-hidden">
            <div className="relative bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 px-6 lg:px-8 py-7 overflow-hidden">
              <div className="absolute inset-0 bg-dots opacity-10 pointer-events-none" />
              <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-fuchsia-400/15 blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-cyan-400/15 blur-3xl pointer-events-none" />

              <div className="relative flex flex-col lg:flex-row items-start lg:items-center gap-5">
                <div className="flex items-center gap-4 shrink-0">
                  <div className="w-14 h-14 rounded-2xl bg-white/15 ring-2 ring-white/30 backdrop-blur-md grid place-items-center text-white">
                    <Briefcase className="h-7 w-7" />
                  </div>
                  <div className="lg:hidden">
                    <div className="text-white/80 text-[10px] uppercase tracking-[0.2em] font-bold">XonSaroy CRM</div>
                    <div className="text-white text-lg font-bold">{t('searchHint')}</div>
                  </div>
                </div>

                <div className="flex-1 w-full lg:max-w-2xl">
                  <div className="hidden lg:block text-white/80 text-[10px] uppercase tracking-[0.2em] font-bold mb-1.5">
                    XonSaroy CRM
                  </div>
                  <div className="relative group/search">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 z-10" />
                    <Input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
                      placeholder={t('searchPlaceholder')}
                      className={cn(
                        'pl-12 pr-32 h-14 text-base rounded-2xl bg-white border-0',
                        'shadow-[0_8px_30px_-8px_rgba(0,0,0,0.25)]',
                        'focus-visible:ring-4 focus-visible:ring-white/40 focus-visible:ring-offset-0',
                      )}
                    />
                    {q && !showMut.isPending && (
                      <button
                        onClick={() => { setQ(''); setDetail(null); setActiveContract(''); }}
                        className="absolute right-28 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full grid place-items-center text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                        aria-label={tc('reset')}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    <Button
                      onClick={() => runSearch()}
                      disabled={!q.trim() || showMut.isPending}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 h-11 px-4 rounded-xl gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold shadow-md"
                    >
                      {showMut.isPending ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> {t('searching')}</>
                      ) : (
                        <><Search className="h-4 w-4" /> {t('searchBtn')}</>
                      )}
                    </Button>
                  </div>
                  <div className="text-white/70 text-xs mt-2 ml-1">{t('exampleHint')}</div>
                </div>
              </div>
            </div>
          </Card>

          {/* ═══ Recent searches ═══ */}
          {!detail && !showMut.isPending && recent.length > 0 && (
            <Card className="border-0 shadow-soft overflow-hidden">
              <CardContent className="p-4 flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] font-bold text-slate-500 shrink-0">
                  <History className="h-3.5 w-3.5" />
                  {t('recentSearches')}
                </div>
                <div className="flex items-center gap-2 flex-wrap flex-1">
                  {recent.map((c) => (
                    <button
                      key={c}
                      onClick={() => { setQ(c); runSearch(c); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-200 text-[12px] font-mono font-semibold text-slate-700 hover:text-indigo-700 transition-all"
                    >
                      <FileText className="h-3 w-3" />
                      {c}
                    </button>
                  ))}
                </div>
                <button
                  onClick={clearRecent}
                  className="text-[11px] text-slate-500 hover:text-rose-600 font-medium inline-flex items-center gap-1"
                >
                  <X className="h-3 w-3" /> {t('clearRecent')}
                </button>
              </CardContent>
            </Card>
          )}

          {/* ═══ Loading skeleton ═══ */}
          {showMut.isPending && (
            <Card className="border-0 shadow-soft overflow-hidden">
              <CardContent className="p-6 space-y-4">
                <Skeleton className="h-32 w-full rounded-xl" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                  <Skeleton className="h-24 rounded-xl" />
                </div>
                <Skeleton className="h-48 w-full rounded-xl" />
              </CardContent>
            </Card>
          )}

          {/* ═══ Empty (initial) state ═══ */}
          {!showMut.isPending && !detail && (
            <Card className="border-0 shadow-soft overflow-hidden">
              <CardContent className="p-12 text-center">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-50 to-violet-50 ring-1 ring-indigo-100 grid place-items-center mx-auto mb-4">
                  <BookOpen className="h-9 w-9 text-indigo-500" />
                </div>
                <div className="text-lg font-bold tracking-tight text-slate-800">{t('searchHint')}</div>
                <div className="text-xs text-slate-500 mt-1">{t('subtitle')}</div>
              </CardContent>
            </Card>
          )}

          {/* ═══ Contract details ═══ */}
          {!showMut.isPending && detail && (
            <>
              {/* Hero card: object + apartment + client + status */}
              <Card className="border-0 shadow-soft overflow-hidden">
                <div className="relative bg-gradient-to-br from-slate-900 via-indigo-900 to-violet-900 overflow-hidden">
                  <div className="absolute inset-0 bg-dots opacity-10 pointer-events-none" />
                  <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full bg-indigo-400/15 blur-3xl pointer-events-none" />
                  <div className="absolute -bottom-32 -left-10 w-80 h-80 rounded-full bg-fuchsia-400/15 blur-3xl pointer-events-none" />

                  <div className="relative px-6 lg:px-8 py-7 text-white">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5 text-white/70 text-[10px] uppercase tracking-[0.2em] font-bold">
                          <Building2 className="h-3 w-3" />
                          {t('object')}
                        </div>
                        <div className="text-3xl lg:text-4xl font-black tracking-tight truncate">
                          {info.object || '—'}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-white/90 text-sm">
                          <User className="h-4 w-4" />
                          <span className="truncate">{fullName || '—'}</span>
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-white/70 text-[10px] uppercase tracking-[0.2em] font-bold mb-1">
                          {t('contractNumber')}
                        </div>
                        <div className="text-2xl font-black font-mono tracking-tight">
                          {activeContract}
                        </div>
                        <span className={cn(
                          'inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded-full text-xs font-bold ring-1 ring-inset',
                          statusTone.cls,
                        )}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', statusTone.dot)} />
                          {statusName}
                        </span>
                      </div>
                    </div>

                    {/* Apartment chips */}
                    <div className="mt-5 flex items-center gap-2 flex-wrap">
                      {info.number && (
                        <Chip icon={<Home className="h-3 w-3" />} label={`№ ${info.number}`} />
                      )}
                      {info.rooms != null && (
                        <Chip icon={<Hash className="h-3 w-3" />} label={`${info.rooms} ${t('rooms').toLowerCase()}`} />
                      )}
                      {info.area && (
                        <Chip icon={<Hash className="h-3 w-3" />} label={`${info.area} m²`} />
                      )}
                      {info.building && (
                        <Chip icon={<Building2 className="h-3 w-3" />} label={String(info.building)} />
                      )}
                      {info.block && (
                        <Chip icon={<Hash className="h-3 w-3" />} label={`${t('block')} ${info.block}`} />
                      )}
                      {info.floor != null && (
                        <Chip icon={<Hash className="h-3 w-3" />} label={`${t('floor')} ${info.floor}`} />
                      )}
                      {detail.contract_date && (
                        <Chip icon={<Calendar className="h-3 w-3" />} label={fmtDate(detail.contract_date)} />
                      )}
                    </div>
                  </div>

                  {/* Money strip */}
                  <div className="relative bg-black/30 backdrop-blur-sm border-t border-white/10 px-6 lg:px-8 py-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-white">
                    <MoneyTile
                      label={t('price')}
                      value={formatMoney(totalPrice, 'UZS')}
                      tone="white"
                    />
                    <MoneyTile
                      label={t('paid')}
                      value={formatMoney(totalPaid, 'UZS')}
                      tone="emerald"
                    />
                    <MoneyTile
                      label={t('remaining')}
                      value={formatMoney(totalLeft, 'UZS')}
                      tone="amber"
                    />
                    <MoneyTile
                      label={t('overdue')}
                      value={overdueSum > 0 ? formatMoney(overdueSum, 'UZS') : '—'}
                      tone={overdueSum > 0 ? 'rose' : 'mute'}
                    />
                  </div>

                  {/* Progress bar */}
                  <div className="relative px-6 lg:px-8 pb-5">
                    <div className="flex items-center justify-between text-[11px] text-white/80 mb-1.5">
                      <span className="uppercase tracking-wider font-bold">{t('paid')}</span>
                      <span className="tabular-nums font-bold">{paidPct.toFixed(1)}%</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-white/15 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-400 via-emerald-500 to-teal-500 rounded-full transition-all duration-700"
                        style={{ width: `${paidPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              </Card>

              {/* Two columns: schedule + history */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

                {/* Schedule */}
                <div className="lg:col-span-7 space-y-5">
                  <Card className="border-0 shadow-soft overflow-hidden">
                    <div className="bg-gradient-to-r from-indigo-50 via-violet-50 to-fuchsia-50 px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 grid place-items-center text-white">
                        <Calendar className="h-4 w-4" />
                      </div>
                      <div className="text-base font-bold tracking-tight text-slate-800">{t('scheduleTitle')}</div>
                    </div>
                    <CardContent className="p-5 space-y-4">

                      {/* Initial */}
                      {(detail.initial?.schedules || []).length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-2.5 pl-1">
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gradient-to-r from-violet-500 to-purple-600 text-white text-[10px] uppercase tracking-[0.15em] font-bold shadow-sm">
                              <Sparkles className="h-3 w-3" />
                              {t('initial')}
                            </div>
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-violet-50 ring-1 ring-violet-200 text-[10px] font-bold text-violet-700 tabular-nums">
                              {detail.initial!.schedules!.length}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {detail.initial!.schedules!.map((s: any, i: number) => (
                              <ScheduleRow key={`init-${i}`} item={s} idx={i + 1} kind="initial" t={t} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Monthly */}
                      {(detail.monthly?.schedules || []).length > 0 ? (
                        <div>
                          <div className="flex items-center justify-between mb-2.5 pl-1">
                            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-[10px] uppercase tracking-[0.15em] font-bold shadow-sm">
                              <Banknote className="h-3 w-3" />
                              {t('monthly')}
                            </div>
                            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 ring-1 ring-blue-200 text-[10px] font-bold text-blue-700 tabular-nums">
                              {detail.monthly!.schedules!.length}
                            </div>
                          </div>
                          <div className="space-y-1.5 max-h-[560px] overflow-y-auto pr-1">
                            {detail.monthly!.schedules!.map((s: any, i: number) => (
                              <ScheduleRow key={`m-${i}`} item={s} idx={i + 1} kind="monthly" t={t} />
                            ))}
                          </div>
                        </div>
                      ) : (detail.initial?.schedules || []).length === 0 && (
                        <div className="text-center py-10 text-xs text-slate-500">
                          {t('noSchedule')}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* History + client */}
                <div className="lg:col-span-5 space-y-5">

                  {/* Client info */}
                  <Card className="border-0 shadow-soft overflow-hidden">
                    <div className="relative bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600 px-5 py-5 text-white overflow-hidden">
                      <div className="absolute inset-0 bg-dots opacity-15 pointer-events-none" />
                      <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/15 blur-3xl pointer-events-none" />
                      <div className="relative flex items-center gap-3">
                        <div className="relative shrink-0">
                          <div className="w-14 h-14 rounded-2xl bg-white/15 ring-2 ring-white/30 backdrop-blur-md grid place-items-center text-white text-xl font-black">
                            {(fullName || '?').charAt(0).toUpperCase()}
                          </div>
                          <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-400 ring-2 ring-white grid place-items-center">
                            <CheckCircle2 className="h-2.5 w-2.5 text-white" />
                          </span>
                        </div>
                        <div className="min-w-0">
                          <div className="text-[10px] uppercase tracking-[0.18em] font-bold text-white/80 flex items-center gap-1">
                            <User className="h-3 w-3" /> {t('openClient')}
                          </div>
                          <div className="text-lg font-black tracking-tight truncate">{fullName || '—'}</div>
                          {client.phone && (
                            <div className="text-[12px] text-white/85 font-mono flex items-center gap-1 mt-0.5">
                              <Phone className="h-3 w-3" /> {String(client.phone)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <CardContent className="p-5 space-y-1">
                      {client.birth_date && (
                        <InfoRow icon={<Calendar className="h-3.5 w-3.5" />} label={t('birthDate')} value={fmtDate(client.birth_date)} />
                      )}
                      {client.passport_series && (
                        <InfoRow icon={<FileText className="h-3.5 w-3.5" />} label={t('passport')} value={String(client.passport_series)} mono />
                      )}
                      {client.address && (
                        <InfoRow icon={<MapPin className="h-3.5 w-3.5" />} label={t('address')} value={String(client.address)} />
                      )}
                      {!client.birth_date && !client.passport_series && !client.address && (
                        <div className="text-center py-2 text-[11px] text-slate-400">—</div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Payment history */}
                  <Card className="border-0 shadow-soft overflow-hidden">
                    <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 grid place-items-center text-white">
                        <CreditCard className="h-4 w-4" />
                      </div>
                      <div className="text-base font-bold tracking-tight text-slate-800 flex-1">{t('historyTitle')}</div>
                      <div className="text-[11px] text-slate-500 tabular-nums">
                        {(detail.payment_histories || []).length}
                      </div>
                    </div>
                    <CardContent className="p-0">
                      {(detail.payment_histories || []).length === 0 ? (
                        <div className="px-5 py-10 text-center text-xs text-slate-500">{t('noHistory')}</div>
                      ) : (
                        <div className="max-h-[640px] overflow-y-auto divide-y divide-slate-100">
                          {detail.payment_histories!.map((h: any, i: number) => (
                            <HistoryRow key={i} h={h} idx={i + 1} apiLang={apiLang} t={t} />
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ────────────────────────── helpers ──────────────────────────

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15 ring-1 ring-white/20 backdrop-blur-sm text-[11px] font-semibold text-white">
      {icon}
      {label}
    </span>
  );
}

function MoneyTile({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: 'white' | 'emerald' | 'amber' | 'rose' | 'mute';
}) {
  const map = {
    white:   'text-white',
    emerald: 'text-emerald-300',
    amber:   'text-amber-300',
    rose:    'text-rose-300',
    mute:    'text-white/60',
  } as const;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.15em] font-bold text-white/70 truncate">{label}</div>
      <div className={cn('text-lg font-black tabular-nums tracking-tight truncate mt-0.5', map[tone])}>{value}</div>
    </div>
  );
}

// Toifa (kind) uchun ranglar — Boshlang'ich vs Oylik
const KIND_STYLE: Record<string, { bg: string; text: string; ring: string; bar: string; chipBg: string; chipText: string }> = {
  initial: {
    bg: 'bg-violet-50/60',
    text: 'text-violet-700',
    ring: 'ring-violet-200',
    bar: 'from-violet-500 to-purple-600',
    chipBg: 'bg-gradient-to-r from-violet-500 to-purple-600',
    chipText: 'text-white',
  },
  monthly: {
    bg: 'bg-blue-50/60',
    text: 'text-blue-700',
    ring: 'ring-blue-200',
    bar: 'from-blue-500 to-indigo-600',
    chipBg: 'bg-gradient-to-r from-blue-500 to-indigo-600',
    chipText: 'text-white',
  },
  other: {
    bg: 'bg-slate-50/60',
    text: 'text-slate-600',
    ring: 'ring-slate-200',
    bar: 'from-slate-400 to-slate-600',
    chipBg: 'bg-slate-200',
    chipText: 'text-slate-700',
  },
};

function ScheduleRow({ item, idx, kind, t }: { item: any; idx?: number; kind?: 'initial' | 'monthly'; t: any }) {
  const [open, setOpen] = useState(false);
  const key = item?.status?.key || 'waiting';
  const tone = STATUS_TONE[key] || STATUS_TONE.waiting;
  const Icon = key === 'paid' ? CheckCircle2 : key === 'overdue' ? AlertCircle : Clock;
  const amount = Number(item?.amount || 0);
  const paid = Number(item?.amount_paid || 0);
  const left = Number(item?.left || 0);
  const purpose = item?.purpose || item?.description || item?.comment || '';
  const kindStyle = KIND_STYLE[kind || 'other'] || KIND_STYLE.other;

  return (
    <div className={cn(
      'group relative rounded-xl ring-1 ring-slate-200 bg-white hover:ring-indigo-300 hover:shadow-md transition-all overflow-hidden',
    )}>
      {/* Left status bar */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b', kindStyle.bar)} />

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full pl-4 pr-3 py-2.5 flex items-center gap-3 text-left"
      >
        <div className={cn('w-9 h-9 rounded-xl grid place-items-center shrink-0 ring-1 shadow-sm', tone.cls)}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {idx != null && (
              <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 tabular-nums">
                #{idx}
              </span>
            )}
            <span className="text-[13px] font-bold tabular-nums text-slate-800">
              {fmtDate(item?.date_payment)}
            </span>
          </div>
          {paid > 0 && left > 0 && (
            <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-700 font-bold tabular-nums">{formatMoney(paid, 'UZS')}</span>
              </span>
              <span className="text-slate-300">·</span>
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-amber-700 font-bold tabular-nums">{formatMoney(left, 'UZS')}</span>
              </span>
            </div>
          )}
        </div>

        <div className="text-right shrink-0 flex items-center gap-2">
          <div>
            <div className="text-sm font-black tabular-nums text-slate-900">{formatMoney(amount, 'UZS')}</div>
          </div>
          <ChevronDown className={cn(
            'h-4 w-4 text-slate-400 transition-transform duration-200 shrink-0',
            open && 'rotate-180',
          )} />
        </div>
      </button>

      {/* Expanded details */}
      <div className={cn(
        'grid transition-[grid-template-rows] duration-300 ease-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="pl-4 pr-4 pb-3 pt-1 space-y-2 border-t border-slate-100 mt-1">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <DetailMini label={t('amount')} value={formatMoney(amount, 'UZS')} tone="slate" />
              <DetailMini
                label={tone.cls.includes('emerald') ? t('paid') : t('status')}
                value={item?.status?.value?.name?.uz || item?.status?.key || '—'}
                tone={key === 'paid' ? 'emerald' : key === 'overdue' ? 'rose' : 'slate'}
              />
              {paid > 0 && <DetailMini label={t('schedulePaid')} value={formatMoney(paid, 'UZS')} tone="emerald" />}
              {left > 0 && <DetailMini label={t('scheduleLeft')} value={formatMoney(left, 'UZS')} tone="amber" />}
            </div>
            <div className="rounded-lg bg-slate-50 ring-1 ring-slate-100 px-3 py-2 flex items-start gap-2">
              <Tag className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
              <div className="text-[11px] text-slate-700 leading-relaxed">
                {purpose || <span className="text-slate-400 italic">{t('noPurpose')}</span>}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HistoryRow({ h, idx, apiLang, t }: { h: any; idx: number; apiLang: 'uz' | 'ru'; t: any }) {
  const [open, setOpen] = useState(false);
  const methodKey = String(h?.method?.key || '').toLowerCase();
  const methodName = h?.method?.value?.[apiLang] || methodKey || '—';
  const typeKey = String(h?.type?.key || '').toLowerCase();
  const typeName = h?.type?.value?.[apiLang] || typeKey || '';
  const statusKey = h?.status?.key || '';
  const statusTone = STATUS_TONE[statusKey] || STATUS_TONE.paid;

  // Toifa — boshlang'ich yoki oylik
  const kind: 'initial' | 'monthly' | 'other' =
    typeKey.includes('init') || typeKey.includes('boshlang') || typeKey.includes('перво')
      ? 'initial'
      : typeKey.includes('month') || typeKey.includes('oyl') || typeKey.includes('ежемес')
        ? 'monthly'
        : 'other';
  const kindStyle = KIND_STYLE[kind];
  const kindLabel = kind === 'initial' ? t('boshlangich') : kind === 'monthly' ? t('oylik') : (typeName || '—');

  const purpose = h?.purpose || h?.description || h?.comment || h?.note || '';
  const paymentId = h?.id || h?.payment_id || '';

  return (
    <div className="relative group">
      {/* Left kind bar */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b', kindStyle.bar)} />

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full pl-4 pr-5 py-3 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-md bg-slate-100 text-[10px] font-bold text-slate-600 tabular-nums">
              #{idx}
            </span>
            <div className="text-sm font-black tabular-nums text-slate-900 truncate">
              {formatMoney(Number(h?.amount || 0), 'UZS')}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-[11px] text-slate-500 tabular-nums">{fmtDate(h?.date_paid)}</div>
            <ChevronDown className={cn(
              'h-3.5 w-3.5 text-slate-400 transition-transform duration-200',
              open && 'rotate-180',
            )} />
          </div>
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {/* Toifa chip */}
          <span className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wider uppercase',
            kindStyle.chipBg, kindStyle.chipText,
          )}>
            {kind === 'initial' ? <Sparkles className="h-2.5 w-2.5" /> : <Banknote className="h-2.5 w-2.5" />}
            {kindLabel}
          </span>
          {/* Method */}
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-[10px] font-semibold text-slate-700">
            <CreditCard className="h-2.5 w-2.5" />
            <span className="capitalize">{methodName}</span>
          </span>
          {/* Status */}
          {statusKey && (
            <span className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold ring-1 ring-inset',
              statusTone.cls,
            )}>
              <span className={cn('w-1 h-1 rounded-full', statusTone.dot)} />
              {h?.status?.value?.[apiLang] || statusKey}
            </span>
          )}
        </div>
      </button>

      <div className={cn(
        'grid transition-[grid-template-rows] duration-300 ease-out',
        open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
      )}>
        <div className="overflow-hidden">
          <div className="pl-4 pr-5 pb-3 pt-1 space-y-2 border-t border-slate-100">
            {/* Purpose */}
            <div className="rounded-lg bg-gradient-to-br from-indigo-50/60 to-violet-50/30 ring-1 ring-indigo-100 px-3 py-2">
              <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.15em] font-bold text-indigo-600 mb-1">
                <Tag className="h-3 w-3" />
                {t('purpose')}
              </div>
              <div className="text-[12px] text-slate-700 leading-relaxed">
                {purpose || <span className="text-slate-400 italic">{t('noPurpose')}</span>}
              </div>
            </div>

            {/* Mini grid */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              {typeName && <DetailMini label={t('type')} value={typeName} tone="slate" />}
              {methodName !== '—' && <DetailMini label={t('method')} value={methodName} tone="slate" />}
              {h?.date_paid && <DetailMini label={t('datePaid')} value={fmtDate(h.date_paid)} tone="slate" />}
              {paymentId && <DetailMini label={t('paymentId')} value={String(paymentId)} tone="slate" mono />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailMini({
  label, value, tone, mono,
}: {
  label: string;
  value: string;
  tone: 'slate' | 'emerald' | 'amber' | 'rose';
  mono?: boolean;
}) {
  const map = {
    slate:   'bg-slate-50 text-slate-800 ring-slate-200',
    emerald: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    amber:   'bg-amber-50 text-amber-800 ring-amber-200',
    rose:    'bg-rose-50 text-rose-800 ring-rose-200',
  } as const;
  return (
    <div className={cn('rounded-lg ring-1 px-2.5 py-1.5', map[tone])}>
      <div className="text-[9px] uppercase tracking-wider font-bold opacity-60">{label}</div>
      <div className={cn('text-[12px] font-bold tabular-nums truncate mt-0.5', mono && 'font-mono')} title={value}>
        {value}
      </div>
    </div>
  );
}

function InfoRow({
  icon, label, value, mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <div className="flex items-center gap-1.5 text-[12px] text-slate-500 shrink-0">
        <span className="text-slate-400">{icon}</span>
        {label}
      </div>
      <div className={cn('text-[13px] text-slate-800 text-right truncate', mono && 'font-mono text-[12px]')}>
        {value || '—'}
      </div>
    </div>
  );
}

function fmtDate(d: any) {
  if (!d) return '—';
  const s = String(d).slice(0, 10);
  const [y, m, dd] = s.split('-');
  if (!y || !m || !dd) return s;
  return `${dd}.${m}.${y}`;
}
