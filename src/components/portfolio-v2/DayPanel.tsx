/**
 * The book's last day, against the index, and the names that made it.
 *
 * ── The three questions, in order ────────────────────────────────────────
 *
 * What did we do, what did the index do, and which names were responsible.
 * A portfolio lens that cannot answer those is a list of holdings, and this
 * one was.
 *
 * ── Where it refuses ─────────────────────────────────────────────────────
 *
 * The benchmark figure appears only when enough of the index could be priced
 * to compute one -- see `useDayPerformance`. Below that floor the slot says
 * so rather than printing a number derived from part of an index and labelled
 * as the whole of it.
 *
 * And it is a DAY, from the last close against the one before it. There is no
 * intraday series in this product, so nothing here is labelled "today" or
 * "live"; the date the cache actually holds is printed instead.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { moveTone } from '../../lib/charts/tone'
import { DAY_WINDOW_DAYS } from '../../hooks/useDayPerformance'
import type { DayPerformance, DayMove } from '../../hooks/useDayPerformance'

const pct = (n: number, dp = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`

export function DayPanel({
  day, onOpen,
}: {
  day: DayPerformance | null
  /** Open one name. The panel is a route into the book, not a dead end. */
  onOpen: (assetId: string) => void
}) {
  const [at, setAt] = useState<string | null>(null)
  if (!day) return null
  /*
   * An empty movers list is a STATE, not a reason to disappear.
   *
   * The guard used to fold the empty-movers case in with the null-day case
   * and return nothing for both. With a stale price cache the movers term
   * was always true -- so the whole left
   * half of the Portfolio header rendered nothing, in a row that reserves
   * 200px for it. Measured live: column one was 909px wide and 0px tall,
   * which is the "half is showing nothing" this was reported as.
   *
   * `day` itself staying null is different and still returns null: that is
   * the query not having landed yet, and the row's reserved height is
   * holding the space for a fade. Nothing-to-price is a settled answer and
   * says so.
   */
  if (!day.movers.length) {
    return (
      <section data-testid="day-panel" data-day="unpriced">
        <div className="flex h-[18px] items-baseline gap-x-3 overflow-hidden whitespace-nowrap">
          <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
            Profit &amp; loss
          </h2>
          <span data-testid="day-unpriced" className="text-[11px] text-gray-500">
            No close in the last {DAY_WINDOW_DAYS} days to price the book from
          </span>
        </div>
      </section>
    )
  }

  /*
   * Five each end, and never the same name twice.
   *
   * `movers` is sorted best-first, so the top five are the head and the
   * bottom five the tail -- but a book of six holdings would otherwise print
   * four of them in both columns and read as ten contributors. The slice is
   * clamped so the two halves cannot meet.
   */
  const n = Math.min(5, Math.floor(day.movers.length / 2))
  const top = day.movers.slice(0, n)
  const bottom = day.movers.slice(-n).reverse()
  const spread = day.benchmarkPct != null ? day.portfolioPct - day.benchmarkPct : null

  return (
    <section data-testid="day-panel" data-day="priced">
      {/*
        A heading row of exactly the same shape as the strip's, on purpose.
        *
        This panel opened straight onto a 26px figure while the benchmark
        strip beside it opened with an 18px title line, so the two halves of
        one row started at different heights and on different baselines and
        read as two unrelated things that happened to be adjacent. One `h-18`
        nowrap line each -- title, then the facts about the window -- lines
        them up and names what the left half IS, which nothing did before.
      */}
      <div className="flex h-[18px] items-baseline gap-x-3 overflow-hidden whitespace-nowrap">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-400">
          Profit &amp; loss
        </h2>
        {/* Never "today": this is the last close the cache holds. */}
        <span className="font-mono text-[11px] tabular-nums text-gray-500">
          close {day.asOf ?? '—'}
        </span>
        {/*
          How far behind, said out loud.
          *
          The date alone was already here and it is not enough: a reader
          sees a 26px "+0.33%" and reads "we are up today", and on a cache
          four weeks stale that is the wrong month. The lag is printed
          whenever it exceeds a long weekend.
        */}
        {day.stale && day.lagDays != null && (
          <span data-testid="day-stale" className="text-[11px] text-amber-600 dark:text-amber-400">
            {day.lagDays}d behind
          </span>
        )}
        {/* Instructions for lists that are not drawn in the rail. */}
        <span className="book-header-detail ml-auto text-[11px] text-gray-400">click a name to open it</span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <Figure label="Book" value={day.portfolioPct} lead />
        {day.benchmarkPct != null ? (
          <Figure label="Benchmark" value={day.benchmarkPct} />
        ) : (
          /* Stated, not hidden. A blank where a benchmark should be reads as
             a bug; this reads as the limit it is. */
          <div data-testid="bench-unpriced">
            {/* Same rung as the benchmark figure it stands in for, so the
                row does not change shape when a book has no index file. */}
            <div className="font-mono text-[19px] font-semibold leading-none text-gray-400">—</div>
            <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
              Benchmark · {Math.round(day.coverage * 100)}% priced
            </div>
          </div>
        )}
        {spread != null && <Figure label="Active" value={spread} />}
      </div>

      {/*
        The ranked lists are study material; the figures above are the triage.
        *
        `book-header-detail` drops them when this column is the ~20rem rail
        beside an open workspace -- see index.css. Two ranked lists at 56px
        and 64px of figures each, in 296px, collided with their own column
        keys, which is what "all messed up" was looking at.
        *
        `md:grid-cols-2` is a VIEWPORT breakpoint and stays only because the
        container query above now decides whether this renders at all: the
        panel is either in the rail, where it is gone, or at full width,
        where the viewport is past md by definition.
      */}
      <div className="book-header-detail mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
        <Movers
          title="Added most" rows={top} at={at} setAt={setAt} onOpen={onOpen} scale={day.movers}
        />
        <Movers
          title="Cost most" rows={bottom} at={at} setAt={setAt} onOpen={onOpen} scale={day.movers}
        />
      </div>
    </section>
  )
}

