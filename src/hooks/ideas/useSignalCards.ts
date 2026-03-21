/**
 * useSignalCards — Generates system signal cards from existing data.
 *
 * Signal types (Tier 1):
 * 1. Attention clusters: multiple posts on the same asset/theme recently
 * 2. Stale coverage: important asset with no recent activity
 * 3. Conflict detection: bullish + bearish sentiment on same asset
 *
 * These are computed client-side from feed data + portfolio context.
 * No AI or external APIs required.
 */

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { subDays, formatDistanceToNow } from 'date-fns'
import type { SignalCard, SignalType } from './useIdeasFeed'

// ============================================================
// Generate attention cluster signals
// ============================================================

async function generateAttentionClusters(): Promise<SignalCard[]> {
  const since = subDays(new Date(), 7).toISOString()

  // Count quick thoughts per asset in last 7 days
  const { data: thoughts } = await supabase
    .from('quick_thoughts')
    .select('asset_id, created_by, sentiment, assets:asset_id(id, symbol, company_name)')
    .eq('is_archived', false)
    .not('asset_id', 'is', null)
    .gte('created_at', since)

  if (!thoughts || thoughts.length === 0) return []

  // Group by asset
  const byAsset = new Map<string, { count: number; authors: Set<string>; asset: any; sentiments: string[] }>()
  for (const t of thoughts as any[]) {
    if (!t.asset_id || !t.assets) continue
    const existing = byAsset.get(t.asset_id) || { count: 0, authors: new Set(), asset: t.assets, sentiments: [] }
    existing.count++
    if (t.created_by) existing.authors.add(t.created_by)
    if (t.sentiment) existing.sentiments.push(t.sentiment)
    byAsset.set(t.asset_id, existing)
  }

  const signals: SignalCard[] = []

  for (const [assetId, data] of byAsset) {
    if (data.count < 3 || data.authors.size < 2) continue // Need 3+ posts from 2+ people

    const hasMixedSentiment = data.sentiments.includes('bullish') && data.sentiments.includes('bearish')
    signals.push({
      id: `signal-cluster-${assetId}`,
      type: 'signal',
      signalType: 'attention_cluster',
      headline: hasMixedSentiment
        ? `${data.asset.symbol}: rising discussion, mixed sentiment`
        : `${data.asset.symbol}: ${data.count} posts in 7 days from ${data.authors.size} people`,
      body: `Activity is building on ${data.asset.symbol}. ${data.authors.size} contributors have posted recently — but no formal trade idea exists yet.`,
      relatedAssets: [{ id: data.asset.id, symbol: data.asset.symbol }],
      metric: String(data.count),
      metricLabel: 'posts this week',
      createdAt: new Date().toISOString(),
      priority: Math.min(1, data.count / 10),
    })
  }

  return signals.sort((a, b) => b.priority - a.priority).slice(0, 3)
}

// ============================================================
// Generate conflict signals (bullish vs bearish)
// ============================================================

async function generateConflictSignals(): Promise<SignalCard[]> {
  const since = subDays(new Date(), 14).toISOString()

  const { data: thoughts } = await supabase
    .from('quick_thoughts')
    .select('asset_id, sentiment, created_by, assets:asset_id(id, symbol, company_name)')
    .eq('is_archived', false)
    .not('asset_id', 'is', null)
    .not('sentiment', 'is', null)
    .in('sentiment', ['bullish', 'bearish'])
    .gte('created_at', since)

  if (!thoughts || thoughts.length === 0) return []

  const byAsset = new Map<string, { bullish: Set<string>; bearish: Set<string>; asset: any }>()
  for (const t of thoughts as any[]) {
    if (!t.asset_id || !t.assets) continue
    const existing = byAsset.get(t.asset_id) || { bullish: new Set(), bearish: new Set(), asset: t.assets }
    if (t.sentiment === 'bullish' && t.created_by) existing.bullish.add(t.created_by)
    if (t.sentiment === 'bearish' && t.created_by) existing.bearish.add(t.created_by)
    byAsset.set(t.asset_id, existing)
  }

  const signals: SignalCard[] = []

  for (const [assetId, data] of byAsset) {
    if (data.bullish.size === 0 || data.bearish.size === 0) continue

    signals.push({
      id: `signal-conflict-${assetId}`,
      type: 'signal',
      signalType: 'conflict',
      headline: `${data.asset.symbol}: team is split — ${data.bullish.size} bullish vs ${data.bearish.size} bearish`,
      body: `Opposing views exist on ${data.asset.symbol} within the team. This disagreement may warrant discussion or a formal review.`,
      relatedAssets: [{ id: data.asset.id, symbol: data.asset.symbol }],
      metric: `${data.bullish.size}/${data.bearish.size}`,
      metricLabel: 'bull / bear',
      createdAt: new Date().toISOString(),
      priority: 0.8,
    })
  }

  return signals.sort((a, b) => b.priority - a.priority).slice(0, 2)
}

