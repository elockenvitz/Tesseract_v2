/**
 * The book against the index it is measured by.
 *
 * ── The question this answers ────────────────────────────────────────────
 *
 * "How are we doing against the benchmark, and what is driving it" is the
 * first thing anybody asks about a fund, and this lens could not say anything
 * about it. It listed positions by weight, which is a fact about the book and
 * not about the decision: owning 5.8% of Microsoft is a big position and a
 * small bet, and the page drew the 5.8 and hid the bet.
 *
 * ── What it deliberately does NOT claim ──────────────────────────────────
 *
 * Not "the fund returned 4.2% against the benchmark's 3.1%". There is no
 * index level anywhere in this schema -- `portfolio_benchmark_weights` holds
 * weights, not a return series -- so a performance line would require
 * inventing one of those two numbers. A chart that looks like attribution and
 * is actually a guess is worse than no chart, and this is a tool people size
 * positions with.
 *
 * What IS exact: the active weights. A weight the book holds that the index
 * does not is a decision somebody made, and its size is the size of that
 * decision. Both halves are drawn -- what we own more of, and what we own
 * less of -- because a manager who owns none of the largest constituent has
 * taken a position on it exactly as much as one who doubled it.
 *
 * ── Interactive, and a way in ────────────────────────────────────────────
 *
 * Pointing at a bar names it and states both weights; clicking one opens that
 * position. The strip is the index of the book's decisions, so it should be
 * the fastest route to any of them.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import type { ActiveWeight } from '../../hooks/useDesktopPortfolio'

export function ActiveWeights({
  rows, onOpen,
}: {
  rows: ActiveWeight[]
  /** Open a name. Inspection never calls it -- pointing is not navigating. */
  onOpen: (assetId: string) => void
}) {
  const [at, setAt] = useState<number | null>(null)
  if (rows.length < 4) return null

  /*
   * The biggest decisions, either way, then laid out signed.
   *
   * `rows` arrives sorted by MAGNITUDE, which is the right way to choose
   * which twenty matter -- but drawing them in that order interleaves the
   * overweights and underweights, and the axis is labelled "most overweight"
   * on the left and "most underweight" on the right. The picture contradicted
   * its own labels. Selecting by magnitude and ordering by sign gives the
   * butterfly the labels promise: the book's convictions falling away to the
   * left of centre, the names it refuses rising to the right.
   *
   * Beyond about thirty the bars stop being separable and the tail is
   * rounding rather than intent.
   */
  const shown = rows.slice(0, 30).sort((a, b) => b.activePct - a.activePct)
  const ceiling = Math.max(...shown.map(r => Math.abs(r.activePct)), 0.1)
  const on = at != null ? shown[at] : null

  /** Active share over the whole book, not just the bars drawn. */
  const activeShare = rows.reduce((s, r) => s + Math.abs(r.activePct), 0) / 2
  const over = rows.filter(r => r.activePct > 0).length
  const under = rows.length - over

  return (
    <section data-testid="active-weights" className="mt-5">
      {/*
        A fixed row, so pointing at a bar cannot move the chart.

        The readout shared a `flex-wrap` row with the heading and the counts.
        Empty it took no width; filled it took about 300px, which pushed the
        line over its wrap point and grew the header by a line -- so the plot
        underneath jumped down the moment the pointer touched it, and jumped
        back when it left. Inspecting a chart must never move the chart.

        One line, `nowrap`, and the readout reserves its own space whether or
        not it has anything to say. Same rule the Ideas readouts follow.
      */}
      <div className="flex h-[18px] items-baseline gap-x-3 overflow-hidden whitespace-nowrap">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
          Against the benchmark
        </h2>
        <span className="font-mono text-[11px] tabular-nums text-gray-500">
          {activeShare.toFixed(1)}% active share
        </span>
        <span className="text-[11px] text-gray-500">
          {over} overweight · {under} underweight
        </span>

        {/*
          One line, one height, whether or not a bar is under the pointer --
          the same rule the Ideas readouts follow, so inspecting the strip
          never moves the page beneath it.
        */}
        <span
          data-testid="active-readout"
          className="ml-auto min-w-0 truncate font-mono text-[11px] tabular-nums text-gray-900 dark:text-gray-100"
        >
          {on && (
            <>
              <span className="font-semibold">{on.symbol ?? 'Not held'}</span>
              <span className="ml-2 font-sans text-gray-500">
                {on.weightPct.toFixed(2)}% held vs {on.benchPct.toFixed(2)}% index
                {' · '}
                <span className={on.activePct >= 0
                  ? 'text-gray-900 dark:text-gray-100'
                  : 'text-gray-600 dark:text-gray-400'}>
                  {on.activePct >= 0 ? '+' : ''}{on.activePct.toFixed(2)}% active
                </span>
              </span>
            </>
          )}
        </span>
      </div>

      {/*
        Zero is a line through the middle, not the floor.

        An underweight is a decision, not an absence, so it is drawn below the
        axis at its real size rather than omitted or flipped to look positive.
      */}
      {/*
        The zero line lives INSIDE the plot and takes no pointer events.

        It was a sibling positioned with a negative offset so it would ride up
        over the bars, and it did exactly that -- including over their pointer
        events. Every bar was unhoverable and unclickable, and the strip
        looked interactive while being inert. Same defect as the Ideas resting
        layer, which was `opacity-0` and still swallowing the pointer.
      */}
      <div
        className="relative mt-2 flex h-[86px] w-full items-stretch gap-px"
        onPointerLeave={() => setAt(null)}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-px -translate-y-1/2 bg-slate-300 dark:bg-white/20"
        />
        {shown.map((r, i) => {
          const h = (Math.abs(r.activePct) / ceiling) * 50
          const up = r.activePct >= 0
          return (
            <button
              key={r.assetId}
              type="button"
              data-testid={`active-bar-${r.symbol ?? r.assetId}`}
              aria-label={`${r.symbol ?? 'unheld name'}, ${r.activePct.toFixed(2)} percent active`}
              onPointerEnter={() => setAt(i)}
              onFocus={() => setAt(i)}
              onBlur={() => setAt(null)}
              onClick={() => onOpen(r.assetId)}
              className={clsx(
                // Capped so a small book does not draw twenty blocks. The
                // strip is a distribution, and a distribution of blocks is a
                // bar chart of nothing.
                'group relative min-w-0 max-w-[64px] flex-1 cursor-pointer',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
                'focus-visible:outline-blue-600',
              )}
            >
              <span
                className={clsx(
                  'absolute left-0 right-0',
                  at === i
                    ? 'bg-slate-900 dark:bg-white'
                    : up
                      ? 'bg-slate-500/80 dark:bg-slate-300/80'
                      : 'bg-slate-300 dark:bg-white/25',
                )}
                style={up
                  ? { bottom: '50%', height: `${Math.max(1.5, h)}%` }
                  : { top: '50%', height: `${Math.max(1.5, h)}%` }}
              />
            </button>
          )
        })}
      </div>

      <div>
        <div className="flex items-baseline justify-between pt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
          <span>Most overweight</span>
          <span className="font-mono tracking-normal normal-case text-gray-400">
            click a bar to open the position
          </span>
          <span>Most underweight</span>
        </div>
      </div>
    </section>
  )
}
