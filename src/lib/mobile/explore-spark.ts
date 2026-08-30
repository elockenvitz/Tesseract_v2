import type { ExploreItem } from './explore-item'
import { exploreVisualKind } from './explore-visual'

/**
 * When an Explore card gets a price line, and what shape that line takes.
 *
 * ── Why sparklines had all but vanished ───────────────────────────────────
 *
 * Not one bug. Two gates multiplied, and the product of two small numbers is
 * zero:
 *
 *   1. **Almost nothing asked.** `exploreVisualFor` reaches `price_trend` for
 *      four signal types (`unusual_move`, `target_hit`, `earnings_result`,
 *      `catalyst_ahead`) and for a bare signal that falls past every other
 *      branch. Every richer archetype is checked first, so a lens item with a
 *      horizon draws a timeline, one with a benchmark draws a comparison, one
 *      with a modelled ladder draws a range — and none of them asks for a line.
 *      Measured over production-shaped rows: three of thirteen items asked.
 *
 *   2. **Most of those three got nothing back.** `TileSparkline` reads
 *      `price_history_cache`, which covers a minority of the asset universe,
 *      and renders `null` rather than an empty box when a name is not in it.
 *      That is the right behaviour and it makes the first gate invisible.
 *
 * So the line was never removed; it was asked for rarely and answered rarely.
 * (One narrowing was mine: Pass 2 took `research` out of the tape fallback,
 * on the grounds that a year of closes says nothing about a thesis changing.
 * That reasoning still holds — a research card gets a line here only when the
 * window is anchored to something the card is actually about.)
 *
 * ── What this module adds ─────────────────────────────────────────────────
 *
 * A second, narrower question, asked only of the cards that draw NOTHING. The
 * archetype still decides first and still wins; this decides whether a card
 * with no picture at all would be better with a price path, and over what
 * window. That ordering is the whole design:
 *
 *   • it can never stack two pictures on one card, and
 *   • it can never displace a picture that explains the finding better.
 *
 * Deterministic and pure. No clock of its own beyond the `now` passed in, no
 * randomness, no render-time coin flips — the same item always plans the same
 * line, which is what stops the feed shimmering between renders.
 */

/** How the line sits on the card. Three placements, not one repeated. */
export type SparkForm =
  /** No line. The card is typography, or its archetype already draws. */
  | 'none'
  /** A short line beside a number, reading as punctuation on the metric. */
  | 'inline'
  /** A wider line along the lower edge of a compact card. */
  | 'edge'
  /** The chart IS the card's picture, at feature weight. */
  | 'primary'

export interface SparkPlan {
  form: SparkForm
  /**
   * ISO date the window opens at, where the finding names one.
   *
   * This is the difference between a price line and an ANSWER: "since anyone
   * last looked" and "since this idea was posted" are the windows the two
   * cards are about, and a year of closes is neither. Null means the full
   * cached window, which is right for a card whose claim is simply the recent
   * path.
   */
  since: string | null
  /** What the opening of the window means, for the chart's own caption. */
  sinceLabel: string | null
  /** Why this plan. Rendered nowhere; asserted in tests, read in review. */
  reason: string
}

const NO_SPARK = (reason: string): SparkPlan =>
  ({ form: 'none', since: null, sinceLabel: null, reason })

/**
 * An idea has to be old enough for "since" to mean anything.
 *
 * A proposal posted this morning has no path worth drawing, and a two-point
 * line implying a trend from six hours of trading is a stronger claim than the
 * data supports.
 */
const IDEA_MIN_AGE_DAYS = 5

const DAY = 86_400_000

function ageDays(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return (now - t) / DAY
}

/**
 * The plan for one card.
 *
 * ── The order, and why it is this order ───────────────────────────────────
 *
 * The archetype is consulted FIRST and its answer is final in both directions.
 * If it chose `price_trend`, the chart is already the card's picture and this
 * only says so at feature weight. If it chose anything else, that picture
 * explains the finding better than a price path would and the card gets no
 * second one — a scenario band with a sparkline under it is two charts
 * competing inside 178 pixels.
 *
 * Only a card drawing NOTHING reaches the per-type rules below. Those cards
 * are the ones the brief is about: the white rectangles that resolve to
 * metadata, a headline, grey copy and no picture at all.
 */
