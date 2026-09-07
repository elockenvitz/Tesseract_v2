/**
 * Where `ViewerContext.canCommit` comes from, and why it is often false.
 *
 * ── The rule the stage sets ───────────────────────────────────────────────
 *
 * Map it from an existing authorization source, or default it to false and
 * keep a non-commit path. Do not invent a role model. So the first job is to
 * say what the existing sources actually are, and the second is to be honest
 * about which of them applies.
 *
 * ── What exists, and what each one governs ────────────────────────────────
 *
 * 1. `lib/permissions/trade-idea-permissions` — `getUserPortfolioRole`,
 *    `isPMForPortfolio`, `canInitiateDecision`. Real, and about TRADES: who
 *    may initiate a portfolio decision on a trade idea. It is also async and
 *    per-portfolio.
 *
 * 2. RLS on `analyst_price_targets`: `auth.uid() = user_id`. The database's
 *    own answer to "may this person change this number". `ScenarioCase.userId`
 *    exists specifically so the client can ask it before rendering a control —
 *    the builder's own comment records that the policy "fails SILENTLY,
 *    matching zero rows and returning success", so a control rendered without
 *    this check is a control that appears to work and does not.
 *
 * ── Which one governs these two situations ────────────────────────────────
 *
 * The committing intent in both is `revise_price_objective`: writing a price
 * target row. That is governed by (2) and not by (1). Importing the trade
 * permission model here would be inventing a role model in the most damaging
 * way available — by borrowing a real one that answers a different question,
 * so the code would look sourced and be wrong. An analyst who is not a PM
 * writes price targets every day.
 *
 * ── The honest asymmetry, and why it is left in place ─────────────────────
 *
 * Case-vs-price can be answered: the ladder on the card carries the author of
 * every case. Target-expired cannot: `StaleTarget` carries no author at all,
 * and the lens that produces it never selected one. So it defaults to false
 * and keeps an inspect path, which is exactly the fallback the stage
 * prescribes.
 *
 * That asymmetry is a finding, not a bug to paper over. Guessing `true` would
 * put a Review target button in front of readers whose write RLS will refuse
 * silently — the specific failure mode source (2) exists to prevent.
 *
 * Pure and synchronous. Nothing here queries; both answers are already on the
 * data the feed has loaded.
 */

import type { SignalCard } from '../../signals/contract'

/** A case row as it survives onto the card's evidence. */
interface AuthoredCase {
  userId?: string | null
}

export interface CapabilityDecision {
  canCommit: boolean
  /**
   * Which source answered, in one word.
   *
   * Recorded because "the button moved" is unanswerable without it, and
   * because a `default_false` that nobody notices is how a surface quietly
   * stops offering its primary action to everybody.
   */
  source: 'case_authorship' | 'default_false'
  because: string
}

/**
 * May this reader change the price objective this situation is about?
 *
 * `readerId` null — signed out, or an auth state still resolving — is false
 * rather than unknown. An unresolved identity that renders a commit control
 * is the same failure as a wrong one.
 */
export function canCommitPriceObjective(
  card: SignalCard,
  readerId: string | null | undefined,
): CapabilityDecision {
  if (!readerId) {
    return {
      canCommit: false,
      source: 'default_false',
      because: 'no resolved reader identity',
    }
  }

  const cases = (card.evidence?.data as { cases?: AuthoredCase[] } | undefined)?.cases
  if (!Array.isArray(cases) || !cases.some(c => c && 'userId' in c)) {
    /**
     * The producer does not carry an author.
     *
     * True of `StaleTarget` today. Reported rather than assumed either way —
     * see the header. Adding the author to that lens is a one-column change to
     * a query and is named in the report as the next thing worth doing.
     */
    return {
      canCommit: false,
      source: 'default_false',
      because: 'the producer carries no author for the artefact',
    }
  }

  const mine = cases.some(c => c?.userId === readerId)
  return {
    canCommit: mine,
    source: 'case_authorship',
    because: mine
      ? 'the reader authored a case in this ladder'
      : 'the ladder is somebody else’s; RLS would refuse the write',
  }
}
