import { useCallback, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  axisDateLabel, axisTickIndices, calendarDaysBetween, changePct, firstCrossing,
  periodLabel, priceScale, type ClosePoint,
} from '../../lib/signals/price-chart'

/**
 * The desktop feed's price preview.
 *
 * ── Why not `Sparkline` ───────────────────────────────────────────────────
 *
 * `Sparkline` is a `<path>` with no state, no effects and `pointer-events-none`,
 * and its header explains why: twenty of them in a scrolling mosaic would be
 * twenty pointer-capture regions competing with the drag the reader is using
 * to scroll past. That reasoning is correct and it is not reversed here —
 * `Sparkline` is untouched and every existing caller keeps it.
 *
 * A desktop feed is a different surface. It has a pointer rather than a thumb,
 * a 700px column rather than a tile, and no gesture competing for the
 * horizontal axis. So this is a second, desktop-only regime over the same
 * batched data, not a second charting system: one component, no library, no
 * new market-data path.
 *
 * ── What it may say, and what it may not ──────────────────────────────────
 *
 * The source is `price_history_cache`: daily CLOSES, and nothing else. No open,
 * no intraday extremes, no volume. So there are no candles, no range bars and
 * no volume pane here, and the two extremes it does mark are extremes of
 * closes. Everything drawn is either a close or arithmetic over closes and a
 * reference the builder declared — see `lib/signals/price-chart.ts`, where all
 * of that arithmetic lives so it can be asserted.
 *
 * ── Generic by construction ───────────────────────────────────────────────
 *
 * It takes points and an optional reference. It does not know what a target hit
 * is, or a stale target, or a trade idea, and it must not learn: a card with a
 * reference gets the reference line, the distance readout and — if the window
 * contains one — the crossing marker, and a card without one simply gets none
 * of those. The family differences fall out of the data.
 *
 * ── Why the readout is HTML and the plot is SVG ───────────────────────────
 *
 * The path is drawn in a normalised `viewBox` with `preserveAspectRatio="none"`
 * so it fills whatever width the column gives it. That stretch would distort
 * text and squash a dot into an ellipse, so every label and marker is HTML
 * positioned over the SVG.
 *
 * ── Cost ──────────────────────────────────────────────────────────────────
 *
 * No state until the pointer is inside. The cursor index is `null` on mount
 * and returns to `null` on leave, so a screen of these renders as static paths
 * and only the chart under the pointer re-renders. Nothing subscribes, nothing
 * measures on scroll, there is no observer per card, and the arithmetic is two
 * linear passes over ~60 points.
 */

const W = 100
const H = 100

