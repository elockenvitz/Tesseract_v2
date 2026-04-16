import { clsx } from 'clsx'
import type { PairLegInfo } from '../../lib/trade-lab/pair-info'

/**
 * Compact "↔ pair" badge shown next to an asset symbol when the asset is
 * part of a pair trade. Hover tooltip lists the paired legs and this leg's
 * direction. Used in both the Trade Book (AcceptedTradesTable) and the
 * Trade Lab (HoldingsSimulationTable).
 */
export function PairBadge({
  info,
  className,
}: {
  info: PairLegInfo
  className?: string
}) {
  const directionLabel = info.direction === 'long' ? 'LONG' : info.direction === 'short' ? 'SHORT' : 'LEG'
  const partners = info.partnerSymbols.join(', ')
  const title = `Pair trade — ${directionLabel} leg. Paired with: ${partners || 'unknown'}`
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-0.5 px-1 py-px rounded text-[8px] font-bold uppercase tracking-wide select-none whitespace-nowrap',
        'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
        className,
      )}
    >
      <span aria-hidden>↔</span>
      <span>{directionLabel === 'LEG' ? 'pair' : directionLabel.toLowerCase()}</span>
    </span>
  )
}
