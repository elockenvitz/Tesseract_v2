/**
 * The instrument block: what is on screen, what it is worth, and where the
 * numbers came from.
 *
 * Replaces a symbol and a company name. See `series-meta.ts` for why the
 * adjustment basis is stated rather than assumed, and `annotation-summary.ts`
 * for why no currency symbol is attached to a price on this surface.
 */
import { clsx } from 'clsx'
import { AlertTriangle } from 'lucide-react'
import { formatMoney } from '../../../lib/market-data/currency'
import {
  readChange, freshnessLabel, adjustmentLabel, adjustmentIsHazardous,
  type SeriesMeta,
} from './series-meta'

export interface InstrumentHeaderProps {
  symbol: string
  companyName?: string | null
  meta: SeriesMeta | null
}

export function InstrumentHeader({ symbol, companyName, meta: incoming }: InstrumentHeaderProps) {
  /*
   * Meta for a different instrument is not shown at all.
   *
   * While a new symbol's series loads, the previous one's meta is still in
   * state. Printing it would put AAPL's last close beside MSFT's name --
   * briefly, and plausibly enough that a reader would not question it. An
   * empty slot for a second is the correct answer to "what is this worth",
   * when the honest answer is "not known yet".
   */
  const meta = incoming && incoming.symbol.toUpperCase() === symbol.toUpperCase() ? incoming : null
  const change = meta ? readChange(meta) : null

  return (
    <div data-charting-instrument className="flex min-w-0 items-center gap-3">
      <span className="text-lg font-bold tracking-tight text-gray-900 dark:text-white">{symbol}</span>
      {companyName && (
        <span className="truncate text-sm text-gray-500 dark:text-gray-400">{companyName}</span>
      )}

      {meta?.last != null && (
        <>
          <span className="font-mono text-base tabular-nums text-gray-900 dark:text-white">
            {formatMoney(meta.last)}
          </span>
          {change && (
            <span
              className={clsx(
                'font-mono text-xs tabular-nums',
                change.direction === 'up' && 'text-emerald-600 dark:text-emerald-400',
                change.direction === 'down' && 'text-rose-600 dark:text-rose-400',
                change.direction === 'flat' && 'text-gray-500',
              )}
            >
              {change.absolute >= 0 ? '+' : '-'}{formatMoney(Math.abs(change.absolute))}
              {' '}({change.percent >= 0 ? '+' : ''}{change.percent.toFixed(2)}%)
            </span>
          )}
        </>
      )}

      {meta && (
        <span className="hidden items-center gap-2 text-[11px] text-gray-400 lg:flex">
          <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
          <span>{meta.bars} bars · {meta.interval}</span>
          <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
          <span>{meta.provider}</span>
          <span>{freshnessLabel(meta.lastBarTime)}</span>
          {/*
            The basis, beside the prices rather than behind a tooltip.
            A raw series on a long window draws a stock split as a collapse,
            and a reader who cannot see the word "raw" has no way to know the
            chart is not describing a market event.
          */}
          <span
            className={clsx(
              'rounded px-1.5 py-0.5',
              adjustmentIsHazardous(meta.adjustment)
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                : 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400',
            )}
            title={
              adjustmentIsHazardous(meta.adjustment)
                ? 'Prices are as traded on the day. A stock split appears as a step change in the line, not as a market move.'
                : undefined
            }
          >
            {adjustmentIsHazardous(meta.adjustment) && (
              <AlertTriangle className="mr-1 inline h-3 w-3 align-[-2px]" />
            )}
            {adjustmentLabel(meta.adjustment)}
          </span>
        </span>
      )}
    </div>
  )
}
