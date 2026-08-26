import { useRef, useState, useEffect } from 'react'
import { clsx } from 'clsx'

export interface CarouselPane {
  /** Stable key, and the label under the indicator. */
  id: string
  label: string
  content: React.ReactNode
}

interface CardCarouselProps {
  panes: CarouselPane[]
  /**
   * Page to this pane when the id changes. Optional; nothing does so by
   * default, because a carousel that moves on its own is a carousel fighting
   * the reader.
   */
  focusPaneId?: string | null
  /**
   * Which pane is showing, as it changes.
   *
   * The card's sticky footer is contextual — a "Review target" button beside a
   * pane that IS the review is a second way to press the thing already on
   * screen — and the footer lives in `SignalCardView`, which otherwise has no
   * idea what the carousel is showing. Fired on the paged pane, not on every
   * scroll frame: `active` is already debounced by the round-to-nearest-page
   * rule in `onScroll`.
   */
  onActiveChange?: (paneId: string) => void
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
 * ── pan-x pan-y, not pan-x ────────────────────────────────────────────────
 *
 * `pan-x` alone means "this element pans horizontally and NOTHING else", so a
 * finger that landed on a carousel — a chart, a ladder, a set of panes, which
 * is most of a card — could not scroll the feed at all. Reported from a phone
 * as "I am unable to scroll the tile when I press on an interactive object".
 *
 * `pan-x pan-y` lets the browser arbitrate on the gesture's own direction:
 * horizontal pages the carousel, vertical scrolls the feed. That is the
 * intent-based behaviour the surface wanted, and the browser does it better
 * than a threshold in JavaScript would.
 *
 * (Historic note.) `touch-action: pan-x` on the track told the browser this only
 * handles horizontal gestures, so a vertical drag is passed straight to the
 * feed and a horizontal one never reaches it. That is the whole mechanism; it
 * is a CSS declaration rather than a JS gesture handler because the browser
 * arbitrates far more reliably than a scroll-position heuristic.
 */
export function CardCarousel({ panes, focusPaneId, onActiveChange }: CardCarouselProps) {
  /**
   * EVERY hook lives here, above the early returns below.
   *
   * ── The crash this caused ─────────────────────────────────────────────────
   *
   * `dotsRef` and `scrubbing` were declared next to the code that uses them,
   * which is after `if (panes.length === 1) return ...`. So a card rendered two
   * hooks on one pass and four on the next — and a card's pane count DOES
   * change between passes: it starts with a control, price history arrives, and
   * a chart pane appears. React throws #310, the boundary catches it, and the
   * reader gets "Oops! Something went wrong" on a hard refresh.
   *
   * Hooks are positional. A conditional return is a conditional hook call, and
   * proximity to the code that reads them is not worth that.
   */
  const [active, setActive] = useState(0)
  const trackRef = useRef<HTMLDivElement>(null)
  const dotsRef = useRef<HTMLDivElement>(null)
  /**
   * Whether a scrub is in progress.
   *
   * A ref rather than `hasPointerCapture`: capture can be taken away
   * mid-gesture — the browser reclaims it when an element is removed or a
   * native scroll wins — and the handler would then silently stop following the
   * finger with no way to tell that from a finished drag.
   */
  const scrubbing = useRef(false)
  /**
   * Where a press on the dot row started, and whether it has become a drag.
   *
   * A tap used to fire BOTH paths: `onPointerDown` scrubbed immediately with
   * `behavior: 'auto'`, and then the button's `onClick` ran `goTo` with
   * `behavior: 'smooth'`. Two scrolls per tap — and not always to the same
   * pane, because scrubbing maps a fraction of the ROW while the click knows
   * which dot was pressed. Pressing dot 2 could jump instantly to dot 3 and
   * then animate back. Reported as hitchy and skippy, which is exactly what it
   * was.
   *
   * So the row waits: a press is a tap until the finger has travelled past the
   * slop, and only then does it become a scrub. Same intent-before-action rule
   * the feed uses to tell a vertical swipe from a horizontal one.
   */
  const pressX = useRef<number | null>(null)
  const didScrub = useRef(false)
  const SCRUB_SLOP_PX = 8

  /**
   * Page to a pane the card has asked for.
   *
   * Used when a reader engages an object: the judgment pane appears and the
   * carousel moves to it, so engaging is one tap rather than a tap and then a
   * hunt through the panes for the thing that just arrived.
   *
   * Keyed on the id rather than an index because the pane SET changes at the
   * same moment — the verdict pane is not in the list until engagement — and an
   * index into the old list means nothing in the new one.
   */
  useEffect(() => {
    if (!focusPaneId) return
    const i = panes.findIndex(p => p.id === focusPaneId)
    const track = trackRef.current
    if (i < 0 || !track) return
    const child = track.children[i] as HTMLElement | undefined
    if (!child) return
    // Feature-detected. jsdom implements no scroll methods at all, and an
    // unguarded call throws inside an effect — which takes the whole card
    // down rather than merely failing to animate. Setting `scrollLeft`
    // directly is the correct fallback: it lands in the right place without
    // the smooth transition.
    if (typeof track.scrollTo === 'function') {
      track.scrollTo({ left: child.offsetLeft, behavior: 'smooth' })
    } else {
      track.scrollLeft = child.offsetLeft
    }
    setActive(i)
    onActiveChange?.(panes[i].id)
  }, [focusPaneId, panes, onActiveChange])

  if (!panes.length) return null
  // One pane needs no carousel furniture — indicators for a single page are
  // noise, and a track that cannot scroll should not advertise that it can.
  //
  // It DOES need the height. This was a bare `<div>`, which has no height of
  // its own, so a pane whose content sizes itself with `h-full` or `flex-1`
  // resolved against nothing and collapsed to its minimum: a price chart in a
  // 180px evidence band rendered as a 20px strip with 120px of white space
  // under it. The multi-pane branch below has always been `flex h-full
  // min-h-0 flex-col`; the shortcut has to be the same box, or "one pane" and
  // "two panes" are different layouts rather than the same layout with the
  // furniture removed.
  if (panes.length === 1) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="carousel-single">
        {panes[0].content}
      </div>
    )
  }

  const onScroll = () => {
    const el = trackRef.current
    if (!el) return
    const i = Math.round(el.scrollLeft / Math.max(el.clientWidth, 1))
    if (i !== active) {
      const clamped = Math.min(Math.max(i, 0), panes.length - 1)
      setActive(clamped)
      onActiveChange?.(panes[clamped].id)
    }
  }

  const goTo = (i: number) => {
    const el = trackRef.current
    if (!el) return
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' })
  }


  /**
   * Which pane a point on the dot row corresponds to.
   *
   * Measured from the row's own box rather than from the dots, so the mapping
   * is continuous: a finger between two dots still resolves to one of them and
   * the panes keep up as it slides, instead of only changing when it happens
   * to be over a target.
   *
   * `auto` rather than `smooth` while dragging — a smooth scroll queued on
   * every pointermove fights the next one and the track lags behind the finger.
   */
  const scrubTo = (clientX: number) => {
    const row = dotsRef.current
    const el = trackRef.current
    if (!row || !el || panes.length < 2) return
    const box = row.getBoundingClientRect()
    const frac = (clientX - box.left) / box.width
    const i = Math.min(panes.length - 1, Math.max(0, Math.round(frac * (panes.length - 1))))
    if (i === active) return
    el.scrollTo({ left: i * el.clientWidth, behavior: 'auto' })
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
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]{display:none} [touch-action:pan-x_pan-y] [overscroll-behavior-x:contain]"
      >
        {panes.map(p => (
          <div key={p.id} data-carousel-pane={p.id}
            // `min-h-0 overflow-hidden` is what makes the pane a box rather
            // than a suggestion.
            //
            // Without it a pane whose content is taller simply grew past the
            // track and out through the bottom of the card: measured at 390x844
            // the scenario panes put a paragraph 136px BELOW the action bar and
            // the active-risk peer list put six rows there. Nothing scrolled to
            // reach them, because the card no longer scrolls — so the content
            // was not hidden, it was gone.
            //
            // Panes must now fit. Components that cannot fit page sideways
            // themselves (see CaseEditor's column wrap) or bound their own
            // content (see ActiveWeightPeers).
            className="flex w-full min-h-0 shrink-0 snap-start flex-col overflow-hidden px-0.5">
            {p.content}
          </div>
        ))}
      </div>

      {/*
        Dots with a label for the active pane, and one drag scrubs the lot.

        ── Why the labelled pills went ────────────────────────────────────────

        Every pane carried its own uppercase pill. With two panes that was
        legible; with five — chart, ladder, cases, target, respond — they
        collapsed into a cramped row of four-letter stubs that named nothing.
        Reported as "cramped and illegible", which is what a label becomes when
        it has no room to be a label.

        So only the CURRENT pane is named, at full width, and the rest are
        dots. The reader always knows where they are, and the row stops
        competing with the card for horizontal space.

        ── Why the row is draggable ───────────────────────────────────────────

        Tapping a dot still works. But a five-pane card is four taps end to
        end, and a press-and-slide across the row is one gesture — the finger
        is already there, and the panes track it as it moves. `touch-action:
        none` on the row is safe precisely because it is a strip of dots: there
        is nothing to scroll inside it, so nothing is taken away.
      */}
      <div
        // One row, not three stacked things.
        //
        // It was dots on one line and the pane name on another, under a 8px
        // margin — about 44px of chrome under an already-squeezed band. The
        // label sits beside the dots now and the whole strip is ~26px.
        className="mt-1 flex shrink-0 items-center justify-center gap-2"
        data-testid="carousel-indicators"
      >
        {/* Names the pane you are on, beside the dots rather than under them. */}
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-gray-400">
          {panes[active]?.label}
        </span>
        <div
          ref={dotsRef}
          className="flex touch-none items-center gap-1 px-1"
          onPointerDown={e => {
            // No scroll here. A press is not yet a gesture, and moving the
            // track on contact is what made a tap arrive twice.
            pressX.current = e.clientX
            didScrub.current = false
            scrubbing.current = false
          }}
          onPointerMove={e => {
            if (pressX.current == null) return
            if (!scrubbing.current) {
              if (Math.abs(e.clientX - pressX.current) < SCRUB_SLOP_PX) return
              scrubbing.current = true
              didScrub.current = true
              // Captured only once this is genuinely a drag, so a tap never
              // takes the pointer away from the button underneath it.
              try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* tap-only */ }
            }
            scrubTo(e.clientX)
          }}
          onPointerUp={e => {
            scrubbing.current = false
            pressX.current = null
            try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* never captured */ }
          }}
          onPointerCancel={() => { scrubbing.current = false; pressX.current = null }}
          onPointerLeave={() => { scrubbing.current = false; pressX.current = null }}
        >
          {panes.map((p, i) => (
            <button
              key={p.id}
              type="button"
              data-carousel-dot={p.id}
              aria-label={p.label}
              aria-current={i === active}
              // A drag has already put the track where it belongs, and the
              // click that follows it would animate somewhere else.
              onClick={() => { if (!didScrub.current) goTo(i) }}
              // 24px, which is the floor a thumb needs — the button is what
              // gets hit, not the 5-7px mark inside it. The row is compact
              // because of its padding and the inline label, not because the
              // targets were shrunk; Phase 3.5 already learned that lesson on
              // the response controls.
              className="flex h-6 w-6 items-center justify-center no-touch-target"
            >
              <span
                className={clsx(
                  'block rounded-full transition-all',
                  i === active
                    ? 'h-[7px] w-[7px] bg-gray-900 dark:bg-white'
                    : 'h-[5px] w-[5px] bg-gray-300 dark:bg-gray-600',
                )}
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
