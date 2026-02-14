import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { findOrCreateRevision, addRevisionEvents } from '../lib/revision-service'

export type TimeframeType = 'preset' | 'date' | 'custom'

export interface AnalystPriceTarget {
  id: string
  asset_id: string
  scenario_id: string
  user_id: string
  price: number
  timeframe: string | null
  timeframe_type: TimeframeType
  target_date: string | null // ISO date string
  is_rolling: boolean
  reasoning: string | null
  probability: number | null
  is_official: boolean
  created_at: string
  updated_at: string
  // Draft fields (unpublished edits)
  draft_price: number | null
  draft_timeframe: string | null
  draft_timeframe_type: string | null
  draft_target_date: string | null
  draft_is_rolling: boolean | null
  draft_reasoning: string | null
  draft_probability: number | null
  draft_updated_at: string | null
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
  scenario?: {
    id: string
    name: string
    color: string | null
    is_default: boolean
  }
  coverage?: {
    role: string | null
    is_active: boolean
  }
}

/** Whether a target has a pending draft */
export function hasDraft(target: AnalystPriceTarget): boolean {
  return target.draft_updated_at != null
}

export interface PriceTargetHistory {
  id: string
  price_target_id: string
  field_name: string
  old_value: string | null
  new_value: string | null
  changed_by: string | null
  changed_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    full_name?: string
  }
}

// Helper to compute full name
const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

interface UseAnalystPriceTargetsOptions {
  assetId: string
  scenarioId?: string // Filter by specific scenario
  userId?: string // Filter by specific user
  officialOnly?: boolean // Only show official (covering analyst) targets
}

