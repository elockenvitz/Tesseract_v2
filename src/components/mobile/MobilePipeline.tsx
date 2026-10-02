import { useEffect, useMemo, useRef, useState } from 'react'
import { isPipelineBasicsCtaEvent, requestOpenTradeLab } from '../../lib/trade-lab/open-trade-lab'
import { clsx } from 'clsx'
import {
  Beaker, ChevronDown, ChevronLeft, ChevronRight, ListTodo, Search, X,
} from 'lucide-react'
import { usePipelineItems } from '../../hooks/usePipelineItems'
import { usePilotPipelineBanner } from '../../hooks/usePilotPipelineBanner'
import { usePilotMode } from '../../hooks/usePilotMode'
import { usePilotProgress } from '../../hooks/usePilotProgress'
import { DecisionInboxPanel } from '../trading/DecisionInboxPanel'
import { PilotStepsBanner } from '../pilot/PilotStepsBanner'
import { RESEARCH_STAGES, RESEARCH_STAGE_CONFIG } from '../../lib/trade-status-semantics'
import { IDEA_STAGES } from '../../lib/ideas/stage-model'
import {
  groupIntoRows,
  rowSearchText,
  COMMITTED_PIPELINE_STATUSES,
  ARCHIVED_PIPELINE_STATUSES,
  isRowParked,
  type PipelineRow,
} from '../../lib/mobile/pipeline-rows'
import type { ResearchStage } from '../../types/trading'
import { BottomSheet } from './BottomSheet'
import { TradeIdeaDetailModal } from '../trading/TradeIdeaDetailModal'

type View = 'pipeline' | 'committed' | 'archived'

const VIEWS: { key: View; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'committed', label: 'Committed' },
  { key: 'archived', label: 'Archived' },
]

/**
 * The idea pipeline on a phone.
 *
 * The desktop board moves cards with native HTML5 drag (`e.dataTransfer`),
 * which produces no events at all on touch — the kanban is not cramped on a
 * phone, it is inert. A drag polyfill was rejected: five columns do not fit at
 * 390px however the gesture is captured.
 *
 * Three decisions shape this surface, all of them corrections:
 *
 * 1. One stage at a time, chosen from a sheet rather than a scrolling strip of
 *    pills. A horizontal strip hides stages off-screen, gives no sense of where
 *    you are in a five-step process, and makes reaching the last stage a scroll
 *    plus a tap. A single control naming the current stage, with paging
 *    chevrons either side, shows position and reaches any stage in one tap.
 *
 * 2. A card is a summary and opens full screen. A pipeline card cannot hold a
 *    thesis, a target, sizing and provenance at this width, and an idea that
 *    cannot be read in full is one that gets advanced without being read.
 *
 * 3. Opening a card opens the shared `TradeIdeaDetailModal` — the same
 *    component the desktop board and Trade Lab open — not a mobile detail pane
 *    of this file's own. This surface writes nothing: reading, editing, moving
 *    stage and submitting a recommendation all happen inside that modal,
 *    through the canonical services, gated by the same rules. A local pane
 *    whose only write was a stage change is what let a phone walk an idea to
 *    Ready to Recommend and then offer no way to recommend it.
 */
export interface MobilePipelineProps {
  /** The idea to bring into view on arrival — the same payload the desktop
   *  board takes, so a hand-off means the same thing on both. */
  focusIdeaId?: string | null
  /**
   * Open the idea's detail on arrival, not merely scroll to it.
   *
   * Eleven producers hand this surface an idea just to put it in view, and
   * for them a scroll-and-flash is the right amount. One does not: the
   * parked-work card's "Resume work" promises the WORK, and landing on a
   * highlighted row in a list is a different promise.
   *
   * Opt-in rather than a change to `focusIdeaId`'s meaning, so the other
   * ten callers are untouched.
   */
  openDetailOnFocus?: boolean
  /** Called once it has actually been applied, so the shell can drop it. */
  onFocusConsumed?: () => void
}

