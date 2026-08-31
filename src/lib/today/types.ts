/**
 * Today — the production surface's item model.
 *
 * A `TodayItem` is a `DecisionItem` that has been asked five questions:
 * what happened, why it matters, why now, what next, and how to move it. The
 * engine answers the first two; this layer derives the rest and picks the one
 * visual that explains why the item surfaced at all.
 */

import type { DecisionItem, DecisionSeverity } from '../../engine/decisionEngine/types'
import type { EngagementTarget } from '../engagement'

/**
 * Priority tier — a hard partition, borrowed from mobile's discipline.
 *
 * Tier decides order; score only ever orders WITHIN a tier. That is the
 * property the architecture audit found desktop had lost by flattening
 * everything onto one `sortScore`: a two-hour-old workflow nudge could outrank
 * a position whose framework had broken, purely because it was newer.
 *
 * The names mirror `lib/signals/feed-priority.ts` so the two products describe
 * the same idea the same way, even though the tier MAP differs (mobile keys on
 * its own SignalType vocabulary; desktop keys on evaluator titleKey).
 */
export type TodayTier = 0 | 1 | 2 | 3 | 4

export const TIER_NAMES: Record<TodayTier, string> = {
  0: 'capital at risk',
  1: 'framework gap',
  2: 'someone is waiting',
  3: 'workflow',
  4: 'informational',
}

/**
 * Which visual explains this item.
 *
 * Chosen by what the evaluator actually knows, never by what would look good.
 * `metrics` is a real answer, not a failure: when the data for a specialised
 * visual is not present, strong typography beats a decorative chart that
 * implies a precision the item does not have.
 */
export type TodayArchetype =
  | 'exposure'          // how much of the book a position is
  | 'aging'             // how long something has been unresolved
  | 'staleness'         // evidence decaying over quarters
  | 'transition'        // a discrete change: rating from → to
  | 'expected-return'   // modelled upside against the current price
  | 'metrics'           // typographic fallback

/** A labelled number shown in the tile's metric strip. */
export interface TodayMetric {
  label: string
  value: string
  tone?: 'neutral' | 'up' | 'down' | 'warn'
}

/** Everything a visual needs, already resolved. Null when unavailable. */
export interface TodayVisual {
  archetype: TodayArchetype
  /** Short label for the visual's own header. */
  caption: string
  /** The window or unit the visual covers — never omitted (see mobile's rule). */
  window: string
  /** One line under the visual saying what it shows. */
  note?: string
  /** Archetype-specific numbers. */
  /**
   * Only the weight. There is deliberately no policy threshold here: the
   * engine loads no policy-limit source, so any tick drawn on this bar
   * would be a constraint Tesseract invented and then showed the user as
   * though it knew it.
   */
  exposure?: { weightPct: number }
  aging?: { days: number; milestones: { label: string; atPct: number; hot?: boolean }[] }
  staleness?: { days: number; quarters: number[] }
  transition?: { from: string; to: string }
  expectedReturn?: { evPct: number; direction: string }
}

export interface TodayItem {
  /** The engine item id — also the disposition key source. */
  id: string
  tier: TodayTier
  score: number
  severity: DecisionSeverity

  /** WHAT HAPPENED */
  ticker: string | null
  objectLabel: string
  state: string

  /**
   * WHY IT MATTERS / WHY NOW, as one investment statement.
   *
   * Previously two fields: the engine's queue-facing `description` as the
   * claim, and a separate why-now sentence under the metrics. They said the
   * same thing twice and made every tile taller than it needed to be.
   */
  claim: string
  metrics: TodayMetric[]

  /** WHAT NEXT */
  nextAction: string | null

  /** HOW TO MOVE IT */
  primary: { label: string; actionKey: string; payload?: Record<string, unknown> } | null
  target: EngagementTarget | null
  seedPrompt: string | null

  visual: TodayVisual
  /** Kept so the tile can dispatch the engine's own CTAs unchanged. */
  source: DecisionItem
}