export function FeedPriceChart({
  series, reference, referenceLabel = 'Target', className,
}: {
  series: ClosePoint[]
  /** A declared reference level. Joins the scale when it can; edge-marked when it cannot. */
  reference?: number | null
  referenceLabel?: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)

  const clean = series.filter(p => Number.isFinite(p.close) && p.close > 0)
  const ref = reference != null && Number.isFinite(reference) && reference > 0 ? reference : null

  const onMove = useCallback((clientX: number) => {
    const el = hostRef.current
    if (!el || clean.length < 2) return
    const r = el.getBoundingClientRect()
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    setCursor(Math.round(t * (clean.length - 1)))
  }, [clean.length])

  if (clean.length < 2) return null

  const closes = clean.map(p => p.close)
  const scale = priceScale(closes, ref)
  const span = scale.hi - scale.lo || 1

  const x = (i: number) => (i / (clean.length - 1)) * W
  const y = (v: number) => H - ((v - scale.lo) / span) * H
  const topPct = (v: number) => (y(v) / H) * 100

  const path = clean.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.close).toFixed(2)}`).join(' ')
  const area = `${path} L${W},${H} L0,${H} Z`

  const first = clean[0]
  const last = clean[clean.length - 1]
  const up = last.close >= first.close
  const period = periodLabel(first.date, last.date)
  const periodPct = changePct(first.close, last.close)
  const spanDays = calendarDaysBetween(first.date, last.date)

  const crossing = firstCrossing(clean, ref)
  const active = cursor != null ? clean[cursor] : null
  const shown = active ?? last

  /*
   * Two quantities, never blended.
   *
   * `periodPct` is what the security did over the drawn window. `vsRef` is how
   * far the shown price sits from a level somebody declared. They answer
   * different questions and have been confused in this product before, so they
   * carry different labels and never share one.
   */
  const vsRef = ref != null ? changePct(ref, shown.close) : null
  const fromStart = active ? changePct(first.close, active.close) : null

  const gid = `fpc-${up ? 'u' : 'd'}-${clean.length}-${Math.round(scale.lo)}-${Math.round(scale.hi)}`
  const money = (v: number) => `$${v < 10 ? v.toFixed(2) : v.toFixed(v < 1000 ? 2 : 0)}`
  const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

  const ticks = axisTickIndices(clean.length)

  return (
    <div className={clsx('relative', className)}>
      {/*
        One row, two states, one height.

        Idle it reads the last close and what the window did; under the pointer
        it reads the inspected close and what that point did. Same slots either
        way — a readout that appears on hover would move the plot under the
        pointer that summoned it, which is the defect this shape avoids. It is
        also why there is no floating tooltip over the line.
      */}
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[11px] leading-none">
        <span className="flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-[15px] font-semibold tabular-nums leading-none text-gray-900 dark:text-white">
            {money(shown.close)}
          </span>
          <span className="text-gray-400 dark:text-gray-500">
            {/* The year stays here even on a short window: this is the one date
                a reader might quote, and "Feb 28" alone is not quotable. */}
            {new Date(shown.date).toLocaleDateString('en-US', {
              month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC',
            })}
          </span>
        </span>
        <span className="flex items-baseline gap-2.5 whitespace-nowrap">
          {active && fromStart != null ? (
            <Stat label="from start" value={signed(fromStart)} tone={fromStart >= 0 ? 'up' : 'down'} />
          ) : periodPct != null ? (
            <Stat label={period} value={signed(periodPct)} tone={periodPct >= 0 ? 'up' : 'down'} />
          ) : null}
          {ref != null && (
            <>
              <Stat label={referenceLabel.toLowerCase()} value={money(ref)} tone="ref" />
              {vsRef != null && (
                <Stat label={`vs ${referenceLabel.toLowerCase()}`} value={signed(vsRef)} tone={vsRef >= 0 ? 'up' : 'down'} />
              )}
            </>
          )}
        </span>
      </div>

      <div
        ref={hostRef}
        className="feed-chart-plot relative h-32 w-full cursor-crosshair"
        /* Inspection only. The tile's click guard sees a focusable descendant
           with a button-ish role and leaves selection alone; this also stops a
           stray click here reaching the tile. */
        role="img"
        aria-label={[
          `${period} price, ${money(first.close)} to ${money(last.close)}`,
          `high close ${money(scale.high)}, low close ${money(scale.low)}`,
          ref != null ? `${referenceLabel.toLowerCase()} ${money(ref)}` : '',
          crossing ? `${referenceLabel.toLowerCase()} crossed ${axisDateLabel(crossing.date, spanDays)}` : '',
        ].filter(Boolean).join('; ')}
        tabIndex={0}
        onPointerMove={e => onMove(e.clientX)}
        onPointerLeave={() => setCursor(null)}
        onClick={e => e.stopPropagation()}
        onKeyDown={e => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault()
          setCursor(c => {
            const base = c ?? clean.length - 1
            return Math.min(clean.length - 1, Math.max(0, base + (e.key === 'ArrowRight' ? 1 : -1)))
          })
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
          <defs>
            <linearGradient id={gid} className={up ? 'text-emerald-500' : 'text-rose-500'} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.22" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/*
            Two guides, at the highest and lowest CLOSE of the window.

            A scale needs a number on it or the shape means nothing, and these
            two are the only levels on this axis that are facts about the
            security rather than round numbers chosen to look tidy. They double
            as the period extremes, which is why there are no separate high/low
            labels crowding the plot.
          */}
          {[scale.high, scale.low].map(v => (
            <line
              key={v} x1="0" x2={W} y1={y(v)} y2={y(v)}
              className="text-gray-200 dark:text-gray-700"
              stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke"
            />
          ))}

          <path d={area} fill={`url(#${gid})`} />

          {ref != null && scale.referenceInScale && (
            <line
              x1="0" x2={W} y1={y(ref)} y2={y(ref)}
              className="text-amber-500"
              stroke="currentColor" strokeWidth="1" strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {crossing && (
            <line
              x1={x(crossing.index)} x2={x(crossing.index)} y1="0" y2={H}
              className="text-amber-400"
              stroke="currentColor" strokeWidth="1" strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
            className={up ? 'text-emerald-500' : 'text-rose-500'}
          />

          {active && (
            <line
              x1={x(cursor!)} x2={x(cursor!)} y1="0" y2={H}
              className="text-gray-400"
              stroke="currentColor" strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Scale labels sit on their guides, right-aligned so they never cross
            the line they belong to. */}
        <Level topPct={topPct(scale.high)} text={money(scale.high)} />
        <Level topPct={topPct(scale.low)} text={money(scale.low)} />

        {/*
          The reference when it does NOT share the scale.

          A target far outside the window is exactly the condition a stale-target
          card is reporting, and pulling it into the domain flattened the price
          into a line — the card destroying its own evidence. So it is pinned to
          the edge it lies beyond and carries its real distance, which says more
          than a line at the frame's edge would.
        */}
        {ref != null && !scale.referenceInScale && (
          <span
            className={clsx(
              'absolute right-0 z-10 rounded-sm bg-amber-50 px-1 py-px text-[10px] font-semibold leading-none text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900',
              scale.referenceSide === 'above' ? 'top-0' : 'bottom-0',
            )}
          >
            {scale.referenceSide === 'above' ? '↑' : '↓'} {referenceLabel} {money(ref)}
          </span>
        )}

        {/* Dots are HTML so they stay round under the horizontal stretch that
            `preserveAspectRatio="none"` applies to everything in the SVG. */}
        {/* One dot: where the price is now. The extremes are already two
            labelled guides, and marking them again put a grey dot under the
            current-price dot every time the window ended on its own high. */}
        <Dot leftPct={100} topPct={topPct(last.close)} tone={up ? 'up' : 'down'} />
        {crossing && (
          <>
            <Dot leftPct={(x(crossing.index) / W) * 100} topPct={topPct(clean[crossing.index].close)} tone="cross" />
            <span
              /* At the top of its own hairline, not floating beside the point.
                 Beside the point it sat on the price line — the crossing is
                 where the line meets the reference, so the two are guaranteed
                 to be in the same place. The hairline already says which x. */
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium leading-none text-amber-600 dark:text-amber-400"
              style={{ left: `${clampPct((x(crossing.index) / W) * 100)}%` }}
            >
              crossed {axisDateLabel(crossing.date, spanDays)}
            </span>
          </>
        )}
        {active && (
          <Dot leftPct={(x(cursor!) / W) * 100} topPct={topPct(active.close)} tone="cursor" />
        )}
      </div>

      {/* When the movement happened. Ends anchored to the ends of the box so
          neither label hangs off it; the middles centre on their own close. */}
      <div className="relative mt-1 h-3 text-[10px] leading-none text-gray-400 dark:text-gray-500">
        {ticks.map((i, n) => (
          <span
            key={i}
            className="absolute whitespace-nowrap tabular-nums"
            style={
              n === 0 ? { left: 0 }
                : n === ticks.length - 1 ? { right: 0 }
                  : { left: `${(x(i) / W) * 100}%`, transform: 'translateX(-50%)' }
            }
          >
            {axisDateLabel(clean[i].date, spanDays)}
          </span>
        ))}
      </div>
    </div>
  )
}

/** A labelled number in the readout row. Label below value weight, never above. */
function Stat({ label, value, tone }: { label: string; value: string; tone: 'up' | 'down' | 'ref' }) {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-gray-400 dark:text-gray-500">{label}</span>
      <span className={clsx(
        'font-semibold tabular-nums',
        tone === 'ref' ? 'text-gray-700 dark:text-gray-200'
          : tone === 'up' ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400',
      )}>{value}</span>
    </span>
  )
}

function Level({ topPct, text }: { topPct: number; text: string }) {
  return (
    <span
      aria-hidden
      style={{ top: `${topPct}%` }}
      /* Left edge, not right. The right edge is where the current price sits —
         its dot, and the off-scale reference chip — and a window that ends on
         its own high put all three on the same pixel. */
      className="pointer-events-none absolute left-0 -translate-y-1/2 bg-white/80 px-0.5 text-[10px] leading-none text-gray-400 tabular-nums dark:bg-gray-800/80 dark:text-gray-500"
    >
      {text}
    </span>
  )
}

function Dot({ leftPct, topPct, tone }: { leftPct: number; topPct: number; tone: 'up' | 'down' | 'cursor' | 'cross' | 'extreme' }) {
  return (
    <span
      aria-hidden
      style={{ left: `${leftPct}%`, top: `${topPct}%` }}
      className={clsx(
        'pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full',
        tone === 'extreme'
          ? 'h-1.5 w-1.5 bg-gray-300 dark:bg-gray-600'
          : 'h-2 w-2 ring-2 ring-white dark:ring-gray-800',
        tone === 'cursor' ? 'bg-gray-900 dark:bg-white'
          : tone === 'cross' ? 'bg-amber-500'
            : tone === 'up' ? 'bg-emerald-500'
              : tone === 'down' ? 'bg-rose-500' : '',
      )}
    />
  )
}

/** Keeps a centred label from hanging off either end of the plot. */
function clampPct(v: number) {
  return Math.min(92, Math.max(8, v))
}
