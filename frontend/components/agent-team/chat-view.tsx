'use client';

/**
 * Agent Support — "Suhbat" ko'rinishi: agents.agent_chat_log (egasi, Leader, SISTEMA).
 * O'sish tartibida tasma, Toshkent kun ajratkichlari.
 * Matn faqat ODDIY MATN sifatida ko'rsatiladi (HTML/markdown render qilinmaydi).
 *
 * Yuklash modeli (polling yuki tarix chuqurligiga bog'liq EMAS):
 *  - Tarix — useInfiniteQuery (before=id kursor), staleTime 'static': 1-sahifa ochilganda, qolganlari faqat
 *    "Eskiroq xabarlar" bosilganda so'raladi. Interval, fokus, mount va invalidateQueries sahifalarni qayta so'ramaydi.
 *  - Jonli bosh — useQuery, har AGENT_TEAM_REFRESH.chat: eng yangi CHAT_LIMIT ta xabar (before'siz), BITTA so'rov.
 *    Tarix tepasidan yangi xabarlar id bo'yicha "live" ro'yxatga qo'shiladi; bosh bilan ma'lum xabarlar orasida
 *    bo'shliq qolsa (tab uzoq yashirin bo'lgan) u to'ldiriladi, juda katta bo'lsa ko'rinish eng yangi sahifaga quriladi.
 *  - Xabarlar tepadan tushib qolmaydi; ro'yxat o'zgarganda ko'rinish tepasidagi xabar joyida qoladi (scroll anchor).
 */

