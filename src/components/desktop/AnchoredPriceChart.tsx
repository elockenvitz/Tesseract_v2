/**
 * The price path, anchored at a date, drawn once for the whole product.
 *
 * ── Why this is a shared component and not a lens's helper ───────────────
 *
 * This plot was written inside `research-v2/ResearchVisual` as
 * `PriceSinceReview`, and its own header records what it replaced: a fixed
 * 340-unit viewBox with `preserveAspectRatio="none"` rendered 548px wide, a
 * 1.61x horizontal smear that turned the end-of-series dot into an ellipse
 * and stretched the anchor rule's dashes 1.61x longer than every other dash
 * on the page. It was 88px tall where Today's was 166, and it offered nothing
 * a reader could interrogate: no scale, no gridlines, nothing to point at.
 *
 * That fix reached Research and Today. It never reached Decisions, which kept
 * its own copy of the broken drawing -- measured on the live detail pane at
 * 636px into the same 340-unit box, a 1.87x smear, 92px tall. Four lenses
 * cannot each own a price chart and stay the same product; the slicing rule
 * had already been moved to `lib/market-data/anchored-window` for exactly
 * this reason, and the drawing follows it here.
 *
 * ── What the caller still decides ────────────────────────────────────────
 *
 * The words (what the anchor is called, what the window means) and the INK.
 * Research and Today grade the line by direction, because every tool their
 * readers use outside this product does and the chart makes no claim about
 * whether the move was good. The Decisions detail pane does NOT: there the
 * line sits beside the decision's own words, and a red path under a stated
 * rationale reads as a verdict on the call. `ink="neutral"` is that case, and
 * `convergence.test.ts` holds it there.
 */

