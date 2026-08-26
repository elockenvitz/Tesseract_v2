import type { ExploreItem } from './explore-item'

/**
 * What a card DRAWS, and why that is a different question from what it says.
 *
 * ── The problem this exists to fix ────────────────────────────────────────
 *
 * Explore drew a sparkline whenever an item had a ticker. `exploreChartEligible`
 * was `symbol && !NO_CHART.has(subtype)`, so a year of closes appeared under a
 * missing-thesis card, a missing-target card, a conviction mismatch, a scenario
 * breach and a news story alike — five different findings wearing one picture.
 *
 * A price line under "MSFT has no research" is not evidence for that claim. The
 * claim is about exposure without work, and the line answers a question nobody
 * asked. It is not merely redundant: it implies the price is the reason the card
 * is here, which is false for most of them, and it makes the page read as a
 * wall of identical widgets rather than a map of different problems.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * **The visual explains why the item matters.** A scenario breach draws the
 * range the price escaped. An expired target draws time. A no-research position
 * draws exposure. A thought draws its own words. A price trend is drawn only
 * where the trajectory IS the story.
 *
 * ── Why the archetype is resolved here and not in the tile ────────────────
 *
 * Same reason `explore-preview` exists: the tile renders what it is given, and
 * a decision made across a `.map` in JSX is a decision nobody can test. This is
 * pure, total, and deterministic — every item gets an answer, the answer depends
 * only on the item, and an item missing the data for its ideal visual falls back
 * rather than drawing an empty box.
 *
 * ── On inventing data ─────────────────────────────────────────────────────
 *
 * Nothing here computes a number the sources do not already carry. Every field
 * below is plumbed from a lens or a builder that already had it — the scenario
 * ladder, the horizon dates, the book weight — and where a source genuinely has
 * no second number (conviction is a WORD, not a target weight) the archetype
 * degrades to typography instead of drawing a comparison against a guess.
 *
 * Pure — no React, no Supabase. The gallery imports it directly.
 */

/** A modelled case, as the scenario builder already holds it. */
export interface VisualCase {
  label: string
  price: number
}

export type ExploreVisual =
  /**
   * The price escaped the range somebody modelled.
   *
   * The only archetype that needs three numbers and is worthless with two: the
   * point is the RELATIONSHIP between where the price is and where the analyst
   * said it would be, and a bar without both ends cannot show it.
   */
  | {
      kind: 'scenario_range'
      low: number
      high: number
      current: number
      /** The case the price is beyond, where the builder named one. */
      breachedLabel?: string
      cases?: VisualCase[]
    }
  /**
   * Where the price sits against a stated target — or against the absence of one.
   *
   * `target: null` is a first-class state, not a missing value. A dashed empty
   * slot says "nobody has put a number here", which is the entire finding on a
   * no-target card, and it must never be drawn as a zero or as a guess.
   */
  | { kind: 'target_compare'; current: number; target: number | null; targetLabel?: string }
  /**
   * Time is the reason the card exists, so time is the picture.
   *
   * Used where the trigger is an elapsed clock: a horizon that ran out, research
   * nobody has touched, a review past its date.
   */
  | { kind: 'timeline'; statedAt: string; dueAt: string; overdueLabel?: string }
  /** How much of a book rides on this, when the finding is about exposure. */
  | { kind: 'exposure'; weightPct: number; portfolioName?: string }
  /**
   * Two weights that disagree, both of them real.
   *
   * Deliberately NOT "position vs conviction" as a bar pair: conviction is
   * stored as a word — `high`, `medium` — and there is no intended-weight number
   * anywhere in the model. Drawing one would be inventing the comparison the
   * card is about. Where a benchmark file exists the active weight is a genuine
   * second number and this renders it; where it does not, the resolver returns
   * `exposure` instead and the card says what it knows.
   */
  | { kind: 'comparison'; rows: { label: string; pct: number }[]; deltaLabel?: string }
  /** A move measured FROM a review, with the review marked. */
  | { kind: 'last_look'; movePct: number; lastLookAt: string }
  /** Where an authored thing has got to. Stages the source actually reports. */
  | { kind: 'workflow'; stages: string[]; activeIndex: number; direction?: 'buy' | 'sell' }
  /** Somebody's words, as the hero. */
  | { kind: 'quote'; text: string; author?: string }
  /** The trajectory itself is the story. The sparkline, used deliberately. */
  | { kind: 'price_trend' }
  /** Typography carries it. The honest answer far more often than it was used. */
  | { kind: 'none' }

/**
 * Data an adapter plumbed through for the visual, when the source had it.
 *
 * Optional at every level: an item that arrives without it falls back, and the
 * page degrades to what it degraded to before rather than to a hole.
 */
export interface ExploreVisualData {
  /** Modelled cases and the price, from the scenario builder's own evidence. */
  cases?: VisualCase[]
  currentPrice?: number | null
  /** The stated target, or explicit null where the finding is its absence. */
  target?: number | null
  /** Horizon dates, from the target row. */
  statedAt?: string | null
  dueAt?: string | null
  /** The benchmark weight for this name in this book, where a file exists. */
  benchmarkPct?: number | null
  /** How far the price has moved since anybody reviewed it. */
  movePct?: number | null
  lastLookAt?: string | null
  /** An authored item's stage rail. */
  stages?: string[]
  activeStage?: number
  direction?: 'buy' | 'sell'
  /** A thought's own words. */
  quote?: string
}

/** Types whose entire claim is that time has passed. */
const TIME_DRIVEN = new Set(['target_expired', 'research_stale', 'project_overdue', 'awaiting_review'])

