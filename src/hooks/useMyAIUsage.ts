/**
 * useMyAIUsage — current user's own AI consumption + cost, derived from
 * ai_usage_log. RLS already allows SELECT where user_id = auth.uid(), so
 * this works identically for BYOK and platform-mode users.
 *
 * For BYOK users, the cost shown is what they paid their provider directly
 * (estimated from the pricing table in the edge function). For platform
 * mode users, the cost counts against the platform's bill.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface MyAIUsageRow {
  id: string
  created_at: string
  mode: string | null
  provider: string | null
  model: string | null
  purpose: string | null
  context_type: string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_write_tokens: number | null
  cache_read_tokens: number | null
  estimated_cost: number | null
  response_time_ms: number | null
}

export interface MyAIUsageDaily { date: string; cost: number; requests: number }

export interface MyAIUsage {
  rows: MyAIUsageRow[]
  isLoading: boolean
  isError: boolean
  /** Current month-to-date cost (USD) */
  costMtd: number
  /** Last 24h cost (USD) */
  costToday: number
  /** Tokens consumed in last 24h (input + output, excludes cache writes/reads) */
  tokensToday: number
  /** Requests in last 24h */
  requestsToday: number
  /** Cache hit rate today (anthropic only). 0..1. */
  cacheHitRate: number
  /** Was there ≥1 anthropic request today (so cache rate is meaningful)? */
  cacheHasData: boolean
  /** Tokens MTD (all provider input+output, excludes cache) */
  tokensMtd: number
  /** 14-day daily series (including today) */
  daily: MyAIUsageDaily[]
  /** MTD cost grouped by purpose, sorted desc */
  byPurpose: { key: string; cost: number; requests: number }[]
  /** MTD cost grouped by model, sorted desc */
  byModel: { key: string; cost: number; requests: number }[]
}

export function useMyAIUsage(): MyAIUsage {
  const { user } = useAuth()

  const query = useQuery<MyAIUsageRow[]>({
    queryKey: ['my-ai-usage-30d', user?.id],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data, error } = await supabase
        .from('ai_usage_log')
        .select('id, created_at, mode, provider, model, purpose, context_type, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, estimated_cost, response_time_ms')
        .eq('user_id', user!.id)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(5000)
      if (error) throw error
      return (data || []) as MyAIUsageRow[]
    }
  })

  const rows = query.data || []

  const derived = useMemo(() => {
    const now = Date.now()
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime()
    const sinceDay = now - 86400000

    let costMtd = 0, costToday = 0
    let inputTokToday = 0, outputTokToday = 0
    let cacheReadTokToday = 0, cacheWriteTokToday = 0
    let requestsToday = 0
    let tokensMtd = 0
    let cacheableRequestsToday = 0

    for (const r of rows) {
      const t = new Date(r.created_at).getTime()
      const cost = Number(r.estimated_cost) || 0
      const inT = r.input_tokens || 0
      const outT = r.output_tokens || 0
      if (t >= startOfMonth) {
        costMtd += cost
        tokensMtd += inT + outT
      }
      if (t >= sinceDay) {
        costToday += cost
        inputTokToday += inT
        outputTokToday += outT
        cacheReadTokToday += r.cache_read_tokens || 0
        cacheWriteTokToday += r.cache_write_tokens || 0
        requestsToday += 1
        if (r.provider === 'anthropic') cacheableRequestsToday += 1
      }
    }

    const cacheTotal = cacheReadTokToday + cacheWriteTokToday
    const cacheHitRate = cacheTotal > 0 ? cacheReadTokToday / cacheTotal : 0

    // 14-day daily bucket
    const buckets = new Map<string, MyAIUsageDaily>()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400000)
      const key = d.toISOString().slice(0, 10)
      buckets.set(key, { date: key, cost: 0, requests: 0 })
    }
    for (const r of rows) {
      const key = r.created_at.slice(0, 10)
      const b = buckets.get(key)
      if (!b) continue
      b.cost += Number(r.estimated_cost) || 0
      b.requests += 1
    }
    const daily = [...buckets.values()]

    // By purpose / model (MTD)
    const purposeMap = new Map<string, { key: string; cost: number; requests: number }>()
    const modelMap = new Map<string, { key: string; cost: number; requests: number }>()
    for (const r of rows) {
      if (new Date(r.created_at).getTime() < startOfMonth) continue
      const cost = Number(r.estimated_cost) || 0
      const pKey = r.purpose || '(untagged)'
      const mKey = r.model || '(unknown)'
      const pEntry = purposeMap.get(pKey) || { key: pKey, cost: 0, requests: 0 }
      pEntry.cost += cost; pEntry.requests += 1
      purposeMap.set(pKey, pEntry)
      const mEntry = modelMap.get(mKey) || { key: mKey, cost: 0, requests: 0 }
      mEntry.cost += cost; mEntry.requests += 1
      modelMap.set(mKey, mEntry)
    }

    return {
      costMtd,
      costToday,
      requestsToday,
      tokensToday: inputTokToday + outputTokToday,
      tokensMtd,
      cacheHitRate,
      cacheHasData: cacheableRequestsToday > 0,
      daily,
      byPurpose: [...purposeMap.values()].sort((a, b) => b.cost - a.cost),
      byModel: [...modelMap.values()].sort((a, b) => b.cost - a.cost),
    }
  }, [rows])

  return {
    rows,
    isLoading: query.isLoading,
    isError: query.isError,
    ...derived,
  }
}
