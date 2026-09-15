import { clsx } from 'clsx'
import { format } from 'date-fns'
import { ArrowLeft, ChevronRight, Layers } from 'lucide-react'
import {
  batchLabel, batchPnlText, statusMixText,
  type BatchGroup, type BatchPnl, type DecisionItem,
} from '../../lib/outcomes/batch-groups'
import { MobileDecisionLedger } from './MobileDecisionLedger'

function commitDate(group: BatchGroup) {
  return group.batch.committedAt ? format(new Date(group.batch.committedAt), 'MMM d, yyyy') : null
}

function PnlLine({ pnl }: { pnl: BatchPnl }) {
  const text = batchPnlText(pnl)
  if (!text) return null
  return (
    <span
      data-slot="batch-pnl"
      className={clsx(
        'tabular-nums',
        pnl.kind === 'total'
          ? pnl.value > 0 ? 'font-semibold text-emerald-600 dark:text-emerald-400' : pnl.value < 0 ? 'font-semibold text-red-600 dark:text-red-400' : 'font-semibold text-gray-700 dark:text-gray-300'
          : 'text-gray-400',
      )}
    >
      {text}
    </span>
  )
}

/**
 * Outcomes → Decisions → Batches on a phone.
 *
 * One card per batch: name, portfolio · commit date, trade count, the status
 * mix of its trades, and a $ P&L only when every trade has one that belongs to
 * this batch alone (lib/outcomes/batch-groups). No batch return %.
 *
 * Decisions committed outside any batch follow as ordinary decision cards under
 * "Not in a batch", so nothing becomes unreachable in this view.
 */
export function MobileBatchList({
  groups,
  standalone,
  searching,
  onOpenBatch,
  selectedId,
  onSelectTrade,
}: {
  groups: BatchGroup[]
  standalone: DecisionItem[]
  searching: boolean
  onOpenBatch: (batchId: string) => void
  selectedId: string | null
  onSelectTrade: (item: DecisionItem['row']) => void
}) {
  if (groups.length === 0 && standalone.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-gray-400">
        <Layers className="h-8 w-8 opacity-50" />
        <p className="text-sm text-center">{searching ? 'No batch, ticker or company matches.' : 'No decisions match these filters.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.length > 0 && (
        <ul data-slot="batch-cards" className="space-y-2">
          {groups.map(group => {
            const date = commitDate(group)
            const partialMatch = group.matches.length !== group.items.length
            return (
              <li key={group.batch.id}>
                <button
                  type="button"
                  data-slot="batch-card"
                  onClick={() => onOpenBatch(group.batch.id)}
                  className="w-full flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-3 text-left active:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:active:bg-gray-700/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Layers aria-hidden className="h-4 w-4 shrink-0 text-gray-400" />
                      <span data-slot="batch-name" className="truncate text-[16px] font-semibold text-gray-900 dark:text-white">
                        {batchLabel(group.batch)}
                      </span>
                    </div>
                    <p data-slot="batch-meta" className="mt-1 truncate text-[13px] text-gray-500 dark:text-gray-400">
                      {[group.portfolioName, date].filter(Boolean).join(' · ')}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px]">
                      <span data-slot="batch-count" className="font-medium text-gray-700 dark:text-gray-300">
                        {partialMatch
                          ? `${group.matches.length} of ${group.items.length} trades match`
                          : `${group.items.length} trade${group.items.length === 1 ? '' : 's'}`}
                      </span>
                      <span data-slot="batch-status-mix" className="text-gray-500 dark:text-gray-400">{statusMixText(group.statusMix)}</span>
                    </p>
                    <p className="mt-0.5 text-[12px]"><PnlLine pnl={group.pnl} /></p>
                  </div>
                  <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {standalone.length > 0 && (
        <section data-slot="standalone-decisions" aria-label="Not in a batch" className="space-y-2">
          <h2 className="px-1 text-[12px] font-medium text-gray-500 dark:text-gray-400">Not in a batch · {standalone.length}</h2>
          <MobileDecisionLedger items={standalone} selectedId={selectedId} onSelect={onSelectTrade} />
        </section>
      )}
    </div>
  )
}

/** One batch opened: its summary, then its trades as decision cards. */
export function MobileBatchView({
  group,
  showAll,
  onShowAll,
  onBack,
  selectedId,
  onSelectTrade,
}: {
  group: BatchGroup
  showAll: boolean
  onShowAll: () => void
  onBack: () => void
  selectedId: string | null
  onSelectTrade: (item: DecisionItem['row']) => void
}) {
  const date = commitDate(group)
  const partialMatch = group.matches.length !== group.items.length
  const items = showAll || !partialMatch ? group.items : group.matches
  return (
    <div data-slot="batch-view" className="space-y-2">
      <button
        type="button"
        onClick={onBack}
        className="no-touch-target tap-pad inline-flex items-center gap-1 h-8 text-[13px] font-medium text-gray-600 dark:text-gray-300"
      >
        <ArrowLeft className="h-4 w-4" /> Batches
      </button>
      <section className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800">
        <h2 data-slot="batch-name" className="text-[17px] font-semibold text-gray-900 break-words dark:text-white">{batchLabel(group.batch)}</h2>
        <p className="mt-0.5 text-[13px] text-gray-500 dark:text-gray-400">{[group.portfolioName, date].filter(Boolean).join(' · ')}</p>
        <p className="mt-1.5 flex flex-wrap gap-x-2 text-[12px]">
          <span className="font-medium text-gray-700 dark:text-gray-300">{group.items.length} trade{group.items.length === 1 ? '' : 's'}</span>
          <span className="text-gray-500 dark:text-gray-400">{statusMixText(group.statusMix)}</span>
        </p>
        <p className="mt-0.5 text-[12px]"><PnlLine pnl={group.pnl} /></p>
      </section>
      {partialMatch && (
        <p className="flex items-center justify-between gap-2 px-1 text-[12px] text-gray-500 dark:text-gray-400">
          <span>{showAll ? `All ${group.items.length} trades` : `${group.matches.length} of ${group.items.length} trades match your search`}</span>
          {!showAll && (
            <button type="button" onClick={onShowAll} className="no-touch-target tap-pad font-medium text-primary-600 dark:text-primary-400">
              Show all
            </button>
          )}
        </p>
      )}
      <MobileDecisionLedger items={items} selectedId={selectedId} onSelect={onSelectTrade} />
    </div>
  )
}