export function MobilePipeline({ focusIdeaId, onFocusConsumed, openDetailOnFocus }: MobilePipelineProps = {}) {
  // Permission checks moved with the stage controls: `TradeIdeaDetailModal`
  // decides who may move an idea, using the same `isCreatorOrCoAnalyst` rule
  // the board uses. The pipeline no longer needs the current user.
  const { data: items = [], isLoading } = usePipelineItems()
  const pilotBanner = usePilotPipelineBanner()
  const pilotMode = usePilotMode()
  const { hasCompletedPipelineStepInbox, hasCompletedPipelineStepTradeLab, mark: markPilotStage } = usePilotProgress()
  /*
   * No `useTradeIdeaService()` here any more: stage changes happen inside
   * `TradeIdeaDetailModal`, which owns the ladder, the gate and the
   * confirmation. The pipeline lists ideas and opens them.
   */

  const [view, setView] = useState<View>('pipeline')
  const [stage, setStage] = useState<ResearchStage>(IDEA_STAGES[0])
  const [search, setSearch] = useState('')
  const [stagePickerOpen, setStagePickerOpen] = useState(false)
  const [detail, setDetail] = useState<PipelineRow | null>(null)
  /*
   * The Decision Inbox drawer, which a phone did not have at all.
   *
   * `DecisionInboxPanel` was mounted only by `TradeQueuePage`, and a phone
   * renders this instead — so the Pipeline tutorial's second step told the
   * reader to open a drawer that nothing drew. The panel itself was never
   * desktop-bound: it is `absolute bottom-0` with percentage heights and one
   * `hidden sm:inline` label, so it needed a positioned ancestor and a piece
   * of state, not a mobile version of itself.
   */
  const [inboxCollapsed, setInboxCollapsed] = useState(true)
  const toggleInbox = () => setInboxCollapsed(prev => {
    // Marked on collapsed → open only, so closing the drawer does not mark,
    // and short-circuited once earned — the same rule and the same stage key
    // the board uses. See `TradeQueuePage`.
    if (prev && pilotMode.effectiveIsPilot && !hasCompletedPipelineStepInbox) {
      markPilotStage('pipeline_step_inbox')
    }
    return !prev
  })

  /*
   * Pipeline basics step 3 — handing off to Trade Lab from this board.
   *
   * The desktop board marks it by listening for `openTradeLab` while it is
   * mounted; the phone board had no marker at all. That was invisible while
   * the three steps fed nothing, but mission stage 2 now waits for all three,
   * so without this a pilot on a phone could never finish it. Same event and
   * same stage key as `TradeQueuePage`.
   */
  useEffect(() => {
    if (!pilotMode.effectiveIsPilot || hasCompletedPipelineStepTradeLab) return
    const handler = (e: Event) => {
      // The banner's own CTA marks only once its navigation is confirmed.
      if (isPipelineBasicsCtaEvent(e)) return
      markPilotStage('pipeline_step_tradelab')
    }
    window.addEventListener('openTradeLab', handler)
    return () => window.removeEventListener('openTradeLab', handler)
  }, [pilotMode.effectiveIsPilot, hasCompletedPipelineStepTradeLab, markPilotStage])

  const rows = useMemo(() => groupIntoRows(items), [items])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(row => rowSearchText(row).includes(q))
  }, [rows, search])

  /*
   * Parked work is hidden from the stage columns, and from here only.
   *
   * The snooze dialog promises it hides the idea "from your pipeline, feed
   * and attention list". Desktop honoured that in `TradeQueuePage`'s own
   * `filteredItems`; this surface reads the same `usePipelineItems` and
   * applied nothing, so the sentence was false on a phone — the exact class
   * of defect the whole slice exists to remove.
   *
   * Applied HERE rather than in `usePipelineItems`, because that hook also
   * feeds the desktop Snoozed tab, which exists precisely to list these.
   * Suppressing at the shared read would make parked work unrecoverable.
   *
   * Search is deliberately exempt: `visible` is already filtered by the
   * query above, so a reader who types a symbol still finds their own
   * parked idea. A snooze you cannot search your way out of is a delete.
   */
  const searching = search.trim().length > 0
  const byStage = useMemo(() => {
    const map = new Map<ResearchStage, PipelineRow[]>(RESEARCH_STAGES.map(s => [s, []]))
    for (const row of visible) {
      if (COMMITTED_PIPELINE_STATUSES.includes(row.status)) continue
      if (ARCHIVED_PIPELINE_STATUSES.includes(row.status)) continue
      if (!searching && isRowParked(row)) continue
      const s = row.stage as ResearchStage
      if (map.has(s)) map.get(s)!.push(row)
    }
    return map
  }, [visible, searching])

  /*
   * Bring the arriving idea into view.
   *
   * The shell rendered `<MobilePipeline />` with no props at all, so every
   * hand-off carrying an idea -- about eleven producers -- was discarded
   * outright on a phone. Desktop scrolls and flashes; here the board shows one
   * stage at a time, so "into view" also means switching to the stage the card
   * is actually in. Without that the scroll would look for a card the board is
   * not currently drawing.
   *
   * Searching would hide everything else, which is a filter, not a focus. The
   * stage switch is the smallest thing that makes the card reachable.
   */
  const focusAppliedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!focusIdeaId || focusAppliedRef.current === focusIdeaId) return
    const match = rows.find(r =>
      r.kind === 'pair'
        ? r.legs.some((l: { id?: string } | null) => l?.id === focusIdeaId)
        : r.item?.id === focusIdeaId)
    if (!match) return
    focusAppliedRef.current = focusIdeaId

    if (COMMITTED_PIPELINE_STATUSES.includes(match.status)) setView('committed')
    else if (ARCHIVED_PIPELINE_STATUSES.includes(match.status)) setView('archived')
    else { setView('pipeline'); setStage(match.stage as ResearchStage) }

    /*
     * Open the detail, for the caller that asked to resume rather than to
     * look.
     *
     * The same `setDetail` an ordinary tap uses (see `onIdeaClick` below) —
     * the shared `TradeIdeaDetailModal`, not a second implementation and not
     * a route parameter nothing reads. `openIdeaDetail`'s second event,
     * `openTradeIdeaModal`, is listened for ONLY by `TradeQueuePage`, which
     * a phone never mounts; this is the mobile half of that promise.
     */
    if (openDetailOnFocus) setDetail(match)

    const timeout = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-pipeline-row-id="${match.id}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        el.classList.add('decision-recorded-flash')
        setTimeout(() => el.classList.remove('decision-recorded-flash'), 2600)
      }
      // Spent after the flash is on, for the reason the desktop board's is:
      // dropping the id re-runs this effect and the cleanup would cancel it.
      onFocusConsumed?.()
    }, 80)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusIdeaId, rows, openDetailOnFocus])

  const committedRows = useMemo(
    () => visible.filter(r => COMMITTED_PIPELINE_STATUSES.includes(r.status)),
    [visible]
  )
  const archivedRows = useMemo(
    () => visible.filter(r => ARCHIVED_PIPELINE_STATUSES.includes(r.status)),
    [visible]
  )

  const stageIndex = RESEARCH_STAGES.indexOf(stage)
  const pipelineTotal = [...byStage.values()].reduce((n, r) => n + r.length, 0)
  const list =
    view === 'pipeline' ? (byStage.get(stage) ?? []) : view === 'committed' ? committedRows : archivedRows

  return (
    /* `relative` so the inbox drawer has something to be absolute against. */
    <div className="relative h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="flex gap-1 px-3 pt-1.5">
          {VIEWS.map(v => {
            const count =
              v.key === 'pipeline' ? pipelineTotal
                : v.key === 'committed' ? committedRows.length
                : archivedRows.length
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-current={view === v.key}
                className={clsx(
                  'flex-1 h-9 rounded-lg text-sm font-medium transition-colors no-touch-target',
                  view === v.key
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                    : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
                )}
              >
                {v.label}
                <span className="ml-1 text-[11px] tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>

        {/* Stage selector. Paging chevrons plus a tappable label, rather than a
            horizontally scrolling strip of pills: the strip hid stages off the
            edge, gave no sense of position in a five-step process, and made the
            last stage a scroll away. */}
        {view === 'pipeline' && (
          <div className="flex items-center gap-1.5 px-3 pt-1.5 pb-1.5">
            <button
              type="button"
              disabled={stageIndex === 0}
              onClick={() => setStage(RESEARCH_STAGES[stageIndex - 1])}
              className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-25 no-touch-target"
              aria-label="Previous stage"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <button
              type="button"
              onClick={() => setStagePickerOpen(true)}
              className="flex-1 min-w-0 h-10 px-3 flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 no-touch-target"
            >
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white truncate">
                  {RESEARCH_STAGE_CONFIG[stage].label}
                </span>
                <span className="block text-[10px] text-gray-400">
                  Stage {stageIndex + 1} of {RESEARCH_STAGES.length}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-500 dark:text-gray-400">
                {(byStage.get(stage) ?? []).length}
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
            </button>

            <button
              type="button"
              disabled={stageIndex === RESEARCH_STAGES.length - 1}
              onClick={() => setStage(RESEARCH_STAGES[stageIndex + 1])}
              className="h-10 w-10 shrink-0 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-25 no-touch-target"
              aria-label="Next stage"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className={clsx('px-3 pb-2', view !== 'pipeline' && 'pt-1.5')}>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search symbol, company or rationale"
              className="w-full h-9 pl-8 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-full text-gray-400"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="flex-shrink-0 px-3 py-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        {view === 'pipeline'
          ? RESEARCH_STAGE_CONFIG[stage].description
          : view === 'committed'
            ? 'Approved and executed. Read-only here — corrections stay on desktop.'
            : 'Rejected, deferred and archived. Read-only here.'}
      </p>

      {/* The Pipeline Get Started banner, in its compact phone form.

          It lived inline in `TradeQueuePage`, which a phone never renders, so
          it had simply never appeared here. Same steps and the same completion
          flags as desktop — see `usePilotPipelineBanner`.

          Below the board's own controls rather than wedged between the view
          tabs and the stage pager, and inset rather than full-bleed: three
          stacked strips before the first card read as three pieces of chrome
          of equal standing, and guidance about the board should not outrank
          the board. */}
      {pilotBanner.show && view === 'pipeline' && (
        <PilotStepsBanner steps={pilotBanner.steps} label={pilotBanner.label} variant="inset" />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-safe space-y-2">
        {isLoading ? (
          [0, 1, 2].map(i => (
            <div key={i} className="h-24 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <ListTodo className="h-8 w-8 opacity-50" />
            <p className="text-sm text-center">
              {search
                ? 'Nothing here matches that.'
                : view === 'pipeline'
                  ? 'Nothing in ' + RESEARCH_STAGE_CONFIG[stage].label + '.'
                  : view === 'committed'
                    ? 'Nothing committed yet.'
                    : 'Nothing archived yet.'}
            </p>
          </div>
        ) : (
          list.map(row => (
            <PipelineCard key={row.id} row={row} onOpen={() => setDetail(row)} />
          ))
        )}
      </div>

      {/* Which stage to look at. */}
      <BottomSheet open={stagePickerOpen} onClose={() => setStagePickerOpen(false)} title="Go to stage" fitContent>
        <div className="px-3 pb-3 space-y-1">
          {RESEARCH_STAGES.map((s, i) => {
            const cfg = RESEARCH_STAGE_CONFIG[s]
            return (
              <button
                key={s}
                type="button"
                onClick={() => { setStage(s); setStagePickerOpen(false) }}
                className={clsx(
                  'w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left no-touch-target',
                  s === stage ? 'bg-primary-50 dark:bg-primary-900/20' : 'active:bg-gray-50 dark:active:bg-gray-800'
                )}
              >
                <span className="w-5 shrink-0 text-[11px] font-semibold tabular-nums text-gray-400">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{cfg.label}</span>
                  <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400">{cfg.description}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-gray-500">
                  {(byStage.get(s) ?? []).length}
                </span>
              </button>
            )
          })}
        </div>
      </BottomSheet>

      {/* The canonical drawer, on the board it belongs to. Not shown on the
          committed or archived tabs, which are read-only here and have no
          decisions waiting. `sheet` opens it as a full-height pane over the
          board instead of a 60% drawer with the Pipeline still showing. */}
      {view === 'pipeline' && (
        <DecisionInboxPanel
          variant="sheet"
          collapsed={inboxCollapsed}
          onToggleCollapsed={toggleInbox}
          onIdeaClick={tradeId => {
            const row = rows.find(r => r.id === tradeId)
            if (row) setDetail(row)
          }}
        />
      )}

      {/* The shared idea detail, not a mobile copy of one.

          This used to open a local read-only pane whose only write was a stage
          change — so a phone could walk an idea to Ready to Recommend and then
          had no way to write a thesis, satisfy a blocked gate, or submit the
          recommendation the stage is named after.

          `TradeIdeaDetailModal` is already mobile-adapted (`useIsMobile` at its
          line 114, full-bleed `pt-safe pb-safe` shell, scrollable tab strip)
          and already opens on a phone from Trade Lab's `MobileIdeasDrawer`.
          Pointing at it gives the pipeline the same editing, stage and
          recommendation capabilities desktop has, through the same canonical
          services — rather than a second mobile implementation of them, which
          is how two surfaces start disagreeing.

          `row.id` is the pair id for a pair and the item id otherwise; the
          modal resolves both, trying `pair_trades` first and falling back to
          `trade_queue_items`. */}
      {detail && (
        <TradeIdeaDetailModal
          isOpen
          tradeId={detail.id}
          onClose={() => setDetail(null)}
          onNavigateToIdea={ideaId => {
            // Following a link inside the modal leaves the pipeline beneath it
            // untouched, so closing still returns to the column and scroll
            // position the reader started from.
            const next = rows.find(r => r.id === ideaId)
            setDetail(next ?? { ...detail, id: ideaId })
          }}
        />
      )}
    </div>
  )
}

/** Colour an action by whether it adds or reduces exposure. */
function actionTone(action: string): string {
  return action === 'buy' || action === 'add'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
}

/**
 * A card is a summary, and the whole card is the tap target.
 *
 * It carries no move controls. Stage changes belong behind the detail view
 * where the idea can actually be read first — the previous inline arrows made
 * advancing an idea easier than opening it.
 */
export function PipelineCard({ row, onOpen }: { row: PipelineRow; onOpen: () => void }) {
  const subject: any = row.kind === 'pair' ? row.legs[0] : row.item
  const portfolioName: string | undefined = subject?.portfolios?.name
  const portfolioId: string | undefined = subject?.portfolios?.id || subject?.portfolio_id || undefined

  /*
   * The portfolio is the way into Trade Lab, as it is on the desktop board.
   *
   * The card was one <button>, so its portfolio could only be grey text, and
   * on a phone the sole route from an idea to Trade Lab was a link three
   * layers down inside the Decision Inbox drawer. The card is a div with the
   * button role now, so the portfolio can be a real control of its own: the
   * same `openTradeLab` hand-off, scoped to this idea and this portfolio. The
   * analyst's name stays plain text.
   */
  return (
    <div
      /* So an arrival carrying a specific idea can find its card, the same way
         the desktop board's cards carry `data-queue-item-id`. */
      data-pipeline-row-id={row.id}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
      }}
      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 active:bg-gray-50 dark:active:bg-gray-800 cursor-pointer"
    >
      {row.kind === 'pair' ? (
        <>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              Pair
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
              {row.pair?.name || 'Pair trade'}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {row.legs.map((leg: any) => (
              <span key={leg.id} className="inline-flex items-center gap-1.5">
                <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase', actionTone(leg.action))}>
                  {leg.pair_leg_type || leg.action}
                </span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {leg.assets?.symbol ?? '—'}
                </span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-2">
          <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide shrink-0', actionTone(row.item.action))}>
            {row.item.action}
          </span>
          <span className="text-sm font-bold text-gray-900 dark:text-white shrink-0">
            {row.item.assets?.symbol ?? '—'}
          </span>
          <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
            {row.item.assets?.company_name}
          </span>
          {row.item.proposed_weight != null && (
            <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
              {row.item.proposed_weight}%
            </span>
          )}
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-300" />
        </div>
      )}

      <p className="mt-1.5 text-[11px] text-gray-400 truncate">
        {portfolioName && portfolioId ? (
          <button
            type="button"
            data-slot="pipeline-card-portfolio"
            onClick={e => {
              e.stopPropagation()
              requestOpenTradeLab({ portfolioId, tradeQueueItemId: subject.id })
            }}
            aria-label={`Open ${portfolioName} in Trade Lab`}
            className="-my-1 -ml-1 px-1 py-1 rounded inline-flex items-center gap-1 align-middle font-medium text-primary-600 dark:text-primary-400 active:bg-primary-50 dark:active:bg-primary-900/30"
          >
            <Beaker className="h-3 w-3 shrink-0" />
            <span className="underline decoration-primary-300 underline-offset-2 dark:decoration-primary-700">{portfolioName}</span>
          </button>
        ) : (
          portfolioName ?? 'No portfolio'
        )}
        {subject?.users && ' · ' + [subject.users.first_name, subject.users.last_name].filter(Boolean).join(' ')}
      </p>
    </div>
  )
}
