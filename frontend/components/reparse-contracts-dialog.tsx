'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search, Loader2, Wand2, AlertTriangle, Check, ArrowRight } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * SOXTA SHARTNOMA RAQAMLARINI QAYTA O'QISH
 *
 * Bank izohi "№006AFS сонли шартнома" bo'lganda ajratuvchi «сон» so'zini ham
 * raqamga qo'shib olgan (kirill С→C, О→O, Н→H bo'lib transliteratsiya qilinadi):
 *   006AFS + COH   → "006AFSCOH"     mavjud emas
 *   020SLQ + SONLI → "020SLQSONLI"   mavjud emas
 *
 * Natijada to'lov yo'q shartnomaga biriktirilgan, CRM'da topilmagan va hech
 * qachon bo'linmagan. Parser tuzatildi; bu oyna ESKI qatorlarni tozalaydi.
 */

interface Qator {
  txId: string;
  date: string;
  amount: string;
  party: string;
  oldContract: string;
  newContract: string | null;
  candidates: string[];
  oplataRows: number;
  action: string;
}

interface Natija {
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  fixed: number;
  cleared: number;
  rows: Qator[];
}

export function ReparseContractsDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [res, setRes] = useState<Natija | null>(null);

  const run = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<Natija>('/categorization/reparse-junk-contracts', { dryRun, limit: 500 }, { timeout: 900_000 }),
    onSuccess: (r) => {
      setRes(r);
      if (r.dryRun) {
        toast.info(`Sinov: ${r.scanned} ta topildi — ${r.fixed} tasi tuzatiladi`);
      } else {
        toast.success(`Bajarildi: ${r.fixed} ta tuzatildi, ${r.cleared} ta XATO ga o'tdi`);
        qc.invalidateQueries({ queryKey: ['transactions'] });
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Xatolik'),
  });

  // ── 2-qadam: CRM'da topilmagan raqamlarni 'XATO' ga almashtirish ──
  // Egasi qoidasi: shartnoma CRM'da bo'lmasa, izohdan olingan raqam shartnoma
  // raqami EMAS — bazada 'XATO' turishi kerak.
  const [xatoRes, setXatoRes] = useState<{ jami: number; dryRun: boolean; namunalar: Array<{ contractNo: string; qator: number }> } | null>(null);
  const xato = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<{ ok: boolean; dryRun: boolean; jami: number; namunalar: Array<{ contractNo: string; qator: number }> }>(
        '/oplata-kv/cleanup-xato-contracts', { dryRun }, { timeout: 300_000 },
      ),
    onSuccess: (r) => {
      setXatoRes(r);
      if (r.dryRun) toast.info(`${r.jami} ta qator 'XATO' ga o'tadi`);
      else {
        toast.success(`${r.jami} ta qator 'XATO' qilindi`);
        qc.invalidateQueries({ queryKey: ['oplata-kv'] });
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Xatolik'),
  });

  const close = () => { setRes(null); setXatoRes(null); run.reset(); xato.reset(); onOpenChange(false); };
  const yozilsinmi = !!res?.dryRun && res.scanned > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="sm:max-w-[860px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 grid place-items-center">
              <Wand2 className="h-4 w-4" />
            </span>
            Soxta shartnoma raqamlari
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            Bank izohida <b>«сонли шартнома»</b> deb yozilganda raqam ajratuvchi
            o&apos;sha so&apos;zni ham qo&apos;shib olgan. Kirillcha <span className="font-mono">сон</span>{' '}
            lotinga <span className="font-mono">COH</span> bo&apos;lib o&apos;tadi, shuning uchun{' '}
            <span className="font-mono">006AFS</span> o&apos;rniga{' '}
            <span className="font-mono">006AFSCOH</span> degan mavjud bo&apos;lmagan shartnoma chiqqan.
            Bunday to&apos;lovlar CRM&apos;da topilmaydi va hech qachon bo&apos;linmaydi.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 ring-1 ring-slate-200 dark:ring-slate-800 px-3.5 py-3 text-[12px] text-slate-600 dark:text-slate-300 leading-relaxed">
          Har bir to&apos;lov izohi qaytadan o&apos;qiladi. CRM&apos;da <b>tasdiqlangan</b> raqam
          topilsa — qo&apos;yiladi. Topilmasa — <b>XATO</b> qilib bo&apos;shatiladi, shunda to&apos;lov
          XATO ro&apos;yxatiga tushadi va odam ko&apos;radi. Jim yolg&apos;on raqam bilan qolmaydi.
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => run.mutate(true)}
            disabled={run.isPending}
            className="gap-2"
          >
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Sinov (yozmaydi)
          </Button>
          {yozilsinmi && (
            <Button
              onClick={() => run.mutate(false)}
              disabled={run.isPending}
              className="gap-2 bg-rose-600 hover:bg-rose-700 text-white"
            >
              {run.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Tasdiqlab yozish ({res!.scanned} ta)
            </Button>
          )}
        </div>

        {run.isPending && (
          <div className="flex items-center gap-2.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 px-3 py-3 text-[12.5px] text-indigo-800 dark:text-indigo-200">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            Izohlar qaytadan o&apos;qilmoqda va CRM&apos;da tekshirilmoqda — bir necha daqiqa olishi mumkin…
          </div>
        )}

        {res && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { l: 'Topildi', v: res.scanned, c: 'text-slate-700 dark:text-slate-200' },
                { l: res.dryRun ? 'Tuzatiladi' : 'Tuzatildi', v: res.fixed, c: 'text-emerald-700 dark:text-emerald-300' },
                { l: res.dryRun ? 'XATO ga o‘tadi' : 'XATO ga o‘tdi', v: res.cleared, c: 'text-amber-700 dark:text-amber-300' },
              ].map((k) => (
                <div key={k.l} className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2">
                  <div className="text-[9.5px] uppercase tracking-wider text-slate-400">{k.l}</div>
                  <div className={cn('text-[20px] font-black tabular-nums', k.c)}>{k.v}</div>
                </div>
              ))}
            </div>

            {res.dryRun && res.scanned > 0 && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900 px-3 py-2.5 text-[11.5px] text-amber-800 dark:text-amber-200">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  Hali hech narsa yozilmadi. Pastdagi ro&apos;yxatni ko&apos;rib chiqing —
                  to&apos;g&apos;ri bo&apos;lsa «Tasdiqlab yozish» tugmasini bosing.
                </span>
              </div>
            )}

            {res.rows.length > 0 && (
              <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                <div className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 dark:bg-slate-800">
                  Eski raqam → yangi raqam
                </div>
                <div className="max-h-[22rem] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {res.rows.map((r) => (
                    <div key={r.txId} className="px-3 py-2 text-[11.5px]">
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-slate-400 w-[74px] shrink-0">{r.date}</span>
                        <span className="tabular-nums font-semibold w-[104px] text-right shrink-0">
                          {Number(r.amount).toLocaleString('ru-RU')}
                        </span>
                        <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{r.party}</span>
                        {r.oplataRows > 0 && (
                          <span className="text-[10px] text-slate-400 shrink-0">
                            {r.oplataRows} ta ОплатыКв
                          </span>
                        )}
                      </div>
                      <div className="mt-1 ml-[74px] flex items-center gap-2 flex-wrap">
                        <span className="px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-[10.5px] font-mono line-through">
                          {r.oldContract}
                        </span>
                        <ArrowRight className="h-3 w-3 text-slate-400 shrink-0" />
                        {r.newContract ? (
                          <span className="px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-[10.5px] font-mono font-bold">
                            {r.newContract}
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 text-[10.5px] font-bold">
                            XATO — CRM&apos;da topilmadi
                          </span>
                        )}
                        {r.candidates.length > 0 && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            nomzodlar: {r.candidates.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {res.scanned === 0 && (
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-900 px-3 py-2.5 text-[12px] text-emerald-800 dark:text-emerald-200">
                Soxta raqamli to&apos;lov topilmadi — hammasi joyida.
              </div>
            )}
          </div>
        )}
        {/* ═══ 2-QADAM ═══ */}
        <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 p-3.5 space-y-2.5">
          <div className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">
            2-qadam · CRM&apos;da topilmagan raqamlarni XATO qilish
          </div>
          <div className="text-[11.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
            Shartnoma CRM&apos;da bo&apos;lmasa, izohdan olingan raqam <b>shartnoma raqami emas</b> —
            bazada <b>XATO</b> turishi kerak. Qo&apos;lda yoki ariza bilan biriktirilgan
            shartnomalarga tegilmaydi. Raqam yo&apos;qolmaydi: tranzaksiyada va to&apos;lov
            izohida qoladi.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => xato.mutate(true)} disabled={xato.isPending} className="gap-2">
              {xato.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Sinov
            </Button>
            {xatoRes?.dryRun && xatoRes.jami > 0 && (
              <Button size="sm" onClick={() => xato.mutate(false)} disabled={xato.isPending}
                className="gap-2 bg-rose-600 hover:bg-rose-700 text-white">
                <Check className="h-3.5 w-3.5" />
                {xatoRes.jami} ta qatorni XATO qilish
              </Button>
            )}
          </div>
          {xatoRes && (
            <div className="text-[11.5px] text-slate-600 dark:text-slate-300">
              {xatoRes.jami === 0 ? (
                <span className="text-emerald-700 dark:text-emerald-300">Tozalanadigan qator yo&apos;q.</span>
              ) : (
                <>
                  <b className="tabular-nums">{xatoRes.jami}</b> ta qator
                  {xatoRes.dryRun ? " 'XATO' ga o'tadi" : " 'XATO' qilindi"}.
                  {xatoRes.namunalar.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {xatoRes.namunalar.slice(0, 12).map((n) => (
                        <span key={n.contractNo} className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[10.5px] font-mono">
                          {n.contractNo} <b>{n.qator}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
