import { useInfiniteQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { ScoredFeedItem, FeedFilters, ItemType, Author, QuickThoughtItem, TradeIdeaItem, NoteItem, ThesisUpdateItem } from '../ideas/types'

const PAGE_SIZE = 10

const mapUserToAuthor = (user: any): Author => {
  // Build full_name from first_name and last_name
  const fullName = user?.first_name && user?.last_name
    ? `${user.first_name} ${user.last_name}`
    : user?.first_name || user?.last_name || user?.email?.split('@')[0] || 'Unknown'

  return {
    id: user?.id || '',
    email: user?.email,
    first_name: user?.first_name,
    last_name: user?.last_name,
    full_name: fullName,
    avatar_url: undefined // Users table doesn't have avatar_url
  }
}

function getTimeFilter(timeRange?: 'day' | 'week' | 'month' | 'all'): string {
  const now = new Date()
  switch (timeRange) {
    case 'day':
      return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    case 'week':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
    case 'month':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    default:
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString()
  }
}

async function fetchFeedPage(
  pageParam: number,
  filters: FeedFilters
): Promise<{ items: ScoredFeedItem[]; nextCursor: number | null }> {
  console.log('[useInfiniteFeed] Fetching page:', pageParam, 'filters:', filters)
  const allItems: ScoredFeedItem[] = []
  const timeFilter = getTimeFilter(filters.timeRange)
  console.log('[useInfiniteFeed] Time filter:', timeFilter)

  // Determine which types to fetch
  const typesToFetch: ItemType[] = filters.types?.length
    ? filters.types
    : ['quick_thought', 'trade_idea', 'note', 'thesis_update']

  // Parallel fetch all content types
  const [
    thoughtsResult,
    tradeIdeasResult,
    assetNotesResult,
    portfolioNotesResult,
    themeNotesResult,
    notebookNotesResult,
    thesisUpdatesResult
  ] = await Promise.all([
    // 1. Quick thoughts
    typesToFetch.includes('quick_thought')
      ? supabase
          .from('quick_thoughts')
          .select(`
            *,
            assets (id, symbol, company_name)
          `)
          .eq('is_archived', false)
          .gte('created_at', timeFilter)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE * 3)
      : Promise.resolve({ data: [], error: null }),

    // 2. Trade ideas from trade_queue_items
    typesToFetch.includes('trade_idea')
      ? supabase
          .from('trade_queue_items')
          .select('*')
          .gte('created_at', timeFilter)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE * 3)
      : Promise.resolve({ data: [], error: null }),

    // 3. Asset notes
    typesToFetch.includes('note')
      ? supabase
          .from('asset_notes')
          .select(`
            *,
            assets (id, symbol, company_name)
          `)
          .neq('is_deleted', true)
          .gte('created_at', timeFilter)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE * 3)
      : Promise.resolve({ data: [], error: null }),

    // 4. Portfolio notes
    typesToFetch.includes('note')
      ? supabase
          .from('portfolio_notes')
          .select(`
            *,
            portfolios (id, name)
          `)
          .neq('is_deleted', true)
          .gte('created_at', timeFilter)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE * 3)
      : Promise.resolve({ data: [], error: null }),

    // 5. Theme notes
    typesToFetch.includes('note')
      ? supabase
          .from('theme_notes')
          .select(`
            *,
            themes (id, name)
          `)
          .neq('is_deleted', true)
          .gte('created_at', timeFilter)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE * 3)
      : Promise.resolve({ data: [], error: null }),

    // 6. Notebook notes
    typesToFetch.includes('note')
      ? supabase
          .from('custom_notebook_notes')
          .select(`
            *,
            custom_notebooks (id, name)
          `)
          .neq('is_deleted', true)
          .gte('created_at', timeFilter)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE * 3)
      : Promise.resolve({ data: [], error: null }),

    // 7. Thesis updates from asset_contributions
    typesToFetch.includes('thesis_update')
      ? supabase
          .from('asset_contributions')
          .select(`
            *,
            assets (id, symbol, company_name)
          `)
          .gte('created_at', timeFilter)
          .order('created_at', { ascending: false })
          .limit(PAGE_SIZE * 3)
      : Promise.resolve({ data: [], error: null })
  ])

  console.log('[useInfiniteFeed] Query results:', {
    thoughts: { count: thoughtsResult.data?.length, error: thoughtsResult.error?.message },
    tradeIdeas: { count: tradeIdeasResult.data?.length, error: tradeIdeasResult.error?.message },
    assetNotes: { count: assetNotesResult.data?.length, error: assetNotesResult.error?.message },
    portfolioNotes: { count: portfolioNotesResult.data?.length, error: portfolioNotesResult.error?.message },
    themeNotes: { count: themeNotesResult.data?.length, error: themeNotesResult.error?.message },
    notebookNotes: { count: notebookNotesResult.data?.length, error: notebookNotesResult.error?.message },
    thesis: { count: thesisUpdatesResult.data?.length, error: thesisUpdatesResult.error?.message }
  })

  // Extra debug for trade ideas
  if (tradeIdeasResult.error) {
    console.error('[useInfiniteFeed] Trade ideas FULL error:', JSON.stringify(tradeIdeasResult.error, null, 2))
  }
  if (tradeIdeasResult.data) {
    console.log('[useInfiniteFeed] Trade ideas data sample:', tradeIdeasResult.data.slice(0, 2))
  }

  // Fetch users separately for items that need them
  let usersMap = new Map<string, any>()
  const allUserIds = new Set<string>()

  // Collect user IDs from all sources
  const collectUserIds = (data: any[] | null) => {
    if (data) {
      data.forEach((item: any) => {
        if (item.created_by) allUserIds.add(item.created_by)
      })
    }
  }

  collectUserIds(thoughtsResult.data)
  collectUserIds(tradeIdeasResult.data)
  collectUserIds(assetNotesResult.data)
  collectUserIds(portfolioNotesResult.data)
  collectUserIds(themeNotesResult.data)
  collectUserIds(notebookNotesResult.data)
  collectUserIds(thesisUpdatesResult.data)

  // Fetch all users at once
  if (allUserIds.size > 0) {
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('id, email, first_name, last_name')
      .in('id', Array.from(allUserIds))

    console.log('[useInfiniteFeed] Users fetch:', { count: users?.length, error: usersError?.message, userIds: Array.from(allUserIds) })

    if (users) {
      users.forEach(u => usersMap.set(u.id, u))
    }
  }

  // Process quick thoughts
  if (thoughtsResult.data) {
    for (const thought of thoughtsResult.data) {
      const item: QuickThoughtItem = {
        id: thought.id,
        type: 'quick_thought',
        content: thought.content,
        created_at: thought.created_at,
        updated_at: thought.updated_at,
        author: mapUserToAuthor(usersMap.get(thought.created_by)),
        sentiment: thought.sentiment,
        source_url: thought.source_url,
        source_title: thought.source_title,
        ticker_mentions: thought.ticker_mentions,
        tags: thought.tags,
        visibility: thought.visibility,
        is_pinned: thought.is_pinned,
        asset: thought.assets
      }
      allItems.push({
        ...item,
        score: 0.5,
        scoreBreakdown: {
          recency: 0.5,
          engagement: 0.5,
          authorRelevance: 0.5,
          assetRelevance: 0.5,
          contentQuality: 0.5
        },
        cardSize: 'medium'
      })
    }
  }

  // Process trade ideas - fetch assets separately if needed
  if (tradeIdeasResult.data && tradeIdeasResult.data.length > 0) {
    console.log('[useInfiniteFeed] Processing', tradeIdeasResult.data.length, 'trade ideas')

    // Collect unique asset IDs to fetch (deduplicated, no nulls/undefined)
    const assetIdSet = new Set<string>()
    tradeIdeasResult.data.forEach((t: any) => {
      if (t.asset_id && typeof t.asset_id === 'string' && t.asset_id.trim()) {
        assetIdSet.add(t.asset_id)
      }
    })
    const uniqueAssetIds = Array.from(assetIdSet)

    // Fetch assets for trade ideas - fetch individually to avoid .in() issues
    let assetsMap = new Map<string, any>()
    console.log('[useInfiniteFeed] Trade idea unique asset IDs:', uniqueAssetIds)
    if (uniqueAssetIds.length > 0) {
      // Fetch each asset individually in parallel to avoid .in() 400 errors
      const assetPromises = uniqueAssetIds.map(id =>
        supabase
          .from('assets')
          .select('id, symbol, company_name')
          .eq('id', id)
          .single()
      )

      const assetResults = await Promise.all(assetPromises)

      let successCount = 0
      let errorCount = 0
      assetResults.forEach((result, idx) => {
        if (result.data) {
          assetsMap.set(result.data.id, result.data)
          successCount++
        } else if (result.error) {
          console.warn('[useInfiniteFeed] Failed to fetch asset:', uniqueAssetIds[idx], result.error.message)
          errorCount++
        }
      })

      console.log('[useInfiniteFeed] Trade idea assets fetched:', {
        success: successCount,
        errors: errorCount,
        total: uniqueAssetIds.length,
        assetsMap: Object.fromEntries(assetsMap)
      })
    }

    for (const trade of tradeIdeasResult.data) {
      const asset = assetsMap.get(trade.asset_id)
      const item: TradeIdeaItem = {
        id: trade.id,
        type: 'trade_idea',
        content: trade.rationale || '',
        created_at: trade.created_at,
        author: mapUserToAuthor(usersMap.get(trade.created_by)),
        action: trade.action,
        urgency: trade.urgency,
        rationale: trade.rationale,
        status: trade.status,
        pair_id: trade.pair_id,
        asset: asset || undefined,
        portfolio: undefined // Skip portfolio for now
      }
      allItems.push({
        ...item,
        score: 0.5,
        scoreBreakdown: {
          recency: 0.5,
          engagement: 0.5,
          authorRelevance: 0.5,
          assetRelevance: 0.5,
          contentQuality: 0.5
        },
        cardSize: 'medium'
      })
    }
    console.log('[useInfiniteFeed] Trade ideas added, allItems count:', allItems.length)
  } else {
    console.log('[useInfiniteFeed] No trade ideas to process, error:', tradeIdeasResult.error)
  }

  // Process asset notes
  if (assetNotesResult.data) {
    for (const note of assetNotesResult.data) {
      const item: NoteItem = {
        id: note.id,
        type: 'note',
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        author: mapUserToAuthor(usersMap.get(note.created_by)),
        title: note.title,
        note_type: 'asset',
        source: note.assets ? {
          id: note.assets.id,
          name: note.assets.symbol,
          type: 'asset'
        } : undefined,
        preview: note.content?.substring(0, 200) || ''
      }
      allItems.push({
        ...item,
        score: 0.5,
        scoreBreakdown: {
          recency: 0.5,
          engagement: 0.5,
          authorRelevance: 0.5,
          assetRelevance: 0.5,
          contentQuality: 0.5
        },
        cardSize: 'large'
      })
    }
  }

  // Process portfolio notes
  if (portfolioNotesResult.data) {
    for (const note of portfolioNotesResult.data) {
      const item: NoteItem = {
        id: note.id,
        type: 'note',
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        author: mapUserToAuthor(usersMap.get(note.created_by)),
        title: note.title || 'Portfolio Note',
        note_type: 'portfolio',
        source: note.portfolios ? {
          id: note.portfolios.id,
          name: note.portfolios.name,
          type: 'portfolio'
        } : undefined,
        preview: note.content?.substring(0, 200) || ''
      }
      allItems.push({
        ...item,
        score: 0.5,
        scoreBreakdown: {
          recency: 0.5,
          engagement: 0.5,
          authorRelevance: 0.5,
          assetRelevance: 0.5,
          contentQuality: 0.5
        },
        cardSize: 'large'
      })
    }
  }

  // Process theme notes
  if (themeNotesResult.data) {
    for (const note of themeNotesResult.data) {
      const item: NoteItem = {
        id: note.id,
        type: 'note',
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        author: mapUserToAuthor(usersMap.get(note.created_by)),
        title: note.title || 'Theme Note',
        note_type: 'theme',
        source: note.themes ? {
          id: note.themes.id,
          name: note.themes.name,
          type: 'theme'
        } : undefined,
        preview: note.content?.substring(0, 200) || ''
      }
      allItems.push({
        ...item,
        score: 0.5,
        scoreBreakdown: {
          recency: 0.5,
          engagement: 0.5,
          authorRelevance: 0.5,
          assetRelevance: 0.5,
          contentQuality: 0.5
        },
        cardSize: 'large'
      })
    }
  }

  // Process notebook notes
  if (notebookNotesResult.data) {
    for (const note of notebookNotesResult.data) {
      const item: NoteItem = {
        id: note.id,
        type: 'note',
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        author: mapUserToAuthor(usersMap.get(note.created_by)),
        title: note.title || 'Notebook Entry',
        note_type: 'custom',
        source: note.custom_notebooks ? {
          id: note.custom_notebooks.id,
          name: note.custom_notebooks.name,
          type: 'notebook'
        } : undefined,
        preview: note.content?.substring(0, 200) || ''
      }
      allItems.push({
        ...item,
        score: 0.5,
        scoreBreakdown: {
          recency: 0.5,
          engagement: 0.5,
          authorRelevance: 0.5,
          assetRelevance: 0.5,
          contentQuality: 0.5
        },
        cardSize: 'large'
      })
    }
  }

  // Process thesis updates
  if (thesisUpdatesResult.data) {
    for (const contribution of thesisUpdatesResult.data) {
      const item: ThesisUpdateItem = {
        id: contribution.id,
        type: 'thesis_update',
        content: contribution.content || '',
        created_at: contribution.created_at,
        updated_at: contribution.updated_at,
        author: mapUserToAuthor(usersMap.get(contribution.created_by)),
        section: contribution.section || 'General',
        field_name: contribution.section,
        new_value: contribution.content,
        change_type: 'created',
        asset: contribution.assets
      }
      allItems.push({
        ...item,
        score: 0.5,
        scoreBreakdown: {
          recency: 0.5,
          engagement: 0.5,
          authorRelevance: 0.5,
          assetRelevance: 0.5,
          contentQuality: 0.5
        },
        cardSize: 'medium'
      })
    }
  }

  // Log type breakdown before sorting
  const typeCounts = allItems.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  console.log('[useInfiniteFeed] Item type breakdown:', typeCounts)

  // Sort all items by created_at descending
  allItems.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  // Paginate
  const offset = pageParam * PAGE_SIZE
  const paginatedItems = allItems.slice(offset, offset + PAGE_SIZE)

  // Log paginated items types
  const paginatedTypeCounts = paginatedItems.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  console.log('[useInfiniteFeed] Final result:', {
    totalItems: allItems.length,
    offset,
    paginatedCount: paginatedItems.length,
    paginatedTypes: paginatedTypeCounts,
    nextCursor: paginatedItems.length === PAGE_SIZE ? pageParam + 1 : null
  })

  return {
    items: paginatedItems,
    nextCursor: paginatedItems.length === PAGE_SIZE ? pageParam + 1 : null
  }
}

export interface UseInfiniteFeedOptions {
  filters?: FeedFilters
  enabled?: boolean
}

export function useInfiniteFeed(options: UseInfiniteFeedOptions = {}) {
  const { filters = {}, enabled = true } = options

  const query = useInfiniteQuery({
    queryKey: ['infinite-feed', filters],
    queryFn: ({ pageParam }) => fetchFeedPage(pageParam, filters),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled,
    staleTime: 30000,
    gcTime: 5 * 60 * 1000
  })

  // Flatten all pages into a single array
  const items = query.data?.pages.flatMap(page => page.items) ?? []

  return {
    items,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    refetch: query.refetch,
    error: query.error
  }
}
