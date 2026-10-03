/**
 * What a deferral actually promises, and what it cannot.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * A PM defers a recommendation. `deferred_until` and `deferred_trigger` are
 * written, displayed back, and read by nothing. The request leaves the
 * pending inbox and never returns on its own. The product shows a user a
 * condition it has no mechanism to evaluate, which is worse than showing
 * nothing: it transfers the obligation to remember from the user to a system
 * that is not remembering.
 *
 * ── Classification, against what this database actually holds ────────────
 *
 * Checked read-only on 2026-09-30, not assumed from the type:
 *
 *   DATE (`deferred_until`)
 *     A timestamp. Deterministic, needs nothing else. EVALUABLE.
 *
 *   price_level  { symbol, condition: above|below, price }
 *     Structured and genuinely computable — `price_history_cache` holds
 *     38,740 dated rows across 137 symbols, current to the previous
 *     session. But it covers 137 of 912 assets, so a sweep would resolve
 *     some deferrals and silently never resolve others. EVALUABLE IN
 *     PRINCIPLE; the sweep is deliberately not built here, and the
 *     obligation is raised with no due date rather than with a date we
 *     cannot stand behind.
 *
 *   earnings  { symbol }
 *     `asset_earnings_dates` exists and holds ZERO rows. There is no
 *     earnings calendar in this product. NOT EVALUABLE — and no amount of
 *     code here changes that; it needs a data source.
 *
 *   custom  { description }
 *     Free text a person wrote. NOT EVALUABLE without a model, and a model
 *     deciding that "when the CFO search concludes" has happened is a guess
 *     presented as a fact. NOT EVALUABLE, by design rather than by gap.
 *
 * ── What this slice therefore does ───────────────────────────────────────
 *
 * Every deferral raises a durable obligation, so no deferred recommendation
 * silently becomes undiscoverable. Only the date-based ones get a `due_at`
 * and so become automatically eligible to resurface. The rest stay
 * outstanding with no due date — findable, countable, never auto-fired, and
 * never described to the user as something Tesseract is watching.
 */
import type { DeferralTrigger } from '../../types/trading'

export type DeferralEvaluability =
  /** A date. Resurfaces on its own. */
  | 'date'
  /** Structured and computable, but no evaluator runs yet. */
  | 'structured_unevaluated'
  /** Structured, but the data needed to evaluate it does not exist. */
  | 'structured_no_data'
  /** Free text. Only a person can say whether it happened. */
  | 'manual'

export interface DeferralSemantics {
  evaluability: DeferralEvaluability
  /** The obligation's due_at. Null whenever we cannot honestly set one. */
  dueAt: string | null
  /** True only when the product will bring this back by itself. */
  autoResurfaces: boolean
  /**
   * What the UI may truthfully say. Never promises evaluation the product
   * does not perform.
   */
  promise: string
  /** Short machine-readable reason, for tests and telemetry. */
  reason: string
}

/**
 * Decide what we can promise about one deferral.
 *
 * A date always wins: a PM who set both a date and a condition has given us
 * something we can act on, and acting on the half we can evaluate is better
 * than acting on neither.
 */
export function classifyDeferral(args: {
  deferredUntil: string | null | undefined
  deferredTrigger: DeferralTrigger | null | undefined
}): DeferralSemantics {
  const { deferredUntil, deferredTrigger } = args

  if (deferredUntil && !Number.isNaN(Date.parse(deferredUntil))) {
    return {
      evaluability: 'date',
      dueAt: deferredUntil,
      autoResurfaces: true,
      promise: 'This will return to your inbox on the date you chose.',
      reason: 'deferred_until',
    }
  }

  switch (deferredTrigger?.type) {
    case 'price_level':
      return {
        evaluability: 'structured_unevaluated',
        dueAt: null,
        autoResurfaces: false,
        // Says what is true today. It is kept and findable; it is not
        // watched. Promising a price alert the product does not send is the
        // defect, restated in nicer words.
        promise:
          'Saved as an open follow-up. Tesseract does not yet watch prices for you — this will not resurface on its own.',
        reason: 'price_level:no-evaluator',
      }

    case 'earnings':
      return {
        evaluability: 'structured_no_data',
        dueAt: null,
        autoResurfaces: false,
        promise:
          'Saved as an open follow-up. Tesseract has no earnings calendar, so this will not resurface on its own.',
        reason: 'earnings:no-calendar',
      }

    case 'custom':
      return {
        evaluability: 'manual',
        dueAt: null,
        autoResurfaces: false,
        promise:
          'Saved as an open follow-up. Tesseract cannot tell when this condition is met — you decide when to pick it back up.',
        reason: 'custom:free-text',
      }

    default:
      return {
        evaluability: 'manual',
        dueAt: null,
        autoResurfaces: false,
        promise: 'Saved as an open follow-up. It will stay on your deferred list until you act on it.',
        reason: 'no-condition',
      }
  }
}

/** A one-line description of the condition, for a list row. Facts only. */
export function describeDeferralCondition(
  trigger: DeferralTrigger | null | undefined,
): string | null {
  if (!trigger) return null
  switch (trigger.type) {
    case 'price_level':
      return `${trigger.symbol} ${trigger.condition} ${trigger.price}`
    case 'earnings':
      return `${trigger.symbol} earnings`
    case 'custom':
      return trigger.description || null
    default:
      return null
  }
}
