import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TIER_HEIGHT, type CardTier } from '../../lib/signals/card-height'

/**
 * One position in the feed, whose card is mounted only when it is near.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 *
 * The feed rendered `feedEntries.map(renderEntry)` with no windowing, so every
 * entry was in the DOM at once — each one a full card with a carousel, an SVG
 * price chart and its own effects. Three things then compounded:
 *
 *   1. The list grows as you scroll. `cycle` re-presents derived insights on
 *      every pass, so depth multiplies the entry count rather than replacing
 *      it, and nothing is ever released.
 *   2. Every recompute rebuilds every entry object — `{...e, subject}`, then
 *      `{...r.item, score}` — so no card can be skipped by identity. Any state
 *      change in the dashboard re-renders all of them.
 *   3. There are many such state changes: quotes arriving, dispositions,
 *      sheets opening, the scroll cycle advancing.
 *
 * So the cost of one filter change, or one arriving price, was proportional to
 * how far the reader had scrolled. That is the "bogged down when I use the
 * filters" report, and it gets worse the longer the session runs.
 *
 * ── Why a slot rather than a virtual list ─────────────────────────────────
 *
 * A tile is one of three declared heights — see `card-height.ts` — and a
 * collapsed slot is an empty div of exactly that same height. No estimated
 * heights, no measurement, no cumulative drift: scroll height and every scroll
 * offset are unchanged whether a slot is mounted or not.
 *
 * The tier arrives as a PROP, derived from the entry, rather than being read
 * off the card once it mounts. That distinction is what preserves the
 * exactness: a tier learned at mount time would make a slot's height depend on
 * whether the reader had already scrolled past it, so landing on a deep tile
 * from above and jumping straight to it would give different offsets. Derived
 * from the entry, every slot is its final size in the first paint.
 *
 * That exactness is what makes this safe on a snap scroller, where a virtual
 * list with estimated heights would move the snap points around under the
 * reader. The wrapper carries `snap-start snap-always` itself, so a collapsed
 * slot still stops the scroller exactly where its card would have.
 *
 * ── Why `h-full` on the wrapper is load-bearing ───────────────────────────
 *
 * `h-full` resolves against the parent. Cards say `h-full` expecting the
 * scroller; putting a bare wrapper between them would give them a parent of
 * auto height and collapse every card to its content — a bug this file's
 * neighbours have been bitten by twice. The wrapper is `h-full` in both states
 * for that reason, not for tidiness.
 */

interface FeedSlotProps {
  /** The scrolling element, used as the observer root. */
  root: HTMLElement | null
  /**
   * Mount without waiting for the observer.
   *
   * The first screens have to be present in the first paint — waiting for an
   * IntersectionObserver callback would show an empty feed for a frame, which
   * on a cold load is exactly when the reader is watching.
   */
  initiallyNear: boolean
  /**
   * Rendered only while near. A function rather than a node so that composing
   * the card — the lookups and derivations `renderEntry` performs — is skipped
   * too, not merely its mounting.
   */
  render: () => ReactNode
  /**
   * How much room to reserve — the same value mounted or collapsed, so the
   * geometry above holds. See `cardTier`.
   */
  tier: CardTier
}

/**
 * How far outside the viewport a card is still worth keeping mounted.
 *
 * One and a half screens each way. Far enough that a normal flick never lands
 * on an unmounted slot, close enough that the mounted set stays around four
 * cards regardless of how deep the reader has scrolled.
 */
const NEAR_MARGIN = '150% 0px'

export function FeedSlot({ root, initiallyNear, render, tier }: FeedSlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  /**
   * Without an IntersectionObserver every slot stays mounted, which is the old
   * behaviour — correct, just slower. jsdom has none, and this is a rendering
   * optimisation rather than a feature, so degrading to "mount everything" is
   * the right failure.
   */
  const [near, setNear] = useState(
    () => initiallyNear || typeof IntersectionObserver === 'undefined',
  )
  /** Whether this entry's card turned out to render nothing. See below. */
  const emptyRef = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el || !root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      entries => { for (const e of entries) setNear(e.isIntersecting) },
      { root, rootMargin: NEAR_MARGIN, threshold: 0 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  /**
   * A slot whose card renders nothing takes no space.
   *
   * ── The blank screens ───────────────────────────────────────────────────
   *
   * `renderEntry` legitimately returns null: a builder can suppress a card,
   * and a suppressed card is supposed to disappear. Before windowing,
   * `entries.map(renderEntry)` put a null in the list and React rendered
   * nothing — correct, and invisible.
   *
   * The slot wrapper broke that. It is `h-full` by design, so it kept
   * occupying exactly one screen whether or not anything was inside it, and a
   * suppressed card became a full-height blank white tile with a snap point of
   * its own. Reported repeatedly, and it looked like a rendering crash rather
   * than what it was: the feed faithfully reserving space for nothing.
   *
   * Remembered rather than recomputed, because the answer must survive the
   * slot collapsing. Once a card is known to render nothing it renders nothing
   * in both states — otherwise scrolling past would restore the blank box.
   */
  const node = near ? render() : null
  if (near && (node === null || node === undefined || node === false)) {
    emptyRef.current = true
  }
  if (emptyRef.current) return null

  return (
    <div
      ref={ref}
      data-feed-slot={near ? 'mounted' : 'collapsed'}
      data-slot-tier={tier}
      className={`w-full snap-start snap-always ${TIER_HEIGHT[tier]}`}
    >
      {node}
    </div>
  )
}
