import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronLeft } from 'lucide-react'

/**
 * A tile becoming a full-screen surface, as one object rather than two.
 *
 * ── Why FLIP and not an animation library ─────────────────────────────────
 *
 * This repo has no motion dependency, and the brief is explicit that one
 * should not be added blindly. Framer Motion's `layoutId` is the obvious tool
 * and it is roughly 50KB gzipped on a bundle already flagged for size — for a
 * single transition whose entire content is "measure two rectangles and
 * interpolate between them", which is what FLIP is.
 *
 * FLIP (First, Last, Invert, Play) does exactly that with no library:
 *
 *   FIRST   the tile's rect, measured at the moment of the tap
 *   LAST    the overlay's natural rect, which is the viewport
 *   INVERT  a transform that makes the full-screen overlay *look* like the
 *           tile — translate to its corner, scale to its size
 *   PLAY    animate that transform to identity
 *
 * Everything is `transform` and `opacity`, so the whole thing runs on the
 * compositor. No width/height animation, no layout thrash per frame, nothing
 * that can force a reflow inside the transition — which is what protects the
 * scroll underneath on a phone.
 *
 * ── Why one shell and not a shared element per field ──────────────────────
 *
 * Animating the ticker, the headline and the chart independently between two
 * DOM trees means measuring and tweening each, and it reads as a handful of
 * pieces flying to new homes. The brief asks for the opposite — "it should
 * feel like ONE object transforming" — so the SHELL is the shared element and
 * the content cross-fades inside it. The expanded-only material fades up over
 * the back half of the transition, which is the "information enters after the
 * primary transition begins" the brief specifies.
 *
 * ── Why the source tile is hidden, not left in place ──────────────────────
 *
 * Two copies of one card on screen for 260ms is the "duplicate tile flash" the
 * brief rules out. The origin tile is hidden with `visibility` — not
 * `display`, which would collapse the grid row and move everything below it,
 * and not opacity, which still paints. The mosaic never unmounts, so scroll
 * position is preserved by construction.
 */

/** Where the transition starts and returns to. Viewport coordinates. */
export interface ExpansionOrigin {
  top: number
  left: number
  width: number
  height: number
  /** The tile's corner radius, so the shell interpolates to the sheet's. */
  radius: number
}

/**
 * The transition's shape.
 *
 * 260ms sits inside the brief's 220–320ms window. The curve is a highly damped
 * ease with no overshoot: a card carrying a price chart that springs past its
 * final size and settles back reads as a toy, and this surface is asking to be
 * taken seriously. `cubic-bezier(0.32, 0.72, 0, 1)` is the standard iOS-ish
 * sheet curve — fast off the mark, long settle, no bounce.
 */
const DURATION_MS = 260
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

/**
 * The sheet LANDS square, and the radius is only a thing in flight.
 *
 * ── Why this is 0 and not 20 ──────────────────────────────────────────────
 *
 * It was 20, and the destination therefore read as an enormous card sitting on
 * a dimmed page rather than as a detail surface — which is half of "it looks
 * like a giant tile". A full-screen surface with rounded corners is a card by
 * every convention this product uses.
 *
 * The radius still interpolates: the FIRST keyframe carries the source tile's
 * own corner, divided by the scale so it reads correctly while the shell is
 * shrunk. So the card's corners are honoured while it is still card-shaped and
 * gone by the time it fills the screen.
 *
 * The animation runs with `fill: 'both'`, so its final keyframe persists after
 * it finishes and outranks any inline style — which is exactly why setting the
 * radius on the element was not enough on its own, and why the value has to be
 * right HERE.
 */
const LANDED_RADIUS = 0

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface ExploreExpansionProps {
  /** The rect the sheet grows from and returns to. */
  origin: ExpansionOrigin | null
  onClose: () => void
  /** Re-measured at dismiss time, so a scrolled feed still returns correctly. */
  measureOrigin?: () => ExpansionOrigin | null
  children: React.ReactNode
  /** Labelled for the reader, since this is a modal surface. */
  label?: string
}

type Phase = 'opening' | 'open' | 'closing'

