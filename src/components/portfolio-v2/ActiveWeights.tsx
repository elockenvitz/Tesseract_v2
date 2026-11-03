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
import type { BenchmarkComparison } from '../../hooks/useDesktopPortfolio'

/**
 * No comparison to draw, said once in the strip's own place.
 *
 * A book with no benchmark file used to get an active share computed against
 * an index of zeros. Now the strip names the absence (or the failed read) and
 * computes nothing -- no active share, no overweight count, no bars.
 */
function NoComparison({ state }: { state: 'none' | 'unavailable' }) {
  return (
    <section data-testid="active-weights" data-benchmark={state}>
      <div className="flex h-[18px] items-baseline gap-x-3 overflow-hidden whitespace-nowrap">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
          Against the benchmark
        </h2>
        <span data-testid="benchmark-absent" className="text-[11px] text-gray-500">
          {state === 'none' ? 'No benchmark on file' : 'Benchmark unavailable'}
        </span>
      </div>
    </section>
  )
}

export function ActiveWeights({
  comparison, onOpen,
}: {
  comparison: BenchmarkComparison
  /** Open a name. Inspection never calls it -- pointing is not navigating. */
  onOpen: (assetId: string) => void
}) {
  const [at, setAt] = useState<number | null>(null)
  if (comparison.state === 'loading') return null
  if (comparison.state !== 'ready') return <NoComparison state={comparison.state} />
  const rows = comparison.rows
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
  const on = at != null ? shown[at] : null
  const split = over.length

  /*
   * Zero sits where the data puts it, not at half height.
   *
   * ── What a fixed middle was costing ──────────────────────────────────────
   *
   * The axis was pinned at 50% and both halves scaled against ONE ceiling --
   * the right call, because a shared scale is the only thing that makes an
   * overweight and an underweight comparable. But a five-position book
   * against a 483-name index has overweights in the tens of percent and
   * underweights that are the index's own rounding: measured live on Large
   * Cap Core, the top bar used all 44px available to it and all five
   * underweights came out at the 1.5% floor, about 2px each.
   *
   * So the lower half of a 116px plot drew nothing, every time, and the
   * strip read as a row of grey slabs hanging off a line with its labels
   * adrift underneath -- reported as "not sized right and not very clean".
   *
   * ── Why not scale the halves separately ──────────────────────────────────
   *
   * Because that is the lie. Give the underweights their own ceiling and a
   * 0.4% underweight draws the same height as a 28% overweight, and the one
   * thing a reader does with this strip -- weigh one bet against another --
   * stops working. The scale stays shared. What moves is the AXIS.
   *
   * Zero goes where the two extremes actually divide the range, so both ends
   * use the height they need and neither reserves height it cannot fill.
   *
   * Clamped, because a label has to fit: at least 28% of the plot stays on
   * each side whatever the data does, which is room for one 10px ticker plus
   * its padding. A book with no underweights at all still gets a readable
   * strip rather than an axis welded to the floor.
   */
  const maxUp = Math.max(...over.map(r => r.activePct), 0)
  const maxDown = Math.max(...under.map(r => Math.abs(r.activePct)), 0)
  const span = maxUp + maxDown
  const zeroPct = span > 0
    ? Math.min(72, Math.max(28, (maxUp / span) * 100))
    : 50

  /*
   * ONE scale, sized to whichever side has less room for it.
   *
   * `scale` is percent-of-plot per point of active weight, and it is the
   * same number on both sides of the axis -- that is what keeps the two ends
   * comparable. It is set so the tallest bar on each side still leaves
   * `LABEL_ROOM` for the ticker that belongs to it, and the binding
   * constraint wins.
   *
   * This replaces a flat `* 38`, which was "38 of the 50 percent a half of a
   * centred plot has, because a bar drawn to the full half-height leaves no
   * room for its name and the labels were clipped off the bottom". Same
   * reasoning, now derived from where the axis actually is instead of
   * assuming it is in the middle.
   */
  const LABEL_ROOM = 12
  const scale = Math.min(
    maxUp > 0 ? (zeroPct - LABEL_ROOM) / maxUp : Infinity,
    maxDown > 0 ? (100 - zeroPct - LABEL_ROOM) / maxDown : Infinity,
  )

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
        {/* Instructions for a strip that is not drawn in the rail. */}
        <span className="book-header-detail text-[11px] text-gray-400">five each end · click to open</span>

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
        ── The headline fact was inside the caption ─────────────────────────
        *
        Active share is the one number that says how much of this book is a
        decision rather than the index, and it was set at 11px in gray-500,
        third item in a nowrap caption line, between a heading and a pair of
        counts and a hover readout. The panel beside it opens with a 28px
        figure. So the left half of this row announced what the book did and
        the right half announced nothing, and the two read as a statement
        next to a label.
        *
        Three figures on the same rung the day panel's secondary figures
        take, with 9px keys underneath -- the same block, in the same place,
        at the same size. That is what makes the two halves one instrument
        rather than two adjacent strips, which is the claim the row's own
        note upstairs makes and could not support.
        *
        The counts move here with it. "11 overweight" is a figure with a
        key, not a clause in a sentence, and as a clause it was competing
        with the active share for the same 11px.
        *
        Nothing is derived that was not already computed: all three read off
        `rows`, the whole book, not the ten bars drawn below.
      */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <Stat value={`${activeShare.toFixed(1)}%`} label="Active share" />
        <Stat value={String(overCount)} label="Overweight" />
        <Stat value={String(underCount)} label="Underweight" />
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
      {/*
        Ten named bars need room to be ten named bars.
        *
        `book-header-detail` drops the strip when this column is the ~20rem
        rail beside an open workspace -- see index.css. At 296px each bar is
        about 26px, so the tickers that were the whole point of cutting from
        thirty bars to ten overlap each other and the strip reads as a smear.
        The three figures above survive, because a number does not stop being
        legible at a narrower width and a distribution does.
      */}
      <div
        className="book-header-detail relative mt-2 flex h-[116px] w-full items-stretch justify-center gap-[3px]"
        onPointerLeave={() => setAt(null)}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-[1] h-px -translate-y-1/2 bg-slate-300 dark:bg-white/20"
          style={{ top: `${zeroPct}%` }}
        />
        {shown.map((r, i) => {
          // Shared scale, floored so a bar that rounds to nothing is still
          // visible as a mark rather than vanishing into the axis.
          const h = Math.max(1.5, Math.abs(r.activePct) * scale)
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
                      // slate-400, not 300: the underweights sit on the
                      // lens's gray-100 ground, and at 300 a 5px bar was
                      // about a two-step difference from the background --
                      // present in the measurement and invisible on screen.
                      // Still clearly the lighter of the two inks, which is
                      // what carries the sign.
                      : 'bg-slate-400 dark:bg-white/30',
                )}
                style={up
                  ? { bottom: `${100 - zeroPct}%`, height: `${h}%` }
                  : { top: `${zeroPct}%`, height: `${h}%` }}
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
                  up ? 'pb-1' : 'pt-1',
                )}
                style={up
                  ? { bottom: `calc(${100 - zeroPct}% + ${h}%)` }
                  : { top: `calc(${zeroPct}% + ${h}%)` }}
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

/**
 * One figure on the row's secondary rung, with its key under it.
 *
 * Deliberately the same 19px / 9px pair as `DayPanel`'s `Figure`, and not
 * imported from it: that one takes a signed number and colours itself by the
 * sign through `moveTone`, which is right for a return and wrong for every
 * figure here. An active share is never negative and a count of overweights
 * is not a move, so neither carries a direction and neither should be inked
 * as though it did.
 */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-[19px] font-semibold leading-none tabular-nums tracking-[-0.02em] text-gray-900 dark:text-gray-100">
        {value}
      </div>
      <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        {label}
      </div>
    </div>
  )
}
