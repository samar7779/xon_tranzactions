'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot, Loader2, Play, Square, CheckCircle2, AlertTriangle, Clock,
  ListChecks, Gauge, Landmark, Link2, Sparkles, FileText,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * KATEGORIYA AGENTI — ilgari alohida bosiladigan 4 ta asbob (kategoriyalash,
 * schotchik backfill, Молия Вазирлиги tozalash, ta'minotdan to'ldirish) endi
 * bitta oqim. Beshinchi bosqich — AI: 1-4 hal qilmagan qoldiqni o'ylab chiqaradi.
 *
 * Bu oynada: qo'lda ishga tushirish, bosqichlarni jonli kuzatish va har bir
 * AI qarorining sababi (log) ko'rinadi.
 */

const BOSQICH_NOM: Record<string, { nom: string; Icon: any; rang: string }> = {
  qoidalar: { nom: 'Qoidalar', Icon: ListChecks, rang: 'text-amber-600 dark:text-amber-400' },
  schotchik: { nom: 'Schotchik', Icon: Gauge, rang: 'text-cyan-600 dark:text-cyan-400' },
  minfin: { nom: 'Молия Вазирлиги', Icon: Landmark, rang: 'text-orange-600 dark:text-orange-400' },
  taminot: { nom: "Ta'minot", Icon: Link2, rang: 'text-teal-600 dark:text-teal-400' },
  ai: { nom: 'AI — qoldiq', Icon: Sparkles, rang: 'text-violet-600 dark:text-violet-400' },
};
const TARTIB = ['qoidalar', 'schotchik', 'minfin', 'taminot', 'ai'] as const;

interface RunXulosa {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  trigger: string;
  dryRun: boolean;
  dateFrom: string | null;
  dateTo: string | null;
  bosqich: string | null;
  stages: Record<string, any>;
  aiSoralgan: number;
  aiQoyilgan: number;
  aiChaqiriq: number;
  error: string | null;
}

interface Holat {
  ishlayapti: boolean;
  runId: string | null;
  bilimBor: boolean;
  /** AI yo'li — setup token (Claude Code obunasi), API kaliti ishlatilmaydi */
  ai: {
    ok: boolean; usul: string; tokenBor: boolean;
    cliBor: boolean; versiya: string; buyruq: string; model: string;
  };
  /** Kunlik chegara — Python agentlar bilan bir obunani ulashadi */
  aiKunlik: { ishlatilgan: number; chegara: number };
  oxirgi: RunXulosa | null;
}

interface Qaror {
  id: string;
  transactionId: string;
  bosqich: string;
  sana: string | null;
  summa: string | null;
  kontragent: string | null;
  categoryCode: string | null;
  modda: string | null;
  obyekt: string | null;
  shartnoma: string | null;
  shartnomaSana: string | null;
  ishonch: number;
  qoyildi: boolean;
  sabab: string | null;
}

