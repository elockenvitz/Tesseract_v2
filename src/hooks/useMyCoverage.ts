/**
 * useMyCoverage — the state half of personal coverage.
 *
 * Stage 3 foundation ONLY. This is the hook a self-service surface will read;
 * it has no presentation, no onboarding awareness and no telemetry, and nothing
 * mounts it yet. Adding it now means the surface built on top of it in a later
 * stage is a rendering change rather than a data change.
 *
 * Desktop and mobile will present coverage very differently — a governance
 * matrix versus three lists — and that is right. What they must not do is
 * disagree about what the user covers, so the state is one hook and only the
 * presentation forks. Same rule the mobile strategy already follows.
 *
 * Reads both lanes; writes only the personal one. The lane boundary is RLS, not
 * this file — see `lib/coverage/personal-coverage.ts`.
 */

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  addPersonalCoverage,
  coverageAnalystName,
  fetchMyCoverage,
  removePersonalCoverage,
  updatePersonalCoverageNotes,
  type MyCoverageRow,
} from '../lib/coverage/personal-coverage'

export interface MyCoverageState {
  /** Every active coverage row naming this user in this org, both lanes. */
  rows: MyCoverageRow[]
  /** Rows the user declared themselves and may edit. */
  personal: MyCoverageRow[]
  /** Rows the organization assigned. Read-only to this user. */
  assigned: MyCoverageRow[]
  /** Asset ids across both lanes — the "what is mine" set. */
  assetIds: Set<string>
  /**
   * Whether Tesseract understands coverage context for this user.
   *
   * Satisfied by EITHER lane, deliberately. A user invited into an
   * already-configured team has meaningful coverage context from the moment
   * they arrive, without declaring anything; requiring a personal row would
   * report them as un-onboarded forever and push them to redo somebody's work.
   */
  hasCoverage: boolean
  isLoading: boolean
  error: unknown
}

export interface MyCoverageActions {
  add: (assetId: string) => Promise<void>
  remove: (assetId: string) => Promise<void>
  setNotes: (assetId: string, notes: string | null) => Promise<void>
  isMutating: boolean
}

export function useMyCoverage(): MyCoverageState & MyCoverageActions {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const userId = user?.id ?? null
  const orgId = currentOrgId ?? null

  const analystName = useMemo(
    () => coverageAnalystName(user as any),
    [(user as any)?.first_name, (user as any)?.last_name, (user as any)?.email],
  )

  // The org is in the key, not just the filter. A cache entry shared across
  // organizations is the exact shape the org-scope guard exists to catch, and
  // coverage is precisely the per-tenant data that would leak through one.
  const query = useQuery({
    queryKey: ['my-coverage', userId, orgId],
    enabled: !!userId && !!orgId,
    staleTime: 30_000,
    queryFn: () => fetchMyCoverage(orgId),
  })

  const rows = query.data ?? []

  const { personal, assigned, assetIds } = useMemo(() => {
    const personal: MyCoverageRow[] = []
    const assigned: MyCoverageRow[] = []
    const assetIds = new Set<string>()
    for (const row of rows) {
      ;(row.coverage_scope === 'personal' ? personal : assigned).push(row)
      assetIds.add(row.asset_id)
    }
    return { personal, assigned, assetIds }
  }, [rows])

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['my-coverage', userId, orgId] })
    // The governance surfaces read their own keys. Coverage the user just
    // declared should appear there too rather than after a hard refresh.
    queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
    queryClient.invalidateQueries({ queryKey: ['coverage'] })
    queryClient.invalidateQueries({ queryKey: ['coverage-gaps'] })
    queryClient.invalidateQueries({ queryKey: ['mobile-coverage', orgId] })
    /**
     * The ranking index — the reason any of this is worth declaring.
     *
     * Without this line the Ideas feed cannot change in the session where the
     * reader made the declaration. `useCoverageRelevance` holds its own key
     * with a 30s staleTime, so the feed kept ranking against "you cover
     * nothing" while the confirmation on screen said Tesseract would use it to
     * decide what to put in front of them. Measured on staging: declaring two
     * names moved the desktop Ideas feed by exactly zero positions.
     *
     * The feed re-keys off `coverageSignature`, so refreshing this index is
     * what actually re-ranks both shells.
     */
    queryClient.invalidateQueries({ queryKey: ['coverage-relevance'] })
  }, [queryClient, userId, orgId])

  const addMutation = useMutation({
    mutationFn: (assetId: string) =>
      addPersonalCoverage({ organizationId: orgId, assetId, analystName }),
    onSuccess: invalidate,
  })

  const removeMutation = useMutation({
    mutationFn: (assetId: string) => removePersonalCoverage(orgId, assetId),
    onSuccess: invalidate,
  })

  const notesMutation = useMutation({
    mutationFn: ({ assetId, notes }: { assetId: string; notes: string | null }) =>
      updatePersonalCoverageNotes(orgId, assetId, notes),
    onSuccess: invalidate,
  })

  return {
    rows,
    personal,
    assigned,
    assetIds,
    hasCoverage: rows.length > 0,
    isLoading: query.isLoading,
    error: query.error,

    add: useCallback(async (assetId: string) => {
      await addMutation.mutateAsync(assetId)
    }, [addMutation]),

    remove: useCallback(async (assetId: string) => {
      await removeMutation.mutateAsync(assetId)
    }, [removeMutation]),

    setNotes: useCallback(async (assetId: string, notes: string | null) => {
      await notesMutation.mutateAsync({ assetId, notes })
    }, [notesMutation]),

    isMutating:
      addMutation.isPending || removeMutation.isPending || notesMutation.isPending,
  }
}