import { useId, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { useWidth } from '../../lib/charts/use-width'
import { indexAtClientX } from '../../lib/charts/scrub'
import { LABEL } from './DesktopModule'
import type { AnchoredWindow } from '../../lib/market-data/anchored-window'

/*
 * ── The chart's chrome is on the page's scale; its plot is not ────────────
 *
 * MEASURED in the asset workspace: eleven elements below the 11px floor and
 * four off-scale sizes, all of them this file's. The chrome -- caption,
 * meta, the price readout, the change chip, the scrub hint, the note, the
 * y-gutter ticks and the x-axis dates -- is page type and now reads as page
 * type: the caption takes `LABEL` rather than restating it, the readout
 * takes the figure step (it was 22px, which belonged to no role), and
 * everything that was 10px is at the floor.
 *
 * The one deliberate exception is the anchor marker's `<text>` INSIDE the
 * plot, at 9px. It is positioned in SVG user units against the series it
 * labels and sits 4px from a dashed rule; its size is a fit constraint, not
 * a reading one, and enlarging it would have it overlap the path. A gate
 * that forbade it would be forbidding the right thing.
 */

/** A second dated event inside the window, as a fraction of its span. */
export interface WindowMark {
  /** 0–1 across the window. */
  at: number
  label: string
}

export function AnchoredPriceChart({
  w, height = 166, caption, meta, anchorTick, note, ink = 'direction',
  marks, testId, readoutTestId,
}: {
  w: AnchoredWindow
  height?: number
  /** The eyebrow. The caller decides what an unreached anchor is called. */
  caption: string
  /** The window note, right-aligned beside the eyebrow. */
  meta: string
  /** What the anchor is called in prose: 'decided', 'since update'. */
  anchorTick: string
  /** One sentence under the plot, when the caller has one to add. */
  note?: React.ReactNode
  /**
   * `direction` grades the line emerald/rose by sign. `neutral` draws one ink
   * either way -- the rule for anything that could be read as a verdict.
   */
  ink?: 'direction' | 'neutral'
  marks?: WindowMark[]
  testId?: string
  readoutTestId?: string
}) {
  const H = height
  const [box, boxW] = useWidth<HTMLDivElement>(320)
  const W = Math.max(1, Math.round(boxW))

  const PAD = 12
  const min = Math.min(...w.series)
  const max = Math.max(...w.series)
  const span = (max - min) || 1
  const x = (i: number) => (i * (W - 1)) / Math.max(1, w.series.length - 1)
  const y = (v: number) => PAD + (H - PAD * 2) * (1 - (v - min) / span)
  const d = w.series.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' L')

  const gid = `apc-${useId().replace(/:/g, '')}`
  const up = w.changePct >= 0
  const first = w.series[0]

  /* The levels a reader asks for, in a gutter beside the plot rather than
     floating on it -- a label on the plot collides with the end of a rising
     series, which is exactly where the eye already is. */
  const gutter = 44
  const ticks: { v: number; tag: string }[] = []
  for (const t of [{ v: max, tag: 'H' }, { v: first, tag: 'open' }, { v: min, tag: 'L' }]) {
    if (ticks.some(u => Math.abs(y(u.v) - y(t.v)) < 11)) continue
    ticks.push(t)
  }

  const plot = useRef<SVGSVGElement | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const at = picked != null ? w.series[picked] : null
  const deltaAt = at != null && first > 0 ? ((at - first) / first) * 100 : null

  const graded = ink === 'direction'
  const lineInk = !graded
    ? 'text-slate-500 dark:text-slate-400'
    : up
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400'

  const last = w.series[w.series.length - 1]
  const shownPrice = at ?? last
  const shownPct = deltaAt ?? w.changePct
  const day = (iso: string) => {
    const t = Date.parse(iso)
    return Number.isFinite(t)
      ? new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : iso
  }

  return (
    <div data-testid={testId}>
      <div className="mb-1 flex items-baseline gap-2">
        <span className={LABEL}>
          {caption}
        </span>
        <span className="ml-auto font-mono text-[11px] text-gray-500">{meta}</span>
      </div>

      {/* One line, one height, hovered or not: a plot that grows a row on
          hover moves everything below it. */}
      <div data-testid={readoutTestId} className="mb-2 flex items-baseline gap-2">
        <span className="font-mono text-[20px] font-semibold leading-none tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
          {shownPrice.toFixed(2)}
        </span>
        {/* The sign is a fact and stays in both modes. The HUE is the
            judgement, so a neutral chart's chip carries none. */}
        <span className={clsx(
          'rounded px-1.5 py-[2px] font-mono text-[13px] font-semibold tabular-nums',
          !graded
            ? 'bg-gray-100 text-gray-800 dark:bg-white/10 dark:text-gray-200'
            : shownPct >= 0
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
              : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400',
        )}>
          {shownPct >= 0 ? '+' : ''}{shownPct.toFixed(1)}%
        </span>
        {/* Only where the window IS anchored. Measured on the Decisions pane
            the moment this chart landed there: the caption read "Price over
            available history" -- the honest refusal -- and this line, two
            inches left of it, read "from decided". The axis already made the
            distinction; the readout was asserting what the caption denied.

            While the reader is scrubbing it names the DAY instead, because a
            price that moves under the pointer with no date attached is a
            number the reader cannot place. The date is the one off
            `w.dates`, never derived from the index: these are trading days
            and the spacing is uneven. */}
        <span data-chart-readout-when className="truncate text-[11px] text-gray-500">
          {picked != null && w.dates[picked]
            ? day(w.dates[picked])
            : w.reachesAnchor ? `from ${anchorTick}` : 'over the window shown'}
        </span>
        {/* The affordance, which the chart had none of.
            Reported in exactly these terms: "im seeing some charts that are
            not interactive like in a research tile". It WAS interactive --
            it has scrubbed on hover since it landed -- but the only sign was
            a crosshair cursor, which a reader sees after they are already
            over the line and never when deciding whether to try. The rail's
            charts carry a visible `5D 1M 3M ALL` and so read as controls.

            A range selector would be the wrong answer here: this window is
            anchored at a review and changing it would destroy the claim the
            chart is making. So the hint says what this chart actually does,
            and it goes quiet once the reader is doing it. */}
        {picked == null && (
          <span data-chart-scrub-hint className="ml-auto shrink-0 text-[11px] text-gray-400 dark:text-gray-500">
            Hover for any day
          </span>
        )}
      </div>

      <div className="relative flex items-start gap-2">
        <div ref={box} className="min-w-0 flex-1">
          <svg
            ref={plot}
            viewBox={`0 0 ${W} ${H}`}
            width={W}
            height={H}
            className={clsx('block w-full cursor-crosshair', lineInk)}
            style={{ height: H }}
            role="img"
            aria-label={`Price, ${w.changePct.toFixed(1)} percent`}
            onPointerMove={e => {
              if (e.pointerType !== 'mouse' || !plot.current) return
              setPicked(indexAtClientX(e.clientX, plot.current.getBoundingClientRect(), w.series.length))
            }}
            onPointerLeave={() => setPicked(null)}
          >
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity={0.22} />
                <stop offset="100%" stopColor="currentColor" stopOpacity={0.02} />
              </linearGradient>
            </defs>

            {/* Half-pixel centres: a 1px rule lands ON a device pixel instead
                of straddling two and rendering as a 2px smudge. */}
            {[0.25, 0.5, 0.75].map(f => (
              <line
                key={f} x1="0" x2={W} y1={Math.round(H * f) + 0.5} y2={Math.round(H * f) + 0.5}
                strokeWidth="1" className="stroke-gray-200/70 dark:stroke-white/[0.07]"
              />
            ))}

            {/* The level the window STARTED at. Everything above this line is
                gain since the anchor, everything below is give-back -- which
                is the question this chart exists to answer. */}
            <line
              x1={0} x2={W} y1={Math.round(y(first)) + 0.5} y2={Math.round(y(first)) + 0.5}
              strokeWidth={1} strokeDasharray="3 3"
              className="stroke-slate-400/80 dark:stroke-slate-500/80"
            />

            <path d={`M${d} L${W},${H} L0,${H} Z`} fill={`url(#${gid})`} />
            <path d={`M${d}`} fill="none" stroke="currentColor" strokeWidth={2}
                  strokeLinejoin="round" strokeLinecap="round" />

            {w.reachesAnchor && (
              <line x1={0.5} y1={0} x2={0.5} y2={H} strokeWidth={1} strokeDasharray="3 3"
                    className="stroke-gray-400 dark:stroke-gray-600" />
            )}

            {/* A second dated event inside the window. Drawn in the one colour
                that is not the line's, because it is a different kind of fact
                from the price -- and never at the anchor itself, which the
                caller is responsible for keeping it clear of. */}
            {(marks ?? []).map(m => (
              <g key={m.label}>
                <line
                  x1={Math.round(m.at * W) + 0.5} y1={0}
                  x2={Math.round(m.at * W) + 0.5} y2={H}
                  strokeWidth={1} strokeDasharray="1 3" className="stroke-blue-500"
                />
                <text
                  x={m.at * W + 4} y={11}
                  className="fill-blue-600 text-[9px] dark:fill-blue-400"
                  style={{ letterSpacing: '.04em' }}
                >
                  {m.label}
                </text>
              </g>
            ))}

            {picked != null && at != null && (
              <>
                <line
                  x1={Math.round(x(picked)) + 0.5} y1={0} x2={Math.round(x(picked)) + 0.5} y2={H}
                  strokeWidth={1} className="stroke-gray-400 dark:stroke-gray-500"
                />
                <circle cx={x(picked)} cy={y(at)} r={5} className="fill-white dark:fill-[#141a25]" />
                <circle cx={x(picked)} cy={y(at)} r={3.5} fill="currentColor" />
              </>
            )}
            <circle cx={W - 3.5} cy={y(w.series[w.series.length - 1])} r={3.5} fill="currentColor" />
          </svg>
        </div>

        <div className="relative shrink-0" style={{ height: H, width: gutter }} aria-hidden>
          {ticks.map(t => (
            <div
              key={t.tag}
              data-tick={t.tag}
              className={clsx(
                'absolute right-0 -translate-y-1/2 font-mono text-[11px] tabular-nums',
                t.tag === 'open' ? 'text-slate-500 dark:text-slate-400' : 'text-gray-400 dark:text-gray-500',
              )}
              style={{ top: `${Math.min(93, Math.max(7, (y(t.v) / H) * 100))}%` }}
            >
              {t.v.toFixed(2)}
            </div>
          ))}
        </div>
      </div>

      {/*
        A real x-axis, which this chart has never had.

        It drew a dashed rule at the left edge with the anchor's name floating
        beside it and left the reader to guess what span the pixels underneath
        covered. The window's own endpoints are stored -- `from` and `to` are
        ISO dates on the slice this plot IS -- so the axis states them rather
        than implying them.

        Only the two ends, deliberately: the series is trading days, not
        calendar days, so interpolating a date for a hovered x would be a
        figure the data does not support. The gutter beside the plot is
        correspondingly the y-axis; between them the chart now answers "how
        much, and over what" without a caption.
      */}
      <div
        className="mt-1 flex items-baseline justify-between font-mono text-[11px] tabular-nums text-gray-400 dark:text-gray-500"
        style={{ paddingRight: gutter + 8 }}
      >
        <span className={w.reachesAnchor ? 'text-slate-500 dark:text-slate-400' : undefined}>
          {w.reachesAnchor ? `${anchorTick} · ${day(w.from)}` : day(w.from)}
        </span>
        <span>{day(w.to)}</span>
      </div>

      {note && <p className="mt-1 text-[11px] text-gray-500">{note}</p>}
    </div>
  )
}
