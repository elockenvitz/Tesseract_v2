/**
 * Focus Mode's canvas, and the Up Next rail.
 *
 * ── Why a rail at all ────────────────────────────────────────────────────
 *
 * On a genuinely wide monitor a focused workspace either stretches its prose
 * across two thousand pixels or leaves half the screen blank. Neither is a
 * design. The rail uses that space for the only thing that belongs beside one
 * issue: the next few issues in the same lens.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * Not the left-rail navigator this product already retired once. It is small,
 * bounded to a handful of items, carries a reason rather than a symbol, and
 * exists only where the viewport can spare it. It never lists the population,
 * and it never replaces Back -- a reader must always be able to return to the
 * scan they came from, and moving sideways is not returning.
 *
 * ── Only above 2xl ───────────────────────────────────────────────────────
 *
 * At 1440 the work surface takes the whole width. Squeezing a 248px column out
 * of a laptop viewport costs the workspace more than the rail gives back, so
 * the rail is simply absent there rather than crushed.
 */

import { clsx } from 'clsx'
import { EYEBROW } from './DesktopModule'
import { TONE_PILL, type SemanticTone } from '../../lib/semantic-tone'

export interface UpNextItem {
  id: string
  symbol: string | null
  /** Why this one is next. The state, not a restated name. */
  reason: string
  tone?: SemanticTone
  /** A single figure worth carrying: a weight, a count, an age. */
  figure?: string | null
}

/**
 * The focused workspace, plus what is next beside it on a wide screen.
 *
 * One scroll container belongs to the page, not to this: the rail is sticky
 * rather than independently scrollable, so a reader never has to work out
 * which pane their wheel is over.
 */
export function FocusCanvas({
  children, upNext, onOpen, label = 'Up next',
}: {
  children: React.ReactNode
  upNext: UpNextItem[]
  onOpen: (id: string) => void
  label?: string
}) {
  const show = upNext.length > 0
  return (
    <div className="mx-auto flex w-full max-w-[1760px] gap-8 px-6">
      <div className="min-w-0 flex-1">{children}</div>
      {show && (
        <aside
          data-testid="up-next"
          aria-label={label}
          className="hidden w-[236px] shrink-0 2xl:block"
        >
          <div className="sticky top-4 pt-5">
            <div className={EYEBROW}>{label}</div>
            <div className="mt-2 flex flex-col gap-0.5">
              {upNext.map(i => (
                <button
                  key={i.id}
                  type="button"
                  data-testid="up-next-item"
                  onClick={() => onOpen(i.id)}
                  className="group rounded-lg px-2 py-2 text-left hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:hover:bg-white/[0.05]"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-[13px] tracking-[-0.02em]">
                      {i.symbol ?? '—'}
                    </span>
                    {i.figure && (
                      <span className="ml-auto font-mono text-[11px] tabular-nums text-gray-500">
                        {i.figure}
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    <span className={clsx(
                      'inline-block rounded-full border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-[0.05em]',
                      TONE_PILL[i.tone ?? 'neutral'],
                    )}>
                      {i.reason}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>
      )}
    </div>
  )
}

/**
 * The next few, in the lens's own order, excluding the one being read.
 *
 * Bounded at four: this is a glance, and a fifth entry turns it into a list.
 * Order is never recomputed -- whatever the lens ranked (or, for Decisions,
 * whatever the chronology says) is what appears, so the rail cannot imply a
 * priority the surface itself does not hold.
 */
export function upNextFrom<T>(
  all: readonly T[],
  selectedId: string | null,
  toItem: (row: T) => UpNextItem,
  limit = 4,
): UpNextItem[] {
  const at = all.findIndex(r => toItem(r).id === selectedId)
  const after = at >= 0 ? all.slice(at + 1) : all
  const wrapped = at > 0 ? [...after, ...all.slice(0, at)] : after
  return wrapped.map(toItem).filter(i => i.id !== selectedId).slice(0, limit)
}