export function ExploreExpansion({
  origin, onClose, measureOrigin, children, label,
}: ExploreExpansionProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<Phase>('opening')
  const reduced = prefersReducedMotion()

  /**
   * INVERT + PLAY, before the browser has painted a frame of the sheet.
   *
   * `useLayoutEffect` rather than `useEffect`: the inverted transform has to be
   * on the element in the same frame it first paints, or the reader sees one
   * frame of full-screen sheet before it snaps back to tile size — a flash
   * that is far more noticeable than the animation it precedes.
   */
  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    if (reduced || !origin) { setPhase('open'); return }

    const to = shell.getBoundingClientRect()
    if (to.width < 1 || to.height < 1) { setPhase('open'); return }

    const sx = origin.width / to.width
    const sy = origin.height / to.height
    const dx = origin.left - to.left
    const dy = origin.top - to.top

    const anim = shell.animate(
      [
        {
          // Scaled about the top-left, so the maths is a plain rect map with
          // no centre-origin correction to get wrong.
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          borderRadius: `${origin.radius / Math.max(sx, sy)}px`,
          opacity: 0.6,
        },
        { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: `${LANDED_RADIUS}px`, opacity: 1 },
      ],
      { duration: DURATION_MS, easing: EASE, fill: 'both' },
    )
    scrimRef.current?.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: DURATION_MS, easing: EASE, fill: 'both' },
    )
    const done = () => setPhase('open')
    anim.addEventListener('finish', done)
    return () => anim.removeEventListener('finish', done)
    // Deliberately once, on mount. Re-running would restart the transition
    // mid-flight if anything above re-rendered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** The reverse, then unmount. The caller is told only once it has landed. */
  const close = () => {
    const shell = shellRef.current
    if (!shell || reduced) { onClose(); return }
    if (phase === 'closing') return
    setPhase('closing')

    // Re-measured, because the reader may have scrolled the mosaic underneath
    // while the sheet was open. Returning to the ORIGINAL rect would fly the
    // card off to where the tile used to be.
    const back = measureOrigin?.() ?? origin
    const from = shell.getBoundingClientRect()
    if (!back || from.width < 1) { onClose(); return }

    const sx = back.width / from.width
    const sy = back.height / from.height
    const dx = back.left - from.left
    const dy = back.top - from.top

    const anim = shell.animate(
      [
        { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: `${LANDED_RADIUS}px`, opacity: 1 },
        {
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          borderRadius: `${back.radius / Math.max(sx, sy)}px`,
          opacity: 0.6,
        },
      ],
      { duration: DURATION_MS, easing: EASE, fill: 'both' },
    )
    scrimRef.current?.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: DURATION_MS, easing: EASE, fill: 'both' },
    )
    anim.addEventListener('finish', onClose)
  }

  // Escape closes on desktop; the sheet has its own back control on a phone.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  return (
    <div className="absolute inset-0 z-40" data-explore-expansion data-phase={phase}>
      {/* The feed, dimmed rather than hidden — the reader keeps their place in
          the world they came from, which is the point of a spatial transition.
          `pointer-events-auto` so a tap outside the sheet dismisses it. */}
      <div
        ref={scrimRef}
        data-explore-scrim
        onClick={close}
        className="absolute inset-0 bg-gray-900/25 dark:bg-black/50"
      />
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        data-explore-sheet
        className={clsx(
          'absolute inset-0 flex flex-col overflow-hidden bg-white dark:bg-gray-900',
          // `will-change` only while moving: leaving it on promotes a
          // full-screen layer for the life of the sheet, which on a phone is
          // memory taken from the feed underneath.
          phase !== 'open' && 'will-change-transform',
        )}
        style={{
          // The animation's `fill: 'both'` owns this once it has run; the
          // inline value only covers the reduced-motion path, which never
          // animates at all.
          borderRadius: LANDED_RADIUS,
          transformOrigin: 'top left',
        }}
      >
        {/* ── The way out ─────────────────────────────────────────────────
            Owned by the component that owns the reverse transition, so there
            is exactly one path back and it always animates. A full-screen
            sheet leaves no scrim to tap — the scrim is there for the dim, not
            as a target — so the control has to live inside the sheet.

            Floating over the content rather than in a header bar: the content
            below is a card that already has its own top, and a second bar
            above it reads as chrome stacked on chrome. */}
        {/* ── The navigation zone ─────────────────────────────────────────
            A dedicated bar, not a pill floating over the content.

            ── Why the floating version was wrong ────────────────────────
            It was absolutely positioned at the safe-area top with a `z-10`,
            and the content underneath had to reserve 3.25rem of blank padding
            to avoid it. Two things went wrong with that. The control sat in
            the same band as the card's own category pill and ticker, so the
            two competed for one corner; and reserving space for an overlay is
            a layout that only works while nobody changes either side.

            This is the grammar `ArticleReader` already uses for a full-screen
            mobile detail surface: a `shrink-0` bar with a real control and a
            bottom rule, then the body scrolling underneath it. Same heights,
            same padding, same backdrop — so the two full-screen surfaces in
            this product read as one family. */}
        <div
          data-explore-detail-header
          className={clsx(
            'flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white/95 px-2 py-2',
            'backdrop-blur dark:border-gray-800 dark:bg-gray-900/95',
            '[padding-top:calc(0.5rem+env(safe-area-inset-top))]',
            // Enters once the shell has stopped moving — a bar that flies in
            // with the card is one more thing moving at once.
            'transition-opacity duration-150',
            phase === 'open' ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <button
            type="button"
            data-explore-close
            onClick={close}
            aria-label="Back to Explore"
            className="-ml-1 flex h-10 items-center gap-1 rounded-full pl-1.5 pr-3 text-[14px] font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-5 w-5" />
            Back to Explore
          </button>
        </div>

        {/* The body owns the remaining height and its own scroller. */}
        <div className="min-h-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}

/**
 * The rect a tile occupies right now, in the shape the transition wants.
 *
 * Reads the radius off the element rather than assuming it, so a change to the
 * tile's corner in CSS cannot silently desynchronise the interpolation.
 */
export function measureTile(el: Element | null): ExpansionOrigin | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width < 1 || r.height < 1) return null
  const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 12
  return { top: r.top, left: r.left, width: r.width, height: r.height, radius }
}
