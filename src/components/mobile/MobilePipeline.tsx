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
export function MobilePipeline() {
  const { user } = useAuth()
  const { data: items = [], isLoading } = usePipelineItems()
  const { moveTrade, isMoving } = useTradeIdeaService()

  const [stage, setStage] = useState<ResearchStage>('aware')
  const [search, setSearch] = useState('')
  const [moving, setMoving] = useState<any | null>(null)

  const byStage = useMemo(() => {
    const map = new Map<ResearchStage, any[]>(RESEARCH_STAGES.map(s => [s, []]))
    const q = search.trim().toLowerCase()
    for (const item of items) {
      // Legacy rows carry a status rather than a research stage; toResearchStage
      // is the same resolution the board applies, so both surfaces agree on
      // which column a given row belongs in.
      const s = toResearchStage(item.stage) as ResearchStage
      if (!map.has(s)) continue
      if (q) {
        const hay = `${item.assets?.symbol ?? ''} ${item.assets?.company_name ?? ''} ${item.rationale ?? ''}`
        if (!hay.toLowerCase().includes(q)) continue
      }
      map.get(s)!.push(item)
    }
    return map
  }, [items, search])

  const canMove = (item: any) =>
    !!user?.id && isCreatorOrCoAnalyst(user.id, {
      created_by: item.created_by,
      assigned_to: item.assigned_to,
      collaborators: item.collaborators,
    })

  const stageIndex = RESEARCH_STAGES.indexOf(stage)
  const current = byStage.get(stage) ?? []

  const commit = (item: any, target: ResearchStage, uiSource: UISource) => {
    moveTrade({ tradeId: item.id, targetStatus: target as any, uiSource })
    setMoving(null)
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Stage strip. Horizontally scrollable rather than five squeezed tabs:
          the labels are the vocabulary of the process and abbreviating them to
          fit ("Deep Res.") makes the board harder to read, not smaller. */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
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

        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search this pipeline"
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
        {RESEARCH_STAGE_CONFIG[stage].description}
      </p>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-safe space-y-2">
        {isLoading ? (
          [0, 1, 2].map(i => (
            <div key={i} className="h-28 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))
        ) : current.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-gray-400">
            <ListTodo className="h-8 w-8 opacity-50" />
            <p className="text-sm">
              {search ? 'Nothing here matches that.' : `Nothing in ${RESEARCH_STAGE_CONFIG[stage].shortLabel}.`}
            </p>
          </div>
        ) : (
          current.map(item => {
            const allowed = canMove(item)
            const prev = stageIndex > 0 ? RESEARCH_STAGES[stageIndex - 1] : null
            const next = stageIndex < RESEARCH_STAGES.length - 1 ? RESEARCH_STAGES[stageIndex + 1] : null

            return (
              <div
                key={item.id}
                className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide',
                      item.action === 'buy' || item.action === 'add'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                        : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                    )}
                  >
                    {item.action}
                  </span>
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {item.assets?.symbol ?? '—'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-gray-400">
                    {item.assets?.company_name}
                  </span>
                  {item.proposed_weight != null && (
                    <span className="shrink-0 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                      {item.proposed_weight}%
                    </span>
                  )}
                </div>

                {item.rationale && <ExpandableText text={item.rationale} lines={2} />}

                <p className="mt-1.5 text-[11px] text-gray-400 truncate">
                  {item.portfolios?.name ?? 'No portfolio'}
                  {item.users &&
                    ` · ${[item.users.first_name, item.users.last_name].filter(Boolean).join(' ')}`}
                </p>

                {/* Adjacent moves are one tap, because advancing a stage is by
                    far the most common action. Anything else opens the sheet. */}
                <div className="mt-2.5 flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={!allowed || !prev || isMoving}
                    onClick={() => prev && commit(item, prev, 'mobile_step')}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 disabled:opacity-30 no-touch-target"
                    aria-label={prev ? `Move back to ${RESEARCH_STAGE_CONFIG[prev].shortLabel}` : 'No earlier stage'}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>

                  <button
                    type="button"
                    disabled={!allowed}
                    onClick={() => setMoving(item)}
                    className="flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 disabled:opacity-40 no-touch-target"
                  >
                    {allowed ? (
                      <>Move<ArrowRight className="h-3.5 w-3.5" /></>
                    ) : (
                      <><Lock className="h-3.5 w-3.5" />Not yours to move</>
                    )}
                  </button>

                  <button
                    type="button"
                    disabled={!allowed || !next || isMoving}
                    onClick={() => next && commit(item, next, 'mobile_step')}
                    className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg bg-primary-600 text-white disabled:opacity-30 no-touch-target"
                    aria-label={next ? `Advance to ${RESEARCH_STAGE_CONFIG[next].shortLabel}` : 'Final stage'}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <BottomSheet
        open={!!moving}
        onClose={() => setMoving(null)}
        title={moving ? `Move ${moving.assets?.symbol ?? 'idea'}` : undefined}
        fitContent
      >
        <div className="px-3 pb-3 space-y-1">
          {RESEARCH_STAGES.map(s => {
            const cfg = RESEARCH_STAGE_CONFIG[s]
            const isCurrent = moving ? toResearchStage(moving.stage) === s : false
            return (
              <button
                key={s}
                type="button"
                disabled={isCurrent || isMoving}
                onClick={() => moving && commit(moving, s, 'mobile_sheet')}
                className={clsx(
                  'w-full flex items-start gap-3 rounded-xl px-3 py-3 text-left no-touch-target',
                  isCurrent
                    ? 'bg-gray-100 dark:bg-gray-800'
                    : 'active:bg-gray-50 dark:active:bg-gray-800'
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
          {isMoving && (
            <p className="flex items-center justify-center gap-1.5 py-2 text-xs text-gray-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Moving…
            </p>
          )}
        </div>
      </BottomSheet>
    </div>
  )
}
