'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot, Loader2, Play, Square, Check, AlertTriangle, Clock,
  ListChecks, Gauge, Landmark, Link2, Sparkles, ChevronRight, Info,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
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
 * Oyna uch savolga javob berishi kerak:
 *   1. Hozir nima bo'lyapti?       → jonli quvur (pipeline)
 *   2. Har bosqich NIMA qiladi?    → har qadamda bir qatorlik izoh
 *   3. Nega shunday qaror qilindi? → qarorlar ro'yxati, sabablari bilan
 */

type BosqichKalit = 'qoidalar' | 'schotchik' | 'minfin' | 'taminot' | 'ai';

const QUVUR: Array<{
  kalit: BosqichKalit;
  nom: string;
  izoh: string;
  Icon: any;
  tus: string;
  halqa: string;
}> = [
  {
    kalit: 'qoidalar',
    nom: 'Qoidalar',
    izoh: 'Shartnoma → mijoz → soliq → bank → maosh → qarz → ko‘chirma tartibida tekshiriladi',
    Icon: ListChecks,
    tus: 'text-amber-600 dark:text-amber-400',
    halqa: 'bg-amber-100 dark:bg-amber-950/50 ring-amber-200 dark:ring-amber-900',
  },
  {
    kalit: 'schotchik',
    nom: 'Schotchik',
    izoh: 'Счётчик uchun kelgan to‘lovlar oylik to‘lovga o‘tkaziladi',
    Icon: Gauge,
    tus: 'text-cyan-600 dark:text-cyan-400',
    halqa: 'bg-cyan-100 dark:bg-cyan-950/50 ring-cyan-200 dark:ring-cyan-900',
  },
  {
    kalit: 'minfin',
    nom: 'Молия Вазирлиги',
    izoh: 'Izohdagi «НДС» so‘zi tufayli xato soliq deb belgilangani tozalanadi',
    Icon: Landmark,
    tus: 'text-orange-600 dark:text-orange-400',
    halqa: 'bg-orange-100 dark:bg-orange-950/50 ring-orange-200 dark:ring-orange-900',
  },
  {
    kalit: 'taminot',
    nom: "Ta'minot",
    izoh: 'xontaminot ERP’dan xarajat moddasi, obyekt va shartnoma o‘qiladi (faqat o‘qish)',
    Icon: Link2,
    tus: 'text-teal-600 dark:text-teal-400',
    halqa: 'bg-teal-100 dark:bg-teal-950/50 ring-teal-200 dark:ring-teal-900',
  },
  {
    kalit: 'ai',
    nom: 'Agent',
    izoh: 'Qolganini o‘qib, shartnoma raqami va SANASIGA qarab o‘zi qaror qiladi',
    Icon: Sparkles,
    tus: 'text-violet-600 dark:text-violet-400',
    halqa: 'bg-violet-100 dark:bg-violet-950/50 ring-violet-200 dark:ring-violet-900',
  },
];

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
  ai: {
    ok: boolean; usul: string; tokenBor: boolean;
    cliBor: boolean; versiya: string; buyruq: string; model: string;
  };
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
        toast.success(dryRun ? 'Sinov boshlandi — hech narsa yozilmaydi' : 'Agent ishga tushdi');
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
  const ishlayapti = !!h?.ishlayapti;

  const tugagan = useMemo(
    () => QUVUR.filter((q) => run?.stages?.[q.kalit] !== undefined).length,
    [run?.stages],
  );

  const tayyor = !!h?.bilimBor && !!h?.ai?.ok;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[940px] max-h-[92vh] overflow-y-auto p-0 gap-0">
        {/* ═══ HERO ═══ */}
        <DialogHeader className="relative overflow-hidden px-6 pt-6 pb-5 border-b border-slate-200/70 dark:border-slate-800 space-y-0">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-50 via-white to-teal-50/60 dark:from-violet-950/40 dark:via-slate-900 dark:to-teal-950/20"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full bg-violet-400/15 blur-3xl"
          />
          <div className="relative flex items-start gap-3.5">
            <span className={cn(
              'w-11 h-11 rounded-2xl grid place-items-center shrink-0 ring-1',
              'bg-violet-100 dark:bg-violet-950/60 ring-violet-200 dark:ring-violet-900',
              ishlayapti && 'animate-pulse',
            )}>
              <Bot className="h-5 w-5 text-violet-700 dark:text-violet-300" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[17px] leading-tight">Kategoriya agenti</DialogTitle>
              <p className="mt-1 text-[12.5px] text-slate-600 dark:text-slate-400 leading-snug">
                Besh bosqich ketma-ket ishlaydi. Har biri oldingisidan qolganini oladi —
                oxirida eng qiyinlarini agent o&apos;zi o&apos;ylab hal qiladi.
              </p>
            </div>
            <div className="hidden sm:flex flex-col items-end gap-1 shrink-0">
              <HolatNishoni ishlayapti={ishlayapti} run={run} />
              {run && (
                <span className="text-[10.5px] text-slate-400 tabular-nums">{tugagan}/5 bosqich</span>
              )}
            </div>
          </div>

          {/* Tayyorlik — muomo bo'lsagina ko'rinadi */}
          <div className="relative mt-4">
            {tayyor ? (
              <div className="flex items-center gap-2 text-[11.5px] text-slate-500 dark:text-slate-400">
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                Tayyor — bilim fayli joyida, setup token ishlayapti
                {h?.ai?.versiya ? ` (claude ${h.ai.versiya}, ${h.ai.model})` : ''}
              </div>
            ) : (
              <div className="space-y-1.5">
                {h && !h.bilimBor && <Ogoh matn="Bilim fayli topilmadi — agents/knowledge/kategoriya.md" />}
                {h && !h.ai?.tokenBor && <Ogoh matn="ANTHROPIC_SETUP_TOKEN yo'q — 5-bosqich ishlamaydi" />}
                {h && h.ai?.tokenBor && !h.ai?.cliBor && (
                  <Ogoh matn={`claude CLI topilmadi (${h.ai.buyruq}) — CLAUDE_CMD bilan yo'lni ko'rsating`} />
                )}
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* ═══ BOSHQARUV ═══ */}
          <div className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-4 space-y-3.5">
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-slate-400 mb-1">Sanadan</div>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[158px]" />
              </div>
              <div>
                <div className="text-[10.5px] uppercase tracking-wider text-slate-400 mb-1">Sanagacha</div>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[158px]" />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Belgilash belgi={dryRun} set={setDryRun} matn="Sinov (yozmaydi)" />
                <Belgilash belgi={rematch} set={setRematch} matn="Bog&rsquo;langanlarni qayta ko&rsquo;rish" />
                <Belgilash belgi={aiYoq} set={setAiYoq} matn="Agentsiz" />
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => boshla.mutate()}
                disabled={boshla.isPending || ishlayapti}
                className={cn(
                  'gap-2 shadow-sm',
                  dryRun
                    ? 'bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white'
                    : 'bg-violet-600 hover:bg-violet-700 text-white',
                )}
              >
                {boshla.isPending || ishlayapti
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Play className="h-4 w-4" />}
                {ishlayapti ? 'Ishlamoqda…' : dryRun ? 'Sinovni boshlash' : 'Ishga tushirish'}
              </Button>
              {ishlayapti && (
                <Button variant="outline" onClick={() => toxtat.mutate()} disabled={toxtat.isPending} className="gap-2">
                  {toxtat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  To&apos;xtatish
                </Button>
              )}
              <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
                {dryRun
                  ? 'Sinovda hech narsa yozilmaydi — qarorlarni ko‘rib, keyin haqiqiy yurish qilasiz'
                  : 'Haqiqiy yurish — o‘zgarishlar amallar tarixiga yoziladi va qaytarilishi mumkin'}
              </span>
            </div>

            {h?.aiKunlik && (
              <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug pt-0.5">
                <Info className="h-3.5 w-3.5 mt-px shrink-0 text-slate-400" />
                <span>
                  Agent kunlik chegarasi{' '}
                  <b className="tabular-nums text-slate-700 dark:text-slate-200">
                    {h.aiKunlik.ishlatilgan}/{h.aiKunlik.chegara}
                  </b>{' '}
                  so&apos;rov. Setup token Telegram agentlari bilan bir obunada — chegara
                  shular uchun joy qoldiradi. Tugasa qolgan to&apos;lovlar ertaga ko&apos;riladi.
                </span>
              </div>
            )}
          </div>

          {/* ═══ QUVUR ═══ */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                Qanday ishlaydi
              </div>
              {run && (
                <div className="text-[10.5px] text-slate-400 tabular-nums">
                  {new Date(run.startedAt).toLocaleString('ru-RU')}
                  {run.dryRun ? ' · sinov' : ''}
                  {run.trigger === 'cron' ? ' · avtomat' : ''}
                </div>
              )}
            </div>

            <div className="relative">
              <div
                aria-hidden
                className="absolute left-[21px] top-6 bottom-6 w-px bg-gradient-to-b from-slate-200 via-slate-200 to-transparent dark:from-slate-700 dark:via-slate-700"
              />
              <div className="space-y-1.5">
                {QUVUR.map((q, i) => (
                  <Qadam
                    key={q.kalit}
                    meta={q}
                    raqam={i + 1}
                    natija={run?.stages?.[q.kalit]}
                    joriy={ishlayapti && run?.bosqich === q.kalit}
                    kutmoqda={!run || (run.stages?.[q.kalit] === undefined && run.bosqich !== q.kalit)}
                  />
                ))}
              </div>
            </div>

            {run?.error && (
              <div className="mt-2 rounded-xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-3 py-2 text-[12px] text-rose-800 dark:text-rose-200 leading-snug">
                {run.error}
              </div>
            )}
          </div>

          {/* ═══ QARORLAR ═══ */}
          {qarorlar.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2.5">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                  Agent qarorlari — nega shunday
                </div>
                <div className="text-[10.5px] text-slate-400 tabular-nums">
                  {qarorlar.filter((q) => q.qoyildi).length} / {qarorlar.length}{' '}
                  {run?.dryRun ? 'qo‘yilardi' : 'qo‘yildi'}
                </div>
              </div>

              {run?.dryRun && (
                <div className="mb-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900 px-3 py-2 text-[11.5px] text-amber-800 dark:text-amber-200 leading-snug">
                  Bu qarorlar hali <b>yozilmagan</b>. To&apos;g&apos;ri bo&apos;lsa
                  &laquo;Sinov&raquo; ni o&apos;chirib qayta ishga tushiring.
                </div>
              )}

              <div className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
                <div className="max-h-[22rem] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {qarorlar.map((q) => <QarorQator key={q.id} q={q} sinov={!!run?.dryRun} />)}
                </div>
              </div>
            </div>
          )}

          {/* ═══ TARIX ═══ */}
          {(runs.data?.rows?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-400 mb-2.5">
                Oxirgi yurishlar
              </div>
              <div className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden">
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {runs.data!.rows.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setKorilayotgan(r.id)}
                      className={cn(
                        'w-full px-3 py-2 text-[11.5px] flex items-center gap-2.5 text-left transition-colors',
                        'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                        kuzatilayotganId === r.id && 'bg-violet-50/70 dark:bg-violet-950/25',
                      )}
                    >
                      <span className="tabular-nums text-slate-500 w-[124px] shrink-0">
                        {new Date(r.startedAt).toLocaleString('ru-RU')}
                      </span>
                      <StatusNishoni status={r.status} />
                      <span className="text-slate-400 shrink-0">{r.dryRun ? 'sinov' : 'haqiqiy'}</span>
                      <span className="flex-1" />
                      <span className="tabular-nums text-slate-500 shrink-0">
                        agent {r.aiQoyilgan}/{r.aiSoralgan}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────────── bo'laklar ─────────────────────────────

function Ogoh({ matn }: { matn: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-900 px-2.5 py-1.5 text-[11.5px] text-amber-800 dark:text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="leading-snug">{matn}</span>
    </div>
  );
}

function Belgilash({ belgi, set, matn }: { belgi: boolean; set: (v: boolean) => void; matn: string }) {
  return (
    <label className={cn(
      'flex items-center gap-2 h-9 px-3 rounded-lg cursor-pointer text-[12px] ring-1 transition-colors select-none',
      belgi
        ? 'bg-slate-900 text-white ring-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-100'
        : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-slate-300',
    )}>
      <input type="checkbox" checked={belgi} onChange={(e) => set(e.target.checked)} className="sr-only" />
      <span className={cn(
        'w-3.5 h-3.5 rounded grid place-items-center ring-1',
        belgi ? 'bg-white/20 ring-white/40 dark:bg-slate-900/20 dark:ring-slate-900/40' : 'ring-slate-300 dark:ring-slate-600',
      )}>
        {belgi && <Check className="h-2.5 w-2.5" />}
      </span>
      <span dangerouslySetInnerHTML={{ __html: matn }} />
    </label>
  );
}

function HolatNishoni({ ishlayapti, run }: { ishlayapti: boolean; run: RunXulosa | null }) {
  if (ishlayapti) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300">
        <Loader2 className="h-3 w-3 animate-spin" /> Ishlamoqda
      </span>
    );
  }
  if (run?.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300">
        <AlertTriangle className="h-3 w-3" /> Uzildi
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
      <Clock className="h-3 w-3" /> Bo&apos;sh turibdi
    </span>
  );
}

function StatusNishoni({ status }: { status: string }) {
  const map: Record<string, string> = {
    ok: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300',
    running: 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300',
    error: 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300',
    stopped: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  };
  const nom: Record<string, string> = {
    ok: 'tugadi', running: 'ishlamoqda', error: 'uzildi', stopped: "to'xtatildi",
  };
  return (
    <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0', map[status] || map.stopped)}>
      {nom[status] || status}
    </span>
  );
}

/** Quvurdagi bitta qadam: nima qilishi + hozirgi holati + natijasi. */
function Qadam({
  meta, raqam, natija, joriy, kutmoqda,
}: {
  meta: (typeof QUVUR)[number];
  raqam: number;
  natija: any;
  joriy: boolean;
  kutmoqda: boolean;
}) {
  const tugadi = natija !== undefined && natija !== null;
  const xato = tugadi && natija?.ok === false;
  const Icon = meta.Icon;

  return (
    <div className={cn(
      'relative rounded-2xl px-3 py-2.5 ring-1 transition-colors flex items-start gap-3',
      xato
        ? 'ring-rose-200 dark:ring-rose-900 bg-rose-50/50 dark:bg-rose-950/20'
        : joriy
          ? 'ring-indigo-300 dark:ring-indigo-800 bg-indigo-50/60 dark:bg-indigo-950/25 shadow-sm'
          : tugadi
            ? 'ring-slate-200 dark:ring-slate-800 bg-white dark:bg-slate-900'
            : 'ring-transparent',
    )}>
      <span className={cn(
        'relative z-10 w-[26px] h-[26px] rounded-xl grid place-items-center shrink-0 ring-1 mt-0.5',
        xato
          ? 'bg-rose-100 dark:bg-rose-950/50 ring-rose-200 dark:ring-rose-900'
          : kutmoqda
            ? 'bg-slate-100 dark:bg-slate-800 ring-slate-200 dark:ring-slate-700'
            : meta.halqa,
      )}>
        {joriy
          ? <Loader2 className={cn('h-3.5 w-3.5 animate-spin', meta.tus)} />
          : xato
            ? <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
            : tugadi
              ? <Check className={cn('h-3.5 w-3.5', meta.tus)} />
              : <Icon className="h-3.5 w-3.5 text-slate-400" />}
      </span>

      <div className={cn('min-w-0 flex-1', kutmoqda && 'opacity-55')}>
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200">
            {raqam}. {meta.nom}
          </span>
          {joriy && <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-medium">hozir</span>}
          {kutmoqda && <span className="text-[10px] text-slate-400">kutilmoqda</span>}
        </div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5">
          {meta.izoh}
        </div>
        {tugadi && <QadamNatija kalit={meta.kalit} natija={natija} />}
      </div>
    </div>
  );
}

function QadamNatija({ kalit, natija }: { kalit: BosqichKalit; natija: any }) {
  const juft: Array<[string, any]> = [];
  const q = (l: string, v: any) => { if (v !== undefined && v !== null) juft.push([l, v]); };

  if (kalit === 'qoidalar') {
    q('kategoriyasiz', natija?.kategoriyasiz);
    q('ko‘rildi', natija?.korildi);
    q('qo‘yildi', natija?.qoyildi);
    q('qolgan', natija?.qolgan);
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
    q('navbatda', natija?.qoldiq);
    q('kategoriyasiz', natija?.kategoriyasiz);
    q('moddasiz', natija?.moddasiz);
    q('so‘raldi', natija?.soralgan);
    q('qo‘yildi', natija?.qoyilgan);
    q('ishonch past', natija?.past);
    q('kunlik', natija?.kunlik);
  }

  const izoh = natija?.izoh || natija?.otkazildi;

  return (
    <div className="mt-1.5 space-y-1">
      {juft.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {juft.map(([l, v]) => (
            <span
              key={l}
              className="inline-flex items-baseline gap-1 px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10.5px] text-slate-600 dark:text-slate-300"
            >
              {l}
              <b className="font-bold tabular-nums text-slate-800 dark:text-slate-100">
                {typeof v === 'number' ? v.toLocaleString('ru-RU') : String(v)}
              </b>
            </span>
          ))}
        </div>
      )}
      {izoh && (
        <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">{String(izoh)}</div>
      )}
      {natija?.chegara && (
        <div className="text-[10.5px] text-amber-700 dark:text-amber-300 leading-snug">{String(natija.chegara)}</div>
      )}
      {natija?.error && (
        <div className="text-[10.5px] text-rose-700 dark:text-rose-300 leading-snug">{String(natija.error)}</div>
      )}
      {Array.isArray(natija?.reasons) && natija.reasons.length > 0 && (
        <div className="text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">
          <span className="text-slate-400">nega qo&apos;yilmadi: </span>
          {natija.reasons.map((r: any) => `${r.reason} (${r.count})`).join(' · ')}
        </div>
      )}
      {Array.isArray(natija?.xatolar) && natija.xatolar.length > 0 && (
        <div className="text-[10.5px] text-amber-700 dark:text-amber-300 leading-snug">
          {natija.xatolar.join(' · ')}
        </div>
      )}
    </div>
  );
}

function QarorQator({ q, sinov }: { q: Qaror; sinov: boolean }) {
  const ishonchli = q.ishonch >= 70;
  return (
    <div className="px-3 py-2.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
      <div className="flex items-center gap-2">
        <span className="tabular-nums text-[11px] text-slate-400 w-[72px] shrink-0">{q.sana || '—'}</span>
        <span className="tabular-nums text-[12px] font-bold w-[108px] text-right shrink-0 text-slate-800 dark:text-slate-100">
          {q.summa ? Number(q.summa).toLocaleString('ru-RU') : '—'}
        </span>
        <span className="flex-1 truncate text-[12px] text-slate-700 dark:text-slate-200">
          {q.kontragent || '—'}
        </span>
        <span className={cn(
          'px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums shrink-0',
          ishonchli
            ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-500',
        )}>
          {q.ishonch}%
        </span>
        <span className="w-4 shrink-0 grid place-items-center">
          {q.qoyildi && (
            <Check className={cn('h-3.5 w-3.5', sinov ? 'text-slate-400' : 'text-emerald-600 dark:text-emerald-400')} />
          )}
        </span>
      </div>

      <div className="mt-1 ml-[72px] flex flex-wrap items-center gap-1.5">
        {q.categoryCode && (
          <span className="px-1.5 py-0.5 rounded-md bg-violet-100 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 text-[10.5px] font-bold">
            {q.categoryCode}
          </span>
        )}
        {q.modda && (
          <span className="px-1.5 py-0.5 rounded-md bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 text-[10.5px]">
            {q.modda}
          </span>
        )}
        {q.obyekt && (
          <span className="px-1.5 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 text-[10.5px]">
            {q.obyekt}
          </span>
        )}
        {q.shartnoma && (
          <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10.5px] font-mono">
            №{q.shartnoma}
            {q.shartnomaSana ? ` · ${q.shartnomaSana}` : ''}
          </span>
        )}
      </div>

      {q.sabab && (
        <div className="mt-1 ml-[72px] text-[10.5px] text-slate-500 dark:text-slate-400 leading-snug">
          {q.sabab}
        </div>
      )}
    </div>
  );
}
