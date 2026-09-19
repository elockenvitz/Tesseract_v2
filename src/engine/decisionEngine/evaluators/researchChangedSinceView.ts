/**
 * Research that moved while you were not looking.
 *
 * ── The question ─────────────────────────────────────────────────────────
 *
 * "What changed on this subject since I last looked at it?" Nothing in the
 * product could answer that, because nothing recorded when you last looked.
 * Every "new since" was measured against the thesis date instead, so a note
 * read yesterday stayed new until somebody edited a document that did not need
 * editing.
 *
 * The view cursor made the missing half of that comparison durable. This is
 * the first thing to read it: the first candidate that exists because of what
 * the reader did, rather than because of what a row says.
 *
 * ── Eligibility, and what it refuses to guess ────────────────────────────
 *
 * Two facts, both durable, both recorded by somebody's action:
 *
 *   1. There is a prior cursor for this asset -- the reader has opened it
 *      before. No cursor is NOT "neglected for a long time"; it is "never
 *      opened", and a first-time name has no "since" to speak of. It produces
 *      nothing here.
 *   2. At least one research item arrived after that cursor. Strictly after:
 *      an item timestamped at the moment of the visit was on screen during it.
 *
 * There is deliberately no age threshold. "You have not looked at this in 30
 * days" is a different claim, needs a different justification, and would make
 * this producer emit for names where nothing whatsoever has happened.
 *
 * Nothing here is generated, inferred or summarised. The reason states counts
 * and dates that came from rows. Whether the evidence is good or bad news is
 * not asked, because no authoritative field says.
 *
 * ── Why it lands on `intel` ──────────────────────────────────────────────
 *
 * It is information, not work. The intel surface is scored and sorted
 * separately from the action queue, so this cannot displace a trade awaiting
 * decision no matter how much evidence piled up. No ranking rule changed to
 * make that true.
 *
 * ── The lifecycle ────────────────────────────────────────────────────────
 *
 * Opening the asset advances the cursor, through the mechanism that already
 * exists. The next evaluation compares the same evidence against a later
 * cursor, finds nothing strictly newer, and the candidate is simply not
 * produced. It is not dismissed, suppressed or remembered -- it stops being
 * true. If something arrives after that visit, it becomes true again, under
 * the same id.
 */

import type { DecisionItem } from '../types'
import type { FeedCandidate } from '../../../lib/feed/candidate'
import { candidateToDecisionItem } from '../../../lib/feed/to-decision-item'

export const RESEARCH_CHANGED_SINCE_VIEW_KIND = 'RESEARCH_CHANGED_SINCE_VIEW'

/** What this producer needs from a research subject. A subset of
 *  `ResearchSubject`, stated here so the evaluator does not depend on the
 *  whole scan model. */
export interface ViewedResearchSubject {
  assetId: string
  symbol?: string | null
  companyName?: string | null
  newestEvidenceAt: string | null
  /** Optional. When absent the claim is made without a count rather than with
   *  a guessed one. */
  evidenceDates?: string[]
}

export interface ResearchChangedSinceViewData {
  subjects?: readonly ViewedResearchSubject[]
  /** assetId → the cursor as it stood BEFORE the reader's current session.
   *  Absent means never opened. */
  viewCursors?: Map<string, string>
  organizationId?: string | null
}

/** The claim itself. Pure; no clock, because nothing here is measured in age. */
export function researchChangedSinceViewCandidates(
  data: ResearchChangedSinceViewData,
): FeedCandidate[] {
  if (!data.subjects?.length || !data.viewCursors?.size) return []

  const out: FeedCandidate[] = []

  for (const s of data.subjects) {
    const lastViewedAt = data.viewCursors.get(s.assetId)
    // Never opened. Silence is the correct answer, not "you have neglected it".
    if (!lastViewedAt) continue

    const newestEvidenceAt = s.newestEvidenceAt
    // Strictly after: evidence stamped at the visit was visible during it.
    if (!newestEvidenceAt || newestEvidenceAt <= lastViewedAt) continue

    // Counted only where the dates were already loaded. A missing list means
    // the count is unknown, and an unknown count is left out of the claim.
    const newItems = s.evidenceDates
      ? s.evidenceDates.filter(d => d > lastViewedAt).length
      : null

    const name = s.symbol ?? s.companyName ?? 'this name'

    out.push({
      // The asset. Stable across regenerations, and carries no date -- an id
      // that moved with the evidence would orphan every dismissal against it.
      id: `research-changed-${s.assetId}`,
      kind: RESEARCH_CHANGED_SINCE_VIEW_KIND,
      subjectType: 'asset',
      subjectId: s.assetId,
      organizationId: data.organizationId ?? '',
      reason: newItems === null
        ? `New research on ${name} since you last opened it.`
        : newItems === 1
          ? `1 new research item on ${name} since you last opened it.`
          : `${newItems} new research items on ${name} since you last opened it.`,
      // Information, not an obligation. Nobody is late for this.
      severity: 'info',
      // The evidence's own arrival time. "What changed" is dated by the change,
      // not by when this ran, and the intel surface ages items from it.
      occurredAt: newestEvidenceAt,
      facts: {
        assetSymbol: s.symbol ?? null,
        lastViewedAt,
        newestEvidenceAt,
        newItemsSinceView: newItems,
      },
      provenance: {
        producer: 'evaluator:researchChangedSinceView',
        sourceType: 'asset_notes',
        sourceId: s.assetId,
      },
      actions: [
        {
          actionKey: 'OPEN_RESEARCH_SUBJECT',
          payload: {
            assetId: s.assetId,
            focus: 'evidence',
            // Carried so the arrival can say why it happened. Losing this is
            // how a handoff becomes a teleport.
            issue: 'New research since you last looked',
            origin: 'today',
          },
        },
      ],
    })
  }

  return out
}

/** The same claims, drawn the way Today already draws things. */
export function evaluateResearchChangedSinceView(
  data: ResearchChangedSinceViewData,
): DecisionItem[] {
  return researchChangedSinceViewCandidates(data).map(c => candidateToDecisionItem(c, {
    title: 'New Research Since You Looked',
    titleKey: RESEARCH_CHANGED_SINCE_VIEW_KIND,
    // Reading the case is research work, not capital at risk.
    category: 'alpha',
    surface: 'intel',
    decisionTier: 'coverage',
    chips: [
      { label: 'Ticker', value: String(c.facts?.assetSymbol ?? '') },
      {
        label: 'New',
        value: c.facts?.newItemsSinceView == null ? '' : String(c.facts.newItemsSinceView),
      },
    ],
    ctaLabels: { OPEN_RESEARCH_SUBJECT: 'Open Research' },
  }))
}
