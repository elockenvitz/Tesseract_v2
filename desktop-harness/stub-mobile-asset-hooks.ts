/**
 * The mobile asset page's secondary reads, stubbed.
 *
 * `DecisionsPanel` and `ListsPanel` call hooks that reach Supabase, and two
 * of them (`useAssetPortfolioWeights`, `useAssetLiveWeights`) call
 * `useOrganization` — which THROWS outside an `OrganizationProvider`. The
 * harness has no provider, so opening the Decisions tab took the whole page
 * down with `useOrganization must be used within an OrganizationProvider`.
 *
 * That is a harness gap, not a product defect: in the app the provider is
 * always above this page. Stubbing them lets the phone surface be measured
 * without standing up auth, an org context and a live database.
 *
 * Values are deliberately thin. The harness exists to measure layout and to
 * check that the truth semantics render; inventing weights and P&L here would
 * put numbers on screen that no record supports, which is the one thing this
 * increment is most careful not to do.
 */

const EMPTY_QUERY = { data: undefined, isLoading: false, isError: false, error: null, refetch: () => {} }

/** Open ideas on the asset. Two, so the list renders rather than its empty state. */
export function useAssetTradeIdeas() {
  return {
    ...EMPTY_QUERY,
    isLoading: false,
    ideas: [
      {
        id: 'idea-1', action: 'add', stage: 'deciding', status: 'open', outcome: null,
        portfolio_id: 'pf-growth', portfolio_name: 'Tech & Consumer Growth',
        created_at: '2026-05-20T10:30:00Z', rationale: 'Accelerating backlog.',
        target_weight: null, current_weight: null,
      },
      {
        id: 'idea-2', action: 'trim', stage: 'researching', status: 'open', outcome: null,
        portfolio_id: 'pf-income', portfolio_name: 'Core Income',
        created_at: '2026-05-26T08:05:00Z', rationale: 'Trimming into strength.',
        target_weight: null, current_weight: null,
      },
    ] as never,
    isLoading: false,
  }
}

/** Already-decided ideas. One, so the resolved list is exercised. */
export function useAssetRecentDecisions() {
  return {
    ...EMPTY_QUERY,
    isLoading: false,
    decisions: [
      {
        id: 'idea-3', action: 'buy', stage: 'deciding', status: 'rejected',
        outcome: 'rejected', decision_outcome: 'rejected',
        portfolio_id: 'pf-growth', portfolio_name: 'Tech & Consumer Growth',
        decided_at: '2026-05-14T11:20:00Z', created_at: '2026-05-10T09:00:00Z',
      },
    ] as never,
    isLoading: false,
  }
}

export function getDecisionLabel(outcome: string | null): string {
  if (outcome === 'rejected') return 'Rejected'
  if (outcome === 'accepted') return 'Accepted'
  if (outcome === 'deferred') return 'Deferred'
  return 'Decided'
}

/** Header context: coverage and priority. Absent rather than invented. */
export function useAssetHeaderContext() {
  return { ...EMPTY_QUERY, data: { coverage: [], priority: null, stage: null } as never }
}

/**
 * Both of these call `useOrganization` in the real app and throw here.
 * Returning empty is honest: the harness has no organization, so it has no
 * book weights.
 */
export function useAssetPortfolioWeights() {
  return { ...EMPTY_QUERY, data: [] as never, weights: [] as never, isLoading: false }
}

export function useAssetLiveWeights() {
  return { ...EMPTY_QUERY, data: [] as never, weights: [] as never, isLoading: false }
}
