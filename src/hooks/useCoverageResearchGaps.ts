/**
 * The reader's coverage research gaps, for any desktop lens.
 *
 * Composes two cached reads that already exist and are already shared:
 *
 *   useCoverageRelevance()   own + assigned coverage, this user, this org
 *   useDerivedInsights()     the research scan the phone feed and Explore run
 *
 * and narrows the second to the first (lib/research/coverage-research-gaps).
 * No query of its own, so a lens that mounts this after Explore or the phone
 * feed pays nothing, and two lenses mounting it share one scan.
 *
 * Not wired into any lens yet.
 */

import { useMemo } from 'react'
import { useOrganization } from '../contexts/OrganizationContext'
import { useCoverageRelevance } from './useCoverageRelevance'
import { useDerivedInsights } from './mobile/useDerivedInsights'
import {
  coverageResearchCandidates,
  type CoverageResearchCandidate,
} from '../lib/research/coverage-research-gaps'

export type { CoverageResearchCandidate } from '../lib/research/coverage-research-gaps'

export interface CoverageResearchGaps {
  /**
   * `loading` until BOTH reads answer. `error` when the scan failed -- a lens
   * must not read that as "nothing to do". `no_org` when there is no workspace.
   */
  status: 'loading' | 'ready' | 'error' | 'no_org'
  candidates: CoverageResearchCandidate[]
  /** Own + assigned covered names, so a lens can tell "no coverage" from "no gaps". */
  coveredCount: number
}

export function useCoverageResearchGaps(): CoverageResearchGaps {
  const { currentOrgId } = useOrganization()
  const coverage = useCoverageRelevance()
  const insights = useDerivedInsights()

  return useMemo<CoverageResearchGaps>(() => {
    if (!currentOrgId) return { status: 'no_org', candidates: [], coveredCount: 0 }
    if (insights.isError) return { status: 'error', candidates: [], coveredCount: 0 }
    if (!coverage.ready || insights.isPending) return { status: 'loading', candidates: [], coveredCount: 0 }
    const covered = new Set([...coverage.direct, ...coverage.assigned])
    return {
      status: 'ready',
      candidates: coverageResearchCandidates(insights.data ?? [], coverage),
      coveredCount: covered.size,
    }
  }, [currentOrgId, coverage, insights.isError, insights.isPending, insights.data])
}
