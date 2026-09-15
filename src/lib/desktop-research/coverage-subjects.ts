/**
 * Coverage research gaps, as ordinary Research subjects.
 *
 * Research is a ranked field of subjects. When the reader's own research on
 * record leaves that field thin, Tesseract fills the empty capacity with work
 * it can see on the reader's coverage -- as subjects of the same type, drawn by
 * the same tile, opened into the same detail, with the same rail. Nothing about
 * the lens changes shape for a new account; it just has something to show.
 *
 * ── Order, capacity and diversity ─────────────────────────────────────────
 *
 * The scan's own subjects first, in the scan's own order. Generated subjects
 * after them, in the shared work order (lib/research/coverage-work): an open
 * idea, then the size of the position, then the shared source's priority and
 * score. A name the scan already has is never generated again.
 *
 * Generated subjects take only the capacity the scan left. Within it, a
 * no-thesis name with an idea or a position is its own specific risk and is not
 * capped; bare coverage with no thesis, a partly written case and a long
 * silence are capped so they cannot crowd the field.
 */

import type { CoverageResearchCandidate } from '../research/coverage-research-gaps'
import {
  coverageWorkClaim, coverageWorkContext, coverageWorkLabel, selectCoverageWork, type StructuralKey,
} from '../research/coverage-work'
import type { ResearchSubject } from './model'

/** How many tiles the field holds before generated work stops filling it. */
export const RESEARCH_FEED_CAPACITY = 10

/** Generated tiles allowed per structural gap in the Research field. */
export const RESEARCH_STRUCTURAL_CAPS: Record<StructuralKey, number> = {
  'no_case:unheld': 5,
  incomplete_case: 4,
  long_silence: 4,
}

/** One candidate as a Research subject, from the facts the shared rule produced. */
export function subjectFromCoverage(c: CoverageResearchCandidate): ResearchSubject {
  const f = c.facts
  const newest = f.evidenceSince.length ? f.evidenceSince[f.evidenceSince.length - 1] : null
  return {
    assetId: c.assetId,
    symbol: c.symbol,
    companyName: c.companyName,
    thesisUpdatedAt: f.caseWrittenAt,
    daysSinceReview: f.daysSinceReview ?? f.daysSinceWritten,
    // Only core sections are known to the shared rule; supporting sections are
    // not counted rather than guessed.
    sectionCount: f.presentSections.length,
    coreSectionCount: f.presentSections.length,
    coreSections: [...f.presentSections],
    evidenceCount: f.evidenceCount,
    newestEvidenceAt: newest?.at ?? null,
    newestEvidenceTitle: newest?.title ?? null,
    newSinceReview: c.framing === 'new_evidence' ? f.evidenceSince.length : 0,
    weightPct: c.exposure.held && c.exposure.weightPct != null ? c.exposure.weightPct : undefined,
    generated: {
      source: 'coverage',
      framing: c.framing,
      coverage: c.coverage,
      movePct: c.framing === 'price_move' ? f.movePct : null,
      context: coverageWorkContext(c),
      label: coverageWorkLabel(c),
      claim: coverageWorkClaim(c),
      liveIdeaCount: c.liveIdeas.length,
      portfolioName: c.exposure.portfolioName,
    },
  }
}

/**
 * The Research field: the scan's subjects, then generated coverage subjects
 * filling the capacity they left.
 */
export function withCoverageSubjects(
  real: readonly ResearchSubject[],
  candidates: readonly CoverageResearchCandidate[],
  { capacity = RESEARCH_FEED_CAPACITY, caps = RESEARCH_STRUCTURAL_CAPS } = {},
): ResearchSubject[] {
  const room = capacity - real.length
  if (room <= 0 || !candidates.length) return [...real]
  const picked = selectCoverageWork(candidates, {
    limit: room,
    caps,
    exclude: new Set(real.map(s => s.assetId)),
  })
  return [...real, ...picked.map(subjectFromCoverage)]
}
