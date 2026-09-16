/**
 * Somebody said the case broke, and the capital is already out the door.
 *
 * ── The claim, and its honest limits ─────────────────────────────────────
 *
 * A reader opened a thesis, concluded `changed` or `needs_work`, and there is
 * an active committed trade on that asset that predates the conclusion. Both
 * halves are durable human acts: a person committed capital, and a person
 * later recorded that the written case no longer stands.
 *
 * What this does NOT say is that the reason for THAT DECISION changed. It
 * cannot: nothing links a committed trade to the contribution rows the
 * decider actually relied on. The linkage is asset-level. So the wording is
 * asset-level too --
 *
 *   "The AAPL thesis was marked changed after this trade was committed."
 *
 * -- which is exactly what the two rows support and no more. Claiming the
 * decision's own rationale had been invalidated would be a stronger statement
 * than the data can carry, and the difference matters most precisely when
 * somebody is deciding whether to unwind a position.
 *
 * No text is compared, no history diffed, nothing generated. The trigger is a
 * conclusion a person typed a button for.
 *
 * ── Why `holds` can never qualify ────────────────────────────────────────
 *
 * It is the opposite claim. A reader confirming the case still stands is the
 * strongest available evidence that a committed trade is fine, and surfacing
 * it as a concern would teach people that recording agreement summons an
 * alarm. Enforced by the outcome set, not by a filter a caller might forget.
 */

import type { FeedCandidate } from '../../../lib/feed/candidate'
import type { DecisionItem } from '../types'
import { candidateToDecisionItem } from '../../../lib/feed/to-decision-item'

export const THESIS_CHANGED_AFTER_COMMIT_KIND = 'THESIS_CHANGED_AFTER_COMMIT'

/** The conclusions that mean the written case no longer stands as-is.
 *  `holds` is absent on purpose and its absence is asserted by a test. */
const QUALIFYING_OUTCOMES = new Set(['changed', 'needs_work'])

/** A `thesis.reviewed` event that concluded something other than `holds`. */
export interface ThesisConcernReview {
  /** The `memory_events` row id. The candidate's identity comes from this. */
  id: string
  /** The asset reviewed. */
  subject_id: string
  occurred_at: string
  outcome: string
  organization_id?: string | null
}

/** What this producer needs from a committed trade. */
export interface CommittedTrade {
  id: string
  asset_id: string | null
  /** When the trade was committed -- `accepted_trades.created_at`. */
  created_at: string
  asset_symbol?: string | null
  portfolio_name?: string | null
}

export interface ThesisChangedAfterCommitData {
  committedTrades?: readonly CommittedTrade[]
  thesisConcernReviews?: readonly ThesisConcernReview[]
  organizationId?: string | null
}

const OUTCOME_PHRASE: Record<string, string> = {
  changed: 'was marked changed',
  needs_work: 'now needs work',
}

/**
 * The claim itself.
 *
 * ── The collapse rule ────────────────────────────────────────────────────
 *
 * One thesis review on a name with ten active trades is one conclusion, not
 * ten. Emitting a card per trade would bury every other finding on Today
 * behind a wall built from a single button press, and the tenth card would
 * carry no information the first did not.
 *
 * So per (review, asset) this emits ONE candidate, attached to the most
 * recently committed active trade that predates the review.
 *
 * That is an eligibility and presentation collapse. It is NOT a claim that the
 * older trades are unaffected -- they are on the same asset and the same
 * conclusion bears on them identically. The newest is chosen because it is the
 * one whose thesis was freshest at commit, so a conclusion landing after it
 * has travelled the shortest distance. `olderTradesOnAsset` carries the count
 * so the surface can say so rather than implying a single position.
 */
