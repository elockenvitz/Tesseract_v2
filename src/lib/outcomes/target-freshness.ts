/**
 * Is a price target still standing, and as of when?
 *
 * ── Why this module exists ────────────────────────────────────────────────
 *
 * Three surfaces of the Asset Page answered that question three different
 * ways, and two of them disagreed on the same row:
 *
 *   Research / Organization  did not answer it at all. `PriceTargetsSummary`
 *                            rendered Bull $180 / Base $120 / Bear $90 with
 *                            no date, no horizon and no status, so targets
 *                            whose horizon ran out in August 2026 read as the
 *                            firm's current valuation.
 *
 *   The target editor        derives an expiry client-side from
 *                            `updated_at + timeframe`. For AMZN's Bull target
 *                            that lands on 2027-08-23 — still current — while
 *                            the evaluated outcome says the target ended
 *                            2026-08-30. The derivation also restarts every
 *                            time anyone saves, so editing a reasoning note
 *                            silently extends the life of a target.
 *
 *   History / Overview       read `price_target_outcomes.status`, and were
 *                            right: "Price target expired — $180.00".
 *
 * This module is the one rule, so Research can agree with History without
 * copying its query.
 *
 * ── What is authoritative, and why ────────────────────────────────────────
 *
 * `price_target_outcomes` wins wherever a row exists. It is an EVALUATED
 * record — it carries `evaluated_at`, `price_at_expiry` and `accuracy_pct` —
 * produced by something that actually looked at the price against the target
 * on the date it mattered. A client-side countdown from `updated_at` is a
 * guess about the horizon, and a guess that an unrelated edit can move.
 *
 * ── The join is the foreign key, never a resemblance ──────────────────────
 *
 * `price_target_outcomes.price_target_id` references
 * `analyst_price_targets.id`. That is the association used here and the only
 * one. Matching on price would collapse two analysts who happen to agree on
 * $180; matching on scenario would collapse every revision of a Bull case
 * into one verdict. Both would attach the wrong outcome to the wrong target
 * and neither failure announces itself.
 *
 * ── Absence of an outcome is not expiry ───────────────────────────────────
 *
 * A target set last week has no outcome row yet. Reading "no outcome" as
 * "expired" would retire live work; reading it as "current" would be the bug
 * this module exists to fix, one table over. So an un-evaluated target falls
 * back to its OWN fixed date when it has one, and is reported `unknown`
 * when it does not. `unknown` is a real answer here and renders as one.
 *
 * Note that `analyst_price_targets.target_date` is null for every AMZN row:
 * these are `timeframe_type: 'preset'` targets whose effective date lives on
 * the outcome. That is exactly why the fallback cannot be the whole rule.
 */

/** The evaluated states `price_target_outcomes.status` may hold. */
export type OutcomeStatusValue = 'pending' | 'hit' | 'missed' | 'expired' | 'cancelled'

/**
 * What a reader should be told about one target, or one scenario's worth.
 *
 *   current    still standing — an outcome says `pending`, the target is
 *              rolling, or its own date has not arrived.
 *   expired    the horizon ran out without resolution.
 *   hit        reached before the horizon.
 *   missed     resolved against.
 *   cancelled  withdrawn.
 *   unknown    nothing on record can say. Not a synonym for current.
 *   mixed      scenario level only: its targets do not agree.
 */
export type FreshnessState =
  | 'current' | 'expired' | 'hit' | 'missed' | 'cancelled' | 'unknown' | 'mixed'

export interface TargetFreshness {
  state: FreshnessState
  /** The date the state refers to, ISO, when one is on record. */
  asOf: string | null
  /** Where the verdict came from, so a reader can tell evaluation from inference. */
  basis: 'outcome' | 'target-date' | 'rolling' | 'none'
}

/** The fields this rule needs from `analyst_price_targets`. */
export interface FreshnessTargetInput {
  id: string
  target_date?: string | null
  is_rolling?: boolean | null
}

