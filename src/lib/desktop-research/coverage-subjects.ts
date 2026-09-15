/**
 * Coverage research gaps, as ordinary Research subjects.
 *
 * Research is a ranked field of subjects. When the reader's own research on
 * record leaves that field thin, Tesseract fills the empty capacity with work
 * it can see on the reader's coverage -- as subjects of the same type, drawn by
 * the same tile, opened into the same detail, with the same rail. Nothing about
 * the lens changes shape for a new account; it just has something to show.
 *
 * ── Order ─────────────────────────────────────────────────────────────────
 *
 * The scan's own subjects first, in the scan's own order. Generated subjects
 * after them, in the shared source's canonical order (priority, then score),
 * with an open idea on the name and then the size of the holding breaking ties.
 * A name the scan already has is never generated again.
 *
 * ── Capacity and diversity ────────────────────────────────────────────────
 *
 * Generated subjects only take capacity the scan left empty, so a desk with a
 * full field of real research sees none. Events (new evidence, a price move)
 * are uncapped within that capacity. Structural gaps (no thesis, incomplete,
 * stale) say the same thing about every name they touch, so each is capped:
 * fifty uncovered theses produce a handful of tiles, not fifty.
 */

import type { CoverageResearchCandidate } from '../research/coverage-research-gaps'
import type { ResearchSubject } from './model'

/** How many tiles the field holds before generated work stops filling it. */
export const RESEARCH_FEED_CAPACITY = 12

/** At most this many generated tiles of any one structural gap. */
export const GENERATED_PER_STRUCTURAL_GAP = 4

const EVENT_FRAMINGS = new Set(['new_evidence', 'price_move'])

/** Canonical priority and score, then open idea, then weight, then ticker. */
export function compareCoverageCandidates(a: CoverageResearchCandidate, b: CoverageResearchCandidate): number {
  return a.priority - b.priority
    || b.score - a.score
    || b.liveIdeas.length - a.liveIdeas.length
    || (b.exposure.weightPct ?? 0) - (a.exposure.weightPct ?? 0)
    || a.symbol.localeCompare(b.symbol)
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
  { capacity = RESEARCH_FEED_CAPACITY, perStructuralGap = GENERATED_PER_STRUCTURAL_GAP } = {},
): ResearchSubject[] {
  const room = capacity - real.length
  if (room <= 0 || !candidates.length) return [...real]

  const onRecord = new Set(real.map(s => s.assetId))
  const taken = new Map<string, number>()
  const generated: ResearchSubject[] = []
  const seen = new Set<string>()

  for (const c of [...candidates].sort(compareCoverageCandidates)) {
    if (generated.length >= room) break
    if (onRecord.has(c.assetId) || seen.has(c.assetId)) continue
    if (!EVENT_FRAMINGS.has(c.framing)) {
      const n = taken.get(c.framing) ?? 0
      if (n >= perStructuralGap) continue
      taken.set(c.framing, n + 1)
    }
    seen.add(c.assetId)
    generated.push(subjectFromCoverage(c))
  }
  return [...real, ...generated]
}