export function KategoriyaAgentDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [dateFrom, setDateFrom] = useState('2026-05-01');
  const [dateTo, setDateTo] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const [rematch, setRematch] = useState(false);
  const [aiYoq, setAiYoq] = useState(false);
  const [korilayotgan, setKorilayotgan] = useState<string | null>(null);

  // Ishlab turganda tez, bo'sh turganda sekin so'raladi — serverni bezovta qilmaydi.
  const holat = useQuery({
    queryKey: ['kategoriya-agent-holat'],
    queryFn: () => api.get<Holat>('/kategoriya-agent/holat'),
    enabled: open,
    refetchInterval: (q) => (open && (q.state.data as Holat | undefined)?.ishlayapti ? 3000 : 20000),
    retry: false,
  });

  const runs = useQuery({
    queryKey: ['kategoriya-agent-runs'],
    queryFn: () => api.get<{ ok: boolean; rows: RunXulosa[] }>('/kategoriya-agent/runs?limit=10'),
    enabled: open,
    refetchInterval: open && holat.data?.ishlayapti ? 5000 : false,
    retry: false,
  });

  const kuzatilayotganId = korilayotgan || holat.data?.runId || holat.data?.oxirgi?.id || null;

  const bitta = useQuery({
    queryKey: ['kategoriya-agent-run', kuzatilayotganId],
    queryFn: () => api.get<{ ok: boolean; run: RunXulosa; qarorlar: Qaror[] }>(
      `/kategoriya-agent/runs/${kuzatilayotganId}?limit=300`,
    ),
    enabled: open && !!kuzatilayotganId,
    refetchInterval: open && holat.data?.ishlayapti ? 4000 : false,
    retry: false,
  });

  const boshla = useMutation({
    mutationFn: () => api.post<{ ok: boolean; started: boolean; runId?: string; message: string }>(
      '/kategoriya-agent/run',
      { dateFrom, dateTo: dateTo || undefined, dryRun, rematch, aiYoq },
    ),
    onSuccess: (r) => {
      if (r.started) {
        setKorilayotgan(r.runId || null);
        toast.success(dryRun ? 'Sinov yurishi boshlandi (yozmaydi)' : 'Agent ishga tushdi');
      } else {
        toast.info(r.message);
      }
      holat.refetch();
      runs.refetch();
    },
    onError: (e: any) => toast.error(e?.message || 'Xatolik'),
  });

  const toxtat = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>('/kategoriya-agent/stop', {}),
    onSuccess: (r) => { toast.info(r.message); holat.refetch(); },
    onError: (e: any) => toast.error(e?.message || 'Xatolik'),
  });

  // Oqim tugagach jadvalni yangilaymiz — natija darhol ko'rinsin.
  const [oldinIshlayaptimi, setOldinIshlayaptimi] = useState(false);
  useEffect(() => {
    const hozir = !!holat.data?.ishlayapti;
    if (oldinIshlayaptimi && !hozir) {
      qc.invalidateQueries({ queryKey: ['transactions'] });
      runs.refetch();
      bitta.refetch();
    }
    setOldinIshlayaptimi(hozir);
  }, [holat.data?.ishlayapti]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = holat.data;
  const run = bitta.data?.run || null;
  const qarorlar = bitta.data?.qarorlar || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[920px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 grid place-items-center">
              <Bot className="h-4 w-4" />
            </span>
            Kategoriya agenti
          </DialogTitle>
          <DialogDescription>
            Besh bosqich ketma-ket: qoidalar → schotchik → Молия Вазирлиги tozalash →
            ta&apos;minotdan to&apos;ldirish → qolgan to&apos;lovlarni AI o&apos;ylab chiqaradi.
            Mijoz to&apos;lovlariga (uy/kvartira tushumi) tegilmaydi.
            Ta&apos;minot bazasiga faqat o&apos;qish so&apos;rovi yuboriladi.
          </DialogDescription>
        </DialogHeader>

        {/* ─── Tayyorlik ─── */}
        {h && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Belgi
              ok={h.bilimBor}
              matn={h.bilimBor ? 'Bilim fayli joyida' : "Bilim fayli yo'q (agents/knowledge/kategoriya.md)"}
            />
            <Belgi
              ok={h.ai?.ok}
              matn={h.ai?.ok
                ? `Setup token joyida · ${h.ai.model}${h.ai.versiya ? ` · claude ${h.ai.versiya}` : ''}`
                : !h.ai?.tokenBor
                  ? "ANTHROPIC_SETUP_TOKEN yo'q — 5-bosqich ishlamaydi"
                  : `claude CLI topilmadi (${h.ai?.buyruq}) — CLAUDE_CMD bilan yo'lni ko'rsating`}
            />
            <div className={cn(
              'rounded-xl px-3 py-2 text-[12px] ring-1 flex items-center gap-2',
              h.ishlayapti
                ? 'bg-indigo-50 dark:bg-indigo-950/40 ring-indigo-200 dark:ring-indigo-900 text-indigo-800 dark:text-indigo-200'
                : 'bg-slate-50 dark:bg-slate-800/60 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300',
            )}>
              {h.ishlayapti
                ? <><Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> Ishlamoqda{run?.bosqich ? ` — ${BOSQICH_NOM[run.bosqich]?.nom || run.bosqich}` : ''}</>
                : <><Clock className="h-3.5 w-3.5 shrink-0" /> Bo&apos;sh turibdi</>}
            </div>
          </div>
        )}

        {h?.aiKunlik && (
          <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2 text-[11.5px] text-slate-600 dark:text-slate-300 leading-snug">
            AI kunlik chegara: <b className="tabular-nums">{h.aiKunlik.ishlatilgan}/{h.aiKunlik.chegara}</b> so&apos;rov.
            Setup token Telegram agentlari (leader, support, checker, teacher) bilan bir obunada —
            chegara shular uchun joy qoldirish uchun qo&apos;yilgan. Chegara tugasa qolgan to&apos;lovlar ertaga ko&apos;riladi.
          </div>
        )}

        {/* ─── Sozlash va ishga tushirish ─── */}
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">Sanadan</div>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">Sanagacha (ixtiyoriy)</div>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[160px]" />
          </div>
          <label className="flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 cursor-pointer">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} className="w-4 h-4 rounded" />
            <span className="text-[12px]">Sinov (yozmaydi)</span>
          </label>
          <label className="flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 cursor-pointer">
            <input type="checkbox" checked={rematch} onChange={(e) => setRematch(e.target.checked)} className="w-4 h-4 rounded" />
            <span className="text-[12px]">Bog&apos;langanlarni qayta ko&apos;rish</span>
          </label>
          <label className="flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-50 dark:bg-slate-800 cursor-pointer">
            <input type="checkbox" checked={aiYoq} onChange={(e) => setAiYoq(e.target.checked)} className="w-4 h-4 rounded" />
            <span className="text-[12px]">AI bosqichisiz</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => boshla.mutate()}
            disabled={boshla.isPending || !!h?.ishlayapti}
            className={cn('gap-2', dryRun ? '' : 'bg-violet-600 hover:bg-violet-700 text-white')}
          >
            {boshla.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {dryRun ? 'Sinovni boshlash' : 'Ishga tushirish'}
          </Button>
          {h?.ishlayapti && (
            <Button variant="outline" onClick={() => toxtat.mutate()} disabled={toxtat.isPending} className="gap-2">
              {toxtat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
              To&apos;xtatish
            </Button>
          )}
          {!dryRun && (
            <span className="text-[11.5px] text-amber-700 dark:text-amber-300">
              Haqiqiy yurish — o&apos;zgarishlar amallar tarixiga yoziladi
            </span>
          )}
        </div>

        {/* ─── Bosqichlar ─── */}
        {run && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Bosqichlar
              </div>
              <div className="text-[11px] text-slate-500 tabular-nums">
                {new Date(run.startedAt).toLocaleString('ru-RU')}
                {run.dryRun ? ' · sinov' : ''}
                {run.trigger === 'cron' ? ' · avtomat' : ''}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-1.5">
              {TARTIB.map((b) => (
                <BosqichQator
                  key={b}
                  kalit={b}
                  natija={run.stages?.[b]}
                  joriy={run.bosqich === b}
                />
              ))}
            </div>
            {run.error && (
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-3 py-2 text-[12px] text-rose-800 dark:text-rose-200">
                {run.error}
              </div>
            )}
          </div>
        )}

        {/* ─── AI qarorlari (loglar) ─── */}
        {qarorlar.length > 0 && (
          <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
            <div className="px-3 py-2 flex items-center gap-2 bg-slate-50 dark:bg-slate-800">
              <FileText className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                AI qarorlari — nega shunday
              </span>
              <span className="ml-auto text-[11px] text-slate-500 tabular-nums">
                {qarorlar.filter((q) => q.qoyildi).length} / {qarorlar.length} qo&apos;yildi
              </span>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {qarorlar.map((q) => (
                <div key={q.id} className="px-3 py-2 text-[11.5px] space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums text-slate-500 w-[74px] shrink-0">{q.sana || '—'}</span>
                    <span className="tabular-nums font-semibold w-[104px] text-right shrink-0">
                      {q.summa ? Number(q.summa).toLocaleString('ru-RU') : '—'}
                    </span>
                    <span className="flex-1 truncate text-slate-700 dark:text-slate-200">{q.kontragent || '—'}</span>
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums shrink-0',
                      q.ishonch >= 70
                        ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-500',
                    )}>
                      {q.ishonch}%
                    </span>
                    {q.qoyildi
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      : <span className="w-3.5 shrink-0" />}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-slate-600 dark:text-slate-300">
                    {q.categoryCode && <span>kategoriya: <b>{q.categoryCode}</b></span>}
                    {q.modda && <span>modda: {q.modda}</span>}
                    {q.obyekt && <span>obyekt: {q.obyekt}</span>}
                    {q.shartnoma && (
                      <span>
                        shartnoma: <span className="font-mono">{q.shartnoma}</span>
                        {q.shartnomaSana ? <> · <span className="font-mono">{q.shartnomaSana}</span></> : null}
                      </span>
                    )}
                  </div>
                  {q.sabab && (
                    <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">{q.sabab}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ─── Oxirgi yurishlar ─── */}
        {(runs.data?.rows?.length ?? 0) > 0 && (
          <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
            <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 dark:bg-slate-800">
              Oxirgi yurishlar
            </div>
            <div className="max-h-52 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
              {runs.data!.rows.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setKorilayotgan(r.id)}
                  className={cn(
                    'w-full px-3 py-2 text-[11.5px] flex items-center gap-2 text-left transition-colors',
                    'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                    kuzatilayotganId === r.id && 'bg-violet-50 dark:bg-violet-950/30',
                  )}
                >
                  <span className="tabular-nums text-slate-500 w-[128px] shrink-0">
                    {new Date(r.startedAt).toLocaleString('ru-RU')}
                  </span>
                  <HolatBelgisi status={r.status} />
                  <span className="text-slate-500 shrink-0">{r.dryRun ? 'sinov' : 'haqiqiy'}</span>
                  <span className="text-slate-400 shrink-0">{r.trigger === 'cron' ? 'avtomat' : "qo'lda"}</span>
                  <span className="flex-1" />
                  <span className="tabular-nums text-slate-500 shrink-0">
                    AI {r.aiQoyilgan}/{r.aiSoralgan}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── kichik bo'laklar ─────────────────────────────

function Belgi({ ok, matn }: { ok: boolean; matn: string }) {
  return (
    <div className={cn(
      'rounded-xl px-3 py-2 text-[12px] ring-1 flex items-center gap-2',
      ok
        ? 'bg-emerald-50 dark:bg-emerald-950/40 ring-emerald-200 dark:ring-emerald-900 text-emerald-800 dark:text-emerald-200'
        : 'bg-amber-50 dark:bg-amber-950/40 ring-amber-200 dark:ring-amber-900 text-amber-800 dark:text-amber-200',
    )}>
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0" />}
      <span className="leading-snug">{matn}</span>
    </div>
  );
}

function HolatBelgisi({ status }: { status: string }) {
  const map: Record<string, string> = {
    ok: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300',
    running: 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300',
    error: 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300',
    stopped: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  };
  const nom: Record<string, string> = {
    ok: 'tugadi', running: 'ishlamoqda', error: 'xato', stopped: "to'xtatildi",
  };
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0', map[status] || map.stopped)}>
      {nom[status] || status}
    </span>
  );
}

/**
 * Bitta bosqich qatori. Natija obyekti har bosqichda boshqacha, shuning uchun
 * eng muhim sonlar tanlab chiqariladi — qolgani yig'ma ko'rinishda.
 */
function BosqichQator({ kalit, natija, joriy }: { kalit: string; natija: any; joriy: boolean }) {
  const meta = BOSQICH_NOM[kalit];
  const Icon = meta?.Icon || ListChecks;
  const tugadi = natija !== undefined && natija !== null;
  const xato = tugadi && natija?.ok === false;

  return (
    <div className={cn(
      'rounded-xl px-3 py-2 ring-1 flex items-start gap-2.5',
      xato
        ? 'ring-rose-200 dark:ring-rose-900 bg-rose-50/60 dark:bg-rose-950/20'
        : joriy
          ? 'ring-indigo-200 dark:ring-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/20'
          : tugadi
            ? 'ring-slate-200 dark:ring-slate-700'
            : 'ring-slate-100 dark:ring-slate-800 opacity-55',
    )}>
      <span className="mt-0.5 shrink-0">
        {joriy
          ? <Loader2 className={cn('h-4 w-4 animate-spin', meta?.rang)} />
          : <Icon className={cn('h-4 w-4', meta?.rang)} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
          {meta?.nom || kalit}
          {!tugadi && !joriy && <span className="ml-2 text-[10.5px] font-normal text-slate-400">kutilmoqda</span>}
        </div>
        {tugadi && <BosqichNatija kalit={kalit} natija={natija} />}
      </div>
    </div>
  );
}

function BosqichNatija({ kalit, natija }: { kalit: string; natija: any }) {
  if (natija?.error) {
    return <div className="text-[11px] text-rose-700 dark:text-rose-300 leading-snug">{String(natija.error)}</div>;
  }
  if (natija?.otkazildi) {
    return <div className="text-[11px] text-slate-500">o&apos;tkazib yuborildi — {String(natija.otkazildi)}</div>;
  }
  if (natija?.chegara && !natija?.soralgan) {
    return <div className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug">{String(natija.chegara)}</div>;
  }

  const juft: Array<[string, any]> = [];
  const q = (l: string, v: any) => { if (v !== undefined && v !== null) juft.push([l, v]); };

  if (kalit === 'qoidalar') {
    q('ko‘rildi', natija?.progress?.total);
    q('mos', natija?.progress?.matched);
    q('xato', natija?.progress?.errors);
    q('kutildi', natija?.kutildi !== undefined ? `${natija.kutildi}s` : undefined);
    if (natija?.message) q('holat', natija.message);
  } else if (kalit === 'schotchik') {
    q('ko‘rildi', natija?.stats?.scanned);
    q('o‘zgardi', natija?.stats?.matched);
    q('allaqachon to‘g‘ri', natija?.stats?.alreadyCorrect);
  } else if (kalit === 'minfin') {
    q('ko‘rildi', natija?.scanned);
    for (const [k, v] of Object.entries(natija || {})) {
      if (typeof v === 'number' && k !== 'scanned') q(k, v);
    }
  } else if (kalit === 'taminot') {
    q('ko‘rildi', natija?.scanned);
    q('allaqachon bog‘langan', natija?.alreadyLinked);
    q('mos', natija?.matched);
    q('noaniq', natija?.ambiguous);
    q('summa oshdi', natija?.shiftRad);
    q('topilmadi', natija?.notFound);
  } else if (kalit === 'ai') {
    q('qoldiq', natija?.qoldiq);
    q('so‘raldi', natija?.soralgan);
    q('qo‘yildi', natija?.qoyilgan);
    q('ishonch past', natija?.past);
    q('so‘rov', natija?.chaqiriq);
    q('kunlik', natija?.kunlik);
    q('paket xato', natija?.paketXato);
  }

  if (juft.length === 0) return null;
  return (
    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600 dark:text-slate-300">
      {juft.map(([l, v]) => (
        <span key={l} className="tabular-nums">
          {l}: <b className="font-semibold">{typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v)}</b>
        </span>
      ))}
      {natija?.chegara && (
        <span className="w-full text-[10.5px] text-amber-700 dark:text-amber-300 leading-snug">
          {String(natija.chegara)}
        </span>
      )}
      {Array.isArray(natija?.xatolar) && natija.xatolar.length > 0 && (
        <span className="w-full text-[10.5px] text-amber-700 dark:text-amber-300 leading-snug">
          {natija.xatolar.join(' · ')}
        </span>
      )}
    </div>
  );
}
