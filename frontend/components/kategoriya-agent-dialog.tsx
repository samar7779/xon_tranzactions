'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Bot, Loader2, Play, Square, Check, AlertTriangle, Clock,
  ListChecks, Gauge, Landmark, Link2, Sparkles, ChevronRight, Info, Zap,
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
 * bitta oqim. Beshinchi bosqich — agent: 1-4 hal qilmagan qoldiqni o'ylab chiqaradi.
 *
 * Oyna uch savolga javob beradi:
 *   1. Hozir nima bo'lyapti?       → jonli quvur, yuqorida katta raqamlar
 *   2. Har bosqich NIMA qiladi?    → har qadamda bir qatorlik izoh
 *   3. Nega shunday qaror qilindi? → qarorlar kartasi, sababi bilan
 */

type BosqichKalit = 'qoidalar' | 'schotchik' | 'minfin' | 'taminot' | 'ai';

type QadamMeta = {
  kalit: BosqichKalit;
  nom: string;
  izoh: string;
  Icon: any;
  /** Asosiy raqam uchun rang (katta son) */
  matn: string;
  /** Ikonka plitasi */
  plita: string;
  /** Kartaning tusli foni (tugagan holatda) */
  karta: string;
  /** Quvur chizig'i uchun */
  chiziq: string;
};

