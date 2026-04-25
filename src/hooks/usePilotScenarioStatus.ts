/**
 * usePilotScenarioStatus — lifecycle state for the pilot user's
 * staged recommendation.
 *
 * Returns one of:
 *   - 'loading'   — waiting for scenario + accepted_trades to resolve
 *   - 'seeding'   — no pilot scenario exists yet (RPC still running)
 *   - 'pending'   — scenario exists but hasn't been committed
 *   - 'completed' — an active accepted_trade links back to the
 *                   scenario's trade_queue_item (strong match)
 *
 * Why trade_queue_item_id?
 *   accepted_trades already carries `trade_queue_item_id` as a
 *   nullable FK. The pilot scenario seed writes a trade_queue_item
 *   and remembers it in pilot_scenarios.trade_queue_item_id, so a
 *   committed pilot decision reliably points back. This is a
 *   stronger link than "has any trade in org" (the previous
 *   hasCommittedTradeInOrg signal, which is too broad).
 *
 * Fallback: if trade_queue_item_id didn't make it onto the commit
 * for any reason (older pilot data), we match on asset_id +
 * portfolio_id within the user's scope. Kept narrow so it doesn't
 * bleed into non-pilot activity.
 */

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { usePilotScenario, type PilotScenario } from './usePilotScenario'

export type PilotScenarioState = 'loading' | 'seeding' | 'pending' | 'completed'

export interface PilotScenarioStatus {
  state: PilotScenarioState
  scenario: PilotScenario | null
  /** The matching accepted_trade row when state === 'completed'. */
  acceptedTrade: {
    id: string
    created_at: string
    action: string
    target_weight: number | null
    delta_weight: number | null
    portfolio_id: string
    asset_id: string
  } | null
  /** Timestamp of commit — convenient for the "Committed today" label. */
  committedAt: string | null
  /** True when a structured review (`decision_reviews`) exists for
   *  the committed decision. Drives the final "Apply learning" step
   *  of the workflow strip and the "Learning captured" state on the
   *  Feedback Loop card. */
  hasReview: boolean
}

export function usePilotScenarioStatus(): PilotScenarioStatus {
  const { user } = useAuth()
  const { scenario, isLoading: scenarioLoading } = usePilotScenario()

  const tradeQueueItemId = scenario?.trade_queue_item_id ?? null
  const assetId = scenario?.asset_id ?? null
  const portfolioId = scenario?.portfolio_id ?? null

  const { data: acceptedTrade, isLoading: tradeLoading } = useQuery({
    // Key on trade_queue_item_id + asset/portfolio so switching
    // scenarios (or an ops reset) invalidates cleanly.
    queryKey: [
      'pilot-scenario-committed',
      user?.id,
      tradeQueueItemId,
      assetId,
      portfolioId,
    ],
    enabled: !!user?.id && !!scenario && (!!tradeQueueItemId || (!!assetId && !!portfolioId)),
    queryFn: async () => {
      // Strong link — scenario's trade_queue_item_id points directly
      // at the accepted_trade. Any non-reverted row wins.
      if (tradeQueueItemId) {
        const { data, error } = await supabase
          .from('accepted_trades')
          .select('id, created_at, action, target_weight, delta_weight, portfolio_id, asset_id, is_active, reverted_at')
          .eq('trade_queue_item_id', tradeQueueItemId)
          .eq('is_active', true)
          .is('reverted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) throw error
        if (data) return data
      }
      // Fallback — older pilots may have committed without the
      // trade_queue_item_id link. Match on asset + portfolio so we
      // stay scoped to the scenario's asset in the scenario's
      // portfolio (no bleed into unrelated rows).
      if (assetId && portfolioId) {
        const { data, error } = await supabase
          .from('accepted_trades')
          .select('id, created_at, action, target_weight, delta_weight, portfolio_id, asset_id, is_active, reverted_at')
          .eq('asset_id', assetId)
          .eq('portfolio_id', portfolioId)
          .eq('is_active', true)
          .is('reverted_at', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) throw error
        return data ?? null
      }
      return null
    },
    staleTime: 15_000,
  })

  // Reflection / review detection — the accepted trade's
  // decision_reviews row with any structured content (thesis call
  // or a process note) signals "learning captured".
  const { data: hasReview = false } = useQuery({
    queryKey: ['pilot-scenario-review', acceptedTrade?.id],
    enabled: !!acceptedTrade?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('decision_reviews')
        .select('decision_id, thesis_played_out, process_note')
        .eq('decision_id', acceptedTrade!.id)
        .maybeSingle()
      if (error) throw error
      if (!data) return false
      return !!(data.thesis_played_out || (data.process_note || '').trim())
    },
    staleTime: 15_000,
  })

  if (!user) return { state: 'loading', scenario: null, acceptedTrade: null, committedAt: null, hasReview: false }
  if (scenarioLoading) return { state: 'loading', scenario: null, acceptedTrade: null, committedAt: null, hasReview: false }
  if (!scenario) return { state: 'seeding', scenario: null, acceptedTrade: null, committedAt: null, hasReview: false }
  if (tradeLoading) return { state: 'loading', scenario, acceptedTrade: null, committedAt: null, hasReview: false }

  if (acceptedTrade) {
    return {
      state: 'completed',
      scenario,
      acceptedTrade: {
        id: acceptedTrade.id,
        created_at: acceptedTrade.created_at,
        action: acceptedTrade.action,
        target_weight: acceptedTrade.target_weight,
        delta_weight: acceptedTrade.delta_weight,
        portfolio_id: acceptedTrade.portfolio_id,
        asset_id: acceptedTrade.asset_id,
      },
      committedAt: acceptedTrade.created_at,
      hasReview,
    }
  }
  return { state: 'pending', scenario, acceptedTrade: null, committedAt: null, hasReview: false }
}
