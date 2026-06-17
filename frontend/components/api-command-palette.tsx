'use client';

import { useEffect } from 'react';
import { Command } from 'cmdk';
import { Search, Play } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { MethodBadge, Kbd } from './api-ui';

export interface PaletteEndpoint {
  method: 'GET' | 'POST';
  path: string;
  titleKey: string;
  descKey: string;
  groupKey: string;
  scope?: string;
  accessible: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  endpoints: PaletteEndpoint[];
  onSelect: (path: string) => void;
  onExecute: (path: string) => void;
}

export function ApiCommandPalette({ open, onOpenChange, endpoints, onSelect, onExecute }: Props) {
  const t = useTranslations('api');

  // Cmd+K global toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  // Cmd+Enter to execute current item inside palette
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      const selected = document.querySelector('[cmdk-item][data-selected="true"]') as HTMLElement | null;
      const path = selected?.getAttribute('data-path');
      if (path) {
        e.preventDefault();
        onSelect(path);
        onExecute(path);
        onOpenChange(false);
      }
    }
  };

  // Group endpoints
  const groups = new Map<string, PaletteEndpoint[]>();
  endpoints.forEach((ep) => {
    if (!groups.has(ep.groupKey)) groups.set(ep.groupKey, []);
    groups.get(ep.groupKey)!.push(ep);
  });

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="API command palette"
      className="fixed inset-0 z-50"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => onOpenChange(false)} />

      {/* Dialog */}
      <div className="fixed left-1/2 top-[18%] -translate-x-1/2 w-[92vw] max-w-[640px] rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-800 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 border-b border-slate-200 dark:border-slate-800">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <Command.Input
            placeholder={t('palette.placeholder')}
            className="w-full py-3.5 bg-transparent outline-none text-[14px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
          />
          <Kbd>Esc</Kbd>
        </div>
        <Command.List className="max-h-[420px] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-[12.5px] text-slate-500">
            {t('palette.empty')}
          </Command.Empty>
          {Array.from(groups.entries()).map(([groupKey, eps]) => (
            <Command.Group
              key={groupKey}
              heading={t(`groups.${groupKey}`)}
              className="text-slate-500 dark:text-slate-400 px-1 py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2"
            >
              {eps.map((ep) => (
                <Command.Item
                  key={ep.path}
                  value={`${ep.method} ${ep.path} ${t(`eps.${ep.titleKey}`)}`}
                  data-path={ep.path}
                  disabled={!ep.accessible}
                  onSelect={() => {
                    onSelect(ep.path);
                    onOpenChange(false);
                  }}
                  className={cn(
                    'flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer',
                    'data-[selected=true]:bg-indigo-50 dark:data-[selected=true]:bg-indigo-950/40',
                    'aria-disabled:opacity-50 aria-disabled:cursor-not-allowed',
                  )}
                >
                  <MethodBadge method={ep.method} size="sm" />
                  <span className="text-[13px] font-medium text-slate-800 dark:text-slate-200 truncate flex-1">
                    {t(`eps.${ep.titleKey}`)}
                  </span>
                  <code className="text-[10px] font-mono text-slate-400 truncate max-w-[180px]">{ep.path}</code>
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-[11px] text-slate-500">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd>{t('palette.select')}</span>
            <span className="inline-flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>↵</Kbd>{t('palette.execute')}</span>
          </div>
          <span className="inline-flex items-center gap-1"><Kbd>⌘K</Kbd>{t('palette.toggle')}</span>
        </div>
      </div>
    </Command.Dialog>
  );
}