/** The fields this rule needs from `price_target_outcomes`. */
export interface FreshnessOutcomeInput {
  price_target_id: string
  status: OutcomeStatusValue | string
  target_date?: string | null
}

const RESOLVED: Record<string, FreshnessState> = {
  pending: 'current',
  hit: 'hit',
  missed: 'missed',
  expired: 'expired',
  cancelled: 'cancelled',
}

/**
 * One target's standing.
 *
 * `now` is injected rather than read from the clock so the boundary cases are
 * testable without freezing time globally.
 */
export function targetFreshness(
  target: FreshnessTargetInput,
  outcomes: readonly FreshnessOutcomeInput[],
  now: Date = new Date(),
): TargetFreshness {
  /* The foreign key, and nothing else. */
  const outcome = outcomes.find(o => o.price_target_id === target.id)

  if (outcome) {
    const state = RESOLVED[outcome.status]
    /* An unrecognised status is reported as unknown rather than guessed into
       one of the five. A new status value should surface, not be absorbed. */
    if (!state) return { state: 'unknown', asOf: outcome.target_date ?? null, basis: 'outcome' }
    return { state, asOf: outcome.target_date ?? null, basis: 'outcome' }
  }

  /* A rolling target has no horizon to run out of. */
  if (target.is_rolling) return { state: 'current', asOf: null, basis: 'rolling' }

  if (target.target_date) {
    const due = new Date(target.target_date)
    if (Number.isNaN(due.getTime())) {
      return { state: 'unknown', asOf: null, basis: 'none' }
    }
    return {
      state: due.getTime() >= now.getTime() ? 'current' : 'expired',
      asOf: target.target_date,
      basis: 'target-date',
    }
  }

  return { state: 'unknown', asOf: null, basis: 'none' }
}

/**
 * The standing of a scenario card, which aggregates several analysts' targets.
 *
 * Unanimity is reported as itself. Disagreement is reported as `mixed` rather
 * than resolved by picking a winner: a card showing one aggregated price whose
 * inputs are half live and half lapsed is not current, and saying so is the
 * point of this work. `asOf` carries the latest date on record so the reader
 * still gets a horizon to judge by.
 *
 * `unknown` members do not outvote a known state — a scenario where one target
 * is evaluated expired and another was never evaluated is still expired as far
 * as anything on record goes. A scenario with nothing but unknowns is unknown.
 */
export function scenarioFreshness(
  targets: readonly FreshnessTargetInput[],
  outcomes: readonly FreshnessOutcomeInput[],
  now: Date = new Date(),
): TargetFreshness {
  if (targets.length === 0) return { state: 'unknown', asOf: null, basis: 'none' }

  const each = targets.map(t => targetFreshness(t, outcomes, now))
  const known = each.filter(f => f.state !== 'unknown')

  /* ISO dates sort lexicographically, so the last one is the latest.
     Index access rather than `.at(-1)`: this project's lib target predates it. */
  const latest = (list: readonly TargetFreshness[]): string | null => {
    const dates = list
      .map(f => f.asOf)
      .filter((d): d is string => !!d)
      .sort()
    return dates.length > 0 ? dates[dates.length - 1] : null
  }

  if (known.length === 0) return { state: 'unknown', asOf: latest(each), basis: 'none' }

  const states = new Set(known.map(f => f.state))
  if (states.size === 1) {
    const only = known[0]
    return { state: only.state, asOf: latest(known), basis: only.basis }
  }

  return { state: 'mixed', asOf: latest(known), basis: 'outcome' }
}

/** Short label for a freshness state. Kept here so every surface says it the same way. */
export const FRESHNESS_LABEL: Record<FreshnessState, string> = {
  current: 'Current',
  expired: 'Expired',
  hit: 'Hit',
  missed: 'Missed',
  cancelled: 'Cancelled',
  unknown: 'No horizon on record',
  mixed: 'Mixed horizons',
}

/** True when the state means "this number no longer stands". */
export function isStale(state: FreshnessState): boolean {
  return state === 'expired' || state === 'missed' || state === 'cancelled' || state === 'mixed'
}
