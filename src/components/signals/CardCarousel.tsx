import { useRef, useState } from 'react'
import { clsx } from 'clsx'

export interface CarouselPane {
  /** Stable key, and the label under the indicator. */
  id: string
  label: string
  content: React.ReactNode
}

interface CardCarouselProps {
  panes: CarouselPane[]
}

/**
 * Horizontal, paged evidence panes inside a card.
 *
 * ── Why this exists, and why horizontal ───────────────────────────────────
 *
 * The feed is a vertical snap scroller: one card per screen, swipe up for the
 * next. Opening the case detail by default pushed the card past one screen, so
 * the card scrolled vertically *inside* a vertical snap container — and every
 * upward drag was ambiguous between "scroll this card" and "next card". The
 * browser resolves that by consuming the gesture in the inner scroller, so the
 * feed stopped advancing until the card was scrolled to its end.
 *
 * The rule that resolves it: **vertical belongs to the feed; overflow goes
 * horizontal.** The card is exactly one screen and never grows. Extra evidence
 * is paged sideways instead of stacked downward, which is also why this is
 * load-bearing rather than a flourish — it is what absorbs the height.
 *
 * `touch-action: pan-x` on the track tells the browser this element only
 * handles horizontal gestures, so a vertical drag is passed straight to the
 * feed and a horizontal one never reaches it. That is the whole mechanism; it
 * is a CSS declaration rather than a JS gesture handler because the browser
 * arbitrates far more reliably than a scroll-position heuristic.
 */
export function CardCarousel({ panes }: CardCarouselProps) {
  const [active, setActive] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)

  if (!panes.length) return null
  // One pane needs no carousel furniture — indicators for a single page are
  // noise, and a track that cannot scroll should not advertise that it can.
  if (panes.length === 1) return <div data-testid="carousel-single">{panes[0].content}</div>

  const onScroll = () => {
    const el = trackRef.current
    if (!el) return
    const i = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))
    if (i !== active) setActive(Math.min(Math.max(i, 0), panes.length - 1))
  }

  const goTo = (i: number) => {
    const el = trackRef.current
    if (!el) return
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }

  return (
    // h-full, not flex-1. This sits in the evidence band (a flex column, where
    // both behave alike) and in the disclosure region (a block, where flex-1
    // resolves to nothing and the panes collapse to their content). Same fix as
    // WhatIfSize and WeightBars.
    <div className="flex h-full min-h-0 flex-col" data-testid="card-carousel">
      <div
        ref={trackRef}
        onScroll={onScroll}
        data-carousel-track=""
        // pan-x is the mechanism that keeps the vertical feed swipe intact.
        // overscroll-behavior-x contain stops a horizontal fling at the last
        // pane from becoming a browser back-navigation.
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]{display:none} [touch-action:pan-x] [overscroll-behavior-x:contain]"
      >
        {panes.map(p => (
          <div key={p.id} data-carousel-pane={p.id} className="flex w-full shrink-0 snap-start flex-col px-0.5">
            {p.content}
          </div>
        ))}
      </div>

      {/* Real indicators: tappable, labelled, and they name the pane rather
          than showing anonymous dots. On a surface where a pane can be a
          blocked state, knowing what you are about to swipe to matters. */}
      <div className="mt-2 flex shrink-0 items-center justify-center gap-1.5" data-testid="carousel-indicators">
        {panes.map((p, i) => (
          <button
            key={p.id}
            type="button"
            data-carousel-dot={p.id}
            aria-label={p.label}
            aria-current={i === active}
            onClick={() => goTo(i)}
            className={clsx(
              'h-7 rounded-full px-2.5 text-[10px] font-bold uppercase tracking-wide transition-colors no-touch-target',
              i === active
                ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  )
}