const QUVUR: QadamMeta[] = [
  {
    kalit: 'qoidalar',
    nom: 'Qoidalar',
    izoh: 'Shartnoma → mijoz → soliq → bank → maosh → qarz → ko‘chirma tartibida tekshiriladi',
    Icon: ListChecks,
    matn: 'text-amber-600 dark:text-amber-300',
    plita: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-amber-500/25',
    karta: 'from-amber-50/80 to-transparent dark:from-amber-950/25 ring-amber-200/70 dark:ring-amber-900/60',
    chiziq: 'bg-amber-400',
  },
  {
    kalit: 'schotchik',
    nom: 'Schotchik',
    izoh: 'Счётчик uchun kelgan to‘lovlar oylik to‘lovga o‘tkaziladi',
    Icon: Gauge,
    matn: 'text-cyan-600 dark:text-cyan-300',
    plita: 'bg-gradient-to-br from-cyan-400 to-sky-500 text-white shadow-cyan-500/25',
    karta: 'from-cyan-50/80 to-transparent dark:from-cyan-950/25 ring-cyan-200/70 dark:ring-cyan-900/60',
    chiziq: 'bg-cyan-400',
  },
  {
    kalit: 'minfin',
    nom: 'Молия Вазирлиги',
    izoh: 'Izohdagi «НДС» so‘zi tufayli xato soliq deb belgilangani tozalanadi',
    Icon: Landmark,
    matn: 'text-orange-600 dark:text-orange-300',
    plita: 'bg-gradient-to-br from-orange-400 to-rose-500 text-white shadow-orange-500/25',
    karta: 'from-orange-50/80 to-transparent dark:from-orange-950/25 ring-orange-200/70 dark:ring-orange-900/60',
    chiziq: 'bg-orange-400',
  },
  {
    kalit: 'taminot',
    nom: "Ta'minot",
    izoh: 'xontaminot ERP’dan xarajat moddasi, obyekt va shartnoma o‘qiladi (faqat o‘qish)',
    Icon: Link2,
    matn: 'text-teal-600 dark:text-teal-300',
    plita: 'bg-gradient-to-br from-teal-400 to-emerald-500 text-white shadow-teal-500/25',
    karta: 'from-teal-50/80 to-transparent dark:from-teal-950/25 ring-teal-200/70 dark:ring-teal-900/60',
    chiziq: 'bg-teal-400',
  },
  {
    kalit: 'ai',
    nom: 'Agent',
    izoh: 'Qolganini o‘qib, shartnoma raqami va SANASIGA qarab o‘zi qaror qiladi',
    Icon: Sparkles,
    matn: 'text-violet-600 dark:text-violet-300',
    plita: 'bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white shadow-violet-500/30',
    karta: 'from-violet-50/80 to-transparent dark:from-violet-950/25 ring-violet-200/70 dark:ring-violet-900/60',
    chiziq: 'bg-violet-500',
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

/** Oynaga tegishli animatsiyalar — tashqi bog'liqliksiz, shu yerda. */
const USLUB = `
@keyframes kag-oqim {
  0%   { offset-distance: 0%;   opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}
@keyframes kag-nafas {
  0%, 100% { transform: scale(1);    opacity: .55; }
  50%      { transform: scale(1.25); opacity: 0; }
}
@keyframes kag-kirish {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}
.kag-nuqta { animation: kag-oqim 3.2s linear infinite; }
.kag-nafas { animation: kag-nafas 2.4s ease-out infinite; }
.kag-kirish { animation: kag-kirish .35s ease-out both; }
`;

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
  const tayyor = !!h?.bilimBor && !!h?.ai?.ok;

  const tugagan = useMemo(
    () => QUVUR.filter((q) => run?.stages?.[q.kalit] !== undefined).length,
    [run?.stages],
  );

  /** Yuqoridagi katta raqamlar — bitta yurishning qisqa hisoboti. */
  const kpi = useMemo(() => {
    const s = run?.stages || {};
    const hal =
      (s.qoidalar?.qoyildi || 0)
      + (s.schotchik?.stats?.matched || 0)
      + (s.taminot?.matched || 0)
      + (s.ai?.qoyilgan || 0);
    const korildi =
      (s.qoidalar?.korildi || s.qoidalar?.kategoriyasiz || 0)
      + (s.schotchik?.stats?.scanned || 0)
      + (s.taminot?.scanned || 0);
    const ishonch = qarorlar.length
      ? Math.round(qarorlar.reduce((a, q) => a + q.ishonch, 0) / qarorlar.length)
      : null;
    return { hal, korildi, qolgan: s.qoidalar?.qolgan ?? null, ishonch };
  }, [run?.stages, qarorlar]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Yopish tugmasi qora hero ustida turadi — oq qilib ko'rsatamiz */}
      <DialogContent className="sm:max-w-[980px] max-h-[93vh] overflow-y-auto p-0 gap-0 border-0 [&>button]:z-20 [&>button]:text-white/70 [&>button:hover]:text-white">
        <style dangerouslySetInnerHTML={{ __html: USLUB }} />

        {/* ══════════════ HERO ══════════════ */}
        <DialogHeader className="relative overflow-hidden space-y-0 px-7 pt-7 pb-6 bg-slate-950 text-white">
          {/* fon */}
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,rgba(139,92,246,.35),transparent_55%),radial-gradient(90%_90%_at_100%_10%,rgba(20,184,166,.28),transparent_55%)]" />
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.07] bg-[linear-gradient(to_right,#fff_1px,transparent_1px),linear-gradient(to_bottom,#fff_1px,transparent_1px)] bg-[size:26px_26px]" />

          <div className="relative flex items-start gap-4">
            <span className="relative shrink-0">
              {ishlayapti && (
                <span aria-hidden className="kag-nafas absolute inset-0 rounded-2xl bg-violet-400" />
              )}
              <span className="relative w-12 h-12 rounded-2xl grid place-items-center bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-900/40">
                <Bot className="h-6 w-6" />
              </span>
            </span>

            <div className="min-w-0 flex-1">
              <DialogTitle className="text-[20px] font-bold tracking-tight text-white leading-tight">
                Kategoriya agenti
              </DialogTitle>
              <p className="mt-1 text-[12.5px] text-slate-300/90 leading-snug max-w-[48ch]">
                Besh bosqich ketma-ket ishlaydi. Har biri oldingisidan qolganini oladi —
                oxirida eng qiyinlarini agent o&apos;zi o&apos;ylab hal qiladi.
              </p>
              <div className="mt-2.5">
                {tayyor ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-300/90">
                    <Check className="h-3.5 w-3.5" />
                    bilim fayli joyida · setup token ishlayapti
                    {h?.ai?.versiya ? ` · claude ${h.ai.versiya} · ${h.ai.model}` : ''}
                  </span>
                ) : (
                  <div className="space-y-1">
                    {h && !h.bilimBor && <OgohQora matn="Bilim fayli topilmadi — agents/knowledge/kategoriya.md" />}
                    {h && !h.ai?.tokenBor && <OgohQora matn="ANTHROPIC_SETUP_TOKEN yo'q — 5-bosqich ishlamaydi" />}
                    {h && h.ai?.tokenBor && !h.ai?.cliBor && (
                      <OgohQora matn={`claude CLI topilmadi (${h.ai.buyruq}) — CLAUDE_CMD bilan yo'lni ko'rsating`} />
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="hidden md:flex flex-col items-end gap-2 shrink-0">
              <HolatNishoni ishlayapti={ishlayapti} run={run} />
              <Oqim ishlayapti={ishlayapti} tugagan={tugagan} />
            </div>
          </div>

          {/* KPI */}
          {run && (
            <div className="relative mt-5 grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <Kpi nom="Hal qilindi" son={kpi.hal} asosiy sinov={run.dryRun} />
              <Kpi nom="Ko'rib chiqildi" son={kpi.korildi} />
              <Kpi
                nom="Agent qarori"
                son={run.aiQoyilgan}
                izoh={run.aiSoralgan ? `${run.aiSoralgan} tadan` : undefined}
              />
              <Kpi
                nom={kpi.ishonch !== null ? "O'rtacha ishonch" : 'Qolgan'}
                son={kpi.ishonch !== null ? kpi.ishonch : (kpi.qolgan ?? 0)}
                qoshimcha={kpi.ishonch !== null ? '%' : undefined}
              />
            </div>
          )}
        </DialogHeader>

        <div className="px-7 py-6 space-y-6 bg-white dark:bg-slate-950">
          {/* ══════════════ BOSHQARUV ══════════════ */}
          <div className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 bg-slate-50/70 dark:bg-slate-900/50 p-4 space-y-3.5">
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[.08em] text-slate-400 mb-1.5">Sanadan</div>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-10 w-[162px]" />
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[.08em] text-slate-400 mb-1.5">Sanagacha</div>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-10 w-[162px]" />
              </div>
              <div className="flex gap-2 flex-wrap">
                <Belgilash belgi={dryRun} set={setDryRun} matn="Sinov (yozmaydi)" />
                <Belgilash belgi={rematch} set={setRematch} matn="Bog&rsquo;langanlarni qayta ko&rsquo;rish" />
                <Belgilash belgi={aiYoq} set={setAiYoq} matn="Agentsiz" />
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              <Button
                onClick={() => boshla.mutate()}
                disabled={boshla.isPending || ishlayapti}
                className={cn(
                  'gap-2 h-10 px-5 font-semibold rounded-xl shadow-lg transition-transform active:scale-[.98]',
                  dryRun
                    ? 'bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/15 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white'
                    : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 text-white shadow-violet-600/25',
                )}
              >
                {boshla.isPending || ishlayapti
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : dryRun ? <Play className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                {ishlayapti ? 'Ishlamoqda…' : dryRun ? 'Sinovni boshlash' : 'Ishga tushirish'}
              </Button>
              {ishlayapti && (
                <Button variant="outline" onClick={() => toxtat.mutate()} disabled={toxtat.isPending} className="gap-2 h-10 rounded-xl">
                  {toxtat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}
                  To&apos;xtatish
                </Button>
              )}
              <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
                {dryRun
                  ? 'Sinovda hech narsa yozilmaydi — qarorlarni ko‘rib, keyin haqiqiy yurish qilasiz'
                  : 'O‘zgarishlar amallar tarixiga yoziladi va qaytarilishi mumkin'}
              </span>
            </div>

            {h?.aiKunlik && (
              <div className="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
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

          {/* ══════════════ QUVUR ══════════════ */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">
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

            <div className="relative space-y-2">
              {QUVUR.map((q, i) => (
                <Qadam
                  key={q.kalit}
                  meta={q}
                  raqam={i + 1}
                  oxirgimi={i === QUVUR.length - 1}
                  natija={run?.stages?.[q.kalit]}
                  joriy={ishlayapti && run?.bosqich === q.kalit}
                  kutmoqda={!run || (run.stages?.[q.kalit] === undefined && run.bosqich !== q.kalit)}
                />
              ))}
            </div>

            {run?.error && (
              <div className="mt-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 ring-1 ring-rose-200 dark:ring-rose-900 px-4 py-3 text-[12px] text-rose-800 dark:text-rose-200 leading-snug">
                {run.error}
              </div>
            )}
          </div>

          {/* ══════════════ QARORLAR ══════════════ */}
          {qarorlar.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400">
                  Agent qarorlari — nega shunday
                </div>
                <div className="text-[10.5px] text-slate-400 tabular-nums">
                  {qarorlar.filter((q) => q.qoyildi).length} / {qarorlar.length}{' '}
                  {run?.dryRun ? 'qo‘yilardi' : 'qo‘yildi'}
                </div>
              </div>

              {run?.dryRun && (
                <div className="mb-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900 px-3.5 py-2.5 text-[11.5px] text-amber-800 dark:text-amber-200 leading-snug">
                  Bu qarorlar hali <b>yozilmagan</b>. To&apos;g&apos;ri bo&apos;lsa
                  &laquo;Sinov&raquo; ni o&apos;chirib qayta ishga tushiring.
                </div>
              )}

              <div className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden bg-white dark:bg-slate-900">
                <div className="max-h-[24rem] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {qarorlar.map((q) => <QarorKarta key={q.id} q={q} sinov={!!run?.dryRun} />)}
                </div>
              </div>
            </div>
          )}

          {/* ══════════════ TARIX ══════════════ */}
          {(runs.data?.rows?.length ?? 0) > 0 && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[.12em] text-slate-400 mb-3">
                Oxirgi yurishlar
              </div>
              <div className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-800 overflow-hidden bg-white dark:bg-slate-900">
                <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {runs.data!.rows.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setKorilayotgan(r.id)}
                      className={cn(
                        'w-full px-3.5 py-2.5 text-[11.5px] flex items-center gap-2.5 text-left transition-colors',
                        'hover:bg-slate-50 dark:hover:bg-slate-800/60',
                        kuzatilayotganId === r.id && 'bg-violet-50/70 dark:bg-violet-950/25',
                      )}
                    >
                      <span className="tabular-nums text-slate-500 w-[126px] shrink-0">
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

/** Hero ichidagi jonli oqim: to'lovlar bosqichlardan o'tayotgani. */
function Oqim({ ishlayapti, tugagan }: { ishlayapti: boolean; tugagan: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {QUVUR.map((q, i) => (
        <span key={q.kalit} className="flex items-center gap-1.5">
          <span
            className={cn(
              'w-2 h-2 rounded-full transition-colors',
              i < tugagan ? q.chiziq : 'bg-white/20',
              ishlayapti && i === tugagan && 'kag-nafas',
            )}
          />
          {i < QUVUR.length - 1 && (
            <span className={cn('w-4 h-px', i < tugagan ? 'bg-white/40' : 'bg-white/15')} />
          )}
        </span>
      ))}
      <span className="ml-1 text-[10.5px] text-slate-400 tabular-nums">{tugagan}/5</span>
    </div>
  );
}

function Kpi({
  nom, son, izoh, qoshimcha, asosiy, sinov,
}: {
  nom: string; son: number; izoh?: string; qoshimcha?: string; asosiy?: boolean; sinov?: boolean;
}) {
  return (
    <div className={cn(
      'kag-kirish rounded-2xl px-3.5 py-3 ring-1 backdrop-blur',
      asosiy
        ? 'bg-white/10 ring-white/20'
        : 'bg-white/[.06] ring-white/10',
    )}>
      <div className="text-[9.5px] font-semibold uppercase tracking-[.1em] text-slate-400">
        {nom}{asosiy && sinov ? ' (sinov)' : ''}
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={cn(
          'font-black tabular-nums leading-none',
          asosiy ? 'text-[27px] text-white' : 'text-[22px] text-slate-200',
        )}>
          {son.toLocaleString('ru-RU')}
        </span>
        {qoshimcha && <span className="text-[13px] font-bold text-slate-400">{qoshimcha}</span>}
        {izoh && <span className="text-[10.5px] text-slate-400">{izoh}</span>}
      </div>
    </div>
  );
}

function OgohQora({ matn }: { matn: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400/15 ring-1 ring-amber-400/30 px-2 py-1 text-[11px] text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="leading-snug">{matn}</span>
    </span>
  );
}

function Belgilash({ belgi, set, matn }: { belgi: boolean; set: (v: boolean) => void; matn: string }) {
  return (
    <label className={cn(
      'flex items-center gap-2 h-10 px-3.5 rounded-xl cursor-pointer text-[12px] ring-1 transition-all select-none',
      belgi
        ? 'bg-slate-900 text-white ring-slate-900 shadow-sm dark:bg-slate-100 dark:text-slate-900 dark:ring-slate-100'
        : 'bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-slate-300 dark:hover:ring-slate-600',
    )}>
      <input type="checkbox" checked={belgi} onChange={(e) => set(e.target.checked)} className="sr-only" />
      <span className={cn(
        'w-4 h-4 rounded-[5px] grid place-items-center ring-1 transition-colors',
        belgi ? 'bg-white/20 ring-white/40 dark:bg-slate-900/20 dark:ring-slate-900/40' : 'ring-slate-300 dark:ring-slate-600',
      )}>
        {belgi && <Check className="h-3 w-3" />}
      </span>
      <span dangerouslySetInnerHTML={{ __html: matn }} />
    </label>
  );
}

function HolatNishoni({ ishlayapti, run }: { ishlayapti: boolean; run: RunXulosa | null }) {
  if (ishlayapti) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-indigo-400/20 ring-1 ring-indigo-400/30 text-indigo-200">
        <Loader2 className="h-3 w-3 animate-spin" /> Ishlamoqda
      </span>
    );
  }
  if (run?.status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-rose-400/20 ring-1 ring-rose-400/30 text-rose-200">
        <AlertTriangle className="h-3 w-3" /> Uzildi
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white/10 ring-1 ring-white/15 text-slate-300">
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

/** Bosqichning ASOSIY raqami — katta ko'rsatiladi. */
function asosiySon(kalit: BosqichKalit, n: any): { son: number; yorliq: string } | null {
  if (!n) return null;
  if (kalit === 'qoidalar') {
    if (n.dryRun) return { son: n.kategoriyasiz ?? 0, yorliq: 'kategoriyasiz' };
    return { son: n.qoyildi ?? 0, yorliq: "qo‘yildi" };
  }
  if (kalit === 'schotchik') return { son: n.stats?.matched ?? 0, yorliq: "o‘zgardi" };
  if (kalit === 'minfin') return { son: n.changed ?? 0, yorliq: 'tozalandi' };
  if (kalit === 'taminot') return { son: n.matched ?? 0, yorliq: 'bog‘landi' };
  if (kalit === 'ai') return { son: n.qoyilgan ?? 0, yorliq: 'qaror' };
  return null;
}

function Qadam({
  meta, raqam, natija, joriy, kutmoqda, oxirgimi,
}: {
  meta: QadamMeta;
  raqam: number;
  natija: any;
  joriy: boolean;
  kutmoqda: boolean;
  oxirgimi: boolean;
}) {
  const tugadi = natija !== undefined && natija !== null;
  const xato = tugadi && natija?.ok === false;
  const Icon = meta.Icon;
  const bosh = tugadi ? asosiySon(meta.kalit, natija) : null;

  return (
    <div className="relative">
      {/* bog'lovchi chiziq */}
      {!oxirgimi && (
        <div
          aria-hidden
          className={cn(
            'absolute left-[25px] top-[52px] bottom-[-8px] w-[2px] rounded-full',
            tugadi ? meta.chiziq : 'bg-slate-200 dark:bg-slate-800',
            tugadi && 'opacity-40',
          )}
        />
      )}

      <div className={cn(
        'relative rounded-2xl px-4 py-3.5 ring-1 transition-all flex items-start gap-3.5 bg-gradient-to-r',
        xato
          ? 'from-rose-50/80 to-transparent dark:from-rose-950/25 ring-rose-200 dark:ring-rose-900'
          : joriy
            ? 'from-indigo-50 to-transparent dark:from-indigo-950/40 ring-indigo-300 dark:ring-indigo-800 shadow-md shadow-indigo-500/10'
            : tugadi
              ? cn(meta.karta, 'ring-1')
              : 'from-transparent to-transparent ring-slate-100 dark:ring-slate-800/70',
      )}>
        <span className={cn(
          'relative z-10 w-[34px] h-[34px] rounded-xl grid place-items-center shrink-0 shadow-lg transition-all',
          xato
            ? 'bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-rose-500/25'
            : kutmoqda
              ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 shadow-none'
              : meta.plita,
        )}>
          {joriy
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : xato
              ? <AlertTriangle className="h-4 w-4" />
              : tugadi
                ? <Check className="h-4 w-4" />
                : <Icon className="h-4 w-4" />}
        </span>

        <div className={cn('min-w-0 flex-1', kutmoqda && 'opacity-50')}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-slate-800 dark:text-slate-100">
              {raqam}. {meta.nom}
            </span>
            {joriy && (
              <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wider bg-indigo-600 text-white">
                hozir
              </span>
            )}
            {kutmoqda && <span className="text-[10px] text-slate-400">kutilmoqda</span>}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug mt-0.5 max-w-[62ch]">
            {meta.izoh}
          </div>
          {tugadi && <QadamNatija kalit={meta.kalit} natija={natija} />}
        </div>

        {/* asosiy raqam — o'ngda, katta */}
        {bosh && (
          <div className="shrink-0 text-right pl-2">
            <div className={cn('text-[24px] font-black tabular-nums leading-none', meta.matn)}>
              {bosh.son.toLocaleString('ru-RU')}
            </div>
            <div className="text-[9.5px] uppercase tracking-wider text-slate-400 mt-0.5">
              {bosh.yorliq}
            </div>
          </div>
        )}
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
    q('qolgan', natija?.qolgan);
  } else if (kalit === 'schotchik') {
    q('ko‘rildi', natija?.stats?.scanned);
    q('allaqachon to‘g‘ri', natija?.stats?.alreadyCorrect);
  } else if (kalit === 'minfin') {
    q('ko‘rildi', natija?.scanned);
    for (const [k, v] of Object.entries(natija || {})) {
      if (typeof v === 'number' && k !== 'scanned' && k !== 'changed') q(k, v);
    }
  } else if (kalit === 'taminot') {
    q('ko‘rildi', natija?.scanned);
    q('allaqachon bog‘langan', natija?.alreadyLinked);
    q('noaniq', natija?.ambiguous);
    q('summa oshdi', natija?.shiftRad);
    q('topilmadi', natija?.notFound);
  } else if (kalit === 'ai') {
    q('navbatda', natija?.qoldiq);
    q('kategoriyasiz', natija?.kategoriyasiz);
    q('moddasiz', natija?.moddasiz);
    q('so‘raldi', natija?.soralgan);
    q('ishonch past', natija?.past);
    q('kunlik', natija?.kunlik);
  }

  const izoh = natija?.izoh || natija?.otkazildi;

  return (
    <div className="mt-2 space-y-1.5">
      {juft.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {juft.map(([l, v]) => (
            <span
              key={l}
              className="inline-flex items-baseline gap-1 px-2 py-0.5 rounded-lg bg-white/80 dark:bg-slate-800/80 ring-1 ring-slate-200/70 dark:ring-slate-700/60 text-[10.5px] text-slate-500 dark:text-slate-400"
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

function QarorKarta({ q, sinov }: { q: Qaror; sinov: boolean }) {
  const ishonchli = q.ishonch >= 70;
  return (
    <div className="relative px-4 py-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
      {/* chap chekka — ishonch bo'yicha rang */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-2 bottom-2 w-[3px] rounded-full',
          ishonchli ? 'bg-emerald-400' : 'bg-slate-300 dark:bg-slate-700',
        )}
      />
      <div className="flex items-center gap-3">
        <span className="tabular-nums text-[11px] text-slate-400 w-[74px] shrink-0">{q.sana || '—'}</span>
        <span className="tabular-nums text-[14px] font-black w-[122px] text-right shrink-0 text-slate-900 dark:text-slate-50">
          {q.summa ? Number(q.summa).toLocaleString('ru-RU') : '—'}
        </span>
        <span className="flex-1 truncate text-[12.5px] font-medium text-slate-700 dark:text-slate-200">
          {q.kontragent || '—'}
        </span>
        <span className={cn(
          'px-2 py-0.5 rounded-lg text-[10.5px] font-black tabular-nums shrink-0',
          ishonchli
            ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
            : 'bg-slate-100 dark:bg-slate-800 text-slate-500',
        )}>
          {q.ishonch}%
        </span>
        <span className="w-4 shrink-0 grid place-items-center">
          {q.qoyildi && (
            <Check className={cn('h-4 w-4', sinov ? 'text-slate-300 dark:text-slate-600' : 'text-emerald-600 dark:text-emerald-400')} />
          )}
        </span>
      </div>

      <div className="mt-1.5 ml-[86px] flex flex-wrap items-center gap-1.5">
        {q.categoryCode && (
          <span className="px-2 py-0.5 rounded-lg bg-violet-600 text-white text-[10px] font-black tracking-wide">
            {q.categoryCode}
          </span>
        )}
        {q.modda && (
          <span className="px-2 py-0.5 rounded-lg bg-teal-50 dark:bg-teal-950/40 ring-1 ring-teal-200/70 dark:ring-teal-900 text-teal-700 dark:text-teal-300 text-[10.5px]">
            {q.modda}
          </span>
        )}
        {q.obyekt && (
          <span className="px-2 py-0.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 ring-1 ring-sky-200/70 dark:ring-sky-900 text-sky-700 dark:text-sky-300 text-[10.5px]">
            {q.obyekt}
          </span>
        )}
        {q.shartnoma && (
          <span className="px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10.5px] font-mono">
            №{q.shartnoma}
            {q.shartnomaSana ? ` · ${q.shartnomaSana}` : ''}
          </span>
        )}
      </div>

      {q.sabab && (
        <div className="mt-1.5 ml-[86px] text-[10.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
          {q.sabab}
        </div>
      )}
    </div>
  );
}
