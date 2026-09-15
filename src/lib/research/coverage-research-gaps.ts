/**
 * Coverage research gaps: the shared candidate source.
 *
 * ── What this is ──────────────────────────────────────────────────────────
 *
 * One candidate per name the reader covers -- their own (personal) coverage or
 * coverage assigned to them by the org -- that has a research condition worth
 * raising. It is a FILTER and a CONTRACT over the existing research scan, never
 * a second set of rules:
 *
 *   classification   `researchIssueFor` (lib/research/case-state), through
 *                    `scanResearchInsights` (hooks/mobile/useDerivedInsights),
 *                    the same scan the phone feed and Explore run
 *   thresholds       MOVE_PCT 15, RESEARCH_STALE_DAYS 90 (lib/signals/thresholds)
 *   precedence       new_evidence > price_move > no_case > incomplete_case >
 *                    long_silence, one issue per asset
 *   copy             `researchCopy`, carried through unchanged
 *   within-family    `researchBaseFor` + the scan's weight nudge (`score`)
 *   coverage         `useCoverageRelevance`: coverage rows with this user's id,
 *                    in this org, active -- direct (personal) or assigned (org)
 *
 * ── What it deliberately excludes ─────────────────────────────────────────
 *
 * The scan's universe is the whole org's coverage, the current book and any
 * written case. Only names in the reader's own or assigned coverage pass here,
 * so a colleague's coverage, a held name nobody gave this reader, and a case
 * someone else wrote on a name this reader does not cover never become this
 * reader's research work.
 *
 * ── Where a candidate goes ────────────────────────────────────────────────
 *
 * `open` is an `openAsset` request focused on research: the existing desktop
 * asset workspace, at its research section. No lens builds its own route.
 */

import type { DerivedInsight } from '../../hooks/mobile/useDerivedInsights'
import type { CoverageIndex } from '../signals/coverage-relevance'
import type { OpenAssetRequest } from '../desktop-asset/navigate'
import type { CoreSection, ResearchFraming, ReviewSource, EvidenceArrival } from './case-state'

/** The canonical precedence, strongest first. Mirrors `researchIssueFor`. */
export const COVERAGE_GAP_PRIORITY: readonly ResearchFraming[] = [
  'new_evidence', 'price_move', 'no_case', 'incomplete_case', 'long_silence',
]

export type CoverageLane = 'own' | 'assigned'

export interface CoverageResearchCandidate {
  /** Stable per asset: one candidate per covered name. */
  id: string
  assetId: string
  symbol: string
  companyName: string | null

  /** Own (personal) wins where the name is both. */
  coverage: CoverageLane

  /** The canonical framing that fired. */
  framing: ResearchFraming
  /** 1 = new_evidence … 5 = long_silence. Position in COVERAGE_GAP_PRIORITY + 1. */
  priority: number
  /** Within-family strength from the scan (`researchBaseFor` + weight nudge). */
  score: number

  /** `researchCopy`, unchanged. */
  headline: string
  body: string
  prompt: string

  /** The facts behind the framing, as the rule produced them. */
  facts: {
    missingSections: CoreSection[]
    presentSections: CoreSection[]
    /** Signed; `price_move` only. */
    movePct: number | null
    /** Arrivals after the anchor; `new_evidence` only. */
    evidenceSince: EvidenceArrival[]
    /** All evidence filed on the name, whenever it arrived. */
    evidenceCount: number
    daysSinceReview: number | null
    daysSinceWritten: number | null
    anchoredOn: ReviewSource | null
    caseWrittenAt: string | null
    reviewAnchor: string | null
  }

  /** Where the name sits in the book now. Context, never a rank input here. */
  exposure: {
    held: boolean
    weightPct: number | null
    portfolioId: string | null
    portfolioName: string | null
    portfolioCount: number
  }
  /** Live ideas on the name. Context only. */
  liveIdeas: { id: string; action: string | null }[]

  /** The existing research surface for this asset. */
  open: OpenAssetRequest

  /** The scan's own object, for adopters that already render it (tile-engine). */
  insight: DerivedInsight
}

export const COVERAGE_RESEARCH_ORIGIN = 'coverage-research'

const priorityOf = (f: ResearchFraming) => COVERAGE_GAP_PRIORITY.indexOf(f) + 1

/**
 * The reader's coverage research candidates, from the scan's insights.
 *
 * Returns nothing until coverage is ready: an unanswered coverage query must
 * never read as "covers nothing", and must never let the org-wide universe
 * through unfiltered.
 */
export function coverageResearchCandidates(
  insights: readonly DerivedInsight[],
  coverage: CoverageIndex,
): CoverageResearchCandidate[] {
  if (!coverage.ready) return []

  const best = new Map<string, DerivedInsight>()
  for (const insight of insights) {
    const inCoverage = coverage.direct.has(insight.assetId) || coverage.assigned.has(insight.assetId)
    if (!inCoverage) continue
    const held = best.get(insight.assetId)
    if (!held
      || priorityOf(insight.issue.framing) < priorityOf(held.issue.framing)
      || (priorityOf(insight.issue.framing) === priorityOf(held.issue.framing) && insight.score > held.score)) {
      best.set(insight.assetId, insight)
    }
  }

  return [...best.values()]
    .map((i): CoverageResearchCandidate => ({
      id: `coverage-research:${i.assetId}`,
      assetId: i.assetId,
      symbol: i.symbol,
      companyName: i.companyName ?? null,
      coverage: coverage.direct.has(i.assetId) ? 'own' : 'assigned',
      framing: i.issue.framing,
      priority: priorityOf(i.issue.framing),
      score: i.score,
      headline: i.headline,
      body: i.body,
      prompt: i.prompt,
      facts: {
        missingSections: [...i.issue.missing],
        presentSections: [...i.issue.present],
        movePct: i.issue.movePct ?? null,
        evidenceSince: i.issue.evidence ?? [],
        evidenceCount: i.evidenceCount,
        daysSinceReview: i.daysSinceReview,
        daysSinceWritten: i.daysSinceWritten,
        anchoredOn: i.anchoredOn,
        caseWrittenAt: i.caseWrittenAt,
        reviewAnchor: i.reviewAnchor,
      },
      exposure: {
        held: i.held,
        weightPct: i.weightPct ?? null,
        portfolioId: i.portfolioId ?? null,
        portfolioName: i.portfolioName ?? null,
        portfolioCount: i.portfolioCount,
      },
      liveIdeas: i.liveIdeas,
      open: {
        assetId: i.assetId,
        symbol: i.symbol,
        companyName: i.companyName ?? null,
        focus: 'research',
        portfolioId: i.portfolioId ?? null,
        portfolioName: i.portfolioName ?? null,
        issue: i.headline,
        origin: COVERAGE_RESEARCH_ORIGIN,
      },
      insight: i,
    }))
    .sort((a, b) => a.priority - b.priority || b.score - a.score || a.symbol.localeCompare(b.symbol))
}
