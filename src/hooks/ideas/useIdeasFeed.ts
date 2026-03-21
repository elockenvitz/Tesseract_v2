/**
 * useIdeasFeed — Primary infinite-scroll feed hook for the Ideas page.
 *
 * Fetches content from multiple sources, applies ranking, and supports
 * cursor-based infinite loading. This replaces the all-at-once discovery
 * feed with a proper paginated approach.
 *
 * Feed modes:
 * - 'for_you': Ranked by relevance to current user (default)
 * - 'following': Only from followed authors
 * - 'latest': Pure recency sort
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { subDays } from 'date-fns'
import type { FeedItem, ScoredFeedItem, ItemType, Author } from './types'

// ============================================================
// Types
// ============================================================

export type FeedMode = 'for_you' | 'following' | 'latest'

export interface IdeasFeedFilters {
  mode: FeedMode
  types?: ItemType[]
  timeRange?: 'day' | 'week' | 'month' | 'all'
  assetId?: string
  portfolioId?: string
  themeId?: string
  search?: string
}

interface FeedPage {
  items: ScoredFeedItem[]
  nextCursor: number | null
}

// ============================================================
// Constants
// ============================================================

const PAGE_SIZE = 15
const MAX_DAYS_BACK = 90

// ============================================================
// Signal card types for system-generated content
// ============================================================

export type SignalType = 'attention_cluster' | 'stale_coverage' | 'conflict' | 'catalyst_proximity' | 'prompt'

export interface SignalCard {
  id: string
  type: 'signal'
  signalType: SignalType
  headline: string
  body: string
  relatedAssets: Array<{ id: string; symbol: string }>
  relatedAuthors?: Author[]
  relatedPostIds?: string[]
  metric?: string
  metricLabel?: string
  createdAt: string
  priority: number // 0-1, used for insertion ranking
}

// ============================================================
// Feed item with signal cards mixed in
// ============================================================

export type MixedFeedItem = ScoredFeedItem | SignalCard

export function isSignalCard(item: MixedFeedItem): item is SignalCard {
  return item.type === 'signal'
}

// ============================================================
// User context for ranking
// ============================================================

function useUserContext() {
  const { user } = useAuth()

  const followedQuery = useQuery({
    queryKey: ['feed-context', 'followed', user?.id],
    queryFn: async () => {
      if (!user) return []
      const { data } = await supabase
        .from('author_follows')
        .select('followed_id')
        .eq('follower_id', user.id)
      return (data || []).map(r => r.followed_id)
    },
    enabled: !!user,
    staleTime: 60_000,
  })

  const holdingsQuery = useQuery({
    queryKey: ['feed-context', 'holdings', user?.id],
    queryFn: async () => {
      if (!user) return new Set<string>()
      const { data } = await supabase
        .from('portfolio_holdings')
        .select('asset_id, portfolios!inner(id)')
      const ids = new Set<string>()
      for (const h of data || []) if (h.asset_id) ids.add(h.asset_id)
      return ids
    },
    enabled: !!user,
    staleTime: 60_000,
  })

  return {
    userId: user?.id || null,
    followedIds: followedQuery.data || [],
    heldAssetIds: holdingsQuery.data || new Set<string>(),
  }
}

// ============================================================
// Score a single feed item
// ============================================================

function scoreFeedItem(
  item: FeedItem,
  ctx: { userId: string | null; followedIds: string[]; heldAssetIds: Set<string> },
  mode: FeedMode,
): ScoredFeedItem {
  const ageHours = (Date.now() - new Date(item.created_at).getTime()) / (1000 * 60 * 60)

  // Freshness: exponential decay, half-life 18h
  const freshness = Math.pow(0.5, ageHours / 18)

  // Author relevance
  const isOwn = item.author?.id === ctx.userId
  const isFollowed = ctx.followedIds.includes(item.author?.id || '')
  const authorRelevance = isOwn ? 0.7 : isFollowed ? 0.9 : 0.3

  // Asset relevance
  const assetId = 'asset' in item && item.asset ? item.asset.id : null
  const assetRelevance = assetId && ctx.heldAssetIds.has(assetId) ? 0.9 : 0.3

  // Content quality
  const contentLen = (item.content || '').length
  const hasAsset = !!assetId
  const hasSentiment = 'sentiment' in item && !!item.sentiment
  const quality = Math.min(1, (contentLen > 200 ? 0.4 : contentLen > 50 ? 0.2 : 0.1) +
    (hasAsset ? 0.3 : 0) + (hasSentiment ? 0.2 : 0))

  // Engagement
  const reactionCount = item.reactionCounts?.reduce((s, r) => s + r.count, 0) || 0
  const engagement = Math.min(1, Math.log2(reactionCount + 1) / 4)

  // Weighted score
  let score: number
  if (mode === 'latest') {
    score = freshness
  } else if (mode === 'following') {
    score = freshness * 0.5 + authorRelevance * 0.3 + quality * 0.2
  } else {
    // for_you
    score = freshness * 0.25 + authorRelevance * 0.2 + assetRelevance * 0.2 +
            quality * 0.15 + engagement * 0.2
  }

  return {
    ...item,
    score,
    scoreBreakdown: {
      recency: freshness,
      engagement,
      authorRelevance,
      assetRelevance,
      contentQuality: quality,
    },
    cardSize: 'medium' as const,
  }
}

// ============================================================
// Apply diversity controls
// ============================================================

function applyDiversity(items: ScoredFeedItem[]): ScoredFeedItem[] {
  const result: ScoredFeedItem[] = []
  const recentAuthors: string[] = []
  const recentAssets: string[] = []

  for (const item of items) {
    const authorId = item.author?.id || ''
    const assetId = ('asset' in item && item.asset?.id) || ''

    // Penalize if 3+ from same author in last 5
    const authorRecent = recentAuthors.slice(-5).filter(a => a === authorId).length
    if (authorRecent >= 3) continue // skip, will appear later

    // Penalize if 2+ on same asset in last 4
    const assetRecent = recentAssets.slice(-4).filter(a => a === assetId && a !== '').length
    if (assetRecent >= 2) continue

    result.push(item)
    recentAuthors.push(authorId)
    recentAssets.push(assetId)
  }

  return result
}

// ============================================================
// Fetch a page of feed items
// ============================================================

async function fetchFeedPage(
  offset: number,
  filters: IdeasFeedFilters,
  ctx: { userId: string | null; followedIds: string[]; heldAssetIds: Set<string> },
): Promise<FeedPage> {
  const timeStart = filters.timeRange === 'day' ? subDays(new Date(), 1).toISOString()
    : filters.timeRange === 'week' ? subDays(new Date(), 7).toISOString()
    : filters.timeRange === 'month' ? subDays(new Date(), 30).toISOString()
    : subDays(new Date(), MAX_DAYS_BACK).toISOString()

  const wantTypes = filters.types && filters.types.length > 0 ? filters.types : null

  // Parallel fetch from content sources
  const fetchSize = PAGE_SIZE + 5 // overfetch slightly for diversity filtering

  const queries: Promise<FeedItem[]>[] = []

  // Quick thoughts
  if (!wantTypes || wantTypes.includes('quick_thought')) {
    queries.push((async () => {
      let q = supabase
        .from('quick_thoughts')
        .select('id, content, created_at, updated_at, sentiment, visibility, is_pinned, tags, asset_id, created_by, source_url, source_title, assets:asset_id(id, symbol, company_name)')
        .eq('is_archived', false)
        .gte('created_at', timeStart)
        .order('created_at', { ascending: false })
        .range(offset, offset + fetchSize - 1)

      if (filters.mode === 'following' && ctx.followedIds.length > 0) {
        q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
      }
      if (filters.assetId) q = q.eq('asset_id', filters.assetId)

      const { data } = await q
      if (!data) return []

      // Fetch authors
      const authorIds = [...new Set((data as any[]).map(d => d.created_by).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      return (data as any[]).map(d => ({
        id: d.id,
        type: 'quick_thought' as const,
        content: d.content || '',
        created_at: d.created_at,
        updated_at: d.updated_at,
        author: (() => { const u = userMap.get(d.created_by); return u ? { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name } : { id: d.created_by || '' } })(),
        sentiment: d.sentiment,
        visibility: d.visibility || 'team',
        is_pinned: d.is_pinned || false,
        tags: d.tags || [],
        source_url: d.source_url,
        source_title: d.source_title,
        asset: d.assets || undefined,
      }))
    })())
  }

  // Trade ideas
  if (!wantTypes || wantTypes.includes('trade_idea')) {
    queries.push((async () => {
      let q = supabase
        .from('trade_queue_items')
        .select('id, action, urgency, rationale, status, created_at, created_by, asset_id, portfolio_id, pair_id, sharing_visibility, assets:asset_id(id, symbol, company_name, current_price), portfolios:portfolio_id(id, name)')
        .eq('status', 'idea')
        .eq('visibility_tier', 'active')
        .gte('created_at', timeStart)
        .order('created_at', { ascending: false })
        .range(offset, offset + fetchSize - 1)

      if (filters.mode === 'following' && ctx.followedIds.length > 0) {
        q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
      }
      if (filters.assetId) q = q.eq('asset_id', filters.assetId)
      if (filters.portfolioId) q = q.eq('portfolio_id', filters.portfolioId)

      const { data } = await q
      if (!data) return []

      const authorIds = [...new Set((data as any[]).map(d => d.created_by).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      return (data as any[]).filter(d => !d.pair_id).map(d => ({
        id: d.id,
        type: 'trade_idea' as const,
        content: d.rationale || '',
        created_at: d.created_at,
        author: (() => { const u = userMap.get(d.created_by); return u ? { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name } : { id: d.created_by || '' } })(),
        action: d.action as any,
        urgency: d.urgency as any,
        rationale: d.rationale,
        status: d.status,
        sharing_visibility: d.sharing_visibility,
        asset: d.assets || undefined,
        portfolio: d.portfolios || undefined,
      }))
    })())
  }

  // Notes (asset notes only for now — most relevant)
  if (!wantTypes || wantTypes.includes('note')) {
    queries.push((async () => {
      let q = supabase
        .from('asset_notes')
        .select('id, title, content, created_at, user_id, asset_id, assets:asset_id(id, symbol, company_name)')
        .gte('created_at', timeStart)
        .order('created_at', { ascending: false })
        .range(offset, offset + fetchSize - 1)

      if (filters.mode === 'following' && ctx.followedIds.length > 0) {
        q = q.in('user_id', [...ctx.followedIds, ctx.userId || ''])
      }
      if (filters.assetId) q = q.eq('asset_id', filters.assetId)

      const { data } = await q
      if (!data) return []

      const authorIds = [...new Set((data as any[]).map(d => d.user_id).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      return (data as any[]).map(d => ({
        id: d.id,
        type: 'note' as const,
        content: d.content || '',
        created_at: d.created_at,
        author: (() => { const u = userMap.get(d.user_id); return u ? { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name } : { id: d.user_id || '' } })(),
        title: d.title || '',
        note_type: 'asset' as const,
        preview: (d.content || '').replace(/<[^>]*>/g, '').slice(0, 200),
        source: d.assets ? { id: d.assets.id, name: d.assets.symbol, type: 'asset' } : undefined,
        asset: d.assets || undefined,
      }))
    })())
  }

  // Thesis updates
  if (!wantTypes || wantTypes.includes('thesis_update')) {
    queries.push((async () => {
      let q = supabase
        .from('asset_contributions')
        .select('id, section, content, created_at, created_by, asset_id, assets:asset_id(id, symbol, company_name)')
        .gte('created_at', timeStart)
        .order('created_at', { ascending: false })
        .range(offset, offset + fetchSize - 1)

      if (filters.mode === 'following' && ctx.followedIds.length > 0) {
        q = q.in('created_by', [...ctx.followedIds, ctx.userId || ''])
      }
      if (filters.assetId) q = q.eq('asset_id', filters.assetId)

      const { data } = await q
      if (!data) return []

      const authorIds = [...new Set((data as any[]).map(d => d.created_by).filter(Boolean))]
      const { data: users } = authorIds.length > 0
        ? await supabase.from('users').select('id, email, first_name, last_name').in('id', authorIds)
        : { data: [] }
      const userMap = new Map((users || []).map(u => [u.id, u]))

      return (data as any[]).map(d => ({
        id: d.id,
        type: 'thesis_update' as const,
        content: d.content || '',
        created_at: d.created_at,
        author: (() => { const u = userMap.get(d.created_by); return u ? { id: u.id, email: u.email, first_name: u.first_name, last_name: u.last_name } : { id: d.created_by || '' } })(),
        section: d.section,
        change_type: 'updated' as const,
        asset: d.assets || undefined,
      }))
    })())
  }

  // Execute all queries in parallel
  const results = await Promise.all(queries)
  const allItems = results.flat()

  // Score and sort
  const scored = allItems.map(item => scoreFeedItem(item, ctx, filters.mode))
  scored.sort((a, b) => b.score - a.score)

  // Apply diversity controls
  const diverse = applyDiversity(scored)

  // Paginate
  const pageItems = diverse.slice(0, PAGE_SIZE)
  const hasMore = allItems.length >= fetchSize

  return {
    items: pageItems,
    nextCursor: hasMore ? offset + PAGE_SIZE : null,
  }
}

// ============================================================
// Main hook
// ============================================================

export function useIdeasFeed(filters: IdeasFeedFilters) {
  const ctx = useUserContext()

  const query = useInfiniteQuery({
    queryKey: ['ideas-feed', filters, ctx.userId, ctx.followedIds.length],
    queryFn: async ({ pageParam = 0 }) => {
      return fetchFeedPage(pageParam, filters, ctx)
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!ctx.userId,
    staleTime: 30_000,
  })

  const items = useMemo(() => {
    return query.data?.pages.flatMap(p => p.items) || []
  }, [query.data])

  return {
    items,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: !!query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    isError: query.isError,
  }
}
