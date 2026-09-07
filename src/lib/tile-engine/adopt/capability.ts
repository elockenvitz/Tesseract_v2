/**
 * Where `ViewerContext.canCommit` comes from, and why it is often false.
 *
 * ── The rule the stage set ────────────────────────────────────────────────
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
 *    may initiate a portfolio decision on a trade idea. Async and
 *    per-portfolio.
 *
 * 2. RLS on `analyst_price_targets`: `auth.uid() = user_id`. The database's
 *    own answer to "may this person change this number". The scenario builder
 *    records why a client-side pre-check is needed at all: the policy "fails
 *    SILENTLY, matching zero rows and returning success", so a control
 *    rendered without it appears to work and does not.
 *
 * ── Which one governs the price-objective families ────────────────────────
 *
 * Source (2), and not (1). Importing the trade permission model would be
 * inventing a role model in the most damaging way available — by borrowing a
 * real one that answers a different question, so the code would look sourced
 * and be wrong. An analyst who is not a PM writes price targets every day.
 *
 * ── What changed in adoption B ────────────────────────────────────────────
 *
 * The asymmetry is gone. Case-vs-price could answer this and target-expired
 * could not, purely because `usePortfolioLenses` had never selected
 * `user_id` — the same column, on the same table, under the same policy that
 * the scenario ladder was already reading. One field on one select closed it.
 *
 * This function no longer sniffs the card for a ladder, either. Authorship is
 * passed in by whoever loaded the row, so a producer that cannot answer says so
 * by passing `null` rather than by having its evidence shape misread.
 *
 * ── The remaining honest `false` ──────────────────────────────────────────
 *
 * A finding whose artefact has no author — a case that was never written, so
 * there is no row and nobody wrote it — cannot answer this and must not guess.
 * That is No Core Thesis, and it defaults to false with an inspect path, which
 * is the fallback the stage prescribes.
 *
 * Pure and synchronous. Nothing here queries.
 */

export interface CapabilityDecision {
  canCommit: boolean
  /**
   * Which source answered, in one word.
   *
   * Recorded because "the button moved" is unanswerable without it, and
   * because a `default_false` that nobody notices is how a surface quietly
   * stops offering its primary action to everybody.
   */
  source: 'row_authorship' | 'no_author_recorded' | 'no_reader'
  because: string
}

/**
 * Who wrote the artefact a revision would change.
 *
 * `null` means the producer cannot say — a different answer from an empty
 * array, which means it looked and found nobody. Both resolve to false and
 * they resolve to it for different reasons, which is what the `source` field
 * is for.
 */
export type ArtefactAuthors = readonly (string | null | undefined)[] | null

/**
 * May this reader revise the artefact this situation is about?
 *
 * `readerId` null — signed out, or an auth state still resolving — is false
 * rather than unknown. An unresolved identity that renders a commit control is
 * the same failure as a wrong one.
 */
export function canReviseArtefact(
  authors: ArtefactAuthors,
  readerId: string | null | undefined,
): CapabilityDecision {
  if (!readerId) {
    return { canCommit: false, source: 'no_reader', because: 'no resolved reader identity' }
  }

  if (authors == null) {
    return {
      canCommit: false,
      source: 'no_author_recorded',
      because: 'the producer carries no author for the artefact',
    }
  }

  const mine = authors.some(a => a === readerId)
  return {
    canCommit: mine,
    source: 'row_authorship',
    because: mine
      ? 'the reader wrote the row a revision would change'
      : 'the row is somebody else’s; the write policy would refuse it',
  }
}
