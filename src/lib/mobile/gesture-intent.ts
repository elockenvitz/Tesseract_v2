/**
 * Who owns the finger.
 *
 * ── The problem ───────────────────────────────────────────────────────────
 *
 * A single touch on a feed card has at least four plausible meanings, and the
 * surfaces that could claim it are nested inside one another:
 *
 *     feed scroller (vertical, snap)
 *       └─ card
 *           └─ carousel (horizontal, paged)
 *               └─ chart (horizontal, scrub)
 *               └─ slider (horizontal, drag)
 *
 * Every one of these was arbitrating independently, with its own thresholds
 * written inline — a 220ms hold here, a 6px slop there, a scroll-snap
 * somewhere else. So the answers disagreed at the margins, and the margins are
 * exactly where a real thumb lives. Reported as: scrubbing the chart scrolls
 * the feed, a swipe over the chart does nothing, dragging a slider pages the
 * carousel.
 *
 * ── The model ─────────────────────────────────────────────────────────────
 *
 * One gesture, one owner, decided once and then held until release.
 *
 *   1. **Undecided.** Below `SLOP` nothing has moved meaningfully. A press
 *      that stays here long enough becomes a chart hold; a release here is a
 *      tap.
 *   2. **Classified.** Past `SLOP` the direction decides, and the decision is
 *      final for that touch. Mostly-vertical goes to the feed; mostly-
 *      horizontal goes to the carousel — unless the chart already owns it.
 *   3. **Locked.** A deliberate press-and-hold on the chart, or a pointer that
 *      started on a slider thumb, takes ownership before any classification
 *      happens and keeps it through the noise a held finger always produces.
 *
 * The asymmetry between the axes is intentional and is the part that makes it
 * feel right: the feed is a snap scroller, so a vertical gesture that turns
 * out to be a scroll must be released to the browser EARLY and cheaply, while
 * a horizontal gesture is worth waiting a few more pixels on because the two
 * horizontal claimants (carousel, chart) are genuinely ambiguous.
 *
 * Pure — no React, no DOM. It takes numbers and returns a decision, so the
 * arbitration is unit-testable and the components hold no thresholds.
 */

export type GestureOwner =
  /** Nothing has claimed it yet. */
  | 'undecided'
  /** The feed scroller. In practice: leave it to the browser. */
  | 'feed'
  /** The horizontal pager. */
  | 'carousel'
  /** Chart inspection — crosshair follows the finger. */
  | 'chart'
  /** A slider thumb or track. */
  | 'slider'

/**
 * Every named threshold in the mobile gesture system.
 *
 * These are the numbers that decide how the surface FEELS, and they were
 * previously scattered across four components as bare literals. Tuning is a
 * matter of changing one of these and re-testing on a real device — which is
 * the only place the final values can honestly be chosen. See the manual test
 * plan; browser tests prove the ownership LOGIC, not the feel.
 */
export const GESTURE = {
  /**
   * Movement below this is noise, not intent.
   *
   * A finger resting on glass drifts a few pixels; a thumb pressing a small
   * control drifts more. Below this nothing is classified, which is what makes
   * a press-and-hold survive the tremor of holding still.
   */
  SLOP_PX: 8,

  /**
   * How long a still press must last before the chart takes the gesture.
   *
   * Long enough that a flick down the feed never trips it, short enough that a
   * deliberate press does not feel broken. 220ms was the value the chart used
   * before this module existed and it tested well on a phone; it is kept
   * rather than re-guessed.
   */
  CHART_HOLD_MS: 220,

  /**
   * Horizontal travel that commits an undecided gesture to the carousel.
   *
   * Deliberately larger than `SLOP_PX`: past the slop we know the finger is
   * moving, but the chart is still eligible, so the carousel has to earn it.
   */
  CAROUSEL_INTENT_PX: 24,

  /**
   * Vertical travel that releases an undecided gesture to the feed.
   *
   * Smaller than the horizontal threshold on purpose. The feed is the default
   * surface and a scroll that hesitates reads as a broken page, so vertical
   * intent is recognised sooner than horizontal.
   */
  FEED_ESCAPE_PX: 12,

  /**
   * How much more horizontal than vertical a movement must be to read as
   * horizontal intent.
   *
   * 1.4 is about 35 degrees off the horizontal. Below that a diagonal is
   * treated as vertical, because on a vertical feed an ambiguous diagonal is
   * far more often a slightly crooked scroll than a deliberate sideways swipe.
   */
  HORIZONTAL_RATIO: 1.4,

  /**
   * Vertical movement tolerated once the chart owns the gesture.
   *
   * A finger dragging sideways across a chart does not travel in a straight
   * line, and losing the scrub halfway across because the thumb rose 20px is
   * the single most annoying way this can fail. Generous on purpose — the
   * chart already has ownership, so this only decides when to give it up.
   */
  CHART_KEEP_PX: 48,

  /**
   * Slop for a gesture that began on a slider control.
   *
   * Tiny, because there is nothing to arbitrate: a pointer down on a thumb is
   * unambiguous, and the slider should track immediately rather than after a
   * dead zone.
   */
  SLIDER_SLOP_PX: 2,
} as const

