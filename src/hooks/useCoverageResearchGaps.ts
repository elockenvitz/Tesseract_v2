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
// The graduation flag alone, from the one cached read that owns it:
// `usePilotMode` layers org flags and unlock queries on top, which this hook
// has no use for and should not make every lens pay for.
import { usePilotProgress } from './usePilotProgress'
import { operationalAfterPilot } from '../lib/pilot/seed-visibility'
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
  /*
   * The cached hint counts too.
   *
   * Candidates are ready before the pilot read answers, so on a cold load a
   * graduated reader would see a seeded idea described as live work for a
   * beat and then watch the sentence change. The hint is written at the end
   * of the previous session for exactly this window.
   */
  const { hasGraduated, cachedHasGraduated } = usePilotProgress()
  const graduated = hasGraduated || cachedHasGraduated

  return useMemo<CoverageResearchGaps>(() => {
    if (!currentOrgId) return { status: 'no_org', candidates: [], coveredCount: 0 }
    // Either read failing is an error, never an endless "loading".
    if (insights.isError || coverage.failed) return { status: 'error', candidates: [], coveredCount: 0 }
    if (!coverage.ready || insights.isPending) return { status: 'loading', candidates: [], coveredCount: 0 }
    const covered = new Set([...coverage.direct, ...coverage.assigned])
    /*
     * After graduation the pilot's seeded ideas stop counting as live work
     * (lib/pilot/seed-visibility), so a covered name whose only open idea was
     * planted by the tour is described by what is actually true of it -- its
     * position, its coverage and its research -- rather than as "being
     * worked". The rows are untouched; only this reading of them changes.
     */
    const scanned = (insights.data ?? []).map(i =>
      i.liveIdeas.length
        ? { ...i, liveIdeas: operationalAfterPilot(i.liveIdeas, { hasGraduated: graduated }) }
        : i)
    return {
      status: 'ready',
      candidates: coverageResearchCandidates(scanned, coverage),
      coveredCount: covered.size,
    }
  }, [currentOrgId, coverage, insights.isError, insights.isPending, insights.data, graduated])
}
