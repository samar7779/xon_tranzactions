'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Landmark, Loader2, Search, Check, Save, AlertTriangle, Building2, FileText,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * BANK KOMISSIYASIGA OBYEKT (Ravshan aka topshirig'i, 10.10.2026)
 *
 * «Начисленные %% … За документ №… Тариф CORPORATE 0,1%» qatorlarida
 * obyekt avtomat tursin:
 *   1-qoida — firma zakazchik (bitta obyekt) → o'sha obyekt
 *   2-qoida — firma genpodryad (ko'p obyekt) → izohdagi «За документ №N
 *             S=summa» orqali asl to'lovning obyekti
 *
 * Oyna ikki qismdan: firmalar ro'yxati (tasdiqlash) va to'ldirish.
 */

interface Firma {
  firma: string;
  komissiya: number;
  taklifObyekt: string | null;
  obyektXil: number;
  obyektliTolov: number;
  saqlanganObyekt: string | null;
  genpodryad: boolean;
  tasdiqlangan: boolean;
}

interface Natija {
  ok: boolean;
  dryRun: boolean;
  korildi: number;
  firmadan: number;
  hujjatdan: number;
  topilmadi: number;
  sabablar: Array<{ sabab: string; qator: number }>;
  namunalar: Array<{
    sana: string; summa: string; firma: string; hujjat: string | null;
    aslSumma: string | null; obyekt: string; usul: string;
  }>;
}

export function KomissiyaObyektDialog({
  open, onOpenChange,
}: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [tahrir, setTahrir] = useState<Record<string, { obyekt: string; genpodryad: boolean }>>({});
  const [res, setRes] = useState<Natija | null>(null);

  const firmalar = useQuery({
    queryKey: ['komissiya-firmalar'],
    queryFn: () => api.get<{ ok: boolean; rows: Firma[] }>('/komissiya/firmalar'),
    enabled: open,
    retry: false,
  });

  // Serverdan kelgan qiymatlarni tahrir holatiga ko'chiramiz (bir marta).
  useEffect(() => {
    const rows = firmalar.data?.rows;
    if (!rows) return;
    setTahrir((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const boshlang: Record<string, { obyekt: string; genpodryad: boolean }> = {};
      for (const r of rows) {
        // Tasdiqlanmagan bo'lsa — taklifni oldindan qo'yamiz, odam ko'rib tasdiqlaydi.
        // Ko'p obyektli firma genpodryad deb belgilanadi (2-qoidaga tushadi).
        const kopObyekt = r.obyektXil > 3;
        boshlang[r.firma] = r.tasdiqlangan
          ? { obyekt: r.saqlanganObyekt || '', genpodryad: r.genpodryad }
          : { obyekt: kopObyekt ? '' : (r.taklifObyekt || ''), genpodryad: kopObyekt };
      }
      return boshlang;
    });
  }, [firmalar.data?.rows]);

  const saqla = useMutation({
    mutationFn: () => {
      const items = Object.entries(tahrir).map(([firma, v]) => ({
        firma, obyekt: v.obyekt || null, genpodryad: v.genpodryad,
      }));
      return api.post<{ ok: boolean; saqlandi: number }>('/komissiya/firmalar', { items });
    },
    onSuccess: (r) => {
      toast.success(`${r.saqlandi} ta firma saqlandi`);
      firmalar.refetch();
    },
    onError: (e: any) => toast.error(e?.message || 'Xatolik'),
  });

  const toldir = useMutation({
    mutationFn: (dryRun: boolean) =>
      api.post<Natija>('/komissiya/obyekt-toldir', { dryRun }, { timeout: 600_000 }),
    onSuccess: (r) => {
      setRes(r);
      const jami = r.firmadan + r.hujjatdan;
      if (r.dryRun) toast.info(`Sinov: ${jami} ta qatorga obyekt qo'yiladi`);
      else {
        toast.success(`Bajarildi: ${jami} ta qatorga obyekt qo'yildi`);
        qc.invalidateQueries({ queryKey: ['transactions'] });
      }
    },
    onError: (e: any) => toast.error(e?.message || 'Xatolik'),
  });

  const rows = firmalar.data?.rows || [];
  const yozilsinmi = !!res?.dryRun && (res.firmadan + res.hujjatdan) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 grid place-items-center">
              <Landmark className="h-4 w-4" />
            </span>
            Bank komissiyasiga obyekt
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            «Начисленные %% … За документ №… Тариф CORPORATE 0,1%» qatorlariga obyekt
            qo&apos;yiladi. Ikki qoida: firma <b>zakazchik</b> bo&apos;lsa — uning obyekti;
            <b> genpodryad</b> bo&apos;lsa — izohdagi hujjat raqami va summa orqali asl
            to&apos;lov topilib, o&apos;sha to&apos;lovning obyekti olinadi.
          </DialogDescription>
        </DialogHeader>

        {/* ═══ 1-QADAM: firmalar ═══ */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              1-qadam · Firma → obyekt
            </div>
            <Button
              size="sm"
              onClick={() => saqla.mutate()}
              disabled={saqla.isPending || rows.length === 0}
              className="gap-1.5 h-8"
            >
              {saqla.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Saqlash
            </Button>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-slate-900/50 ring-1 ring-slate-200 dark:ring-slate-800 px-3 py-2.5 text-[11.5px] text-slate-600 dark:text-slate-300 leading-relaxed">
            Obyekt ustuni mavjud ma&apos;lumotdan oldindan to&apos;ldirilgan — har firmaning
            to&apos;lovlarida eng ko&apos;p uchragan obyekt. <b>Xil</b> ustuni nechta turli
            obyekt borligini ko&apos;rsatadi: 1 bo&apos;lsa firma bitta obyektga ishlaydi,
            ko&apos;p bo&apos;lsa genpodryad. Tekshirib, kerak bo&apos;lsa to&apos;g&apos;irlang.
          </div>

          {firmalar.isLoading ? (
            <div className="py-8 text-center text-[12px] text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" /> Yuklanmoqda…
            </div>
          ) : (
            <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
              <div className="grid grid-cols-[1fr_72px_1fr_96px] gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <span>Firma</span>
                <span className="text-right">Komissiya</span>
                <span>Obyekt</span>
                <span className="text-center">Genpodryad</span>
              </div>
              <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => {
                  const t = tahrir[r.firma] || { obyekt: '', genpodryad: false };
                  return (
                    <div key={r.firma} className="grid grid-cols-[1fr_72px_1fr_96px] gap-2 px-3 py-2 items-center">
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-slate-800 dark:text-slate-100 truncate">
                          {r.firma}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          xil: <b className={cn(r.obyektXil > 3 && 'text-amber-600 dark:text-amber-400')}>{r.obyektXil}</b>
                          {r.obyektliTolov > 0 ? ` · ${r.obyektliTolov} to'lov` : ''}
                        </div>
                      </div>
                      <div className="text-[12px] tabular-nums text-right text-slate-600 dark:text-slate-300">
                        {r.komissiya}
                      </div>
                      <Input
                        value={t.obyekt}
                        disabled={t.genpodryad}
                        onChange={(e) => setTahrir((p) => ({ ...p, [r.firma]: { ...t, obyekt: e.target.value } }))}
                        placeholder={t.genpodryad ? 'hujjat orqali' : 'obyekt nomi'}
                        className="h-8 text-[12px]"
                      />
                      <label className="flex items-center justify-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={t.genpodryad}
                          onChange={(e) => setTahrir((p) => ({ ...p, [r.firma]: { ...t, genpodryad: e.target.checked } }))}
                          className="w-4 h-4 rounded"
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ═══ 2-QADAM: to'ldirish ═══ */}
        <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-800 p-3.5 space-y-2.5">
          <div className="text-[12.5px] font-semibold text-slate-800 dark:text-slate-100">
            2-qadam · Obyektni qo&apos;yish
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => toldir.mutate(true)} disabled={toldir.isPending} className="gap-2">
              {toldir.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Sinov (yozmaydi)
            </Button>
            {yozilsinmi && (
              <Button size="sm" onClick={() => toldir.mutate(false)} disabled={toldir.isPending}
                className="gap-2 bg-sky-600 hover:bg-sky-700 text-white">
                <Check className="h-3.5 w-3.5" />
                {res!.firmadan + res!.hujjatdan} ta qatorga qo&apos;yish
              </Button>
            )}
          </div>

          {res && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { l: "Ko'rildi", v: res.korildi, c: 'text-slate-700 dark:text-slate-200', Icon: FileText },
                  { l: '1-qoida (firma)', v: res.firmadan, c: 'text-emerald-700 dark:text-emerald-300', Icon: Building2 },
                  { l: '2-qoida (hujjat)', v: res.hujjatdan, c: 'text-sky-700 dark:text-sky-300', Icon: FileText },
                  { l: 'Topilmadi', v: res.topilmadi, c: 'text-amber-700 dark:text-amber-300', Icon: AlertTriangle },
                ].map((k) => (
                  <div key={k.l} className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2">
                    <div className="text-[9.5px] uppercase tracking-wider text-slate-400">{k.l}</div>
                    <div className={cn('text-[19px] font-black tabular-nums', k.c)}>{k.v.toLocaleString('ru-RU')}</div>
                  </div>
                ))}
              </div>

              {res.sabablar.length > 0 && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
                  <span className="text-slate-400">topilmaganlarning sababi: </span>
                  {res.sabablar.map((s) => `${s.sabab} (${s.qator})`).join(' · ')}
                </div>
              )}

              {res.namunalar.length > 0 && (
                <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                  <div className="px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-50 dark:bg-slate-800">
                    Namunalar
                  </div>
                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                    {res.namunalar.map((n, i) => (
                      <div key={i} className="px-3 py-1.5 text-[11.5px] flex items-center gap-2">
                        <span className="tabular-nums text-slate-400 w-[74px] shrink-0">{n.sana}</span>
                        <span className="tabular-nums font-semibold w-[72px] text-right shrink-0">
                          {Number(n.summa).toLocaleString('ru-RU')}
                        </span>
                        <span className="flex-1 truncate text-slate-600 dark:text-slate-300">{n.firma}</span>
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[9.5px] font-bold shrink-0',
                          n.usul === 'firma'
                            ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                            : 'bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300',
                        )}>
                          {n.usul === 'firma' ? 'firma' : `№${n.hujjat}`}
                        </span>
                        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 w-[110px] truncate text-right">
                          {n.obyekt}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
