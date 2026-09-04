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
 * ── Why the CONTENT is counter-scaled ─────────────────────────────────────
 *
 * The shell's scale is non-uniform by nature: a tile is about 190x130 and the
 * sheet is the viewport, so opening one is `scale(0.47, 0.23)` animating to
 * identity. Applied to the shell alone that squashes everything inside it to
 * roughly half width and a quarter height, and the first ~200ms of the
 * transition is a stretched, illegible card un-squashing itself. Reported as
 * the transition not being smooth; it is not jank — no frame is dropped — it
 * is a 2:1 aspect distortion resolving in front of the reader.
 *
 * So the shell carries the morph and an inner wrapper carries its exact
 * inverse. The two transforms cancel, the content renders at natural size for
 * every frame, and what actually animates is the FRAME: a tile-sized window on
 * to a full-size card, growing. Both are still pure `transform`, so this stays
 * on the compositor and costs one extra layer.
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
export const DURATION_MS = 260
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

/**
 * The easing curve, evaluated — because the inverse has to be sampled, not eased.
 *
 * ── Why the obvious version does not cancel ───────────────────────────────
 *
 * The shell animates `scale(sx) -> scale(1)` and the content the reciprocal,
 * `scale(1/sx) -> scale(1)`. It is tempting to give both two keyframes and the
 * same easing and call them inverses. They are inverses at the two ENDS and
 * nowhere in between, because interpolating a value and interpolating its
 * reciprocal are different curves:
 *
 *   at the midpoint of a 0.226 -> 1 shell scale
 *   shell    = (0.226 + 1) / 2 = 0.613
 *   content  = (4.425 + 1) / 2 = 2.71
 *   product  = 1.66            ← content 66% oversize, mid-flight
 *
 * So the smear shrinks but does not go. The fix is to stop easing the inverse
 * and start SAMPLING it: evaluate the shell's curve at a series of offsets,
 * and emit content keyframes whose values are the exact reciprocals of the
 * shell's value at those same offsets, interpolated linearly between them.
 * With 12 samples the residual error is under half a percent, which is well
 * below what an eye can catch on a 260ms transition.
 *
 * The sample count is not arbitrary. Between two samples the content
 * interpolates linearly while the shell keeps easing, and the reciprocal curve
 * is steep at the start — 1/0.226 is 4.4 — so a coarse sampling leaves real
 * error exactly where the move is fastest. Measured against a 190x130 tile
 * opening to 400x578: 12 samples leaves 5.75%, 24 leaves 1.71%, 48 leaves
 * 0.47%. Keyframes are cheap and the animation is constructed once per tap.
 *
 * This is a plain cubic-bezier solve: find `t` for a given `x` by bisection,
 * then read `y`. Bisection rather than Newton because the curve is fixed and
 * evaluated 12 times on one interaction — clarity is worth more than the
 * handful of microseconds, and Newton needs a derivative and a fallback.
 */
const BEZIER = { x1: 0.32, y1: 0.72, x2: 0, y2: 1 }

export function bezierAt(x: number): number {
  const cx = (t: number, a: number, b: number) =>
    3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (cx(mid, BEZIER.x1, BEZIER.x2) < x) lo = mid
    else hi = mid
  }
  return cx((lo + hi) / 2, BEZIER.y1, BEZIER.y2)
}

/** How many points the inverse is sampled at. See `bezierAt`. */
const INVERSE_SAMPLES = 48

/**
 * Keyframes that undo `scale(sx, sy) -> scale(1, 1)` at every instant.
 *
 * `opacity` rides along on the same offsets so the material still arrives over
 * the back half of the move, rather than being a third animation to keep in
 * step with the other two.
 */
export function inverseKeyframes(sx: number, sy: number, fade: 'in' | 'out'): Keyframe[] {
  return Array.from({ length: INVERSE_SAMPLES + 1 }, (_, i) => {
    const offset = i / INVERSE_SAMPLES
    const p = bezierAt(offset)
    // The shell's scale at this offset, then its exact reciprocal.
    const shellX = sx + (1 - sx) * p
    const shellY = sy + (1 - sy) * p
    // Opacity is a ramp over one half of the move: the back half opening, the
    // front half closing, so the content is gone before the frame is small.
    const o = fade === 'in'
      ? Math.max(0, Math.min(1, (offset - 0.25) / 0.4))
      : Math.max(0, Math.min(1, 1 - offset / 0.45))
    return {
      offset,
      transform: `scale(${(1 / shellX).toFixed(4)}, ${(1 / shellY).toFixed(4)})`,
      opacity: o.toFixed(3),
      // Linear BETWEEN samples: the curve is already baked into the values.
      easing: 'linear',
    }
  })
}