import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  keepPreviousData, useInfiniteQuery, useQuery, useQueryClient, type InfiniteData,
} from '@tanstack/react-query';
import {
  AlertTriangle, ArrowDown, ArrowDownToLine, ArrowUpRight, ChevronsUp, Forward, History, Loader2,
  MessagesSquare, RotateCcw, SearchX, UserRound,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { AGENT_TEAM_REFRESH, agentTeamApi, agentTeamKeys, type ChatParams } from '@/lib/agent-team-api';
import type { AgentTeamChat, AgentTeamView, AgentTeamViewProps, ChatRow } from '@/lib/agent-team-types';
import {
  AgentAvatar, ChipFilter, DateBox, EmptyBlock, ErrorBlock, IconButton, NotInstalled, Pill, RefreshButton,
  SearchBox, SectionCard, SkeletonRows, addDays, fmtDateTime, fmtDay, fmtTime, isAgentName, systemKindTone,
  tashkentDay, tashkentToday, useDebounced, type ChipOption,
} from './ui';

const CHAT_LIMIT = 60;
/** Bir xil muallifning shu oraliqdagi ketma-ket xabarlari guruhlanadi (avatar/sarlavha takrorlanmaydi) */
const GROUP_GAP_MS = 3 * 60 * 1000;
/** Shundan uzun matn yig'ilgan holda ko'rsatiladi */
const LONG_TEXT = 1200;
const BOTTOM_EPS = 60;
/** Bo'shliqni to'ldirish: bitta so'rov hajmi (backend max 200) va so'rovlar chegarasi; oshsa — eng yangi sahifadan qayta quriladi */
const GAP_PAGE = 200;
const GAP_MAX_PAGES = 5;

type RoleFilter = 'all' | 'owner' | 'leader' | 'system';
type HistoryData = InfiniteData<AgentTeamChat, number | null>;
/** Tarix tepasidan keyin kelgan xabarlar (jonli bosh olgan) — faqat `key` filtri uchun amal qiladi */
interface LiveState { key: string; rows: ChatRow[] }
/** Ko'rinish tepasidagi birinchi xabar va uning scroll konteyneri tepasidan masofasi (px) */
interface ScrollAnchor { id: string; offset: number }

const NO_ROWS: ChatRow[] = [];

// SSR'da useLayoutEffect ogohlantirishisiz
const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

/** 'HH:mm' (Toshkent) */
function hm(iso: string): string {
  return fmtTime(iso).slice(0, 5);
}

/**
 * Ko'rinish tepasidagi (qisman ko'rinsa ham) birinchi xabar elementi.
 * Konteynerning bevosita bolalari hujjat tartibida — ikkilik qidiruv, ko'p xabarda ham arzon.
 */
function captureAnchor(el: HTMLElement): ScrollAnchor | null {
  const kids = el.children;
  const top = el.getBoundingClientRect().top;
  let lo = 0;
  let hi = kids.length - 1;
  let first = kids.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (kids[mid].getBoundingClientRect().bottom > top) {
      first = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  for (let i = first; i < kids.length; i++) {
    const node = kids[i] as HTMLElement;
    const id = node.dataset.rowId;
    if (id) return { id, offset: node.getBoundingClientRect().top - top };
  }
  return null;
}

/** Ro'yxat o'zgargandan keyin langar xabarni avvalgi joyiga qaytaradi (tepaga qo'shilgan/o'rtaga kirgan xabarlar surmaydi). */
function restoreAnchor(el: HTMLElement, a: ScrollAnchor): void {
  const node = el.querySelector<HTMLElement>(`:scope > [data-row-id="${a.id}"]`);
  if (!node) return;
  const delta = node.getBoundingClientRect().top - el.getBoundingClientRect().top - a.offset;
  if (Math.abs(delta) >= 1) el.scrollTop += delta;
}

export function ChatView({ onNavigate }: AgentTeamViewProps) {
  const t = useTranslations('adminAgentTeam');
  const qc = useQueryClient();

  // ---- Filtrlar ----
  const [role, setRole] = useState<RoleFilter>('all');
  const [qInput, setQInput] = useState('');
  const q = useDebounced(qInput.trim(), 200);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [forward, setForward] = useState(false);
  const hasFilters = role !== 'all' || !!qInput.trim() || !!from || !!to || forward;

  const params = useMemo<Omit<ChatParams, 'before'>>(() => ({
    role: role === 'all' ? undefined : role,
    q: q || undefined,
    from: from || undefined,
    to: to || undefined,
    forward: forward || undefined,
    limit: CHAT_LIMIT,
  }), [role, q, from, to, forward]);
  const paramsKey = JSON.stringify(params);

  const headKey = useMemo(() => [...agentTeamKeys.chat(params), 'head'] as const, [params]);

  // ---- Tarix: faqat ochilganda va "Eskiroq xabarlar" bosilganda so'raladi (hech qachon interval bilan emas) ----
  const chatQ = useInfiniteQuery({
    queryKey: agentTeamKeys.chat(params),
    queryFn: async ({ pageParam }) => {
      const page = await agentTeamApi.chat({ ...params, before: pageParam });
      // 1-sahifa = jonli boshning aynan o'zi: head so'rovi yoqilishi bilan takrorlanmasin
      if (pageParam == null) qc.setQueryData<AgentTeamChat>(headKey, page);
      return page;
    },
    initialPageParam: null as number | null,
    getNextPageParam: (last) => (last.installed && last.hasMore && last.nextBefore != null ? last.nextBefore : undefined),
    // 'static': refetchInterval/fokus/mount/invalidateQueries yuklangan N sahifani qayta so'ramaydi
    staleTime: 'static',
    placeholderData: keepPreviousData,
  });

  const pages = chatQ.data?.pages;
  const isPlaceholder = chatQ.isPlaceholderData;

  // ---- Jonli bosh: eng yangi CHAT_LIMIT ta xabar, har intervalda BITTA so'rov ----
  const headEnabled = !!pages && !isPlaceholder;
  const headQ = useQuery({
    queryKey: headKey,
    queryFn: () => agentTeamApi.chat(params),
    enabled: headEnabled,
    refetchInterval: AGENT_TEAM_REFRESH.chat,
    // Tarix 1-sahifasi bilan urug'langan ma'lumot yoqilgan zahoti qayta so'ralmasin
    staleTime: AGENT_TEAM_REFRESH.chat / 2,
  });
  const headData = headEnabled ? headQ.data : undefined;

  // O'rnatilganlik: eng so'nggi ma'lumot (bosh) ustun — bot o'rnatilsa/olib tashlansa darhol ko'rinadi
  const firstPage = pages?.[0];
  const installState = headData ?? firstPage;
  const installed = installState ? installState.installed : true;
  const retentionDays = installState?.retentionDays || 30;

  // ---- Live: tarix tepasidan yangi xabarlar ----
  const [live, setLive] = useState<LiveState>({ key: '', rows: NO_ROWS });
  const liveRef = useRef(live);
  const commitLive = useCallback((next: LiveState) => {
    liveRef.current = next;
    setLive(next);
  }, []);
  /** Bo'shliq to'ldirilmoqda */
  const [syncing, setSyncing] = useState(false);
  /** Ko'rinish eng yangi sahifadan qayta qurilganda oshadi — scroll pastga qaytadi */
  const [epoch, setEpoch] = useState(0);

  const keyRef = useRef(paramsKey);
  const ingestRef = useRef<Promise<void>>(Promise.resolve());
  useIsoLayoutEffect(() => {
    keyRef.current = paramsKey;
  });

  useEffect(() => {
    if (!headData) return;
    const key = paramsKey;
    const historyKey = agentTeamKeys.chat(params);
    const base = params;
    const head = headData;

    /** Tarixni boshning o'zi (eng yangi 1 sahifa) bilan almashtirish — so'rovsiz */
    const rebase = (jump: boolean) => {
      qc.setQueryData<HistoryData>(historyKey, { pages: [head], pageParams: [null] });
      commitLive({ key, rows: NO_ROWS });
      if (jump) setEpoch((e) => e + 1);
    };

    const ingest = async () => {
      // Kesh — navbatdagi ingest oldingisining rebase'ini render kutmasdan ko'radi
      const hist = qc.getQueryData<HistoryData>(historyKey)?.pages;
      if (keyRef.current !== key || !hist?.length || !head.installed) return;
      // Tarix bot hali o'rnatilmaganda olingan — boshdan qayta quriladi
      if (!hist[0].installed) {
        rebase(false);
        return;
      }

      const cur = liveRef.current.key === key ? liveRef.current.rows : NO_ROWS;
      const histTop = hist[0].rows[0]?.id ?? 0;
      let knownTop = histTop;
      for (const r of cur) if (r.id > knownTop) knownTop = r.id;

      // Boshdagi HAMMA xabar yangi va pastda yana bor — orada ko'rilmagan xabarlar bo'lishi mumkin
      const extra: ChatRow[] = [];
      const headMin = head.rows.length ? head.rows[head.rows.length - 1].id : null;
      if (head.hasMore && head.nextBefore != null && headMin != null && headMin > knownTop) {
        setSyncing(true);
        try {
          let cursor: number | null = head.nextBefore;
          let closed = false;
          for (let i = 0; i < GAP_MAX_PAGES && cursor != null; i++) {
            const res = await agentTeamApi.chat({ ...base, before: cursor, limit: GAP_PAGE });
            if (keyRef.current !== key) return;
            let reached = !res.installed || !res.hasMore;
            for (const r of res.rows) {
              if (r.id > knownTop) extra.push(r);
              else reached = true;
            }
            if (reached) {
              closed = true;
              break;
            }
            cursor = res.nextBefore;
          }
          if (!closed) {
            rebase(true);
            return;
          }
        } finally {
          setSyncing(false);
        }
      }

      // Faqat tarix tepasidan yangi va hali qo'shilmagan xabarlar
      const have = new Set(cur.map((r) => r.id));
      const add = [...head.rows, ...extra].filter((r) => r.id > histTop && !have.has(r.id));
      if (!add.length) return;
      commitLive({ key, rows: cur.concat(add) });
    };

    // Ketma-ket: bo'shliq to'ldirilayotganda kelgan navbatdagi bosh keyin qayta ishlanadi.
    // Xato (tarmoq) yutiladi — keyingi interval (dataUpdatedAt o'zgaradi) qayta urinadi.
    ingestRef.current = ingestRef.current.then(ingest).catch(() => undefined);
  }, [headData, headQ.dataUpdatedAt, paramsKey, params, qc, commitLive]);

  // Tarix sahifalari + live, id bo'yicha takrorsiz va O'SISH tartibida
  const liveRows = live.key === paramsKey ? live.rows : NO_ROWS;
  const rows = useMemo<ChatRow[]>(() => {
    if (!pages) return NO_ROWS;
    const seen = new Set<number>();
    const out: ChatRow[] = [];
    for (const p of pages) {
      for (const r of p.rows) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          out.push(r);
        }
      }
    }
    for (const r of liveRows) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push(r);
      }
    }
    out.sort((a, b) => a.id - b.id);
    return out;
  }, [pages, liveRows]);

  // ---- Scroll boshqaruvi ----
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const [showNew, setShowNew] = useState(false);
  /** Ko'rinish tepasidagi xabar — har scroll va har yangilanishdan keyin yoziladi */
  const anchorRef = useRef<ScrollAnchor | null>(null);
  const prevRef = useRef<{ key: string; firstId: number | null; lastId: number | null }>({ key: '', firstId: null, lastId: null });

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_EPS;
    atBottomRef.current = bottom;
    setAtBottom((p) => (p === bottom ? p : bottom));
    if (bottom) setShowNew(false);
    anchorRef.current = captureAnchor(el);
  };

  const viewKey = `${paramsKey}#${epoch}`;
  useIsoLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevRef.current;
    // Placeholder (oldingi filtr ma'lumoti) ko'rinayotganda kalit hali "eski" hisoblanadi
    const key = isPlaceholder ? prev.key : viewKey;
    const firstId = rows.length ? rows[0].id : null;
    const lastId = rows.length ? rows[rows.length - 1].id : null;
    if (el && rows.length) {
      if (prev.key !== key || prev.lastId === null) {
        // Birinchi yuklanish, yangi filtr yoki qayta qurish — pastga
        el.scrollTop = el.scrollHeight;
        atBottomRef.current = true;
        setAtBottom(true);
        setShowNew(false);
      } else {
        // Tepaga (eskiroq sahifa) yoki o'rtaga (bo'shliq) qo'shilgan xabarlar ko'rinayotgan joyni surmasin
        if (anchorRef.current) restoreAnchor(el, anchorRef.current);
        if (lastId !== null && prev.lastId !== null && lastId > prev.lastId) {
          // Yangi xabar keldi
          if (atBottomRef.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          else setShowNew(true);
        }
      }
      anchorRef.current = captureAnchor(el);
    } else {
      anchorRef.current = null;
    }
    prevRef.current = { key, firstId, lastId };
  }, [rows, viewKey, isPlaceholder]);

  const loadOlder = () => {
    const el = scrollRef.current;
    if (el) anchorRef.current = captureAnchor(el);
    void chatQ.fetchNextPage();
  };
  const jumpLatest = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setShowNew(false);
  };

  const resetFilters = () => {
    setRole('all');
    setQInput('');
    setFrom('');
    setTo('');
    setForward(false);
  };

  const roleOptions: ChipOption<RoleFilter>[] = [
    { value: 'all', label: t('common.all') },
    { value: 'owner', label: t('chat.roles.owner'), tone: 'indigo' },
    { value: 'leader', label: t('chat.roles.leader'), tone: 'violet' },
    { value: 'system', label: t('chat.roles.system'), tone: 'slate' },
  ];

  // ---- Tasma elementlari (kun ajratkichlari bilan) ----
  const today = tashkentToday();
  const yesterday = addDays(today, -1);
  const items: ReactNode[] = [];
  let prevDay = '';
  let prevRow: ChatRow | null = null;
  for (const r of rows) {
    const day = tashkentDay(r.ts);
    if (day !== prevDay) {
      const label = day === today ? t('common.today') : day === yesterday ? t('common.yesterday') : fmtDay(r.ts);
      items.push(<DaySeparator key={`d-${day}-${r.id}`} label={label} />);
      prevDay = day;
      prevRow = null;
    }
    const grouped = !!prevRow && prevRow.role === r.role && r.role !== 'system'
      && Date.parse(r.ts) - Date.parse(prevRow.ts) < GROUP_GAP_MS;
    if (r.role === 'owner') items.push(<OwnerMessage key={r.id} row={r} grouped={grouped} />);
    else if (r.role === 'leader') items.push(<LeaderMessage key={r.id} row={r} grouped={grouped} />);
    else items.push(<SystemEvent key={r.id} row={r} onNavigate={onNavigate} />);
    prevRow = r;
  }

  const searching = qInput.trim() !== q || (chatQ.isFetching && isPlaceholder);

  // Fon xatosi (ma'lumot bor): tarix sahifasi yoki jonli bosh. Qayta urinish faqat xato bergan so'rovni takrorlaydi.
  const historyError = chatQ.isError && !!chatQ.data;
  const bgError = historyError ? chatQ.error : headEnabled && headQ.isError ? headQ.error : null;
  const retryBg = () => {
    if (historyError) {
      if (chatQ.isFetchNextPageError) void chatQ.fetchNextPage();
      else void chatQ.refetch();
    } else {
      void headQ.refetch();
    }
  };
  // Yangilash: yuklangan tarix emas, faqat jonli bosh (bitta so'rov)
  const refresh = () => {
    if (headEnabled) void headQ.refetch();
    else void chatQ.refetch();
  };

  // ---- Tana ----
  let body: ReactNode;
  if (chatQ.isPending) {
    body = <SkeletonRows rows={8} className="p-5" />;
  } else if (chatQ.isError && !chatQ.data) {
    body = <ErrorBlock error={chatQ.error} onRetry={() => chatQ.refetch()} />;
  } else if (!installed && installState) {
    body = <NotInstalled state={installState} compact />;
  } else if (!rows.length) {
    body = hasFilters
      ? <EmptyBlock icon={SearchX} title={t('common.noResults')} />
      : <EmptyBlock icon={MessagesSquare} title={t('chat.empty')} desc={t('chat.retention', { n: retentionDays })} />;
  } else {
    body = (
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className={cn(
            'h-[620px] max-h-[72vh] overflow-y-auto overscroll-contain px-3 sm:px-5 py-4 bg-slate-50/60 dark:bg-slate-950/40 transition-opacity',
            isPlaceholder && chatQ.isFetching && 'opacity-60',
          )}
        >
          {/* Tepa: eskiroq xabarlar yoki tarix boshi */}
          <div className="flex justify-center pb-2">
            {chatQ.hasNextPage ? (
              <button
                type="button"
                onClick={loadOlder}
                disabled={chatQ.isFetchingNextPage || isPlaceholder}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[11.5px] font-semibold ring-1 bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-600 dark:text-slate-300 hover:ring-violet-300 dark:hover:ring-violet-700 hover:text-violet-700 dark:hover:text-violet-300 shadow-sm disabled:opacity-60 transition-colors"
              >
                {chatQ.isFetchingNextPage ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronsUp className="h-3.5 w-3.5" />}
                {t('chat.loadOlder')}
              </button>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                <History className="h-3.5 w-3.5" />
                {t('chat.start')}
              </span>
            )}
          </div>
          {items}
        </div>

        {showNew ? (
          <button
            type="button"
            onClick={jumpLatest}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 h-8 pl-2.5 pr-3.5 rounded-full text-[11.5px] font-bold text-white shadow-lg shadow-violet-500/30 bg-gradient-to-r from-violet-600 to-fuchsia-600 hover:from-violet-700 hover:to-fuchsia-700 animate-in fade-in slide-in-from-bottom-2 duration-200"
          >
            <span className="relative inline-flex w-2 h-2">
              <span className="absolute inset-0 rounded-full bg-white/70 animate-ping" />
              <span className="relative inline-flex w-2 h-2 rounded-full bg-white" />
            </span>
            <ArrowDown className="h-3.5 w-3.5" />
            {t('chat.newMessages')}
          </button>
        ) : !atBottom ? (
          <button
            type="button"
            onClick={jumpLatest}
            title={t('chat.jumpLatest')}
            aria-label={t('chat.jumpLatest')}
            className="absolute bottom-4 right-5 h-9 w-9 grid place-items-center rounded-full ring-1 bg-white dark:bg-slate-900 ring-slate-200 dark:ring-slate-700 text-slate-500 dark:text-slate-400 hover:text-violet-700 dark:hover:text-violet-300 hover:ring-violet-300 shadow-md transition-colors"
          >
            <ArrowDownToLine className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <SectionCard
      icon={MessagesSquare}
      title={t('chat.title')}
      subtitle={t('chat.subtitle')}
      noBody
      actions={(
        <>
          <IconButton icon={Forward} title={t('chat.forwardOnly')} active={forward} tone="amber" onClick={() => setForward((v) => !v)} />
          {hasFilters && <IconButton icon={RotateCcw} title={t('common.resetFilters')} onClick={resetFilters} />}
          <RefreshButton
            onClick={refresh}
            fetching={headQ.isFetching || syncing || (chatQ.isFetching && !chatQ.isFetchingNextPage)}
          />
        </>
      )}
    >
      {/* Filtrlar */}
      <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2">
        <ChipFilter<RoleFilter> value={role} options={roleOptions} onChange={setRole} />
        <SearchBox
          value={qInput}
          onChange={setQInput}
          placeholder={t('chat.search')}
          busy={searching}
          className="flex-1 min-w-[200px]"
        />
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <DateBox value={from} onChange={setFrom} title={t('common.from')} className="flex-1 sm:flex-none min-w-0" />
          <span className="text-slate-300 dark:text-slate-600 text-[12px]">–</span>
          <DateBox value={to} onChange={setTo} title={t('common.to')} className="flex-1 sm:flex-none min-w-0" />
        </div>
      </div>

      {bgError && (
        <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-[11.5px] ring-1 bg-rose-50/70 dark:bg-rose-950/30 ring-rose-200 dark:ring-rose-900 text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 min-w-0 truncate">{t('common.loadError')}{bgError.message ? ` — ${bgError.message}` : ''}</span>
          <button type="button" onClick={retryBg} className="font-semibold hover:underline shrink-0">{t('common.retry')}</button>
        </div>
      )}

      {body}

      <div className="px-5 py-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap text-[10.5px] text-slate-400 dark:text-slate-500">
        <History className="h-3.5 w-3.5" />
        <span>{t('chat.retention', { n: retentionDays })}</span>
        <span className="opacity-50">·</span>
        <span>{t('common.tashkentTime')}</span>
      </div>
    </SectionCard>
  );
}

// ===========================================================================
// Yordamchilar
// ===========================================================================
function DaySeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 my-4">
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
      <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 tabular-nums">
        {label}
      </span>
      <span className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
    </div>
  );
}

