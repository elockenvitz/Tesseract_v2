import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useFollowingList } from './ideas/useAuthorFollow'
import type { IdeasScope, IdeasTimeRange } from './useIdeasRouting'
import type { QuickThoughtItem, Author, ScoredFeedItem, CardSize } from './ideas/types'

// ============================================================================
// QUICK THOUGHTS FEED HOOK
// Optimized single-table query when type=quick_thought filter is active
// Supports scope filtering, time range, context filters, and revisit pinning
// ============================================================================

interface UseQuickThoughtsFeedParams {
  scope: IdeasScope
  timeRange: IdeasTimeRange
  assetId?: string | null
  portfolioId?: string | null
  themeId?: string | null
  pageSize?: number
  enabled?: boolean
}

interface QuickThoughtRow {
  id: string
  content: string
  created_at: string
  updated_at: string | null
  sentiment: QuickThoughtItem['sentiment']
  idea_type: 'thought' | 'research_idea' | 'thesis' | null
  source_url: string | null
  source_title: string | null
  ticker_mentions: string[] | null
  tags: string[] | null
  visibility: 'private' | 'team' | 'public'
  is_pinned: boolean
  revisit_date: string | null
  promoted_to_trade_idea_id: string | null
  created_by: string
  asset_id: string | null
  portfolio_id: string | null
  theme_id: string | null
  // Joined relations (no author join - no FK exists)
  assets: {
    id: string
    symbol: string
    company_name: string
  } | null
}

/**
 * Calculate time boundary for time range filter
 */
function getTimeBoundary(timeRange: IdeasTimeRange): string | null {
  if (timeRange === 'all') return null

  const now = new Date()
  switch (timeRange) {
    case 'today':
      now.setHours(0, 0, 0, 0)
      return now.toISOString()
    case 'week':
      now.setDate(now.getDate() - 7)
      return now.toISOString()
    case 'month':
      now.setMonth(now.getMonth() - 1)
      return now.toISOString()
    default:
      return null
  }
}

/**
 * Map user data to Author format
 * Mirrors the implementation in useContentAggregation.ts
 */
function mapUserToAuthor(user: any): Author {
  if (!user) {
    return { id: '', full_name: 'Unknown' }
  }
  return {
    id: user.id || '',
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    full_name: user.first_name && user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.email?.split('@')[0] || 'Unknown',
  }
}

/**
 * Fetch users by IDs and return a Map
 */
async function fetchUsersMap(userIds: string[]): Promise<Map<string, any>> {
  const usersMap = new Map<string, any>()
  if (userIds.length === 0) return usersMap

  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, first_name, last_name')
    .in('id', userIds)

  if (error) {
    console.error('Error fetching users:', error)
    return usersMap
  }

  if (users) {
    users.forEach(u => usersMap.set(u.id, u))
  }
  return usersMap
}

/**
 * Transform database row to ScoredFeedItem format
 * Adds default score values for compatibility with MasonryGrid
 */
function transformRow(
  row: QuickThoughtRow,
  usersMap?: Map<string, any>
): ScoredFeedItem & { revisit_date: string | null; promoted_to_trade_idea_id: string | null } {
  // Get author from usersMap or use placeholder
  const author = usersMap
    ? mapUserToAuthor(usersMap.get(row.created_by))
    : { id: row.created_by, full_name: 'User' }

  // Determine card size based on content length
  const contentLength = row.content?.length || 0
  const cardSize: CardSize = contentLength > 280 ? 'medium' : 'small'

  return {
    id: row.id,
    type: 'quick_thought',
    content: row.content,
    created_at: row.created_at,
    updated_at: row.updated_at || undefined,
    author,
    sentiment: row.sentiment || undefined,
    idea_type: row.idea_type || 'thought',
    source_url: row.source_url || undefined,
    source_title: row.source_title || undefined,
    ticker_mentions: row.ticker_mentions || undefined,
    tags: row.tags || undefined,
    visibility: row.visibility,
    is_pinned: row.is_pinned,
    revisit_date: row.revisit_date,
    promoted_to_trade_idea_id: row.promoted_to_trade_idea_id,
    asset: row.assets ? {
      id: row.assets.id,
      symbol: row.assets.symbol,
      company_name: row.assets.company_name,
    } : undefined,
    // Default score values for MasonryGrid compatibility
    score: 1,
    scoreBreakdown: {
      recency: 1,
      engagement: 0,
      authorRelevance: 0,
      assetRelevance: 0,
      contentQuality: 0,
    },
    cardSize,
  }
}