export interface GesturePoint { x: number; y: number }

export interface GestureState {
  owner: GestureOwner
  start: GesturePoint
  /** ms since pointerdown. Only consulted while undecided. */
  elapsedMs: number
  /**
   * Set when the pointer went down on a control that owns gestures outright.
   * A slider thumb is the case that matters.
   */
  startedOn?: 'slider' | 'chart' | null
}

export function beginGesture(at: GesturePoint, startedOn?: 'slider' | 'chart' | null): GestureState {
  return {
    // A slider claims its gesture at pointerdown. There is no ambiguity to
    // resolve and any delay reads as an unresponsive control.
    owner: startedOn === 'slider' ? 'slider' : 'undecided',
    start: at,
    elapsedMs: 0,
    startedOn: startedOn ?? null,
  }
}

/**
 * Decide who owns the gesture, given where the finger is now.
 *
 * Called on every move. Once the owner is anything but `undecided` the answer
 * is stable for the rest of the touch — that stability IS the feature, and the
 * reason this returns a whole state rather than a verdict per event.
 */
export function advanceGesture(state: GestureState, at: GesturePoint, elapsedMs: number): GestureState {
  const dx = at.x - state.start.x
  const dy = at.y - state.start.y
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)

  // ── Already owned ──────────────────────────────────────────────────────
  if (state.owner === 'slider' || state.owner === 'carousel' || state.owner === 'feed') {
    return { ...state, elapsedMs }
  }

  if (state.owner === 'chart') {
    /**
     * The chart keeps it through vertical noise, and gives it up on a
     * genuine vertical departure.
     *
     * Without the escape a reader who engaged the chart and then decided to
     * scroll would be trapped: the non-passive touchmove handler blocks the
     * browser's pan for as long as the chart is engaged.
     */
    if (ay > GESTURE.CHART_KEEP_PX && ay > ax * GESTURE.HORIZONTAL_RATIO) {
      return { ...state, owner: 'feed', elapsedMs }
    }
    return { ...state, elapsedMs }
  }

  // ── Undecided ──────────────────────────────────────────────────────────

  /**
   * A still press on the chart engages inspection.
   *
   * Checked before the movement thresholds so that a hold which drifts a
   * couple of pixels still counts — which is every real hold.
   */
  if (state.startedOn === 'chart'
      && elapsedMs >= GESTURE.CHART_HOLD_MS
      && ax <= GESTURE.SLOP_PX && ay <= GESTURE.SLOP_PX) {
    return { ...state, owner: 'chart', elapsedMs }
  }

  if (ax <= GESTURE.SLOP_PX && ay <= GESTURE.SLOP_PX) {
    return { ...state, elapsedMs }
  }

  // Vertical intent is recognised first and on a shorter travel: the feed is
  // the default surface, and a scroll that hesitates reads as a broken page.
  if (ay >= GESTURE.FEED_ESCAPE_PX && ay * GESTURE.HORIZONTAL_RATIO > ax) {
    return { ...state, owner: 'feed', elapsedMs }
  }

  if (ax >= GESTURE.CAROUSEL_INTENT_PX && ax > ay * GESTURE.HORIZONTAL_RATIO) {
    return { ...state, owner: 'carousel', elapsedMs }
  }

  return { ...state, elapsedMs }
}

/**
 * Whether a chart hold is still possible for this gesture.
 *
 * The hold timer should be cancelled the moment it cannot fire, rather than
 * left to expire into a state where the finger has already left.
 */
export function holdStillPossible(state: GestureState, at: GesturePoint): boolean {
  if (state.owner !== 'undecided') return false
  return Math.abs(at.x - state.start.x) <= GESTURE.SLOP_PX
      && Math.abs(at.y - state.start.y) <= GESTURE.SLOP_PX
}