/** Types whose claim is a price trajectory, and only these. */
const TREND_DRIVEN = new Set(['unusual_move'])

/**
 * The archetype for one item.
 *
 * Ordered most-specific first. Each branch checks that the data it needs is
 * actually present before claiming the item, so a missing field falls through
 * to the next honest answer rather than producing an empty visual.
 */
export function exploreVisualFor(
  item: ExploreItem & { visual?: ExploreVisualData },
): ExploreVisual {
  const v = item.visual ?? {}
  const type = item.signalType ?? ''

  /**
   * A thought is its own words, and nothing else.
   *
   * Checked first because it is the one case where the CONTENT is the visual —
   * "People want cheap food." under a chart of the stock is the picture arguing
   * with the sentence.
   */
  if (v.quote) {
    return { kind: 'quote', text: v.quote, author: item.source?.label }
  }

  // ── The price against a range somebody modelled ────────────────────────
  if (v.cases?.length && v.currentPrice != null && Number.isFinite(v.currentPrice)) {
    const prices = v.cases.map(c => c.price).filter(p => Number.isFinite(p) && p > 0)
    if (prices.length >= 2) {
      const low = Math.min(...prices)
      const high = Math.max(...prices)
      // A degenerate ladder — every case at one number — has no range to draw.
      if (high > low) {
        const above = v.currentPrice > high
        const below = v.currentPrice < low
        const edge = above
          ? v.cases.reduce((a, b) => (b.price > a.price ? b : a))
          : below
            ? v.cases.reduce((a, b) => (b.price < a.price ? b : a))
            : null
        return {
          kind: 'scenario_range',
          low, high, current: v.currentPrice,
          breachedLabel: edge?.label,
          cases: v.cases,
        }
      }
    }
  }

  // ── The price against a target, present or absent ──────────────────────
  if (v.currentPrice != null && Number.isFinite(v.currentPrice) && 'target' in v) {
    // `null` is the finding on a no-target card and must survive as null.
    const target = v.target != null && Number.isFinite(v.target) ? v.target : null
    return { kind: 'target_compare', current: v.currentPrice, target }
  }

  // ── Elapsed time, where the clock is the trigger ────────────────────────
  if (TIME_DRIVEN.has(type) && v.statedAt && v.dueAt) {
    return {
      kind: 'timeline',
      statedAt: v.statedAt,
      dueAt: v.dueAt,
      overdueLabel: item.metric?.label,
    }
  }

  // ── A move measured from the last review ───────────────────────────────
  if (v.movePct != null && Number.isFinite(v.movePct) && v.lastLookAt) {
    return { kind: 'last_look', movePct: v.movePct, lastLookAt: v.lastLookAt }
  }

  // ── Two weights that disagree, both real ───────────────────────────────
  const weight = item.portfolio?.weightPct
  if (weight != null && v.benchmarkPct != null && Number.isFinite(v.benchmarkPct)) {
    const delta = weight - v.benchmarkPct
    return {
      kind: 'comparison',
      rows: [
        { label: 'Position', pct: weight },
        { label: 'Index', pct: v.benchmarkPct },
      ],
      deltaLabel: `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pts active`,
    }
  }

  // ── Where an authored thing has got to ─────────────────────────────────
  if (v.stages?.length) {
    return {
      kind: 'workflow',
      stages: v.stages,
      activeIndex: Math.min(Math.max(v.activeStage ?? 0, 0), v.stages.length - 1),
      direction: v.direction,
    }
  }

  /**
   * Exposure, where the finding is about how much rides on it.
   *
   * The catch-all for the position-shaped gaps — no research, no target with no
   * price to compare, an oversized holding with no benchmark file. "You own
   * THIS much without the work" is the claim, and a bar is the shortest way to
   * say it.
   */
  if (weight != null && Number.isFinite(weight) && weight > 0 && item.subtype !== 'news') {
    return { kind: 'exposure', weightPct: weight, portfolioName: item.portfolio?.name }
  }

  /**
   * The sparkline, now earned rather than assumed.
   *
   * Reached only by types whose claim IS the trajectory. Everything else that
   * happens to have a ticker now falls to `none`, which is the change this file
   * exists to make.
   */
  if (TREND_DRIVEN.has(type) && item.symbol) return { kind: 'price_trend' }

  return { kind: 'none' }
}

/**
 * Whether a sparkline belongs on this card.
 *
 * Replaces `exploreChartEligible`, whose test was "has a ticker". The chart is
 * now one archetype among ten rather than the default for anything nameable.
 */
export function exploreDrawsSparkline(
  item: ExploreItem & { visual?: ExploreVisualData },
): boolean {
  return exploreVisualFor(item).kind === 'price_trend'
}

/**
 * A short name for the archetype, for layout rhythm and for tests.
 *
 * The packer uses this to avoid three cards in a row that look the same — see
 * `packExplore`. It is presentation only and never touches ranking.
 */
export function exploreVisualKind(
  item: ExploreItem & { visual?: ExploreVisualData },
): ExploreVisual['kind'] {
  return exploreVisualFor(item).kind
}

/**
 * Whether the archetype needs width to be legible.
 *
 * A range bar with three labelled points and a marker outside it is unreadable
 * at half a phone width; a quote and an exposure bar are fine. Feeds into
 * sizing so a card is wide because its picture needs the room, which is the
 * "width must be earned" rule applied to the visual rather than only to the
 * number.
 */
export function visualNeedsWidth(kind: ExploreVisual['kind']): boolean {
  return kind === 'scenario_range' || kind === 'timeline' || kind === 'comparison'
}
