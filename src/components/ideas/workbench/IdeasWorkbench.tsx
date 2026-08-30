import { useMemo, useState } from 'react'
import { clsx } from 'clsx'

import {
  filterWorkbench, needsAttentionCount,
  type NextAction, type WorkbenchFilter, type WorkbenchIdea,
} from '../../../lib/ideas/workbench'
import { IdeaQueueRow } from './IdeaQueueRow'
import { IdeaWorkspace } from './IdeaWorkspace'

/**
 * Desktop Ideas as a split-pane workbench.
 *
 * ── The shape, and why ────────────────────────────────────────────────────
 *
 * Left: the ranked queue, sized to scan. Right: the selected idea, sized to
 * work in. The split is the whole architecture — it is what lets a reader
 * compare several ideas and then act on one without losing the comparison,
 * which neither a card wall nor a notification list can do.
 *
 * 38/62. The queue needs enough width for a ticker, a stance, a claim at two
 * lines and a small chart; the workspace needs enough for a real chart and a
 * paragraph of thesis at a readable measure. Below `lg` the panes stack and the
 * queue takes the screen, because a 400px-wide split is two cramped columns.
 *
 * ── Filters, not sections ─────────────────────────────────────────────────
 *
 * The cockpit carved the page into ATTENTION and NEXT, which made attention a
 * PLACE — so nineteen findings read as nineteen exceptions and the ideas
 * themselves were nowhere. Here there is one ranked list and the segments are
 * filters over it. Attention is a count and a lens, not a section.
 */

interface IdeasWorkbenchProps {
  ideas: readonly WorkbenchIdea[]
  /** A small price path for a queue row. Injected; this never fetches. */
  renderRowSpark?: (symbol: string) => React.ReactNode
  /** The larger chart for the open idea. Injected for the same reason. */
  renderChart?: (symbol: string) => React.ReactNode
  onAct?: (action: NextAction, idea: WorkbenchIdea) => void
  onOpenAsset?: (symbol: string) => void
}

const FILTERS: { key: WorkbenchFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'attention', label: 'Needs attention' },
  { key: 'authored', label: 'My ideas' },
  { key: 'watching', label: 'Watching' },
]

export function IdeasWorkbench({
  ideas, renderRowSpark, renderChart, onAct, onOpenAsset,
}: IdeasWorkbenchProps) {
  const [filter, setFilter] = useState<WorkbenchFilter>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const visible = useMemo(() => filterWorkbench(ideas, filter), [ideas, filter])
  const attention = useMemo(() => needsAttentionCount(ideas), [ideas])

  /**
   * The selection, defaulted to the top of the list.
   *
   * Held as an id rather than an object so a re-rank does not strand the pane
   * on a stale copy — and falling back to the first visible idea means the
   * workspace is never empty while the queue has something in it, which is
   * what makes the surface feel loaded rather than waiting.
   */
  const selected = useMemo(
    () => visible.find(i => i.id === selectedId) ?? visible[0] ?? null,
    [visible, selectedId],
  )

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row" data-ideas-workbench>
      {/* ── Left: the queue ─────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-col border-gray-200 lg:w-[38%] lg:border-r dark:border-gray-800">
        <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-200 px-3 py-2 dark:border-gray-800">
          {FILTERS.map(f => (
            <button
              key={f.key}
              type="button"
              data-workbench-filter={f.key}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              className={clsx(
                'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold transition-colors',
                filter === f.key
                  ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300',
              )}
            >
              {f.label}
              {f.key === 'attention' && attention > 0 && (
                <span className={clsx(
                  'ml-1.5 tabular-nums',
                  filter === f.key ? 'text-white/70 dark:text-gray-900/60' : 'text-gray-400',
                )}>
                  {attention}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto" data-workbench-queue>
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-gray-400">
              No ideas in this view.
            </p>
          ) : (
            visible.map(idea => (
              <IdeaQueueRow
                key={idea.id}
                idea={idea}
                selected={selected?.id === idea.id}
                onSelect={setSelectedId}
                sparkline={idea.symbol && renderRowSpark ? renderRowSpark(idea.symbol) : undefined}
              />
            ))
          )}
        </div>
      </div>

      {/* ── Right: the workspace ────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 bg-white dark:bg-gray-900">
        <IdeaWorkspace
          idea={selected}
          chart={selected?.symbol && renderChart ? renderChart(selected.symbol) : undefined}
          onAct={onAct}
          onOpenAsset={onOpenAsset}
        />
      </div>
    </div>
  )
}