/**
 * Hook to fetch Quick Thoughts with optimized single-table query
 *
 * SCOPE RULES:
 * - mine: created_by = current user (any visibility)
 * - team: (created_by = me) OR (visibility = 'team')
 * - following: created_by IN (followed users + me), respecting visibility
 * - all: rely on RLS (everything user can see)
 *
 * REVISIT PINNING STRATEGY:
 * Two-query approach to avoid fetching all rows:
 * 1. Query items where revisit_date <= today (limit N)
 * 2. Query remaining items ordered by created_at DESC (exclude revisit items)
 * 3. Merge with revisit items pinned on top
 *
 * TIME FILTERING:
 * - today/week/month/all maps to created_at bounds
 */
export function useQuickThoughtsFeed({
  scope,
  timeRange,
  assetId,
  portfolioId,
  themeId,
  pageSize = 20,
  enabled = true,
}: UseQuickThoughtsFeedParams) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Get followed user IDs for 'following' scope
  const { data: followingData } = useFollowingList(user?.id || '', {
    enabled: !!user?.id && scope === 'following',
  })
  const followedUserIds = followingData?.map(f => f.followed_id) || []

  const queryKey = [
    'quick-thoughts-feed',
    user?.id,
    scope,
    timeRange,
    assetId,
    portfolioId,
    themeId,
    followedUserIds.join(','),
  ]

  // ============================================================================
  // QUERY 1: Revisit items (pinned to top)
  // Items with revisit_date <= today, ordered by revisit_date
  // ============================================================================
  const revisitQuery = useQuery({
    queryKey: [...queryKey, 'revisit'],
    queryFn: async () => {
      if (!user?.id) return []

      const today = new Date().toISOString().split('T')[0]

      let query = supabase
        .from('quick_thoughts')
        .select(`
          id,
          content,
          created_at,
          updated_at,
          sentiment,
          idea_type,
          source_url,
          source_title,
          ticker_mentions,
          tags,
          visibility,
          is_pinned,
          revisit_date,
          promoted_to_trade_idea_id,
          created_by,
          asset_id,
          portfolio_id,
          theme_id,
          assets:asset_id (id, symbol, company_name)
        `)
        .eq('is_archived', false)
        .lte('revisit_date', today)
        .order('revisit_date', { ascending: true })
        .limit(10) // Cap revisit items

      // Apply scope filter
      query = applyScopeFilter(query, scope, user.id, followedUserIds)

      // Apply context filters
      if (assetId) query = query.eq('asset_id', assetId)
      if (portfolioId) query = query.eq('portfolio_id', portfolioId)
      if (themeId) query = query.eq('theme_id', themeId)

      // Apply time filter
      const timeBoundary = getTimeBoundary(timeRange)
      if (timeBoundary) {
        query = query.gte('created_at', timeBoundary)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error fetching revisit items:', error)
        return []
      }

      if (!data || data.length === 0) return []

      // Fetch users for author enrichment
      const userIds = [...new Set(data.map(t => t.created_by).filter(Boolean))]
      const usersMap = await fetchUsersMap(userIds)

      return data.map(row => transformRow(row, usersMap))
    },
    enabled: enabled && !!user?.id,
    staleTime: 30000,
  })

  // ============================================================================
  // QUERY 2: Main feed with infinite scroll
  // Items ordered by created_at DESC, excluding items shown in revisit
  // ============================================================================
  const mainFeedQuery = useInfiniteQuery({
    queryKey: [...queryKey, 'main'],
    queryFn: async ({ pageParam = 0 }) => {
      if (!user?.id) return { items: [], nextCursor: null }

      const today = new Date().toISOString().split('T')[0]

      let query = supabase
        .from('quick_thoughts')
        .select(`
          id,
          content,
          created_at,
          updated_at,
          sentiment,
          idea_type,
          source_url,
          source_title,
          ticker_mentions,
          tags,
          visibility,
          is_pinned,
          revisit_date,
          promoted_to_trade_idea_id,
          created_by,
          asset_id,
          portfolio_id,
          theme_id,
          assets:asset_id (id, symbol, company_name)
        `)
        .eq('is_archived', false)
        // Exclude items that would appear in revisit section
        .or(`revisit_date.is.null,revisit_date.gt.${today}`)
        .order('created_at', { ascending: false })
        .range(pageParam, pageParam + pageSize - 1)

      // Apply scope filter
      query = applyScopeFilter(query, scope, user.id, followedUserIds)

      // Apply context filters
      if (assetId) query = query.eq('asset_id', assetId)
      if (portfolioId) query = query.eq('portfolio_id', portfolioId)
      if (themeId) query = query.eq('theme_id', themeId)

      // Apply time filter
      const timeBoundary = getTimeBoundary(timeRange)
      if (timeBoundary) {
        query = query.gte('created_at', timeBoundary)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error fetching quick thoughts:', error)
        return { items: [], nextCursor: null }
      }

      if (!data || data.length === 0) {
        return { items: [], nextCursor: null }
      }

      // Fetch users for author enrichment
      const userIds = [...new Set(data.map(t => t.created_by).filter(Boolean))]
      const usersMap = await fetchUsersMap(userIds)

      const items = data.map(row => transformRow(row, usersMap))
      const nextCursor = items.length === pageSize ? pageParam + pageSize : null

      return { items, nextCursor }
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: 0,
    enabled: enabled && !!user?.id,
    staleTime: 30000,
  })

  // ============================================================================
  // COMBINED RESULTS
  // Revisit items pinned to top, then main feed items
  // ============================================================================
  const revisitItems = revisitQuery.data || []
  const mainItems = mainFeedQuery.data?.pages.flatMap(page => page.items) || []

  // Dedupe in case of overlap (shouldn't happen but be safe)
  const revisitIds = new Set(revisitItems.map(i => i.id))
  const dedupedMainItems = mainItems.filter(i => !revisitIds.has(i.id))

  const allItems = [...revisitItems, ...dedupedMainItems]

  // Invalidation helper
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['quick-thoughts-feed'] })
  }

  return {
    items: allItems,
    revisitItems,
    mainItems: dedupedMainItems,
    isLoading: revisitQuery.isLoading || mainFeedQuery.isLoading,
    isFetchingNextPage: mainFeedQuery.isFetchingNextPage,
    hasNextPage: mainFeedQuery.hasNextPage,
    fetchNextPage: mainFeedQuery.fetchNextPage,
    refetch: () => {
      revisitQuery.refetch()
      mainFeedQuery.refetch()
    },
    invalidate,
    error: revisitQuery.error || mainFeedQuery.error,
  }
}