/** Uzun matn: yig'ilgan holda boshlanadi, "Batafsil" / "Yig'ish" bilan ochiladi. Faqat oddiy matn. */
function MessageText({ text, className, toggleClassName }: { text: string; className?: string; toggleClassName?: string }) {
  const t = useTranslations('adminAgentTeam.common');
  const long = text.length > LONG_TEXT;
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={cn('whitespace-pre-wrap break-words [overflow-wrap:anywhere]', long && !open && 'max-h-[320px] overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]', className)}>
        {text || '—'}
      </div>
      {long && (
        <button type="button" onClick={() => setOpen((v) => !v)} className={cn('mt-1.5 text-[11px] font-semibold hover:underline', toggleClassName)}>
          {open ? t('showLess') : t('showMore')}
        </button>
      )}
    </>
  );
}

function OwnerMessage({ row, grouped }: { row: ChatRow; grouped: boolean }) {
  const t = useTranslations('adminAgentTeam');
  return (
    <div data-row-id={row.id} className={cn('flex justify-end items-end gap-2', grouped ? 'mt-1' : 'mt-3')}>
      <div className="max-w-[88%] sm:max-w-[72%] min-w-0 flex flex-col items-end">
        {!grouped && (
          <div className="mb-1 px-1 text-[10.5px] font-semibold text-slate-500 dark:text-slate-400">{t('chat.roles.owner')}</div>
        )}
        {row.isForward && (
          <Pill tone="amber" icon={Forward} title={t('chat.forwardHint')} className="mb-1">{t('chat.forward')}</Pill>
        )}
        <div
          className={cn(
            'px-3.5 py-2.5 rounded-2xl rounded-tr-md text-[12.5px] leading-relaxed shadow-sm',
            row.isForward
              ? 'bg-amber-50 dark:bg-amber-950/40 ring-1 ring-amber-200 dark:ring-amber-800 text-amber-900 dark:text-amber-100'
              : 'bg-gradient-to-br from-violet-600 to-fuchsia-600 text-white',
          )}
          title={row.isForward ? t('chat.forwardHint') : undefined}
        >
          <MessageText text={row.text} toggleClassName={row.isForward ? 'text-amber-700 dark:text-amber-300' : 'text-white/90'} />
        </div>
        <time dateTime={row.ts} title={fmtDateTime(row.ts)} className="mt-0.5 px-1 text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
          {hm(row.ts)}
        </time>
      </div>
      <span
        className={cn(
          'w-6 h-6 rounded-md grid place-items-center shrink-0 mb-5 text-white shadow-md bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/30',
          grouped && 'invisible',
        )}
      >
        <UserRound className="h-3.5 w-3.5" />
      </span>
    </div>
  );
}

