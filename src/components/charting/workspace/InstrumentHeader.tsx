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
  /**
   * The row is too narrow to carry the provenance chips.
   *
   * Decided by the CONTAINER, not the viewport. This block used to hide
   * itself at Tailwind's `lg:`, which reads the window -- so a Charting tab
   * narrowed to a third of a 1920px monitor kept every chip and overflowed
   * the command bar by a measured 245px, while the same 390px on a phone
   * was fine. The toolbar's constraint has never been the window.
   *
   * The basis chip survives `dense` even so. It is what stops a reader
   * taking a raw series' split for a market move, and a narrow pane does
   * not make that less true -- the company name gives way instead.
   */
  dense?: boolean
}

export function InstrumentHeader({ symbol, companyName, meta: incoming, dense = false }: InstrumentHeaderProps) {
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
      <span className="shrink-0 text-lg font-bold tracking-tight text-gray-900 dark:text-white">{symbol}</span>
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

      {/*
        `shrink-0` below: when the row runs short of space the COMPANY NAME
        gives way, never this block. It carries the freshness and the basis,
        and the basis is the label that stops a reader taking a raw series'
        split for a market move. The thing that can mislead is the last
        thing to be squeezed out, not the first.
      */}
      {meta && (
        <span className="flex shrink-0 items-center gap-2 text-[11px] text-gray-400">
          {!dense && (
            <>
              <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
              <span>{meta.bars} bars · {meta.interval}</span>
              <span className="h-3 w-px bg-gray-200 dark:bg-white/10" />
              <span>{meta.provider}</span>
              {/*
                `observedAt`, never `lastBarTime`. The bar carries the opening
                of the period it covers, so on a monthly series it is the
                first of the month and the header announced an 18-day-old
                chart that was current. See `freshnessLabel`.
              */}
              <span>{freshnessLabel(meta.observedAt)}</span>
            </>
          )}
          {/*
            On a phone the basis chip is kept only when it has something to
            warn about.

            It is about 90px, and at 360px of toolbar the left group was
            still 92px over with every other chip already gone. Something
            had to give, and between "split-adjusted" -- which tells a
            reader the chart is SAFE -- and the company name, the reassurance
            is what can be looked up later.

            `adjustmentIsHazardous` is never suppressed. A raw or unmeasurable
            series draws a split as a collapse, and the narrow pane is
            precisely where a reader is least able to spot that for
            themselves.
          */}
          {/*
            The basis, beside the prices rather than behind a tooltip.
            A raw series on a long window draws a stock split as a collapse,
            and a reader who cannot see the word "raw" has no way to know the
            chart is not describing a market event.
          */}
          {(!dense || adjustmentIsHazardous(meta.adjustment)) && (
          <span
            className={clsx(
              'rounded px-1.5 py-0.5',
              adjustmentIsHazardous(meta.adjustment)
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300'
                : 'bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400',
            )}
            /*
             * The hazard explains itself; an adjusted series shows what the
             * conclusion was measured from. A reader who wants to know why
             * the chart claims to be split-adjusted gets the measurement
             * rather than being asked to trust the badge.
             */
            title={
              adjustmentIsHazardous(meta.adjustment)
                ? 'Prices are as traded on the day. A stock split appears as a step change in the line, not as a market move.'
                : meta.adjustmentEvidence
            }
          >
            {adjustmentIsHazardous(meta.adjustment) && (
              <AlertTriangle className="mr-1 inline h-3 w-3 align-[-2px]" />
            )}
            {adjustmentLabel(meta.adjustment)}
          </span>
          )}
        </span>
      )}
    </div>
  )
}