/**
 * Apply scope filter to query
 * Extracted for reuse between revisit and main queries
 */
function applyScopeFilter(
  query: any,
  scope: IdeasScope,
  userId: string,
  followedUserIds: string[]
): any {
  switch (scope) {
    case 'mine':
      // Only items created by current user
      return query.eq('created_by', userId)

    case 'team':
      // My items OR team-visible items
      return query.or(`created_by.eq.${userId},visibility.eq.team`)

    case 'following':
      // Items from followed users + self, respecting visibility
      // For followed users, only show non-private items
      // For self, show all
      if (followedUserIds.length === 0) {
        return query.eq('created_by', userId)
      }
      const followedList = followedUserIds.map(id => `created_by.eq.${id}`).join(',')
      return query.or(`created_by.eq.${userId},and(${followedList},visibility.neq.private)`)

    case 'all':
      // RLS handles visibility - no additional filter
      // But still filter out private items from others
      return query.or(`created_by.eq.${userId},visibility.neq.private`)

    default:
      return query.eq('created_by', userId)
  }
}

// ============================================================================
// SINGLE ITEM HOOK
// For fetching a single Quick Thought by ID (used in detail panel)
// ============================================================================

export function useQuickThought(id: string | null) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['quick-thought', id],
    queryFn: async () => {
      if (!id || !user?.id) return null

      const { data, error } = await supabase
        .from('quick_thoughts')
        .select(`
          id,
          content,
          created_at,
          updated_at,
          sentiment,
          idea_type,
          source_url,
          source_title,
          ticker_mentions,
          tags,
          visibility,
          is_pinned,
          revisit_date,
          promoted_to_trade_idea_id,
          created_by,
          asset_id,
          portfolio_id,
          theme_id,
          assets:asset_id (id, symbol, company_name),
          portfolios:portfolio_id (id, name),
          themes:theme_id (id, name)
        `)
        .eq('id', id)
        .single()

      if (error) {
        console.error('Error fetching quick thought:', error)
        return null
      }

      // Fetch user for author enrichment
      const usersMap = data.created_by
        ? await fetchUsersMap([data.created_by])
        : new Map()

      return {
        ...transformRow(data as QuickThoughtRow, usersMap),
        portfolio: data.portfolios ? { id: data.portfolios.id, name: data.portfolios.name } : undefined,
        theme: data.themes ? { id: data.themes.id, name: data.themes.name } : undefined,
      }
    },
    enabled: !!id && !!user?.id,
    staleTime: 30000,
  })
}

// ============================================================================
// TODO: Future enhancements
// - Add reactions/bookmarks to query (join with idea_reactions, user_bookmarks)
// - Add comment count
// - Support search query filtering
// - Add sorting options beyond created_at
// ============================================================================
