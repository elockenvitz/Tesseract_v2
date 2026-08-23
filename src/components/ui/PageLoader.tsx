import { useEffect, useState } from 'react'

import { TesseractLoader } from './TesseractLoader'

/**
 * The branded loader, with the timing a branded loader needs.
 *
 * ── Why a spinner could go straight in and this cannot ────────────────────
 *
 * A spinner is a stateless loop: every frame looks like every other frame, so
 * it can appear and vanish at any moment and still look deliberate. The
 * Tesseract is a PHRASED animation — invert, turn, invert, over 4.5 seconds —
 * and a phrase cut off after 150ms is not a shortened phrase, it is a flicker.
 * Dropping it into 300 call sites unchanged would have traded a neutral
 * indicator for a mark that glitches on every fast query.
 *
 * So two thresholds, which is what makes the swap safe:
 *
 * **A delay before it appears.** Under `DELAY_MS` nothing renders at all.
 * Most queries in a warm cache return inside that window, and a loader that
 * never appears is better than one that flashes — the screen simply changes.
 * This is the older of the two rules and the one that matters most.
 *
 * **A minimum life once it has.** Having committed to showing the mark, it
 * stays for `MIN_VISIBLE_MS` even if the data lands immediately after. Without
 * this the delay just moves the flicker: a request that takes 210ms would show
 * the loader for 10ms.
 *
 * ── Where this belongs, and where it does not ─────────────────────────────
 *
 * Route-level loads, where this IS the screen and the reader has nothing else
 * to look at. Not buttons: at 16px the mark is twenty-four projected edges in a
 * space that can carry one stroke, and it resolves to a smudge — a rotating arc
 * stays legible there and the button already says "Saving…". Not content areas
 * with a known shape either; a skeleton says what is coming, and a loader of
 * any kind says only that nothing is here yet.
 */

/**
 * Long enough that a warm query never trips it, short enough that a cold one
 * does not feel unanswered. The usual quoted floor for "instant" is 100ms and
 * the usual ceiling for "responsive" is around 300.
 */
export const DELAY_MS = 200

/**
 * About one beat of the 4.5s loop — enough to read as a considered pause
 * rather than a blink, without holding a screen back that is ready to draw.
 */
export const MIN_VISIBLE_MS = 450

interface PageLoaderProps {
  /** Whether the thing being waited on is still pending. */
  loading?: boolean
  text?: string
  size?: number
  /**
   * Centre within the parent instead of the viewport.
   *
   * Almost never what you want — see `LOADER_ANCHOR`. Kept for a loader that
   * genuinely belongs to a panel rather than to the screen.
   */
  inline?: boolean
  className?: string
}

/**
 * Whether to paint a loader right now, given how long the wait has run.
 *
 * Exported so the thresholds are testable without a timer-driven render, and
 * so the two rules can be read as one function rather than inferred from two
 * `setTimeout` calls.
 */
export function useDeferredLoading(loading: boolean): boolean {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (loading) {
      // Nothing at all until the wait has proved itself long.
      const t = setTimeout(() => setVisible(true), DELAY_MS)
      return () => clearTimeout(t)
    }
    if (!visible) return
    // Shown, and now finished: hold the rest of the minimum. Measured from the
    // moment it became visible, so a 5s load hides the instant it lands.
    const t = setTimeout(() => setVisible(false), MIN_VISIBLE_MS)
    return () => clearTimeout(t)
    // `visible` is deliberately absent: including it would restart the hold
    // timer on the state change it causes, and the loader would never clear.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  return visible
}

/**
 * One vertical anchor for every loading state in the app.
 *
 * ── Why the viewport and not the container ────────────────────────────────
 *
 * The pre-JS boot element is `position: fixed; inset: 0`, because at the moment
 * it paints there is no layout to belong to. Every React loader centred inside
 * whatever box it happened to be in — and those boxes sit BELOW the app header,
 * so the mark landed lower than the one it was replacing. The figure jumped
 * down the screen partway through a single wait, which is exactly the seam all
 * the phase work was there to remove.
 *
 * Fixed and centred puts every mark in the same place as the boot element, on
 * every screen, with no header height to guess at — and a guess is what any
 * padding-based fix would be, since the header carries
 * `env(safe-area-inset-top)` and is a different height on every device.
 *
 * `pointer-events-none` because this is transparent: the header underneath
 * stays visible and usable while the wait runs, which is the reason not to just
 * cover the screen instead.
 */
export const LOADER_ANCHOR =
  'fixed inset-0 z-40 flex items-center justify-center pointer-events-none'

export function PageLoader({
  loading = true, text = 'Loading…', size = 96, inline = false, className = '',
}: PageLoaderProps) {
  const visible = useDeferredLoading(loading)
  if (!visible) return null
  return (
    <div
      data-testid="page-loader"
      // `role="status"` and `aria-live="polite"`: a screen reader gets told the
      // wait has begun without the announcement interrupting whatever is being
      // read. The mark itself is `role="img"` and carries its own label.
      role="status"
      aria-live="polite"
      className={`${inline ? 'flex h-full min-h-[240px] w-full items-center justify-center' : LOADER_ANCHOR} ${className}`}
    >
      <TesseractLoader size={size} text={text} compact />
    </div>
  )
}