function Figure({ label, value, lead }: { label: string; value: number; lead?: boolean }) {
  return (
    <div>
      <div className={clsx(
        /*
         * ── Two rungs, far enough apart to be a ladder ───────────────────
         *
         * 26 against 15 is a ratio of 1.7, which reads as "one big number
         * and two small ones" rather than as a hierarchy: the benchmark and
         * the active figure sat at the size of the axis labels below them,
         * and the book's own return was the only thing on the panel a
         * reader could see from a seat away.
         *
         * 28 / 19 is the prototype's step and it is the step the rest of
         * this product already uses -- 19px is the figure size on an
         * Explore tile's stats row, so the secondary rung here matches a
         * primary figure elsewhere instead of inventing a sixth size.
         *
         * The book stays the lead because the question is "what did WE do";
         * the benchmark and the spread are what that answer is measured
         * against, and they are now legible as answers rather than as
         * captions.
         */
        'font-mono font-semibold leading-none tabular-nums tracking-[-0.02em]',
        lead ? 'text-[28px]' : 'text-[19px]',
        moveTone(value),
      )}>
        {pct(value)}
      </div>
      <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        {label}
      </div>
    </div>
  )
}

/**
 * One end of the contribution list.
 *
 * The bar is scaled against the largest contribution in the WHOLE book, not
 * within its own column -- otherwise the biggest detractor and the biggest
 * contributor both draw full-width and the two halves stop being comparable,
 * which is the one thing a reader is doing with them.
 */
function Movers({
  title, rows, at, setAt, onOpen, scale,
}: {
  title: string
  rows: DayMove[]
  at: string | null
  setAt: (id: string | null) => void
  onOpen: (assetId: string) => void
  scale: DayMove[]
}) {
  const ceiling = Math.max(...scale.map(m => Math.abs(m.contribPct)), 0.01)
  return (
    <div>
      {/*
        ── The two percentage columns were unlabelled ───────────────────────
        *
        Every mover row prints two percentages side by side -- the name's
        contribution to the book's return, and the name's own return -- and
        nothing said which was which. They differ by 1px of size and by
        colour, so a reader comparing "+0.04%" against "+2.1%" on one line
        had no way to know the first was weighted and the second was not,
        and the natural reading (two attempts at the same number) made the
        panel look wrong.
        *
        Naming them once at the top of the column costs one 9px line and
        resolves it. The widths and the `px-1` mirror the button below so
        each key sits over its own figure; `gap-3` and the `flex-1` spacer
        stand in for the symbol cell and the bar track.
      */}
      <div className="flex items-baseline gap-3 px-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
        <span>{title}</span>
        <span className="min-w-0 flex-1" />
        <span className="w-[56px] shrink-0 text-right">of book</span>
        <span className="w-[64px] shrink-0 text-right">own</span>
      </div>
      <ul className="mt-1.5" onPointerLeave={() => setAt(null)}>
        {rows.map(m => (
          <li key={m.assetId}>
            <button
              type="button"
              data-testid={`mover-${m.symbol ?? m.assetId}`}
              onPointerEnter={() => setAt(m.assetId)}
              onFocus={() => setAt(m.assetId)}
              onBlur={() => setAt(null)}
              onClick={() => onOpen(m.assetId)}
              className={clsx(
                'flex w-full items-center gap-3 px-1 py-[3px] text-left transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1',
                'focus-visible:outline-blue-600',
                at === m.assetId ? 'bg-slate-100 dark:bg-white/[0.06]' : 'bg-transparent',
              )}
            >
              <span className="w-[52px] shrink-0 truncate font-mono text-[12px] font-semibold">
                {m.symbol ?? '—'}
              </span>

              {/* Zero is the left edge of this track for gainers and the right
                  edge for detractors, so the two columns mirror rather than
                  both growing rightward and implying the same sign. */}
              <span className="relative h-[10px] min-w-0 flex-1">
                <span
                  className={clsx('absolute inset-y-0 bg-current', moveTone(m.contribPct))}
                  style={m.contribPct >= 0
                    ? { left: 0, width: `${(Math.abs(m.contribPct) / ceiling) * 100}%` }
                    : { right: 0, width: `${(Math.abs(m.contribPct) / ceiling) * 100}%` }}
                />
              </span>

              <span className={clsx(
                'w-[56px] shrink-0 text-right font-mono text-[11px] tabular-nums',
                moveTone(m.contribPct),
              )}>
                {pct(m.contribPct)}
              </span>
              <span className="w-[64px] shrink-0 text-right font-mono text-[10px] tabular-nums text-gray-400">
                {pct(m.retPct, 1)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
