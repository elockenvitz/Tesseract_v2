/**
 * What a name weighs, in a tile's corner, and what is behind it on a click.
 *
 * ── Why a control and not a figure ───────────────────────────────────────
 *
 * "6.4%" answers one question and raises three: how many dollars is that, how
 * does it compare to the index, and how many shares. All four on the card
 * buries the one that matters; none of them sends the reader to a detail pane
 * for a number they wanted in passing.
 *
 * ── Why it is shared, and why every field is optional ────────────────────
 *
 * It was built in Portfolio, which holds the whole book and can answer all
 * four. Research asks a different question and loads different data: its
 * coverage rows carry the weight, the book it is in and how many books hold
 * the name -- and no market value, no share count, no benchmark comparison.
 *
 * So the fields are optional and absent ones are simply not rendered. What is
 * NOT done is invent them: a zero market value or a zero active weight would
 * be a number the reader could act on, and neither lens would be entitled to
 * it. Where a lens has nothing beyond the weight the panel says so.
 *
 * `data-no-portal` throughout, because the tile shell treats an unhandled
 * click as "open this record" -- reading a number is not a decision to leave
 * the gallery.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'

export interface WeightDetail {
  label: string
  value: string
  /** Direction ink, for a figure that has one. Omit for plain facts. */
  sign?: number
}

export function TileWeightChip({
  pct, details, caption = 'weight', testId = 'tile-weight',
}: {
  /** The weight itself. The one thing every caller has. */
  pct: number
  /** Everything behind it, in the order the lens wants it read. */
  details: WeightDetail[]
  /**
   * What the weight is OF, beside the figure: "in Tech & Consumer Growth", or
   * "in 3 portfolios" where several hold the name.
   *
   * A percentage of an unnamed book is not a fact a reader can use -- 5.4%
   * means one thing in a concentrated fund and another in a broad one -- and
   * naming a single book when three hold the position states the wrong thing
   * outright. The caller decides which of those it is; this only prints it.
   */
  caption?: string
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const figure = `${pct.toFixed(1)}%`

  /*
   * ── The panel is a portal, because the tile clips ────────────────────────
   *
   * `DesktopTile`'s shell carries `overflow-hidden` -- it is what keeps the
   * rounded corners and stops a wide object bleeding out of a card. An
   * absolutely-positioned panel inside that shell is clipped by it, so on a
   * compact tile the reader opened the weight and got the top two rows of a
   * panel with the rest cut off.
   *
   * Rendering into `document.body` puts it outside every ancestor's clip. The
   * cost is that it no longer moves with the tile, so the position is measured
   * when it opens and the panel closes on scroll rather than drifting away
   * from the control that owns it.
   */
  const anchorRef = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) { setAt(null); return }
    const el = anchorRef.current
    if (!el) return

    const place = () => {
      const r = el.getBoundingClientRect()
      const W = 196
      const H = 160
      /* Below the control by default, above it where the viewport's bottom is
         closer than the panel is tall -- the same flip any menu does, and the
         reason a compact tile near the foot of the page still shows all of it. */
      const below = window.innerHeight - r.bottom
      const top = below < H && r.top > H ? r.top - H - 4 : r.bottom + 4
      // Never off the right edge, and never off the left.
      const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8))
      setAt({ top, left })
    }
    place()

    // Closing beats chasing: a panel that follows the page while the reader
    // scrolls reads as stuck to the glass rather than to the tile.
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <div ref={anchorRef} className="relative ml-auto shrink-0" data-no-portal>
      <button
        type="button"
        data-testid={testId}
        aria-expanded={open}
        aria-label={`Weight ${figure}. Show size detail.`}
        onClick={() => setOpen(v => !v)}
        className={clsx(
          'flex items-baseline gap-1 rounded px-1 py-px transition-colors',
          'hover:bg-gray-100 dark:hover:bg-white/10',
          open && 'bg-gray-100 dark:bg-white/10',
        )}
      >
        <span className="font-mono text-[13px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
          {figure}
        </span>
        <span className="min-w-0 max-w-[150px] truncate text-[9px] font-semibold uppercase tracking-[0.09em] text-gray-400">
          {caption}
        </span>
      </button>

      {open && at != null && createPortal(
        <div
          data-testid={`${testId}-detail`}
          data-no-portal
          style={{ position: 'fixed', top: at.top, left: at.left, width: 196 }}
          className="z-50 rounded border border-gray-200 bg-white p-2.5 shadow-lg dark:border-white/15 dark:bg-[#1a2130]"
        >
          {details.length === 0 ? (
            <p className="text-[10px] text-gray-500">
              Nothing recorded beyond the weight.
            </p>
          ) : (
            <dl className="flex flex-col gap-1.5 text-[10px]">
              {details.map(d => (
                <div key={d.label} className="flex items-baseline justify-between gap-2">
                  <dt className="shrink-0 text-gray-500">{d.label}</dt>
                  {/* `break-words`, not truncate: a book name is the one value
                      here that can be long, and half a name reads as a
                      different book. The panel has room to wrap. */}
                  <dd className={clsx(
                    'min-w-0 break-words text-right font-mono tabular-nums',
                    d.sign == null ? 'text-gray-700 dark:text-gray-300'
                      : d.sign >= 0 ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                      : 'font-semibold text-rose-700 dark:text-rose-400',
                  )}>
                    {d.value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
