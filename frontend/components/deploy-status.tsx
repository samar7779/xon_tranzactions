'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, AlertCircle, GitCommit } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface DeployStatus {
  ok: boolean;
  state: 'idle' | 'running' | 'success' | 'failed';
  currentCommit?: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  message?: string | null;
  error?: string | null;
}

export function DeployStatusBadge() {
  const lastStateRef = useRef<string>('idle');

  const { data } = useQuery({
    queryKey: ['deploy-status'],
    queryFn: () => api.get<DeployStatus>('/_deploy/status'),
    refetchInterval: 5_000, // har 5 sekundda
  });

  const state = data?.state || 'idle';

  // Holat o'zgarganda toast ko'rsatamiz (web bildirishnoma)
  useEffect(() => {
    const prev = lastStateRef.current;
    if (prev !== state) {
      if (prev === 'running' && state === 'success') {
        toast.success(`Deploy muvaffaqiyatli (${data?.currentCommit || ''})`, {
          icon: '✅',
          duration: 6000,
        });
      } else if (prev === 'running' && state === 'failed') {
        toast.error(`Deploy muvaffaqiyatsiz: ${data?.message || 'noma\'lum xato'}`, {
          icon: '❌',
          duration: 12000,
        });
      } else if (state === 'running') {
        toast(`Deploy boshlandi`, { icon: '🟡', duration: 3000 });
      }
      lastStateRef.current = state;
    }
  }, [state, data?.currentCommit, data?.message]);

  if (!data) return null;

  const cfg = {
    idle:    { color: 'bg-slate-500/20 text-white/80 ring-white/20', icon: <GitCommit className="h-3 w-3" />,            label: 'idle' },
    running: { color: 'bg-amber-400/30 text-white ring-amber-300/40', icon: <Loader2 className="h-3 w-3 animate-spin" />, label: 'Deploy...' },
    success: { color: 'bg-emerald-400/30 text-white ring-emerald-300/40', icon: <CheckCircle2 className="h-3 w-3" />,    label: 'Deploy OK' },
    failed:  { color: 'bg-rose-400/30 text-white ring-rose-300/40', icon: <AlertCircle className="h-3 w-3" />,           label: 'Deploy FAIL' },
  }[state];

  return (
    <div
      title={
        state === 'failed'
          ? `${data.message || 'fail'}\n${data.error || ''}`
          : `${data.message || ''}\nCommit: ${data.currentCommit || '?'}`
      }
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold ring-1 backdrop-blur-sm',
        cfg.color,
      )}
    >
      {cfg.icon}
      <span>{cfg.label}</span>
      {data.currentCommit && state !== 'running' && (
        <code className="opacity-80 ml-0.5">{data.currentCommit}</code>
      )}
    </div>
  );
}