export function useAnalystPriceTargets({
  assetId,
  scenarioId,
  userId,
  officialOnly = false
}: UseAnalystPriceTargetsOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch price targets
  const {
    data: priceTargets,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['analyst-price-targets', assetId, scenarioId, userId, officialOnly],
    queryFn: async () => {
      let query = supabase
        .from('analyst_price_targets')
        .select(`
          *,
          user:users!analyst_price_targets_user_id_fkey(id, first_name, last_name),
          scenario:scenarios!analyst_price_targets_scenario_id_fkey(id, name, color, is_default)
        `)
        .eq('asset_id', assetId)
        .order('updated_at', { ascending: false })

      if (scenarioId) {
        query = query.eq('scenario_id', scenarioId)
      }

      if (userId) {
        query = query.eq('user_id', userId)
      }

      if (officialOnly) {
        query = query.eq('is_official', true)
      }

      const { data, error } = await query

      if (error) throw error

      // Fetch coverage data for each user to get their role
      const userIds = [...new Set((data || []).map(pt => pt.user_id))]
      const { data: coverageData } = await supabase
        .from('coverage')
        .select('user_id, role, is_active')
        .eq('asset_id', assetId)
        .eq('is_active', true)
        .in('user_id', userIds)

      const coverageMap = new Map(
        (coverageData || []).map(c => [c.user_id, { role: c.role, is_active: c.is_active }])
      )

      return (data || []).map(pt => ({
        ...pt,
        price: Number(pt.price),
        probability: pt.probability ? Number(pt.probability) : null,
        // Ensure new timeframe fields have correct types/defaults
        timeframe_type: (pt.timeframe_type || 'preset') as TimeframeType,
        target_date: pt.target_date || null,
        is_rolling: pt.is_rolling === true, // Ensure boolean
        // Draft fields
        draft_price: pt.draft_price != null ? Number(pt.draft_price) : null,
        draft_probability: pt.draft_probability != null ? Number(pt.draft_probability) : null,
        draft_timeframe: pt.draft_timeframe || null,
        draft_timeframe_type: pt.draft_timeframe_type || null,
        draft_target_date: pt.draft_target_date || null,
        draft_is_rolling: pt.draft_is_rolling ?? null,
        draft_reasoning: pt.draft_reasoning || null,
        draft_updated_at: pt.draft_updated_at || null,
        user: pt.user ? { ...pt.user, full_name: getFullName(pt.user) } : undefined,
        coverage: coverageMap.get(pt.user_id)
      })) as AnalystPriceTarget[]
    },
    enabled: !!assetId,
    staleTime: Infinity, // Never refetch automatically
    gcTime: 30 * 60 * 1000
  })

  // Get current user's price targets
  const myPriceTargets = priceTargets?.filter(pt => pt.user_id === user?.id) || []

  // Get other users' price targets
  const otherPriceTargets = priceTargets?.filter(pt => pt.user_id !== user?.id) || []

  // Group price targets by scenario
  const priceTargetsByScenario = (priceTargets || []).reduce((acc, pt) => {
    const scenarioName = pt.scenario?.name || 'Unknown'
    if (!acc[scenarioName]) {
      acc[scenarioName] = []
    }
    acc[scenarioName].push(pt)
    return acc
  }, {} as Record<string, AnalystPriceTarget[]>)

  // Group price targets by user
  const priceTargetsByUser = (priceTargets || []).reduce((acc, pt) => {
    const userId = pt.user_id
    if (!acc[userId]) {
      acc[userId] = []
    }
    acc[userId].push(pt)
    return acc
  }, {} as Record<string, AnalystPriceTarget[]>)

  // Check if user is a covering analyst
  const checkIsCoveringAnalyst = async (checkUserId: string): Promise<boolean> => {
    const { data } = await supabase
      .from('coverage')
      .select('id')
      .eq('asset_id', assetId)
      .eq('user_id', checkUserId)
      .eq('is_active', true)
      .maybeSingle()

    return !!data
  }

  // ---- DRAFT / PUBLISH PATTERN ----

  /** Save draft: writes to draft_* columns only. No revision events. */
  const saveDraftPriceTarget = useMutation({
    mutationFn: async ({
      scenarioId,
      price,
      timeframe,
      timeframeType,
      targetDate,
      isRolling,
      reasoning,
      probability
    }: {
      scenarioId: string
      price: number
      timeframe?: string
      timeframeType?: TimeframeType
      targetDate?: string
      isRolling?: boolean
      reasoning?: string
      probability?: number
    }) => {
      if (!user) throw new Error('Not authenticated')

      const draftData = {
        draft_price: price,
        draft_timeframe: timeframe || '12 months',
        draft_timeframe_type: timeframeType || 'preset',
        draft_target_date: targetDate || null,
        draft_is_rolling: isRolling ?? false,
        draft_reasoning: reasoning || null,
        draft_probability: probability ?? null,
        draft_updated_at: new Date().toISOString(),
      }

      // Check if target already exists
      const { data: existing } = await supabase
        .from('analyst_price_targets')
        .select('id')
        .eq('scenario_id', scenarioId)
        .eq('user_id', user.id)
        .maybeSingle()

      if (existing) {
        const { error } = await supabase
          .from('analyst_price_targets')
          .update(draftData)
          .eq('id', existing.id)
        if (error) throw error
      } else {
        // Create new row with a placeholder published price of 0 and draft filled in
        const isCovering = await checkIsCoveringAnalyst(user.id)
        const { error } = await supabase
          .from('analyst_price_targets')
          .insert({
            asset_id: assetId,
            scenario_id: scenarioId,
            user_id: user.id,
            price: 0, // placeholder — not published yet
            is_official: isCovering,
            ...draftData,
          })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
    }
  })

  /** Publish a price target: saves to published columns, clears draft, fires revision events. */
  const publishPriceTarget = useMutation({
    mutationFn: async ({
      scenarioId,
      scenarioName,
      price,
      timeframe,
      timeframeType,
      targetDate,
      isRolling,
      reasoning,
      probability
    }: {
      scenarioId: string
      scenarioName?: string
      price: number
      timeframe?: string
      timeframeType?: TimeframeType
      targetDate?: string
      isRolling?: boolean
      reasoning?: string
      probability?: number
    }) => {
      if (!user) throw new Error('Not authenticated')
      const isCovering = await checkIsCoveringAnalyst(user.id)

      // Fetch existing to compute diffs for revision events
      const { data: existing } = await supabase
        .from('analyst_price_targets')
        .select('id, price, probability, timeframe, timeframe_type, target_date, is_rolling')
        .eq('scenario_id', scenarioId)
        .eq('user_id', user.id)
        .maybeSingle()

      const isNewTarget = !existing || (Number(existing.price) === 0 && !existing.timeframe)
      const oldPrice = existing ? Number(existing.price) : 0
      const oldProb = existing?.probability != null ? Number(existing.probability) : null

      const publishedData = {
        price,
        timeframe: timeframe || '12 months',
        timeframe_type: timeframeType || 'preset',
        target_date: targetDate || null,
        is_rolling: isRolling ?? false,
        reasoning: reasoning || null,
        probability: probability ?? null,
        is_official: isCovering,
        updated_at: new Date().toISOString(),
        // Clear any draft
        draft_price: null,
        draft_timeframe: null,
        draft_timeframe_type: null,
        draft_target_date: null,
        draft_is_rolling: null,
        draft_reasoning: null,
        draft_probability: null,
        draft_updated_at: null,
      }

      if (existing) {
        const { error } = await supabase
          .from('analyst_price_targets')
          .update(publishedData)
          .eq('id', existing.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('analyst_price_targets')
          .insert({
            asset_id: assetId,
            scenario_id: scenarioId,
            user_id: user.id,
            ...publishedData,
          })
        if (error) throw error
      }

      // Build revision events
      const revisionEvents: { category: 'valuation_targets'; field_key: string; before_value: string | null; after_value: string; significance_tier: 1 | 2 | 3 }[] = []
      const scenarioSlug = scenarioName ? scenarioName.toLowerCase().replace(/\s+/g, '_') : null
      const fieldPrefix = scenarioSlug ? `targets.${scenarioSlug}` : 'targets'

      if (isNewTarget) {
        revisionEvents.push({ category: 'valuation_targets', field_key: `${fieldPrefix}.price`, before_value: null, after_value: String(price), significance_tier: 1 })
      } else if (oldPrice !== price) {
        revisionEvents.push({ category: 'valuation_targets', field_key: `${fieldPrefix}.price`, before_value: String(oldPrice), after_value: String(price), significance_tier: 1 })
      }

      const newProb = probability ?? null
      if (newProb != null && oldProb != null && newProb !== oldProb && Math.abs(newProb - oldProb) >= 5) {
        revisionEvents.push({ category: 'valuation_targets', field_key: `${fieldPrefix}.prob`, before_value: String(oldProb), after_value: String(newProb), significance_tier: 1 })
      }

      if (!isNewTarget && existing) {
        const oldTimeframe = existing.timeframe || ''
        const newTimeframe = timeframe || ''
        const oldDate = existing.target_date || ''
        const newDate = targetDate || ''
        if (oldTimeframe !== newTimeframe || oldDate !== newDate) {
          revisionEvents.push({ category: 'valuation_targets', field_key: `${fieldPrefix}.expiry`, before_value: oldDate || oldTimeframe || null, after_value: newDate || newTimeframe, significance_tier: 1 })
        }
      }

      // Fire revision events (fire-and-forget)
      if (revisionEvents.length > 0) {
        findOrCreateRevision({ assetId, actorUserId: user.id, viewScopeType: 'firm' })
          .then(revisionId => addRevisionEvents(revisionId, revisionEvents))
          .catch(err => console.warn('Failed to record price target revision:', err))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
      queryClient.invalidateQueries({ queryKey: ['asset-revisions', assetId] })
      queryClient.invalidateQueries({ queryKey: ['price-target-history'] })
    }
  })

  /** Discard a single target's draft. Deletes placeholder rows, clears draft columns on existing targets. */
  const discardDraft = useMutation({
    mutationFn: async (targetId: string) => {
      if (!user) throw new Error('Not authenticated')

      const { data: target, error: fetchErr } = await supabase
        .from('analyst_price_targets')
        .select('id, price, timeframe')
        .eq('id', targetId)
        .eq('user_id', user.id)
        .single()

      if (fetchErr) throw fetchErr
      if (!target) return

      const isPlaceholder = Number(target.price) === 0 && !target.timeframe
      if (isPlaceholder) {
        await supabase.from('analyst_price_targets').delete().eq('id', target.id)
      } else {
        await supabase
          .from('analyst_price_targets')
          .update({
            draft_price: null,
            draft_timeframe: null,
            draft_timeframe_type: null,
            draft_target_date: null,
            draft_is_rolling: null,
            draft_reasoning: null,
            draft_probability: null,
            draft_updated_at: null,
          })
          .eq('id', target.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
    }
  })

  // Legacy: direct save (bypasses draft pattern — kept for backward compat)
  const savePriceTarget = useMutation({
    mutationFn: async ({
      scenarioId,
      price,
      timeframe,
      timeframeType,
      targetDate,
      isRolling,
      reasoning,
      probability
    }: {
      scenarioId: string
      price: number
      timeframe?: string
      timeframeType?: TimeframeType
      targetDate?: string
      isRolling?: boolean
      reasoning?: string
      probability?: number
    }) => {
      if (!user) throw new Error('Not authenticated')
      const isCovering = await checkIsCoveringAnalyst(user.id)

      const { data: existing } = await supabase
        .from('analyst_price_targets')
        .select('id')
        .eq('scenario_id', scenarioId)
        .eq('user_id', user.id)
        .maybeSingle()

      const targetData = {
        price,
        timeframe: timeframe || '12 months',
        timeframe_type: timeframeType || 'preset',
        target_date: targetDate || null,
        is_rolling: isRolling ?? false,
        reasoning: reasoning || null,
        probability: probability || null,
        is_official: isCovering,
        updated_at: new Date().toISOString()
      }

      if (existing) {
        const { data, error } = await supabase
          .from('analyst_price_targets')
          .update(targetData)
          .eq('id', existing.id)
          .select(`
            *,
            user:users!analyst_price_targets_user_id_fkey(id, first_name, last_name),
            scenario:scenarios!analyst_price_targets_scenario_id_fkey(id, name, color, is_default)
          `)
          .single()

        if (error) throw error
        return {
          ...data,
          price: Number(data.price),
          user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
        } as AnalystPriceTarget
      } else {
        const { data, error } = await supabase
          .from('analyst_price_targets')
          .insert({
            asset_id: assetId,
            scenario_id: scenarioId,
            user_id: user.id,
            ...targetData
          })
          .select(`
            *,
            user:users!analyst_price_targets_user_id_fkey(id, first_name, last_name),
            scenario:scenarios!analyst_price_targets_scenario_id_fkey(id, name, color, is_default)
          `)
          .single()

        if (error) throw error
        return {
          ...data,
          price: Number(data.price),
          user: data.user ? { ...data.user, full_name: getFullName(data.user) } : undefined
        } as AnalystPriceTarget
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
    }
  })

  // Delete a price target
  const deletePriceTarget = useMutation({
    mutationFn: async (priceTargetId: string) => {
      const { error } = await supabase
        .from('analyst_price_targets')
        .delete()
        .eq('id', priceTargetId)
        .eq('user_id', user?.id) // Can only delete own targets

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
    }
  })

  // Get price target for specific scenario and user
  const getPriceTarget = (targetScenarioId: string, targetUserId?: string) => {
    const uid = targetUserId || user?.id
    return priceTargets?.find(pt => pt.scenario_id === targetScenarioId && pt.user_id === uid)
  }

  return {
    priceTargets: priceTargets || [],
    myPriceTargets,
    otherPriceTargets,
    priceTargetsByScenario,
    priceTargetsByUser,
    isLoading,
    error,
    refetch,
    savePriceTarget,
    saveDraftPriceTarget,
    publishPriceTarget,
    discardDraft,
    deletePriceTarget,
    getPriceTarget
  }
}

// Hook for fetching price target history
export function usePriceTargetHistory(priceTargetId: string | undefined) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ['price-target-history', priceTargetId],
    queryFn: async () => {
      if (!priceTargetId) return []

      const { data, error } = await supabase
        .from('analyst_price_target_history')
        .select(`
          *,
          user:users!analyst_price_target_history_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('price_target_id', priceTargetId)
        .order('changed_at', { ascending: false })

      if (error) throw error
      return (data || []).map(h => ({
        ...h,
        user: h.user ? { ...h.user, full_name: getFullName(h.user) } : undefined
      })) as PriceTargetHistory[]
    },
    enabled: !!priceTargetId
  })

  return {
    history: history || [],
    isLoading,
    error
  }
}
