import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import {
  ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight,
  Loader2, ListTodo, Lock, Search, X,
} from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { usePipelineItems } from '../../hooks/usePipelineItems'
import { useTradeIdeaService } from '../../hooks/useTradeIdeaService'
import { isCreatorOrCoAnalyst } from '../../lib/permissions/trade-idea-permissions'
import { RESEARCH_STAGES, RESEARCH_STAGE_CONFIG } from '../../lib/trade-status-semantics'
import {
  groupIntoRows,
  rowSearchText,
  missingForStage,
  isForwardMove,
  COMMITTED_PIPELINE_STATUSES,
  ARCHIVED_PIPELINE_STATUSES,
  type PipelineRow,
} from '../../lib/mobile/pipeline-rows'
import type { ResearchStage, UISource } from '../../types/trading'
import { BottomSheet } from './BottomSheet'
import { ExpandableText } from './ExpandableText'

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
 * 2. Moving is never a single tap. Stage is the shared state of the whole
 *    desk's process, and a mis-tap on a phone silently rewrites it. Every move
 *    is chosen, then confirmed against a plain sentence naming both stages.
 *
 * 3. A card is a summary and opens full screen. A pipeline card cannot hold a
 *    thesis, a target, sizing and provenance at this width, and an idea that
 *    cannot be read in full is one that gets advanced without being read.
 *
 * Writes go through useTradeIdeaService — the same audited mutations the board
 * uses — and forward moves are gated client-side against the same requirements
 * the service enforces, so the reader is told what is missing before tapping
 * rather than after.
 */
