/**
 * useMyCoverage — the one coverage hook the first session uses, on both shells.
 *
 * Desktop and mobile present coverage very differently (a governance matrix
 * versus three lists), and that is right. What they must not do is disagree
 * about what the user covers, so the *state* is one hook and only the
 * presentation forks. This is the same rule the mobile strategy already
 * follows for everything else: one app, two shells, one data layer.
 *
 * Reads both lanes. Writes only the personal one — see
 * `lib/coverage/personal-coverage.ts` for why that boundary lives in RLS.
 */

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  addPersonalCoverage,
  addPersonalCoverageBulk,
  coverageAnalystName,
  fetchMyCoverage,
  removePersonalCoverage,
  type PersonalCoverageRow,
} from '../lib/coverage/personal-coverage'
import { evaluateActivation, markActivationMilestone } from '../lib/onboarding/activation'

export interface MyCoverageState {
  /** Every active coverage row naming this user in this org, both lanes. */
  rows: PersonalCoverageRow[]
  /** Rows the user declared themselves and may edit. */
  personal: PersonalCoverageRow[]
  /** Rows the organization assigned. Read-only to this user. */
  assigned: PersonalCoverageRow[]
  /** Asset ids across both lanes — the "what is mine" set for relevance. */
  assetIds: Set<string>
  /**
   * Whether Tesseract understands coverage context for this user.
   *
   * Half of the activation definition, and deliberately satisfied by EITHER
   * lane: a user invited into an already-configured team has meaningful
   * coverage context from the moment they arrive, without declaring anything.
   * Requiring a personal row would report them as un-onboarded forever and
   * push them to re-declare work somebody already did.
   */
  hasCoverage: boolean
  isLoading: boolean
  error: unknown
}

export interface MyCoverageActions {
  add: (assetId: string) => Promise<void>
  addMany: (assetIds: string[]) => Promise<{ added: number; failed: number }>
  remove: (assetId: string) => Promise<void>
  isMutating: boolean
}

export function useMyCoverage(): MyCoverageState & MyCoverageActions {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const userId = user?.id ?? null
  const orgId = currentOrgId ?? null

  const identity = useMemo(
    () =>
      userId && orgId
        ? { userId, orgId, analystName: coverageAnalystName(user as any) }
        : null,
    [userId, orgId, (user as any)?.first_name, (user as any)?.last_name, (user as any)?.email],
  )

  // Org is in the key, not just the filter. A cache entry shared across orgs is
  // the exact shape the org-scope guard exists to catch, and coverage is
  // precisely the kind of per-tenant data that would leak through one.
  const query = useQuery({
    queryKey: ['my-coverage', userId, orgId],
    enabled: !!userId && !!orgId,
    staleTime: 30_000,
    queryFn: () => fetchMyCoverage({ userId: userId!, orgId: orgId! }),
  })

  const rows = query.data ?? []

  const { personal, assigned, assetIds } = useMemo(() => {
    const personal: PersonalCoverageRow[] = []
    const assigned: PersonalCoverageRow[] = []
    const assetIds = new Set<string>()
    for (const row of rows) {
      ;(row.coverage_scope === 'personal' ? personal : assigned).push(row)
      assetIds.add(row.asset_id)
    }
    return { personal, assigned, assetIds }
  }, [rows])

  const hasCoverage = rows.length > 0

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['my-coverage', userId, orgId] })
    // The governance surfaces read their own unscoped keys. Coverage the user
    // just declared should appear there too rather than after a hard refresh.
    queryClient.invalidateQueries({ queryKey: ['all-coverage'] })
    queryClient.invalidateQueries({ queryKey: ['coverage'] })
    queryClient.invalidateQueries({ queryKey: ['mobile-coverage', orgId] })
    queryClient.invalidateQueries({ queryKey: ['coverage-gaps'] })
  }, [queryClient, userId, orgId])

  /**
   * Mark the coverage half of activation, then see whether that completes it.
   *
   * Fired after a successful write rather than on render: "the user has
   * coverage" and "the user established coverage" are different claims, and
   * only the second is a milestone. A user who arrives into a configured team
   * gets the milestone the first time a write of theirs succeeds, or from the
   * separate observation path — not from merely having been assigned rows.
   */
  const noteCoverageEstablished = useCallback(
    async (source: 'single' | 'bulk', count: number) => {
      if (!userId || !orgId) return
      const ctx = {
        userId,
        orgId,
        actorEmail: (user as any)?.email ?? null,
        actorName: coverageAnalystName(user as any),
      }
      await markActivationMilestone('coverage_established', ctx, {
        metadata: { source, count },
      })
      await evaluateActivation(ctx)
    },
    [userId, orgId, user],
  )

  const addMutation = useMutation({
    mutationFn: async (assetId: string) => {
      if (!identity) throw new Error('No workspace selected')
      return addPersonalCoverage(identity, assetId)
    },
    onSuccess: async () => {
      invalidate()
      await noteCoverageEstablished('single', 1)
    },
  })

  const addManyMutation = useMutation({
    mutationFn: async (assetIds: string[]) => {
      if (!identity) throw new Error('No workspace selected')
      return addPersonalCoverageBulk(identity, assetIds)
    },
    onSuccess: async (result) => {
      invalidate()
      if (result.added.length > 0) {
        await noteCoverageEstablished('bulk', result.added.length)
      }
    },
  })

  const removeMutation = useMutation({
    mutationFn: async (assetId: string) => {
      if (!identity) throw new Error('No workspace selected')
      return removePersonalCoverage(identity, assetId)
    },
    onSuccess: invalidate,
  })

  return {
    rows,
    personal,
    assigned,
    assetIds,
    hasCoverage,
    isLoading: query.isLoading,
    error: query.error,

    add: useCallback(async (assetId: string) => {
      await addMutation.mutateAsync(assetId)
    }, [addMutation]),

    addMany: useCallback(async (assetIds: string[]) => {
      const result = await addManyMutation.mutateAsync(assetIds)
      return { added: result.added.length, failed: result.failed.length }
    }, [addManyMutation]),

    remove: useCallback(async (assetId: string) => {
      await removeMutation.mutateAsync(assetId)
    }, [removeMutation]),

    isMutating:
      addMutation.isPending || addManyMutation.isPending || removeMutation.isPending,
  }
}