// ============================================================
// Generate stale coverage signals
// ============================================================

async function generateStaleCoverageSignals(userId: string): Promise<SignalCard[]> {
  // Get user's portfolio holdings
  const { data: holdings } = await supabase
    .from('portfolio_holdings')
    .select('asset_id, assets:asset_id(id, symbol, company_name)')

  if (!holdings || holdings.length === 0) return []

  const heldAssets = new Map<string, any>()
  for (const h of holdings as any[]) {
    if (h.asset_id && h.assets) heldAssets.set(h.asset_id, h.assets)
  }
  if (heldAssets.size === 0) return []

  // Check for recent activity on held assets
  const since30d = subDays(new Date(), 30).toISOString()
  const assetIds = [...heldAssets.keys()]

  const { data: recentActivity } = await supabase
    .from('quick_thoughts')
    .select('asset_id')
    .in('asset_id', assetIds)
    .gte('created_at', since30d)

  const activeAssets = new Set((recentActivity || []).map((r: any) => r.asset_id))
  const staleAssets = assetIds.filter(id => !activeAssets.has(id))

  if (staleAssets.length === 0) return []

  const signals: SignalCard[] = staleAssets.slice(0, 3).map(assetId => {
    const asset = heldAssets.get(assetId)!
    return {
      id: `signal-stale-${assetId}`,
      type: 'signal' as const,
      signalType: 'stale_coverage' as SignalType,
      headline: `${asset.symbol}: held position with no recent team activity`,
      body: `This position has had no posts, notes, or thesis updates in over 30 days. The view may be stale.`,
      relatedAssets: [{ id: asset.id, symbol: asset.symbol }],
      metric: '30+',
      metricLabel: 'days silent',
      createdAt: new Date().toISOString(),
      priority: 0.6,
    }
  })

  return signals
}

// ============================================================
// Main hook
// ============================================================

export function useSignalCards() {
  const { user } = useAuth()

  const query = useQuery({
    queryKey: ['signal-cards', user?.id],
    queryFn: async () => {
      if (!user) return []

      const [clusters, conflicts, stale] = await Promise.all([
        generateAttentionClusters(),
        generateConflictSignals(),
        generateStaleCoverageSignals(user.id),
      ])

      return [...clusters, ...conflicts, ...stale]
        .sort((a, b) => b.priority - a.priority)
    },
    enabled: !!user,
    staleTime: 5 * 60_000, // 5 min cache — signals don't change fast
  })

  return {
    signals: query.data || [],
    isLoading: query.isLoading,
  }
}

// ============================================================
// Insert signals into feed with pacing
// ============================================================

/**
 * Insert signal cards into the feed with editorial pacing.
 *
 * Rules:
 * - First signal after item 2 (give human content time to anchor)
 * - Subsequent signals every 4-5 human posts
 * - Never two signals back-to-back
 * - Highest priority signals placed first (earlier in feed)
 */
export function insertSignalsIntoFeed(
  feedItems: any[],
  signals: SignalCard[],
): any[] {
  if (signals.length === 0) return feedItems
  if (feedItems.length === 0) return signals.slice(0, 3) // Show signals even with no posts

  const sorted = [...signals].sort((a, b) => b.priority - a.priority)
  const result: any[] = []
  let signalIdx = 0
  let humanCount = 0

  // Insert first signal after 2 human posts, then every 4-5
  const insertPoints = [2, 6, 10, 15, 20, 26]

  for (let i = 0; i < feedItems.length; i++) {
    result.push(feedItems[i])
    humanCount++

    if (signalIdx < sorted.length && insertPoints.includes(humanCount)) {
      result.push(sorted[signalIdx])
      signalIdx++
    }
  }

  return result
}