export function MobilePipeline() {
  const { user } = useAuth()
  const { data: items = [], isLoading } = usePipelineItems()
  const { moveTrade, movePairTrade, isMoving, isMovingPairTrade } = useTradeIdeaService()

  const [view, setView] = useState<View>('pipeline')
  const [stage, setStage] = useState<ResearchStage>('aware')
  const [search, setSearch] = useState('')
  const [stagePickerOpen, setStagePickerOpen] = useState(false)
  const [detail, setDetail] = useState<PipelineRow | null>(null)
  const [moveTarget, setMoveTarget] = useState<PipelineRow | null>(null)

  const busy = isMoving || isMovingPairTrade

  const rows = useMemo(() => groupIntoRows(items), [items])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(row => rowSearchText(row).includes(q))
  }, [rows, search])

  const byStage = useMemo(() => {
    const map = new Map<ResearchStage, PipelineRow[]>(RESEARCH_STAGES.map(s => [s, []]))
    for (const row of visible) {
      if (COMMITTED_PIPELINE_STATUSES.includes(row.status)) continue
      if (ARCHIVED_PIPELINE_STATUSES.includes(row.status)) continue
      const s = row.stage as ResearchStage
      if (map.has(s)) map.get(s)!.push(row)
    }
    return map
  }, [visible])

  const committedRows = useMemo(
    () => visible.filter(r => COMMITTED_PIPELINE_STATUSES.includes(r.status)),
    [visible]
  )
  const archivedRows = useMemo(
    () => visible.filter(r => ARCHIVED_PIPELINE_STATUSES.includes(r.status)),
    [visible]
  )

  const canMove = (row: PipelineRow) => {
    const subject = row.kind === 'pair' ? row.legs[0] : row.item
    if (!subject || !user?.id) return false
    return isCreatorOrCoAnalyst(user.id, {
      created_by: subject.created_by,
      assigned_to: subject.assigned_to,
      collaborators: subject.collaborators,
    })
  }

  const stageIndex = RESEARCH_STAGES.indexOf(stage)
  const pipelineTotal = [...byStage.values()].reduce((n, r) => n + r.length, 0)
  const list =
    view === 'pipeline' ? (byStage.get(stage) ?? []) : view === 'committed' ? committedRows : archivedRows

  // Failures surface through the app's toast, which now outranks these
  // overlays (see ToastContainer) and already rolls the optimistic update back.
  // Reporting them a second time inline would double-report the same event.
  const commit = (row: PipelineRow, target: ResearchStage, uiSource: UISource) => {
    if (row.kind === 'pair') {
      movePairTrade({ pairTradeId: row.id, targetStatus: target as any, uiSource })
    } else {
      moveTrade({ tradeId: row.id, targetStatus: target as any, uiSource })
    }
    setMoveTarget(null)
    setDetail(null)
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="flex gap-1 px-3 pt-2">
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
          <div className="flex items-center gap-1.5 px-3 py-2">
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

      {detail && (
        <IdeaDetail
          row={detail}
          readOnly={view !== 'pipeline'}
          movable={view === 'pipeline' && canMove(detail)}
          onClose={() => setDetail(null)}
          onRequestMove={() => setMoveTarget(detail)}
        />
      )}

      {moveTarget && (
        <MoveSheet
          row={moveTarget}
          busy={busy}
          onClose={() => setMoveTarget(null)}
          onConfirm={target => commit(moveTarget, target, 'mobile_sheet')}
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
function PipelineCard({ row, onOpen }: { row: PipelineRow; onOpen: () => void }) {
  const subject: any = row.kind === 'pair' ? row.legs[0] : row.item

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 active:bg-gray-50 dark:active:bg-gray-800"
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
        {subject?.portfolios?.name ?? 'No portfolio'}
        {subject?.users && ' · ' + [subject.users.first_name, subject.users.last_name].filter(Boolean).join(' ')}
      </p>
    </button>
  )
}

/** One labelled figure in the detail grid. Omitted entirely when unset. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900 dark:text-gray-100">{value}</dd>
    </div>
  )
}

/**
 * The whole idea, full screen.
 *
 * A pipeline card at 390px can hold an action, a symbol and a line of
 * rationale. Everything that decides whether an idea should advance — the
 * thesis, the target, the sizing, who owns it — did not fit, so the reader was
 * being asked to move ideas they could not read.
 */
function IdeaDetail({
  row,
  readOnly,
  movable,
  onClose,
  onRequestMove,
}: {
  row: PipelineRow
  readOnly: boolean
  movable: boolean
  onClose: () => void
  onRequestMove: () => void
}) {
  if (typeof document === 'undefined') return null

  const subject: any = row.kind === 'pair' ? row.legs[0] : row.item
  const stageCfg = RESEARCH_STAGE_CONFIG[row.stage as ResearchStage]

  return createPortal(
    <div className="fixed inset-0 z-[90] flex flex-col bg-white dark:bg-gray-900">
      <div className="flex-shrink-0 flex items-center gap-2 px-3 h-14 pt-safe border-b border-gray-200 dark:border-gray-700">
        <span className="min-w-0 flex-1 truncate text-base font-bold text-gray-900 dark:text-white">
          {row.kind === 'pair'
            ? row.pair?.name || 'Pair trade'
            : `${row.item.assets?.symbol ?? '—'}`}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="h-10 w-10 shrink-0 flex items-center justify-center rounded-full text-gray-500 dark:text-gray-400 no-touch-target"
          aria-label="Close"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-4">
        <div className="flex items-center gap-2">
          {stageCfg && (
            <span className={clsx('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide', stageCfg.color)}>
              {stageCfg.label}
            </span>
          )}
          {row.status && (
            <span className="text-[11px] text-gray-400 capitalize">
              {String(row.status).replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {row.kind === 'pair' ? (
          <div className="space-y-2">
            {row.legs.map((leg: any) => (
              <div key={leg.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={clsx('px-1.5 py-0.5 rounded text-[10px] font-bold uppercase', actionTone(leg.action))}>
                    {leg.pair_leg_type || leg.action}
                  </span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">{leg.assets?.symbol}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
                    {leg.assets?.company_name}
                  </span>
                </div>
                <dl className="grid grid-cols-3 gap-2">
                  <Fact label="Weight" value={leg.proposed_weight != null ? `${leg.proposed_weight}%` : null} />
                  <Fact label="Shares" value={leg.proposed_shares != null ? Number(leg.proposed_shares).toLocaleString() : null} />
                  <Fact label="Target" value={leg.target_price != null ? `$${Number(leg.target_price).toFixed(2)}` : null} />
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <dl className="grid grid-cols-3 gap-3">
            <Fact label="Action" value={<span className="capitalize">{row.item.action}</span>} />
            <Fact label="Weight" value={row.item.proposed_weight != null ? `${row.item.proposed_weight}%` : null} />
            <Fact label="Shares" value={row.item.proposed_shares != null ? Number(row.item.proposed_shares).toLocaleString() : null} />
            <Fact label="Target" value={row.item.target_price != null ? `$${Number(row.item.target_price).toFixed(2)}` : null} />
            <Fact label="Conviction" value={row.item.conviction ? <span className="capitalize">{row.item.conviction}</span> : null} />
            <Fact label="Horizon" value={row.item.time_horizon?.replace(/_/g, ' ')} />
          </dl>
        )}

        <dl className="grid grid-cols-2 gap-3 pt-1 border-t border-gray-100 dark:border-gray-800">
          <Fact label="Portfolio" value={subject?.portfolios?.name ?? 'None'} />
          <Fact
            label="Owner"
            value={
              subject?.users
                ? [subject.users.first_name, subject.users.last_name].filter(Boolean).join(' ') || subject.users.email
                : null
            }
          />
          <Fact label="Urgency" value={subject?.urgency ? <span className="capitalize">{subject.urgency}</span> : null} />
          <Fact
            label="Last moved"
            value={
              subject?.stage_changed_at
                ? new Date(subject.stage_changed_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
                : null
            }
          />
        </dl>

        {(row.kind === 'pair' ? row.pair?.rationale || subject?.rationale : row.item.rationale) && (
          <section>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Why now</h3>
            <ExpandableText
              text={row.kind === 'pair' ? (row.pair?.rationale || subject.rationale) : row.item.rationale}
              lines={6}
              markdown
            />
          </section>
        )}

        {subject?.thesis_text && (
          <section>
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Trade thesis</h3>
            <ExpandableText text={subject.thesis_text} lines={6} markdown />
          </section>
        )}
      </div>

      {!readOnly && (
        <div className="flex-shrink-0 px-4 py-3 pb-safe border-t border-gray-200 dark:border-gray-700">
          <button
            type="button"
            disabled={!movable}
            onClick={onRequestMove}
            className="w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-gray-800 no-touch-target"
          >
            {movable ? (
              <>Move to another stage<ArrowRight className="h-4 w-4" /></>
            ) : (
              <><Lock className="h-4 w-4" />Only the owner or a co-analyst can move this</>
            )}
          </button>
        </div>
      )}
    </div>,
    document.body
  )
}

/**
 * Choose a stage, then confirm it.
 *
 * Two steps rather than one because stage is shared state — it is the desk's
 * view of where a name sits in its process, and a mis-tap on a phone rewrites
 * it for everyone with no undo. The confirmation names both stages in a
 * sentence rather than showing a generic "Are you sure?", so what is about to
 * happen is legible without remembering what was tapped.
 *
 * Targets whose requirements are unmet are shown disabled with the missing
 * fields named. The service refuses those moves anyway; surfacing the rule here
 * turns a failed action into an unavailable one.
 */
function MoveSheet({
  row,
  busy,
  onClose,
  onConfirm,
}: {
  row: PipelineRow
  busy: boolean
  onClose: () => void
  onConfirm: (target: ResearchStage) => void
}) {
  const [chosen, setChosen] = useState<ResearchStage | null>(null)
  const fromCfg = RESEARCH_STAGE_CONFIG[row.stage as ResearchStage]
  const label = row.kind === 'pair' ? (row.pair?.name || 'this pair') : (row.item.assets?.symbol ?? 'this idea')

  return (
    <BottomSheet open onClose={onClose} title={chosen ? 'Confirm move' : `Move ${label}`} fitContent>
      {chosen ? (
        <div className="px-4 pb-4">
          <p className="text-[15px] leading-relaxed text-gray-900 dark:text-gray-100">
            Move <span className="font-semibold">{label}</span> from{' '}
            <span className="font-semibold">{fromCfg?.label ?? row.stage}</span> to{' '}
            <span className="font-semibold">{RESEARCH_STAGE_CONFIG[chosen].label}</span>?
          </p>
          <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
            {row.kind === 'pair'
              ? 'Both legs move together. This changes the stage for everyone on the desk and is recorded in the audit trail.'
              : 'This changes the stage for everyone on the desk and is recorded in the audit trail.'}
          </p>

          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setChosen(null)}
              className="flex-1 h-11 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 no-touch-target"
            >
              Back
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(chosen)}
              className="flex-1 h-11 inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-600 text-white text-sm font-semibold disabled:opacity-50 no-touch-target"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Move
            </button>
          </div>
        </div>
      ) : (
        <div className="px-3 pb-3 space-y-1">
          {row.kind === 'pair' && (
            <p className="px-1 pb-1 text-[11px] text-gray-500 dark:text-gray-400">Both legs move together.</p>
          )}
          {RESEARCH_STAGES.map(s => {
            const cfg = RESEARCH_STAGE_CONFIG[s]
            const isCurrent = row.stage === s
            const missing = isForwardMove(row.stage, s) ? missingForStage(row, s) : []
            const blocked = missing.length > 0
            return (
              <button
                key={s}
                type="button"
                disabled={isCurrent || blocked || busy}
                onClick={() => setChosen(s)}
                className={clsx(
                  'w-full flex items-start gap-3 rounded-xl px-3 py-3 text-left no-touch-target',
                  isCurrent ? 'bg-gray-100 dark:bg-gray-800' : 'active:bg-gray-50 dark:active:bg-gray-800',
                  blocked && 'opacity-60'
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">{cfg.label}</span>
                  <span className="block text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                    {blocked ? `Needs ${missing.join(' and ')} first` : cfg.description}
                  </span>
                </span>
                {isCurrent ? (
                  <span className="mt-0.5 shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500">
                    <Check className="h-3.5 w-3.5" /> Current
                  </span>
                ) : blocked ? (
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </BottomSheet>
  )
}