export function exploreSparkPlan(item: ExploreItem, now: number = Date.now()): SparkPlan {
  if (!item.symbol) return NO_SPARK('no symbol to chart')
  if (item.subtype === 'aggregate') return NO_SPARK('an aggregate stands for many names')
  /**
   * A task is a deadline, not a price.
   *
   * §"Generally no sparkline unless there is a genuinely market-derived
   * reason" — and a workflow row's reason is a due date, which the timeline
   * archetype already draws.
   */
  if (item.subtype === 'workflow') return NO_SPARK('workflow is deadline-driven, not price-driven')

  const archetype = exploreVisualKind(item)
  if (archetype === 'price_trend') {
    return {
      form: 'primary',
      since: null,
      sinceLabel: null,
      reason: 'the archetype chose the price path as the finding',
    }
  }
  /**
   * The one archetype a real price path beats.
   *
   * `last_look` draws a marker, a rule and a number: "Last look — +18% —
   * Today". It was built because no windowed price path was available to the
   * tile, and the brief's own example is exactly this card — "NVDA has moved
   * 15% since anyone last looked, show the path from LAST LOOK to TODAY".
   * The actual shape of those months says everything the rail says and adds
   * the path, which is the whole question a reader has about a stale name.
   *
   * Safe to prefer because the caller passes the rail as the chart's fallback:
   * a name with no cached closes keeps the picture it has today. See
   * `TileSparkline.fallback`.
   */
  if (archetype === 'last_look') {
    const lastLook = item.visual?.lastLookAt ?? null
    return lastLook
      ? { form: 'edge', since: lastLook, sinceLabel: 'Last look', reason: 'the real path beats the schematic rail' }
      : NO_SPARK('last_look without a date to anchor')
  }

  if (archetype !== 'none') {
    return NO_SPARK(`${archetype} already explains this card`)
  }

  /**
   * ── Why there is no `signal` branch below ───────────────────────────────
   *
   * There was one, and it could never run. `exploreVisualFor` ends with a tape
   * fallback for the `signal` subtype, so a signal carrying a symbol and no
   * richer archetype has ALREADY resolved to `price_trend` and been answered
   * by the `primary` branch above. A signal without a symbol returned at the
   * top. There is no third case, and a branch that cannot be reached is a rule
   * nobody can rely on — a test asking for it is what found this.
   *
   * Signals therefore get the highest chart rate of any type, which is what
   * the brief asks for, and they get it from the archetype rather than from a
   * second rule that would have to be kept in step with it.
   */
  switch (item.subtype) {
    /**
     * Research earns a line only when the window is anchored.
     *
     * "NVDA has moved 18% since anyone last looked" is a claim ABOUT a window,
     * and drawing that exact window is the chart doing the sentence's work. A
     * research card with no review date has no window, and a year of closes
     * under it would be the generic tape this file exists to refuse.
     */
    case 'research': {
      const lastLook = item.visual?.lastLookAt ?? null
      if (!lastLook) return NO_SPARK('research: no review date to anchor a window')
      return { form: 'edge', since: lastLook, sinceLabel: 'Last look', reason: 'research: the move since the review is the finding' }
    }

    /**
     * A proposal with a direction and some road behind it.
     *
     * A narrative post keeps its typography: a thought's content IS its
     * content, and a price line under somebody's sentence implies the market
     * is the argument. Only a card that took a POSITION — a buy or a sell —
     * has a claim the subsequent path speaks to.
     */
    case 'idea': {
      if (!item.visual?.direction) return NO_SPARK('idea: narrative post, its words are the content')
      const age = ageDays(item.occurredAt, now)
      if (age == null || age < IDEA_MIN_AGE_DAYS) return NO_SPARK('idea: too new for a path to mean anything')
      return { form: 'edge', since: item.occurredAt ?? null, sinceLabel: 'Idea', reason: 'idea: the path since the call was made' }
    }

    /**
     * A story earns a line only when the card already states a market
     * reaction. Without one there is nothing to corroborate, and Explore
     * becomes a financial-news app with a chart on every headline.
     */
    case 'news': {
      if (!item.metric) return NO_SPARK('news: no stated market reaction to corroborate')
      return { form: 'inline', since: item.occurredAt ?? null, sinceLabel: 'Published', reason: 'news: the move the metric names' }
    }

    default:
      return NO_SPARK('no rule for this subtype')
  }
}

/**
 * Trim a series to the window the plan asked for.
 *
 * Kept here rather than in the fetching component so it can be tested without
 * a network, and so the rule "a window too short to draw is no window" lives
 * beside the rule that chose the window.
 *
 * Falls back to the FULL series rather than to nothing when the cache does not
 * reach back far enough: a line that starts later than the marker is still an
 * honest recent path, and the caption says which window it covers either way.
 */
export function sliceSince<T extends { date: string }>(
  points: T[],
  since: string | null,
): T[] {
  if (!since) return points
  const t = new Date(since).getTime()
  if (!Number.isFinite(t)) return points
  const cut = points.filter(p => new Date(p.date).getTime() >= t)
  // Two points is the minimum that draws a line at all; below that the full
  // series says more than a stub would.
  return cut.length >= 2 ? cut : points
}
