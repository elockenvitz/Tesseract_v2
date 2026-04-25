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
 */

import { useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { logPilotEvent } from '../lib/pilot/pilot-telemetry'

export type PilotStage =
  | 'trade_book_unlocked'
  | 'outcomes_unlocked'

export interface PilotProgress {
  trade_book_unlocked_at?: string | null
  outcomes_unlocked_at?: string | null
  [key: string]: string | null | undefined
}

const STAGE_TO_KEY: Record<PilotStage, keyof PilotProgress> = {
  trade_book_unlocked: 'trade_book_unlocked_at',
  outcomes_unlocked: 'outcomes_unlocked_at',
}

const STAGE_TO_EVENT: Record<PilotStage, string> = {
  trade_book_unlocked: 'pilot_trade_book_unlocked',
  outcomes_unlocked: 'pilot_outcomes_unlocked',
}

export function usePilotProgress() {
  const { user } = useAuth()
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
      const key = STAGE_TO_KEY[stage]
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
    mark,
  }
}
