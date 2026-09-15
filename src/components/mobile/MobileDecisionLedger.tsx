import { clsx } from 'clsx'
import { format } from 'date-fns'
import { ChevronRight, Layers, Target } from 'lucide-react'
import { batchLabel } from '../../lib/outcomes/batch-groups'
import type { AccountabilityRow } from '../../types/decision-accountability'
import { VERDICT_DISPLAY, type DecisionIntelligence } from '../../lib/decision-intelligence'

interface MobileDecisionLedgerProps {
  items: Array<{ row: AccountabilityRow; intel: DecisionIntelligence }>
  selectedId: string | null
  onSelect: (row: AccountabilityRow) => void
  /** Trades view: name the batch each trade was committed in. Off inside an
   *  opened batch, where it would only repeat the heading. */
  showBatch?: boolean
}

const ACTION: Record<string, { label: string; tone: string }> = {
  buy:   { label: 'Buy',   tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  add:   { label: 'Add',   tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  long:  { label: 'Long',  tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  sell:  { label: 'Sell',  tone: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  trim:  { label: 'Trim',  tone: 'bg-red-50 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  short: { label: 'Short', tone: 'bg-violet-50 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  pair:  { label: 'Pair',  tone: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
}

/** A return worth putting on the card: a realised or current move. "Pending"
 *  and "+x% missed" describe a trade that did not happen, and stay in the
 *  detail where they are explained. */
function cardReturn(intel: DecisionIntelligence): string | null {
  const r = intel.returnLabel
  if (!r || r === 'Pending' || r.includes('missed')) return null
  return r
}

/**
 * The decision list on a phone: one card per decision.
 *
 * The desktop row is a twelve-track pixel grid over a thousand pixels wide; it
 * does not compress. A card carries what a reader scans for — what was decided
 * on which name, where and when, how it has done, and where it stands — and
 * everything else stays in the detail, as on desktop.
 *
 * Card hierarchy, top to bottom:
 *   action + ticker ............................ return / P&L, chevron
 *   portfolio · date
 *   review / outcome status
 *
 * Status is the row's decision-intelligence verdict (Working, Monitoring,
 * Stalled…), the same label the desktop State column shows. The return is the
 * row's own `returnLabel` and `pnlLabel`; nothing is recomputed here.
 *
 * The earlier card keyed its action chip on 'increase' / 'decrease', which no
 * row carries, so every card showed "—". It now reads the row's real
 * direction. The "no decision price" footnote is gone from the card: it is a
 * data-quality caveat for the detail, not something to scan past on every row.
 */
export function MobileDecisionLedger({ items, selectedId, onSelect, showBatch = false }: MobileDecisionLedgerProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-gray-400">
        <Target className="h-8 w-8 opacity-50" />
        <p className="text-sm text-center">No decisions match these filters.</p>
      </div>
    )
  }

  return (
    <ul data-slot="decision-cards" className="space-y-2">
      {items.map(({ row, intel }) => {
        const action = ACTION[row.direction]
        const ret = cardReturn(intel)
        const positive = intel.resultDirection === 'positive'
        const negative = intel.resultDirection === 'negative'
        const vd = VERDICT_DISPLAY[intel.verdict]
        const when = row.approved_at || row.created_at
        const meta = [row.portfolio_name, when ? format(new Date(when), 'MMM d, yyyy') : null].filter(Boolean).join(' · ')

        return (
          <li key={row.decision_id}>
            <button
              type="button"
              data-slot="decision-card"
              onClick={() => onSelect(row)}
              className={clsx(
                'w-full flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition-colors',
                selectedId === row.decision_id
                  ? 'border-primary-300 bg-primary-50/60 dark:border-primary-700 dark:bg-primary-900/20'
                  : 'border-gray-200 bg-white active:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:active:bg-gray-700/50',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    data-slot="card-action"
                    className={clsx('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold', action?.tone ?? ACTION.pair.tone)}
                  >
                    {action?.label ?? 'Decision'}
                  </span>
                  <span data-slot="card-ticker" className="truncate text-[16px] font-semibold text-gray-900 dark:text-white">
                    {row.asset_symbol ?? '—'}
                  </span>
                </div>
                {meta && (
                  <p data-slot="card-meta" className="mt-1 truncate text-[13px] text-gray-500 dark:text-gray-400">{meta}</p>
                )}
                {showBatch && (row.batches?.length ?? 0) > 0 && (
                  <p data-slot="card-batch" className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-gray-500 dark:text-gray-400">
                    <Layers aria-hidden className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      {row.batches!.length === 1 ? batchLabel(row.batches![0]) : `In ${row.batches!.length} batches`}
                    </span>
                  </p>
                )}
                <span
                  data-slot="card-status"
                  className={clsx('mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium', vd.bgColor, vd.color)}
                >
                  {intel.verdictLabel}
                </span>
              </div>

              {(ret || intel.pnlLabel) && (
                <div data-slot="card-result" className="shrink-0 text-right">
                  {ret && (
                    <div className={clsx(
                      'text-[15px] font-semibold tabular-nums',
                      positive ? 'text-emerald-600 dark:text-emerald-400' : negative ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-300',
                    )}>
                      {ret}
                    </div>
                  )}
                  {intel.pnlLabel && (
                    <div className="text-[12px] tabular-nums text-gray-500 dark:text-gray-400">{intel.pnlLabel}</div>
                  )}
                </div>
              )}
              <ChevronRight aria-hidden className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
