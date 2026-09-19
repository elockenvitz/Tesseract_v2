import { useState, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight, Layers } from 'lucide-react'
import {
  batchLabel, batchPnlText, statusMixText,
  type BatchGroup, type DecisionItem,
} from '../../lib/outcomes/batch-groups'

/**
 * Outcomes → Decisions → Batches on desktop: a summary row per batch that
 * expands to its trades as the ordinary table rows, then decisions in no batch.
 *
 * Same semantics as the phone (lib/outcomes/batch-groups): count, status mix,
 * $ P&L only when every trade has one attributable to this batch, no return %.
 */
export function DesktopBatchRows({
  groups,
  standalone,
  searching,
  renderRow,
}: {
  groups: BatchGroup[]
  standalone: DecisionItem[]
  searching: boolean
  renderRow: (item: DecisionItem) => ReactNode
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  if (groups.length === 0 && standalone.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-[12px] text-gray-400">
        {searching ? 'No batch, ticker or company matches.' : 'No decisions match these filters.'}
      </div>
    )
  }

  return (
    <div data-slot="desktop-batch-rows">
      {groups.map(group => {
        // A search that matched trades (not the name) opens the batch on them.
        const open = expanded.has(group.batch.id) || (searching && group.matches.length !== group.items.length)
        const items = searching ? group.matches : group.items
        const pnl = batchPnlText(group.pnl)
        return (
          <div key={group.batch.id} className="border-b border-gray-100 dark:border-gray-800">
            <button
              type="button"
              data-slot="desktop-batch-row"
              aria-expanded={open}
              onClick={() => toggle(group.batch.id)}
              className="w-full flex items-center gap-3 px-4 py-2 bg-gray-50/70 hover:bg-gray-100/70 text-left dark:bg-gray-900/40 dark:hover:bg-gray-900/70"
            >
              {open ? <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
              <Layers className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <span className="text-[12px] font-semibold text-gray-900 truncate dark:text-white">{batchLabel(group.batch)}</span>
              <span className="text-[11px] text-gray-500 truncate dark:text-gray-400">
                {[group.portfolioName, group.batch.committedAt ? format(new Date(group.batch.committedAt), 'MMM d, yyyy') : null].filter(Boolean).join(' · ')}
              </span>
              <span className="ml-auto flex items-center gap-3 shrink-0 text-[11px]">
                <span className="font-medium text-gray-700 dark:text-gray-300">
                  {items.length !== group.items.length ? `${items.length} of ${group.items.length} trades` : `${group.items.length} trade${group.items.length === 1 ? '' : 's'}`}
                </span>
                <span className="text-gray-500 dark:text-gray-400">{statusMixText(group.statusMix)}</span>
                {pnl && (
                  <span className={clsx('tabular-nums', group.pnl.kind === 'total'
                    ? group.pnl.value > 0 ? 'font-semibold text-emerald-600' : group.pnl.value < 0 ? 'font-semibold text-red-600' : 'font-semibold text-gray-700'
                    : 'text-gray-400')}>
                    {pnl}
                  </span>
                )}
              </span>
            </button>
            {open && items.map(item => <div key={item.row.decision_id}>{renderRow(item)}</div>)}
          </div>
        )
      })}
      {standalone.length > 0 && (
        <div data-slot="desktop-standalone">
          <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50/40 border-b border-gray-100 dark:bg-gray-900/30 dark:border-gray-800">
            Not in a batch · {standalone.length}
          </div>
          {standalone.map(item => <div key={item.row.decision_id}>{renderRow(item)}</div>)}
        </div>
      )}
    </div>
  )
}
