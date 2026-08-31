import { useSymbolHistory } from '../../../hooks/mobile/useSymbolHistory'
import { PriceContext } from '../../signals/PriceContext'
import { canChart, priceIdentity } from '../../../lib/signals/price-availability'
import { ideaPerformance, targetGapPct, targetProgress } from '../../../lib/signals/idea-performance'
import type { StanceShape } from '../../../lib/signals/idea-shape'
import { IdeaTargetBar } from './IdeaTargetBar'

/**
 * The one picture an idea earns, fetched for that idea alone.
 *
 * ── Why the component fetches ─────────────────────────────────────────────
 *
 * The same reason `PricePane` does, and its header makes the argument: a
 * per-card fetch is one symbol and 260 rows, comfortably inside the 1,000-row
 * PostgREST cap, and `FeedSlot` keeps about five cards mounted. The batched
 * alternative made whether a card had evidence depend on how far down the feed
 * the reader was standing.
 *
 * There is a second reason here. The numbers this pane states — the gap to the
 * target, the return since the idea — can only be honest if they come from the
 * series actually being drawn. Computing them in the parent, from a different
 * source, is precisely the divergence the data-authority rule forbids. The
 * fetch and the arithmetic have to live together, so they live here.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * Substitute another symbol, extrapolate, or label a window it is not drawing.
 * When the cache does not reach the idea, `ideaPerformance` returns no
 * `sinceIdea` at all — there is no field to render a false delta from — and the
 * caption says "Recent" instead.
 */

interface IdeaVisualPaneProps {
  /** Already resolved to the traded ticker by the caller. */
  symbol: string
  companyName?: string | null
  /** ISO. The anchor every "since" claim is measured from. */
  createdAt: string
  family: 'target' | 'performance'
  stance: StanceShape | null
  targetPrice?: number | null
  timeHorizon?: string | null
  onExpand?: (series: { date: string; close: number }[]) => void
  /**
   * What to show instead of an apology when the performance family cannot draw.
   *
   * The parent cannot know synchronously whether a symbol has cached closes —
   * the fetch lives here — so it declares an idea chart-ELIGIBLE and this
   * resolves it. Without a fallback an old thesis-led idea on an uncached name
   * would get "Price history unavailable" where a typographic composition of
   * its own argument is strictly more useful. That is the "degrade
   * intentionally" rule: the absence of a chart is not the absence of content.
   */
  fallback?: React.ReactNode
}

export function IdeaVisualPane({
  symbol, companyName, createdAt, family, stance, targetPrice, timeHorizon, onExpand, fallback,
}: IdeaVisualPaneProps) {
  const { data, isLoading } = useSymbolHistory(symbol)
  const id = priceIdentity(symbol, () => data)

  if (isLoading) {
    return (
      <div className="flex h-full min-h-[92px] items-center" data-slot="idea-visual-loading" aria-busy="true">
        <div className="h-24 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    )
  }

  const drawable = canChart(id)
  const series = drawable ? id.series : []
  const perf = ideaPerformance(series, createdAt)
  const last = series.length ? series[series.length - 1] : null

  // ── Target family ───────────────────────────────────────────────────────
  if (family === 'target' && targetPrice != null) {
    if (!last) {
      /**
       * A target on a name with nothing cached. Common — only 135 of 912
       * assets carry any history — and a real state rather than a failure.
       *
       * The card's metric already shows the target itself, so this says what
       * is missing rather than repeating what is known. It does NOT fall back
       * to `assets.current_price`: that column has no timestamp anywhere in
       * the schema, so a gap computed from it could not be dated, and an
       * undated comparison is the defect `price-snapshot` exists to prevent.
       */
      return (
        <div className="flex h-full min-h-[92px] flex-col justify-center" data-slot="idea-target-unpriced">
          <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-200">
            No cached price for {symbol}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
            The target stands; the gap against the tape is not shown, because there is no
            dated close to measure it from.
          </p>
        </div>
      )
    }

    const direction = stance?.direction ?? 'increase'
    return (
      <IdeaTargetBar
        symbol={symbol}
        currentPrice={last.close}
        targetPrice={targetPrice}
        // The date is the point of the label. A close is a close, and saying
        // which day's is what stops it reading as a live quote.
        priceLabel={`Close ${last.date.slice(5)}`}
        direction={direction}
        gapPct={targetGapPct(last.close, targetPrice, direction)}
        // Progress needs a price from when the idea was raised, which only an
        // anchored window provides. Null everywhere else, and the bar says so.
        progress={targetProgress(perf.sinceIdea?.fromPrice ?? null, last.close, targetPrice)}
        timeHorizon={timeHorizon}
      />
    )
  }

  // ── Performance family ──────────────────────────────────────────────────
  if (!drawable) {
    if (fallback) return <>{fallback}</>
    return (
      <div className="flex h-full min-h-[92px] flex-col justify-center" data-slot="idea-no-history">
        <p className="text-[14px] font-semibold text-gray-700 dark:text-gray-200">
          Price history unavailable
        </p>
        <p className="mt-1 text-[13px] leading-snug text-gray-500 dark:text-gray-400">
          Nothing is cached for {id.symbol ?? symbol}. No other name&rsquo;s chart is shown in its place.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[92px] flex-col" data-slot="idea-performance" data-anchored={perf.anchored}>
      <div className="flex items-baseline justify-between px-0.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {/* The caption states the window it is ACTUALLY drawing. When the
              cache could not reach the idea this reads "Recent", not "Since
              this idea" — see `ideaPerformance`. */}
          {perf.windowLabel}
        </span>
        {perf.sinceIdea && (
          <span
            data-since-idea
            className={`text-[13px] font-bold tabular-nums ${
              perf.sinceIdea.changePct >= 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {perf.sinceIdea.changePct >= 0 ? '+' : '−'}
            {Math.abs(perf.sinceIdea.changePct).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1">
        <PriceContext
          symbol={symbol}
          // The same points the percentage above was computed from. Passing
          // the full series here while quoting a windowed delta is the exact
          // divergence this pane exists to make impossible.
          series={perf.points}
          onExpand={onExpand ? () => onExpand(perf.points) : undefined}
        />
      </div>
      {!perf.anchored && (
        <p className="px-0.5 pt-1 text-[11px] leading-snug text-gray-400">
          Cached prices do not reach back to when this idea was raised.
        </p>
      )}
      {companyName && <span className="sr-only">{companyName}</span>}
    </div>
  )
}
