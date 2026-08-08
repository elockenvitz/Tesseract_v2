import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  ArrowRight, Check, ChevronLeft, ChevronRight, Loader2, ListTodo, Lock, Search, X,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePipelineItems } from '../../hooks/usePipelineItems'
import { useTradeIdeaService } from '../../hooks/useTradeIdeaService'
import { isCreatorOrCoAnalyst } from '../../lib/permissions/trade-idea-permissions'
import {
  RESEARCH_STAGES,
  RESEARCH_STAGE_CONFIG,
  toResearchStage,
} from '../../lib/trade-status-semantics'
import type { ResearchStage, UISource } from '../../types/trading'
import { BottomSheet } from './BottomSheet'
import { ExpandableText } from './ExpandableText'

/**
 * The idea pipeline on a phone.
 *
 * The desktop board is a five-column kanban moved with native HTML5 drag
 * (`e.dataTransfer`). That API does not fire on touch at all — not "works
 * badly", it produces no events — so the board is not merely cramped on a
 * phone, it is inert. A drag polyfill was rejected: five columns will not fit
 * at 390px regardless of how the gesture is captured, and dragging a card
 * across a horizontally-scrolling viewport with one thumb is a poor
 * interaction even where it works.
 *
 * So the board becomes one stage at a time, and moving becomes an explicit
 * action rather than a gesture. This is the same shape Trello itself uses on
 * mobile, and it has a property dragging does not: a move can be confirmed,
 * and a stage the reader lacks permission to move into can be shown as
 * unavailable with a reason instead of silently refusing the drop.
 *
 * Writes go through useTradeIdeaService.moveTrade — the same audited mutation
 * the board uses, with `uiSource` distinguishing where the move came from.
 */
/** Terminal statuses, split the way the board's fourth column splits them. */
const COMMITTED: string[] = ['approved', 'executed']
const ARCHIVED: string[] = ['rejected', 'cancelled', 'archived']

type View = 'pipeline' | 'committed' | 'archived'

const VIEWS: { key: View; label: string }[] = [
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'committed', label: 'Committed' },
  { key: 'archived', label: 'Archived' },
]

/**
 * A pipeline row: either a single idea or a pair trade carrying its legs.
 *
 * Pairs are one row, not two. The legs move together — movePairTrade moves the
 * whole group — so showing them as independent cards would offer a move that
 * cannot be made leg-by-leg and would double-count the stage's card count.
 */
type Row =
  | { kind: 'item'; id: string; stage: string; status: string; item: any }
  | { kind: 'pair'; id: string; stage: string; status: string; pair: any; legs: any[] }