export function thesisChangedAfterCommitCandidates(
  data: ThesisChangedAfterCommitData,
): FeedCandidate[] {
  if (!data.thesisConcernReviews?.length || !data.committedTrades?.length) return []

  // Active trades per asset, newest commit first.
  const tradesByAsset = new Map<string, CommittedTrade[]>()
  for (const t of data.committedTrades) {
    if (!t.asset_id || !t.created_at) continue
    const list = tradesByAsset.get(t.asset_id) ?? []
    list.push(t)
    tradesByAsset.set(t.asset_id, list)
  }
  for (const list of tradesByAsset.values()) {
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
  }

  const out: FeedCandidate[] = []

  for (const review of data.thesisConcernReviews) {
    // `holds` is not a concern. The set is the guard.
    if (!QUALIFYING_OUTCOMES.has(review.outcome)) continue
    if (!review.subject_id || !review.occurred_at || !review.id) continue

    const onAsset = tradesByAsset.get(review.subject_id)
    if (!onAsset?.length) continue

    // Strictly before: a conclusion recorded at or before the commit was
    // available to the person committing, and is not news about that trade.
    const predating = onAsset.filter(t => t.created_at < review.occurred_at)
    if (!predating.length) continue

    const trade = predating[0]
    const symbol = trade.asset_symbol ?? null
    const name = symbol ?? 'this asset'
    const phrase = OUTCOME_PHRASE[review.outcome] ?? 'was marked changed'

    out.push({
      // The review event. A LATER qualifying review is a genuinely new
      // conclusion by a person, so it earns its own candidate rather than
      // silently replacing the first -- and re-running the producer over the
      // same event reproduces the same id, so a dismissal still holds.
      id: `thesis-changed-${review.id}`,
      kind: THESIS_CHANGED_AFTER_COMMIT_KIND,
      // The trade is the subject: the capital is what is now in question.
      subjectType: 'trade',
      subjectId: trade.id,
      organizationId: review.organization_id ?? data.organizationId ?? '',
      // Asset-level language, because the linkage is asset-level. Saying the
      // decision's own reason changed would outrun the data.
      reason: `The ${name} thesis ${phrase} after this trade was committed.`,
      // Conservative, and inside the vocabulary the neighbouring thesis
      // evaluator already uses. `changed` says the case no longer stands while
      // capital is deployed; `needs_work` says the document cannot be judged,
      // which is a weaker statement about the world. Neither is red: red here
      // is reserved by existing rules for age and missed deadlines, and no
      // existing rule makes a single review the most urgent thing on Today.
      severity: review.outcome === 'changed' ? 'orange' : 'yellow',
      // The conclusion's own timestamp. What "after this trade" is measured by.
      occurredAt: review.occurred_at,
      facts: {
        assetId: review.subject_id,
        assetSymbol: symbol,
        portfolioName: trade.portfolio_name ?? null,
        committedAt: trade.created_at,
        reviewedAt: review.occurred_at,
        reviewOutcome: review.outcome,
        // Stated, not hidden: the collapse is presentational. The other trades
        // on this name predate the same conclusion and it bears on them too.
        olderTradesOnAsset: predating.length - 1,
      },
      provenance: {
        producer: 'evaluator:thesisChangedAfterCommit',
        sourceType: 'memory_events',
        sourceId: review.id,
      },
      // It exists because a person recorded a conclusion. That row is the
      // reason, and it is what makes the claim checkable.
      memoryRefs: [{ kind: 'event', id: review.id }],
      actions: [
        {
          actionKey: 'OPEN_RESEARCH_SUBJECT',
          payload: {
            assetId: review.subject_id,
            focus: 'thesis',
            issue: review.outcome === 'changed'
              ? 'Thesis marked changed after a trade was committed'
              : 'Thesis marked needs work after a trade was committed',
            origin: 'today',
          },
        },
      ],
    })
  }

  return out
}

/** The same claims, drawn the way Today already draws things. */
export function evaluateThesisChangedAfterCommit(
  data: ThesisChangedAfterCommitData,
): DecisionItem[] {
  return thesisChangedAfterCommitCandidates(data).map(c => candidateToDecisionItem(c, {
    title: c.facts?.reviewOutcome === 'changed'
      ? 'Thesis Changed After Commit'
      : 'Thesis Needs Work After Commit',
    titleKey: THESIS_CHANGED_AFTER_COMMIT_KIND,
    category: 'risk',
    // Committed capital on a case somebody has since questioned.
    decisionTier: 'capital',
    chips: [
      { label: 'Ticker', value: String(c.facts?.assetSymbol ?? '') },
      { label: 'Portfolio', value: String(c.facts?.portfolioName ?? '') },
      {
        label: 'Also on this name',
        value: Number(c.facts?.olderTradesOnAsset ?? 0) > 0
          ? `${c.facts?.olderTradesOnAsset} older`
          : '',
      },
    ],
    ctaLabels: { OPEN_RESEARCH_SUBJECT: 'Open Research' },
  }))
}