function LeaderMessage({ row, grouped }: { row: ChatRow; grouped: boolean }) {
  const t = useTranslations('adminAgentTeam');
  return (
    <div data-row-id={row.id} className={cn('flex justify-start items-end gap-2', grouped ? 'mt-1' : 'mt-3')}>
      <span className={cn('mb-5', grouped && 'invisible')}>
        <AgentAvatar name="leader" size="sm" />
      </span>
      <div className="max-w-[88%] sm:max-w-[72%] min-w-0 flex flex-col items-start">
        {!grouped && (
          <div className="mb-1 px-1 text-[10.5px] font-semibold text-violet-600 dark:text-violet-400">{t('chat.roles.leader')}</div>
        )}
        {row.isForward && (
          <Pill tone="amber" icon={Forward} title={t('chat.forwardHint')} className="mb-1">{t('chat.forward')}</Pill>
        )}
        <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-md text-[12.5px] leading-relaxed shadow-sm bg-white dark:bg-slate-800 ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200">
          <MessageText text={row.text} toggleClassName="text-violet-600 dark:text-violet-400" />
        </div>
        <time dateTime={row.ts} title={fmtDateTime(row.ts)} className="mt-0.5 px-1 text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">
          {hm(row.ts)}
        </time>
      </div>
    </div>
  );
}

