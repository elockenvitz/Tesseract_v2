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
  basis: 'outcome' | 'target-date' | 'rolling' | 'created-timeframe' | 'none'
}

/** The fields this rule needs from `analyst_price_targets`. */
export interface FreshnessTargetInput {
  id: string
  target_date?: string | null
  is_rolling?: boolean | null
  /**
   * The horizon anchor, and the reason this field is here.
   *
   * The target editor derived its countdown from `updated_at + timeframe`.
   * `updated_at` moves on ANY save -- there is a BEFORE UPDATE trigger that
   * touches it -- so correcting a typo in `reasoning` pushed the displayed
   * expiry a full timeframe into the future, and a target the outcome had
   * already evaluated as expired read as current in the editor.
   *
   * `created_at` is when the horizon began and does not move.
   *
   * ── A correction to what this comment used to claim ──────────────────────
   *
   * It said the database agrees, anchoring on `NEW.created_at`. That is only
   * half true, and the half it omits is the one that matters. Read from the
   * live `create_outcome_for_target` on 2026-11-14:
   *
   *   IF TG_OP = 'UPDATE' AND COALESCE(NEW.is_rolling,false) = false
   *     THEN v_base_date := NOW();        -- the analyst is RENEWING
   *     ELSE v_base_date := NEW.created_at;
   *
   * So on INSERT the horizon runs from `created_at`, and on UPDATE it
   * RESTARTS from now -- and the row's `status` is reset to `pending` and its
   * evaluation cleared at the same time. A republished target genuinely gets
   * a fresh horizon.
   *
   * This branch is therefore a fallback for a target with no outcome row, and
   * `created_at` is the right anchor for exactly that case: no outcome row
   * means no UPDATE has been recorded against it. It is NOT a client-side
   * reimplementation of the database's rule, and must not be used as one --
   * where an outcome row exists its `target_date` already carries whichever
   * anchor the database used, which is why that branch wins above.
   */
  created_at?: string | null
  timeframe?: string | null
  timeframe_type?: string | null
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

    /*
     * `pending` means "nothing has evaluated this yet", NOT "still standing".
     *
     * The two are the same thing only if something flips the row on the day
     * its horizon passes, and nothing does. Measured against production on
     * 2026-11-14: of 26 outcome rows holding `pending`, FIVE had a
     * `target_date` already in the past -- the earliest 2026-04-12, seven
     * months before. So the status column and the horizon column on the SAME
     * ROW disagreed, and this function took the stale one.
     *
     * That is the divergence this module was written to end, surviving inside
     * it: Research and the Asset Workspace read `status` here and reported a
     * lapsed target as the firm's current view.
     *
     * The horizon decides, because it is a fact about the target the day it
     * was written, while the status is a record of work that may not have
     * happened. `basis` stays `outcome` -- the date IS the outcome row's,
     * this is not a fallback to inference.
     *
     * Only `pending` is reconsidered. A terminal state is a verdict somebody
     * reached: a target HIT in month three is still `hit` long after its
     * horizon passes, and overriding that would retire real history.
     */
    if (state === 'current' && outcome.target_date) {
      const due = new Date(outcome.target_date)
      if (!Number.isNaN(due.getTime()) && due.getTime() < now.getTime()) {
        return { state: 'expired', asOf: outcome.target_date, basis: 'outcome' }
      }
    }

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

  /*
   * A preset-duration target with no outcome row yet.
   *
   * Anchored on `created_at` -- never `updated_at`, which is the whole point
   * of this branch. In practice an outcome exists for every non-rolling
   * target, because `create_outcome_for_target` makes one on INSERT, so this
   * covers legacy rows and the window before that record lands.
   */
  const anchored = addTimeframe(target.created_at, target.timeframe)
  if (anchored) {
    return {
      state: anchored.getTime() >= now.getTime() ? 'current' : 'expired',
      asOf: toIsoDate(anchored),
      basis: 'created-timeframe',
    }
  }

  return { state: 'unknown', asOf: null, basis: 'none' }
}

/** `2026-08-30`, the shape every date on this path is stored and compared in. */
function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * Add a stored timeframe to an anchor date.
 *
 * Ported from the editor's own `calculateExpirationDate` so there is ONE
 * implementation of "what does '12 months' mean" rather than a copy per
 * surface. The behaviour is unchanged; only the anchor it is given has been
 * corrected, and that is the caller's decision rather than this function's.
 */
export function addTimeframe(
  anchorIso: string | null | undefined,
  timeframe: string | null | undefined,
): Date | null {
  if (!anchorIso || !timeframe) return null
  const base = new Date(anchorIso)
  if (Number.isNaN(base.getTime())) return null

  const tf = timeframe.toLowerCase()
  if (tf.includes('3 month')) base.setMonth(base.getMonth() + 3)
  else if (tf.includes('6 month')) base.setMonth(base.getMonth() + 6)
  else if (tf.includes('12 month') || tf.includes('1 year')) base.setFullYear(base.getFullYear() + 1)
  else if (tf.includes('18 month')) base.setMonth(base.getMonth() + 18)
  else if (tf.includes('24 month') || tf.includes('2 year')) base.setFullYear(base.getFullYear() + 2)
  else {
    const match = timeframe.match(/(\d+)\s*month/i)
    if (!match) return null
    base.setMonth(base.getMonth() + parseInt(match[1], 10))
  }
  return base
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
