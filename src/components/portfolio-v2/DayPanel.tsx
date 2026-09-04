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
  if (!day || !day.movers.length) return null

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
    <section data-testid="day-panel" className="mt-5">
      <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <Figure label="Book" value={day.portfolioPct} lead />
        {day.benchmarkPct != null ? (
          <Figure label="Benchmark" value={day.benchmarkPct} />
        ) : (
          /* Stated, not hidden. A blank where a benchmark should be reads as
             a bug; this reads as the limit it is. */
          <div data-testid="bench-unpriced">
            <div className="font-mono text-[15px] font-semibold leading-none text-gray-400">—</div>
            <div className="mt-1 text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
              Benchmark · {Math.round(day.coverage * 100)}% priced
            </div>
          </div>
        )}
        {spread != null && <Figure label="Active" value={spread} />}

        <span className="ml-auto font-mono text-[10px] tabular-nums text-gray-400">
          {/* Never "today": this is the last close the cache holds. */}
          close {day.asOf ?? '—'}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 md:grid-cols-2">
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
        'font-mono font-semibold leading-none tabular-nums tracking-[-0.02em]',
        lead ? 'text-[26px]' : 'text-[15px]',
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
      <div className="text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">{title}</div>
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
