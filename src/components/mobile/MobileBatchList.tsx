import { clsx } from 'clsx'
import { format } from 'date-fns'
import { ArrowLeft, ChevronRight, Layers } from 'lucide-react'
import {
  batchLabel, batchPnlText,
  type BatchGroup, type BatchPnl, type DecisionItem,
} from '../../lib/outcomes/batch-groups'
import { phoneStatusMixText } from '../../lib/outcomes/phone-status'
import { MobileDecisionLedger } from './MobileDecisionLedger'

function commitDate(group: BatchGroup) {
  return group.batch.committedAt ? format(new Date(group.batch.committedAt), 'MMM d, yyyy') : null
}

function PnlLine({ pnl, className }: { pnl: BatchPnl; className?: string }) {
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
        className,
      )}
    >
      {text}
    </span>
  )
}

/**
 * Outcomes → Decisions → Batches on a phone.
 *
 * The batch card summarises the batch and nothing more: its name, how many
 * trades · portfolio · commit date, the status mix of those trades, and a $ P&L
 * total on the right only when every trade has one that belongs to this batch
 * alone (lib/outcomes/batch-groups). No batch return %. Ticker, action and each
 * trade's own result live on the trade cards once the batch is opened.
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
            const meta = [group.portfolioName, date].filter(Boolean).join(' · ')
            const totalPnl = group.pnl.kind === 'total'
            return (
              <li key={group.batch.id}>
                <button
                  type="button"
                  data-slot="batch-card"
                  onClick={() => onOpenBatch(group.batch.id)}
                  className="w-full flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-left active:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:active:bg-gray-700/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <Layers aria-hidden className="h-4 w-4 shrink-0 text-gray-400" />
                      <span data-slot="batch-name" className="truncate text-[15px] font-semibold text-gray-900 dark:text-white">
                        {batchLabel(group.batch)}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-gray-400">
                      <span data-slot="batch-count" className="font-medium text-gray-600 dark:text-gray-300">
                        {partialMatch
                          ? `${group.matches.length} of ${group.items.length} trades match`
                          : `${group.items.length} trade${group.items.length === 1 ? '' : 's'}`}
                      </span>
                      {meta && <> · <span data-slot="batch-meta">{meta}</span></>}
                    </p>
                    <p data-slot="batch-status-mix" className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-gray-400">
                      {phoneStatusMixText(group.items)}
                    </p>
                    {!totalPnl && <p className="mt-0.5 text-[12px]"><PnlLine pnl={group.pnl} /></p>}
                  </div>
                  {totalPnl && <PnlLine pnl={group.pnl} className="shrink-0 text-right text-[14px]" />}
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

/**
 * One batch opened: a quiet summary, then its trades as the thing to tap.
 *
 * The summary is plain text, not a card, so the trade cards under it are the
 * strongest shapes on the screen. It states portfolio, date and trade count
 * once, so the trade cards leave them out. The status mix and the P&L total
 * appear only when there is more than one trade — for a single trade they
 * would restate that trade's own card.
 */
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
  const several = group.items.length > 1
  return (
    <div data-slot="batch-view" className="space-y-2">
      <button
        type="button"
        onClick={onBack}
        className="no-touch-target tap-pad inline-flex items-center gap-1 h-8 text-[13px] font-medium text-gray-600 dark:text-gray-300"
      >
        <ArrowLeft className="h-4 w-4" /> Batches
      </button>
      <section data-slot="batch-summary" className="px-1 pb-1">
        <h2 data-slot="batch-name" className="text-[17px] font-semibold text-gray-900 break-words dark:text-white">{batchLabel(group.batch)}</h2>
        <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">
          {[group.portfolioName, date, `${group.items.length} trade${group.items.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}
        </p>
        {several && (
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] text-gray-500 dark:text-gray-400">
            <span data-slot="batch-status-mix">{phoneStatusMixText(group.items)}</span>
            <PnlLine pnl={group.pnl} />
          </p>
        )}
      </section>
      {partialMatch ? (
        <p className="flex items-center justify-between gap-2 px-1 text-[12px] text-gray-500 dark:text-gray-400">
          <span>{showAll ? `All ${group.items.length} trades` : `${group.matches.length} of ${group.items.length} trades match your search`}</span>
          {!showAll && (
            <button type="button" onClick={onShowAll} className="no-touch-target tap-pad font-medium text-primary-600 dark:text-primary-400">
              Show all
            </button>
          )}
        </p>
      ) : (
        <h3 data-slot="batch-trades-hint" className="px-1 text-[12px] font-medium text-gray-500 dark:text-gray-400">
          {several ? 'Tap a trade to see its outcome' : 'Tap the trade to see its outcome'}
        </h3>
      )}
      <MobileDecisionLedger items={items} selectedId={selectedId} onSelect={onSelectTrade} showMeta={false} prominent />
    </div>
  )
}
