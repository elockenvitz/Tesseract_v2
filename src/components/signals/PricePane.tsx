import { useSymbolHistory } from '../../hooks/mobile/useSymbolHistory'
import { canChart, priceIdentity } from '../../lib/signals/price-availability'
import { PriceContext, type PriceBand, type PriceMarker, type RangeKey } from './PriceContext'

/**
 * The tape behind a card, fetched for that card alone.
 *
 * ── Why this is a component and not a value ───────────────────────────────
 *
 * The feed used to compose every price pane from one shared map, filled by a
 * batched query for the first 24 symbols in feed order. So whether a card had
 * a chart depended on how far down the feed it sat — see `useSymbolHistory`
 * for why that budget existed and why it no longer needs to.
 *
 * Fetching per card means the fetch is a hook, and a hook needs a component.
 * That is not a workaround: it is what makes the request lifecycle match the
 * card's. `FeedSlot` mounts roughly five cards at a time, so this mounts
 * roughly five times, and unmounting a distant card stops caring about its
 * symbol without cancelling anything the reader can see.
 *
 * ── The three states, all of them honest ──────────────────────────────────
 *
 * Loading, drawable, and resolved-but-uncached. The third is the one that
 * matters: only 135 of 912 assets have any history, so "no chart" is a common
 * and permanent answer for many real names, and it has to be distinguishable
 * from "still loading" and from "this kind of card never charts".
 *
 * What it will never do is substitute another symbol. See `news-chart` for
 * what that looked like when the feed was allowed to choose.
 */

interface PricePaneProps {
  /** Resolved by the caller — already the traded ticker where they differ. */
  symbol: string
  bands?: PriceBand[]
  markers?: PriceMarker[]
  /** Opens the expanded chart. Given the resolved symbol and its series. */
  /**
   * Opens the expanded chart with the series AND the window the reader had
   * selected, so expanding shows the same thing larger rather than resetting
   * to the default. See `PriceContext.onExpand`.
   */
  onExpand?: (series: { date: string; close: number }[], activeRange: RangeKey | null) => void
  /** Promote one band's distance from the price over the window return. */
  compareTo?: string
  /**
   * The window to open on, and a report when the reader changes it.
   *
   * Only a caller that swaps the SYMBOL under this pane needs either — the
   * pair Legs pane, which remounts per leg and would otherwise reset to the
   * default on every switch. Both are optional and every existing caller
   * behaves exactly as before.
   */
  initialRange?: RangeKey | null
  onRangeChange?: (activeRange: RangeKey | null) => void
  /**
   * Draw the price without grading its direction.
   *
   * Passed through untouched. Research sets it because a rise and a fall are
   * the same finding there; Ideas and Pair do not, because the sign is the
   * verdict on their cards. See `PriceContext.gradeDirection`.
   */
  directionNeutral?: boolean
}

export function PricePane({
  symbol, bands = [], markers = [], onExpand, compareTo, initialRange, onRangeChange,
  directionNeutral,
}: PricePaneProps) {
  const { data, isLoading } = useSymbolHistory(symbol)
  const id = priceIdentity(symbol, () => data)

  if (isLoading) {
    return (
      <div
        className="flex h-full min-h-[92px] items-center"
        data-slot="price-loading"
        // Announced rather than merely drawn: a silent skeleton is
        // indistinguishable from an empty pane to anybody not looking at it.
        aria-busy="true"
      >
        <div className="h-24 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    )
  }

  if (!canChart(id)) {
    /**
     * A resolved name with nothing cached says so.
     *
     * Rendering nothing would leave the reader unable to tell this from a card
     * that never carries a chart — which is exactly how the missing-chart
     * reports read. The second sentence is deliberate: it forecloses the
     * question the previous behaviour invited, which was whether the chart
     * shown belonged to some other name.
     */
    return (
      <div className="flex h-full min-h-[92px] flex-col justify-center" data-slot="no-price-history">
        <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-200">
          Price history unavailable
        </p>
        <p className="mt-1 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
          Nothing is cached for {id.symbol ?? symbol}. No other name's chart is shown in its place.
        </p>
      </div>
    )
  }

  return (
    <PriceContext
      // The RESOLVED symbol. `priceIdentity` normalises case and rejects
      // placeholders, and the chart title must name what the series is keyed on.
      symbol={id.symbol}
      series={id.series}
      bands={bands}
      markers={markers}
      compareTo={compareTo}
      initialRange={initialRange ?? undefined}
      onRangeChange={onRangeChange}
      directionNeutral={directionNeutral}
      onExpand={onExpand ? range => onExpand(id.series, range) : undefined}
    />
  )
}