/** SISTEMA yozuvi: markazda ixcham; plan_* / agent_* / memory_* bosilsa tegishli ko'rinishga o'tadi */
function SystemEvent({ row, onNavigate }: { row: ChatRow; onNavigate: AgentTeamViewProps['onNavigate'] }) {
  const t = useTranslations('adminAgentTeam');
  const kind = row.kind ?? 'other';
  const kindLabel = t.has(`chat.kinds.${kind}`) ? t(`chat.kinds.${kind}`) : kind;

  let target: AgentTeamView | null = null;
  let go: (() => void) | null = null;
  if (kind.startsWith('plan_')) {
    target = 'plans';
    go = () => onNavigate('plans');
  } else if (kind.startsWith('agent_')) {
    target = 'activity';
    const agent = isAgentName(row.agent) ? row.agent : undefined;
    go = () => onNavigate('activity', agent ? { agent } : undefined);
  } else if (kind.startsWith('memory_')) {
    target = 'memory';
    go = () => onNavigate('memory');
  }

  const inner = (
    <>
      <div className="flex items-center justify-center gap-2 flex-wrap">
        {row.agent && <AgentAvatar name={row.agent} size="sm" />}
        <Pill tone={systemKindTone(kind)} dot>{kindLabel}</Pill>
        <time dateTime={row.ts} title={fmtDateTime(row.ts)} className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums">{hm(row.ts)}</time>
        {target && <ArrowUpRight className="h-3.5 w-3.5 text-slate-400 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors" />}
      </div>
      <div
        className="mt-1.5 font-mono text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-center line-clamp-3"
        title={row.text}
      >
        {row.text || '—'}
      </div>
    </>
  );

  const box = 'w-fit max-w-[94%] sm:max-w-[80%] rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white/80 dark:bg-slate-900/70 px-3 py-2';
  return (
    <div data-row-id={row.id} className="my-3 flex justify-center">
      {go && target ? (
        <button
          type="button"
          onClick={go}
          aria-label={t(`views.${target}`)}
          className={cn(box, 'group text-center hover:ring-violet-300 dark:hover:ring-violet-700 hover:shadow-md hover:shadow-violet-500/10 transition-all')}
        >
          {inner}
        </button>
      ) : (
        <div className={box}>{inner}</div>
      )}
    </div>
  );
}
