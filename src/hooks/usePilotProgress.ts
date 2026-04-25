/**
 * usePilotProgress — reads users.pilot_progress and exposes a
 * markPilotStage mutator. Drives pilot unlock behavior layered on top of
 * usePilotMode's static access config.
 *
 * Stage keys are plain strings so we can evolve without migrations.
 * Known stages today:
 *   - trade_book_unlocked      — first "View in Trade Book" click from the
 *                                Decision Recorded modal
 *   - outcomes_unlocked        — first real visit to Trade Book after
 *                                unlocking (proxies "reviewed")
 *   - graduated                — first time the user reaches Outcomes
 *                                in a given org. Tracked per-org via
 *                                `graduated_at_<orgId>` keys so an
 *                                analyst running multiple pilot clients
 *                                stays "not yet graduated" in each new
 *                                client until they walk the loop there.
 */

import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { logPilotEvent } from '../lib/pilot/pilot-telemetry'

export type PilotStage =
  | 'trade_book_unlocked'
  | 'outcomes_unlocked'
  | 'graduated'

export interface PilotProgress {
  trade_book_unlocked_at?: string | null
  outcomes_unlocked_at?: string | null
  /** @deprecated retained for compatibility — new code reads
   *  `graduated_at_<orgId>` instead, since graduation is per-org. */
  graduated_at?: string | null
  /** Per-org graduation timestamps live as `graduated_at_<orgId>`
   *  inside this same JSONB. Index signature below covers them. */
  [key: string]: string | null | undefined
}

const graduatedKey = (orgId: string | null) => `graduated_at_${orgId || 'no-org'}`

const STAGE_TO_KEY: Record<Exclude<PilotStage, 'graduated'>, keyof PilotProgress> = {
  trade_book_unlocked: 'trade_book_unlocked_at',
  outcomes_unlocked: 'outcomes_unlocked_at',
}

const STAGE_TO_EVENT: Record<PilotStage, string> = {
  trade_book_unlocked: 'pilot_trade_book_unlocked',
  outcomes_unlocked: 'pilot_outcomes_unlocked',
  graduated: 'pilot_graduated',
}

export function usePilotProgress() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['pilot-progress', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<PilotProgress> => {
      const { data, error } = await supabase
        .from('users')
        .select('pilot_progress')
        .eq('id', user!.id)
        .maybeSingle()
      if (error) return {}
      return (data?.pilot_progress ?? {}) as PilotProgress
    },
  })

  const progress: PilotProgress = query.data ?? {}

  const markStage = useMutation({
    mutationFn: async (stage: PilotStage) => {
      if (!user?.id) return
      // Graduation is per-org; everything else is user-level.
      const key: keyof PilotProgress = stage === 'graduated'
        ? graduatedKey(currentOrgId)
        : STAGE_TO_KEY[stage]
      // Already marked? Don't re-write.
      if (progress[key]) return

      const nextProgress: PilotProgress = { ...progress, [key]: new Date().toISOString() }
      const { error } = await supabase
        .from('users')
        .update({ pilot_progress: nextProgress })
        .eq('id', user.id)
      if (error) throw error
      logPilotEvent({ eventType: STAGE_TO_EVENT[stage] })
      return nextProgress
    },
    onSuccess: (next) => {
      if (next) {
        queryClient.setQueryData(['pilot-progress', user?.id], next)
      }
      // Force usePilotMode to re-resolve access
      queryClient.invalidateQueries({ queryKey: ['pilot-progress', user?.id] })
    },
  })

  /** Stable callback — safe to pass into useEffect deps. */
  const mark = useCallback((stage: PilotStage) => {
    markStage.mutate(stage)
  }, [markStage])

  return {
    progress,
    isLoading: query.isLoading,
    hasUnlockedTradeBook: !!progress.trade_book_unlocked_at,
    hasUnlockedOutcomes: !!progress.outcomes_unlocked_at,
    /** Per-org: true only if the user has reached Outcomes in the
     *  CURRENT org. Each new pilot client starts as not-yet-graduated
     *  even for an analyst who's graduated in prior clients. */
    hasGraduated: !!progress[graduatedKey(currentOrgId)],
    mark,
  }
}