export function MobilePipeline() {
  const { user } = useAuth()
  const { data: items = [], isLoading } = usePipelineItems()
  const { moveTrade, movePairTrade, isMoving, isMovingPairTrade } = useTradeIdeaService()

  const [view, setView] = useState<View>('pipeline')
  const [stage, setStage] = useState<ResearchStage>('aware')
  const [search, setSearch] = useState('')
  const [moving, setMoving] = useState<Row | null>(null)

  const busy = isMoving || isMovingPairTrade

  /**
   * Collapse the flat item list into rows, grouping pair legs.
   *
   * A pair's stage is taken from its first leg: legs move together, so any leg
   * answers the question, and reading it from the pair_trades row would go
   * stale whenever a move updated the legs but not the parent.
   */
  const rows = useMemo<Row[]>(() => {
    const pairs = new Map<string, { pair: any; legs: any[] }>()
    const singles: any[] = []

    for (const item of items) {
      const pairId = item?.pair_id || item?.pair_trade_id
      if (pairId) {
        if (!pairs.has(pairId)) {
          pairs.set(pairId, {
            pair: item.pair_trades ?? { id: pairId, name: 'Pair Trade', rationale: item.rationale },
            legs: [],
          })
        }
        pairs.get(pairId)!.legs.push(item)
      } else {
        singles.push(item)
      }
    }

    const out: Row[] = singles.map(item => ({
      kind: 'item' as const,
      id: item.id,
      stage: toResearchStage(item.stage) as string,
      status: item.status,
      item,
    }))

    for (const [pairId, group] of pairs) {
      // Long leg first: a pair reads as "long X / short Y", and ordering by
      // whatever the query returned made the same pair render differently
      // between loads.
      const legs = [...group.legs].sort((a, b) =>
        (a.pair_leg_type === 'long' ? 0 : 1) - (b.pair_leg_type === 'long' ? 0 : 1)
      )
      const first = legs[0]
      out.push({
        kind: 'pair',
        id: pairId,
        stage: toResearchStage(first?.stage) as string,
        status: first?.status,
        pair: group.pair,
        legs,
      })
    }
    return out
  }, [items])

  const matchesSearch = (row: Row) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    const parts =
      row.kind === 'pair'
        ? [row.pair?.name, row.pair?.rationale, ...row.legs.map(l => l.assets?.symbol), ...row.legs.map(l => l.assets?.company_name)]
        : [row.item.assets?.symbol, row.item.assets?.company_name, row.item.rationale]
    return parts.filter(Boolean).join(' ').toLowerCase().includes(q)
  }

  const visible = useMemo(() => rows.filter(matchesSearch), [rows, search])

  const byStage = useMemo(() => {
    const map = new Map<ResearchStage, Row[]>(RESEARCH_STAGES.map(s => [s, []]))
    for (const row of visible) {
      if (COMMITTED.includes(row.status) || ARCHIVED.includes(row.status)) continue
      const s = row.stage as ResearchStage
      if (map.has(s)) map.get(s)!.push(row)
    }
    return map
  }, [visible])

  const committedRows = useMemo(() => visible.filter(r => COMMITTED.includes(r.status)), [visible])
  const archivedRows = useMemo(() => visible.filter(r => ARCHIVED.includes(r.status)), [visible])

  const canMove = (row: Row) => {
    // A pair is governed by its legs; the first one answers, since every leg of
    // a pair is created together by the same author.
    const subject = row.kind === 'pair' ? row.legs[0] : row.item
    if (!subject || !user?.id) return false
    return isCreatorOrCoAnalyst(user.id, {
      created_by: subject.created_by,
      assigned_to: subject.assigned_to,
      collaborators: subject.collaborators,
    })
  }

  const stageIndex = RESEARCH_STAGES.indexOf(stage)
  const current = byStage.get(stage) ?? []

  const commit = (row: Row, target: ResearchStage, uiSource: UISource) => {
    if (row.kind === 'pair') {
      movePairTrade({ pairTradeId: row.id, targetStatus: target as any, uiSource })
    } else {
      moveTrade({ tradeId: row.id, targetStatus: target as any, uiSource })
    }
    setMoving(null)
  }


  const list = view === 'pipeline' ? current : view === 'committed' ? committedRows : archivedRows

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        {/* Pipeline / Committed / Archived. The board carries these as a fourth
            column with its own dropdown; at phone width they are better as a
            top-level switch, because the archive is browsed rather than worked
            and does not want to compete with the stages for room. */}
        <div className="flex gap-1 px-3 pt-2">
          {VIEWS.map(v => {
            const count =
              v.key === 'pipeline'
                ? [...byStage.values()].reduce((n, rows) => n + rows.length, 0)
                : v.key === 'committed'
                  ? committedRows.length
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

        {/* Stage strip. Horizontally scrollable rather than five squeezed tabs:
            the labels are the vocabulary of the process and abbreviating them
            to fit ("Deep Res.") makes the board harder to read, not smaller. */}
        {view === 'pipeline' && (
          <div className="flex gap-1.5 px-3 py-2 overflow-x-auto no-scrollbar">
            {RESEARCH_STAGES.map(s => {
              const cfg = RESEARCH_STAGE_CONFIG[s]
              const count = (byStage.get(s) ?? []).length
              const active = s === stage
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStage(s)}
                  aria-current={active}
                  className={clsx(
                    'shrink-0 inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-sm font-medium transition-colors no-touch-target',
                    active
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
                  )}
                >
                  {cfg.shortLabel}
                  <span
                    className={clsx(
                      'min-w-[1.25rem] px-1 rounded-full text-[11px] font-semibold tabular-nums',
                      active ? 'bg-white/20' : 'bg-white dark:bg-gray-900'
                    )}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        <div className={clsx('px-3 pb-2', view !== 'pipeline' && 'pt-2')}>
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

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-safe space-y-2">
        {isLoading ? (
          [0, 1, 2].map(i => (
            <div key={i} className="h-28 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <ListTodo className="h-8 w-8 opacity-50" />
            <p className="text-sm text-center">
              {search
                ? 'Nothing here matches that.'
                : view === 'pipeline'
                  ? 'Nothing in ' + RESEARCH_STAGE_CONFIG[stage].shortLabel + '.'
                  : view === 'committed'
                    ? 'Nothing committed yet.'
                    : 'Nothing archived yet.'}
            </p>
          </div>
        ) : (
          list.map(row => (
            <PipelineCard
              key={row.id}
              row={row}
              movable={view === 'pipeline' && canMove(row)}
              showMoveControls={view === 'pipeline'}
              busy={busy}
              prev={stageIndex > 0 ? RESEARCH_STAGES[stageIndex - 1] : null}
              next={stageIndex < RESEARCH_STAGES.length - 1 ? RESEARCH_STAGES[stageIndex + 1] : null}
              onStep={(target) => commit(row, target, 'mobile_step')}
              onOpenSheet={() => setMoving(row)}
            />
          ))
        )}
      </div>

      <BottomSheet
        open={!!moving}
        onClose={() => setMoving(null)}
        title={
          moving
            ? moving.kind === 'pair'
              ? 'Move ' + (moving.pair?.name || 'pair trade')
              : 'Move ' + (moving.item.assets?.symbol ?? 'idea')
            : undefined
        }
        fitContent
      >
        <div className="px-3 pb-3 space-y-1">
          {moving?.kind === 'pair' && (
            <p className="px-1 pb-1 text-[11px] text-gray-500 dark:text-gray-400">
              Both legs move together.
            </p>
          )}
          {RESEARCH_STAGES.map(s => {
            const cfg = RESEARCH_STAGE_CONFIG[s]
            const isCurrent = moving ? moving.stage === s : false
            return (
              <button
                key={s}
                type="button"
                disabled={isCurrent || busy}
                onClick={() => moving && commit(moving, s, 'mobile_sheet')}
                className={clsx(
                  'w-full flex items-start gap-3 rounded-xl px-3 py-3 text-left no-touch-target',
                  isCurrent ? 'bg-gray-100 dark:bg-gray-800' : 'active:bg-gray-50 dark:active:bg-gray-800'
                )}
              >
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {cfg.label}
                  </span>
                  <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                    {cfg.description}
                  </span>
                </span>
                {isCurrent && (
                  <span className="mt-0.5 shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500">
                    <Check className="h-3.5 w-3.5" /> Current
                  </span>
                )}
              </button>
            )
          })}
          {busy && (
            <p className="flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Moving…
            </p>
          )}
        </div>
      </BottomSheet>
    </div>
  )
}

/** Colour an action by whether it adds or reduces exposure. */
function actionTone(action: string): string {
  return action === 'buy' || action === 'add'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
    : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
}

function PipelineCard({
  row,
  movable,
  showMoveControls,
  busy,
  prev,
  next,
  onStep,
  onOpenSheet,
}: {
  row: Row
  movable: boolean
  showMoveControls: boolean
  busy: boolean
  prev: ResearchStage | null
  next: ResearchStage | null
  onStep: (target: ResearchStage) => void
  onOpenSheet: () => void
}) {
  const isPair = row.kind === 'pair'
  const subject: any = isPair ? row.legs[0] : row.item

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
      {row.kind === 'pair' ? (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              Pair
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
              {row.pair?.name || 'Pair trade'}
            </span>
            <span className="shrink-0 text-[11px] text-gray-400">{row.legs.length} legs</span>
          </div>

          {/* Both legs, so the pair reads as a relationship rather than a name.
              A pair whose legs are hidden behind a tap is indistinguishable
              from a single idea at a glance. */}
          <ul className="mb-2 space-y-1">
            {row.legs.map((leg: any) => (
              <li key={leg.id} className="flex items-center gap-2">
                <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase', actionTone(leg.action))}>
                  {leg.pair_leg_type || leg.action}
                </span>
                <span className="text-sm font-bold text-gray-900 dark:text-white">
                  {leg.assets?.symbol ?? '—'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
                  {leg.assets?.company_name}
                </span>
                {leg.proposed_weight != null && (
                  <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">
                    {leg.proposed_weight}%
                  </span>
                )}
              </li>
            ))}
          </ul>

          {(row.pair?.rationale || subject?.rationale) && (
            <ExpandableText text={row.pair?.rationale || subject.rationale} lines={2} />
          )}
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-1.5">
            <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', actionTone(row.item.action))}>
              {row.item.action}
            </span>
            <span className="text-sm font-bold text-gray-900 dark:text-white">
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
          </div>

          {row.item.rationale && <ExpandableText text={row.item.rationale} lines={2} />}
        </>
      )}

      <p className="mt-1.5 text-[11px] text-gray-400 truncate">
        {subject?.portfolios?.name ?? 'No portfolio'}
        {subject?.users &&
          ' · ' + [subject.users.first_name, subject.users.last_name].filter(Boolean).join(' ')}
        {!showMoveControls && row.status && ' · ' + String(row.status).replace(/_/g, ' ')}
      </p>

      {showMoveControls && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            disabled={!movable || !prev || busy}
            onClick={() => prev && onStep(prev)}
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 no-touch-target"
            aria-label={prev ? 'Move back to ' + RESEARCH_STAGE_CONFIG[prev].shortLabel : 'No earlier stage'}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <button
            type="button"
            disabled={!movable}
            onClick={onOpenSheet}
            className="flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 disabled:opacity-40 no-touch-target"
          >
            {movable ? (
              <>Move<ArrowRight className="h-3.5 w-3.5" /></>
            ) : (
              <><Lock className="h-3.5 w-3.5" />Not yours to move</>
            )}
          </button>

          <button
            type="button"
            disabled={!movable || !next || busy}
            onClick={() => next && onStep(next)}
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-primary-600 text-white disabled:opacity-30 no-touch-target"
            aria-label={next ? 'Advance to ' + RESEARCH_STAGE_CONFIG[next].shortLabel : 'Final stage'}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  )
}