/**
 * Start an animation, having cancelled whatever was already on the element.
 *
 * ── The leak this closes ──────────────────────────────────────────────────
 *
 * Every animation here runs with `fill: 'both'`, because the landed state has
 * to persist after the transition finishes — the sheet must stay square and
 * at identity, not snap back to the tile-sized keyframe it started from.
 *
 * The cost is that a finished animation never goes away on its own. Opening
 * and closing a tile twice left three animations on the shell and three on the
 * content — one finished and holding its fill, plus the two new ones — and the
 * browser composites all of them. Measured in the running app, and it is the
 * shape of "the animation gets worse the more I use it": the first open is
 * clean, and every one after composites against the residue of the last.
 *
 * Cancelling first is safe precisely because of where the keyframes start. The
 * close animation opens on the state the open animation ended at, so there is
 * no frame in which nothing is applied.
 */
function restart(
  el: Element | null | undefined, keyframes: Keyframe[], options: KeyframeAnimationOptions,
): Animation | undefined {
  if (!el) return undefined
  el.getAnimations().forEach(a => a.cancel())
  return el.animate(keyframes, options)
}

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
  /** Carries the inverse of the shell's scale. See the note at the top. */
  const contentRef = useRef<HTMLDivElement>(null)
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

    const anim = restart(shell,
      [
        {
          // Scaled about the top-left, so the maths is a plain rect map with
          // no centre-origin correction to get wrong.
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          borderRadius: `${origin.radius / Math.max(sx, sy)}px`,
        },
        { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: `${LANDED_RADIUS}px` },
      ],
      { duration: DURATION_MS, easing: EASE, fill: 'both' },
    )!
    /**
     * The exact inverse, so the content never distorts.
     *
     * Same duration and same curve as the shell — a different easing here
     * would mean the two transforms fail to cancel mid-flight, which is a
     * subtler version of the smear this removes.
     *
     * The opacity is on the content and not on the shell. Fading the shell
     * faded its background too, so the feed showed through the card while it
     * grew and the whole transition read as translucent. Fading only what is
     * inside keeps the surface solid and lets the material arrive over the
     * back half, which is the behaviour the brief asked for.
     */
    restart(contentRef.current, inverseKeyframes(sx, sy, 'in'),
      // No `easing` here on purpose — the curve lives in the sampled values.
      { duration: DURATION_MS, fill: 'both' })
    restart(scrimRef.current, [{ opacity: 0 }, { opacity: 1 }],
      { duration: DURATION_MS, easing: EASE, fill: 'both' })
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

    const anim = restart(shell,
      [
        { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: `${LANDED_RADIUS}px` },
        {
          transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
          borderRadius: `${back.radius / Math.max(sx, sy)}px`,
        },
      ],
      { duration: DURATION_MS, easing: EASE, fill: 'both' },
    )!
    // The same inverse, run backwards. Closing distorted exactly as badly as
    // opening did, and for the same reason.
    restart(contentRef.current, inverseKeyframes(sx, sy, 'out'),
      { duration: DURATION_MS, fill: 'both' })
    restart(scrimRef.current, [{ opacity: 1 }, { opacity: 0 }],
      { duration: DURATION_MS, easing: EASE, fill: 'both' })
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
        {/* The counter-scaled layer. Everything the reader reads lives inside
            it, so the bar and the card distort identically — which is to say
            not at all. `transform-origin` matches the shell's, or the two
            transforms cancel everywhere except the top-left corner. */}
        <div
          ref={contentRef}
          data-explore-content
          className="flex min-h-0 flex-1 flex-col"
          style={{ transformOrigin: 'top left' }}
        >
        <div
          data-explore-detail-header
          className={clsx(
            /**
             * Trimmed from 61px to 49.
             *
             * The bar sits UNDER the app header, so a detail view was spending
             * 126px of a 700px phone on two stacked chromes and handing the
             * card 574px where the feed gives it 590 — reported as the banner
             * being too large and the tile too small.
             *
             * The 8px of vertical padding was the part doing no work: the
             * button already carries its own height, and `index.css` gives
             * every button a 44px minimum on a coarse pointer, so the padding
             * was purely additive. The control keeps its full 44px target —
             * a back control is primary navigation and is not somewhere to
             * claw back pixels by going under the accessibility floor.
             */
            'flex shrink-0 items-center gap-2 border-b border-gray-200 bg-white/95 px-2 py-0.5',
            'backdrop-blur dark:border-gray-800 dark:bg-gray-900/95',
            '[padding-top:calc(0.125rem+env(safe-area-inset-top))]',
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
            className="-ml-1 flex h-11 items-center gap-1 rounded-full pl-1.5 pr-3 text-[14px] font-semibold text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
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
