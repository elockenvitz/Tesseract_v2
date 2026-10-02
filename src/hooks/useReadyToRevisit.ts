/**
 * Parked work that is due, with what moved while it was gone.
 *
 * ── Request budget ───────────────────────────────────────────────────────
 *
 * Fixed, and the reason this is one hook rather than a per-tile one:
 *
 *   1  obligations            (`fetchObligations`)
 *   2  subject resolution     (ideas, decisions — batched by type)
 *   6  change facts           (`fetchChangeFacts`, batched across subjects)
 *   ─────
 *   9 requests for 1 candidate, and 9 for 24.
 *
 * The alternative — resolving facts inside the tile — is how twenty-four
 * memory tiles become twenty-four history requests arriving in twenty-four
 * separate waves. That pathology was measured and fixed once already in
 * this codebase; it is not being reintroduced for a feature whose whole
 * appeal is that it feels instant.
 */
import { useQuery } from '@tanstack/react-query'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  fetchObligations,
  resolveRevisitCandidates,
  type RevisitCandidate,
} from '../lib/memory/due-obligations'
import { OBLIGATION_KINDS } from '../lib/memory/obligations'
import { fetchChangeFacts, type ChangeFact, type ChangeSubject } from '../lib/memory/what-changed'
import { isEligible } from '../lib/memory/ready-to-revisit'

export const READY_TO_REVISIT_KEY = ['memory', 'ready-to-revisit'] as const

export interface ReadyToRevisitData {
  candidates: RevisitCandidate[]
  factsBySubject: Map<string, ChangeFact[]>
}

const EMPTY: ReadyToRevisitData = { candidates: [], factsBySubject: new Map() }

export function useReadyToRevisit(opts?: { enabled?: boolean }): ReadyToRevisitData {
  const { currentOrgId } = useOrganization()

  const { data } = useQuery({
    queryKey: [...READY_TO_REVISIT_KEY, currentOrgId],
    enabled: !!currentOrgId && opts?.enabled !== false,
    // Longer than the obligation list's own staleness: a park date does not
    // move minute to minute, and the price comparison behind it is a daily
    // close. Refetching this every minute would buy nothing and cost six
    // queries each time.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ReadyToRevisitData> => {
      const now = new Date()

      const obligations = await fetchObligations({
        organizationId: currentOrgId!,
        kinds: [OBLIGATION_KINDS.ideaRevisit, OBLIGATION_KINDS.decisionRevisit],
        dueStates: ['due'],
        now,
      })
      if (obligations.length === 0) return EMPTY

      const candidates = await resolveRevisitCandidates(obligations, now)

      // Facts are fetched only for candidates that will actually be shown.
      // Computing them for a terminal or unreadable subject is work whose
      // result is discarded, and it would widen the price query for nothing.
      const eligible = candidates.filter(c => isEligible(c))
      if (eligible.length === 0) return { candidates, factsBySubject: new Map() }

      // Keyed by the IDEA, not the obligation's subject: a deferred
      // recommendation's subject is the decision request, and the facts
      // live against the idea behind it.
      const subjects: ChangeSubject[] = eligible
        .filter(c => !!c.ideaId)
        .map(c => ({
          tradeQueueItemId: c.ideaId!,
          assetId: c.assetId,
          symbol: c.symbol,
          parkedAt: c.parkedAt,
        }))

      return { candidates, factsBySubject: await fetchChangeFacts(subjects, now) }
    },
  })

  return data ?? EMPTY
}
