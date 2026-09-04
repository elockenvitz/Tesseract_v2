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
   * Five overweights and five underweights, and nothing in between.
   *
   * It drew thirty bars, which is every active position a book of this size
   * has -- so the strip was a full distribution, and the tail of it was
   * rounding rather than intent. Twenty anonymous slivers between the two
   * ends carry no decision anybody made and no name a reader can act on.
   *
   * Ten bars leave room to LABEL each one, which is the change that matters:
   * the strip stops being a shape you have to hover to read and becomes a
   * list you can read at a glance and point at for the detail.
   *
   * `rows` arrives sorted by magnitude, so the two ends are its head and its
   * tail -- taken separately, because slicing the head alone gives ten
   * overweights on a long-only book and answers half the question.
   */
  const over = rows.filter(r => r.activePct > 0).slice(0, 5)
  const under = rows.filter(r => r.activePct < 0).slice(0, 5).reverse()
  const shown = [...over, ...under]
  const ceiling = Math.max(...shown.map(r => Math.abs(r.activePct)), 0.1)
  const on = at != null ? shown[at] : null
  const split = over.length

  /** Active share and the counts span the WHOLE book, not the ten drawn. */
  const activeShare = rows.reduce((s, r) => s + Math.abs(r.activePct), 0) / 2
  const overCount = rows.filter(r => r.activePct > 0).length
  const underCount = rows.length - overCount

  return (
    <section data-testid="active-weights">
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
          {overCount} overweight · {underCount} underweight
          <span className="ml-1 text-gray-400">· five each end · click to open</span>
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
        className="relative mt-2 flex h-[116px] w-full items-stretch justify-center gap-[3px]"
        onPointerLeave={() => setAt(null)}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-px -translate-y-1/2 bg-slate-300 dark:bg-white/20"
        />
        {shown.map((r, i) => {
          // 38, not 50: a bar drawn to the full half-height leaves no room
          // for the name that belongs to it, and the labels were clipped off
          // the bottom of the strip.
          const h = (Math.abs(r.activePct) / ceiling) * 38
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
                // Capped and centred. Ten bars across the full width of a
                // 1920 header are 190px slabs, which read as a stacked bar
                // rather than as a distribution of decisions.
                'group relative min-w-0 max-w-[86px] flex-1 cursor-pointer',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
                'focus-visible:outline-blue-600',
                // A visible gap where the sign flips, so the two halves read
                // as two lists rather than one gradient.
                i === split && 'ml-6',
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

              {/*
                Named on the bar. This is the change ten bars buy that thirty
                could not: the strip stops being a shape you must hover to
                read and becomes a list you can read at a glance.
              */}
              <span
                className={clsx(
                  'absolute inset-x-0 truncate font-mono text-[10px] tabular-nums',
                  at === i ? 'text-gray-900 dark:text-gray-100' : 'text-gray-500',
                  up ? 'bottom-[calc(50%+2px)] pb-1' : 'top-[calc(50%+2px)] pt-1',
                )}
                style={up ? { bottom: `calc(50% + ${Math.max(1.5, h)}%)` } : { top: `calc(50% + ${Math.max(1.5, h)}%)` }}
              >
                {r.symbol ?? '—'}
              </span>
            </button>
          )
        })}
      </div>

      {/*
        The axis captions are gone.

        They named the two ends -- "most overweight", "most underweight" --
        for a strip whose bars were anonymous. The bars carry their own names
        now, so the captions restate what the reader can already read, and at
        the right-hand end the last ticker was landing on top of one of them.
      */}
    </section>
  )
}
