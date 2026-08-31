import { useEffect } from 'react'
import { X } from 'lucide-react'

import { PriceContext, type PriceBand, type PriceMarker, type PricePoint, type RangeKey } from './PriceContext'

/**
 * The expanded chart. One shell, whatever card opened it.
 *
 * ── Why an overlay and not the asset page ─────────────────────────────────
 *
 * "Do not jump from Level 2 to Level 3 for interactions that can reasonably
 * happen in place." Wanting a bigger chart is not a decision to leave the feed;
 * routing to the asset page loses the card, the scroll position, and whatever
 * the reader was part-way through on it. An overlay keeps all three, and
 * closing puts them back exactly.
 *
 * ── Why the overlays are parameters rather than variants ──────────────────
 *
 * A target card wants its recorded level drawn; a scenario card wants bear,
 * base and bull; a no-target card wants the price it is proposing; a news card
 * wants the event date. Those are four sets of BANDS AND MARKERS, not four
 * charts — `PriceContext` already draws both, and it already knows how to pin
 * a level that sits far outside the price action rather than flattening the
 * line to accommodate it.
 *
 * So there is exactly one fullscreen chart, and cards differ only in what they
 * hand it. A second implementation would drift on the details that matter
 * most: off-scale handling, the stale-data warning, and the refusal to label
 * the right edge "today".
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * It takes a series or it renders nothing worth looking at. There is no symbol
 * fallback and no way to reach one from here — the caller resolves
 * availability through `price-availability` and simply does not offer the
 * expand control when there is no tape. See `news-chart` for what happens when
 * a chart is allowed to pick its own subject.
 */

export interface FullscreenChartProps {
  open: boolean
  onClose: () => void
  symbol: string
  companyName?: string | null
  series: PricePoint[]
  /** Recorded target, scenario levels, a proposal being explored. */
  bands?: PriceBand[]
  /** Event dates, horizons. */
  markers?: PriceMarker[]
  /**
   * The window the reader was already looking at, carried in from the card.
   *
   * Absent means nobody chose one, and `PriceContext` applies its own default
   * exactly as before — which is what keeps this additive for every caller
   * that has not been taught to pass it.
   */
  initialRange?: RangeKey | null
}

export function FullscreenChart({
  open, onClose, symbol, companyName, series, bands = [], markers = [], initialRange,
}: FullscreenChartProps) {
  /**
   * Escape closes, and the page behind does not scroll.
   *
   * The feed is a snap scroller; leaving it live under a full-screen overlay
   * means a scroll gesture that misses the chart moves the card the reader is
   * about to come back to.
   */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      data-slot="fullscreen-chart"
      role="dialog"
      aria-modal="true"
      aria-label={`${symbol} price history`}
      className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-950"
    >
      <div className="flex shrink-0 items-start justify-between px-4 pt-3">
        <div className="min-w-0">
          <p data-slot="fs-symbol" className="text-[20px] font-bold leading-tight text-gray-900 dark:text-white">
            {symbol}
          </p>
          {/* Only when we have it. 506 of 912 assets carry placeholder
              metadata, and an empty line is better than "Unknown". */}
          {companyName && (
            <p data-slot="fs-name" className="truncate text-[13px] text-gray-500 dark:text-gray-400">
              {companyName}
            </p>
          )}
        </div>
        <button
          type="button"
          data-slot="fs-close"
          aria-label="Close"
          onClick={onClose}
          className="-mr-1 rounded-full p-2 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* The chart takes everything left.
          `PriceContext` carries its own read-out (symbol, inspected price,
          change) and its own range chips, and it measures ranges from the
          SERIES END rather than from today — so a symbol whose ingestion has
          stalled shows a clearly labelled stale window instead of an empty
          one. All of that is why this is a shell rather than a second chart. */}
      <div className="min-h-0 flex-1 px-4 pb-6 pt-2">
        <PriceContext
          symbol={symbol}
          series={series}
          bands={bands}
          markers={markers}
          /* The card's window, where it had one. `undefined` rather than
             `null` so `PriceContext` takes its own default path unchanged. */
          initialRange={initialRange ?? undefined}
        />
      </div>
    </div>
  )
}
