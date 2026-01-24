import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import type {
  FeedItem,
  QuickThoughtItem,
  TradeIdeaItem,
  NoteItem,
  ThesisUpdateItem,
  ContentAggregationOptions,
  Author
} from './types'

const mapUserToAuthor = (user: any): Author => ({
  id: user?.id || '',
  email: user?.email,
  first_name: user?.first_name,
  last_name: user?.last_name,
  full_name: user?.full_name || (user?.first_name && user?.last_name
    ? `${user.first_name} ${user.last_name}`
    : user?.email?.split('@')[0] || 'Unknown'),
  avatar_url: user?.avatar_url
})

export function useContentAggregation(options: ContentAggregationOptions = {}) {
  const { user } = useAuth()
  const { limit = 50, offset = 0, filters = {} } = options

  return useQuery({
    queryKey: ['content-aggregation', limit, offset, filters, user?.id],
    queryFn: async (): Promise<FeedItem[]> => {
      const allItems: FeedItem[] = []
      const timeFilter = getTimeFilter(filters.timeRange)

      // Parallel fetch all content types
      const [
        thoughtsResult,
        tradeIdeasResult,
        notesResult,
        thesisUpdatesResult
      ] = await Promise.all([
        // 1. Quick thoughts (no FK to public.users, fetch separately)
        (!filters.types || filters.types.includes('quick_thought'))
          ? supabase
              .from('quick_thoughts')
              .select(`
                *,
                assets (id, symbol, company_name)
              `)
              .eq('is_archived', false)
              .gte('created_at', timeFilter)
              .order('created_at', { ascending: false })
              .limit(limit)
          : Promise.resolve({ data: [], error: null }),

        // 2. Trade ideas from trade_queue_items (fetch assets and users separately)
        (!filters.types || filters.types.includes('trade_idea'))
          ? supabase
              .from('trade_queue_items')
              .select(`
                *,
                portfolios (id, name)
              `)
              .eq('status', 'idea')
              .gte('created_at', timeFilter)
              .order('created_at', { ascending: false })
              .limit(limit)
          : Promise.resolve({ data: [], error: null }),

        // 3. Notes (from all note tables)
        (!filters.types || filters.types.includes('note'))
          ? fetchAllNotes(timeFilter, limit)
          : Promise.resolve([]),

        // 4. Thesis updates from asset_contributions (fetch users separately)
        (!filters.types || filters.types.includes('thesis_update'))
          ? supabase
              .from('asset_contributions')
              .select(`
                *,
                assets (id, symbol, company_name)
              `)
              .gte('created_at', timeFilter)
              .order('created_at', { ascending: false })
              .limit(limit)
          : Promise.resolve({ data: [], error: null })
      ])

      // Fetch users for quick_thoughts separately (FK points to auth.users)
      let usersMap = new Map<string, any>()
      if (thoughtsResult.data && thoughtsResult.data.length > 0) {
        const userIds = [...new Set(thoughtsResult.data.map(t => t.created_by).filter(Boolean))]
        if (userIds.length > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, email, first_name, last_name')
            .in('id', userIds)

          if (users) {
            users.forEach(u => usersMap.set(u.id, u))
          }
        }
      }

      // Fetch assets and users for trade ideas separately (similar FK issue)
      let tradeIdeasAssetsMap = new Map<string, any>()
      let tradeIdeasUsersMap = new Map<string, any>()
      if (tradeIdeasResult.data && tradeIdeasResult.data.length > 0) {
        // Get unique asset IDs and user IDs
        const assetIds = [...new Set(tradeIdeasResult.data.map(t => t.asset_id).filter(Boolean))]
        const tradeUserIds = [...new Set(tradeIdeasResult.data.map(t => t.created_by).filter(Boolean))]

        // Fetch assets individually to avoid .in() issues
        if (assetIds.length > 0) {
          const assetPromises = assetIds.map(id =>
            supabase
              .from('assets')
              .select('id, symbol, company_name')
              .eq('id', id)
              .single()
          )
          const assetResults = await Promise.all(assetPromises)
          assetResults.forEach(result => {
            if (result.data) {
              tradeIdeasAssetsMap.set(result.data.id, result.data)
            }
          })
        }

        // Fetch users
        if (tradeUserIds.length > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, email, first_name, last_name')
            .in('id', tradeUserIds)

          if (users) {
            users.forEach(u => tradeIdeasUsersMap.set(u.id, u))
          }
        }
      }

      // Fetch users for thesis updates separately
      let thesisUsersMap = new Map<string, any>()
      if (thesisUpdatesResult.data && thesisUpdatesResult.data.length > 0) {
        const thesisUserIds = [...new Set(thesisUpdatesResult.data.map(t => t.created_by).filter(Boolean))]
        if (thesisUserIds.length > 0) {
          const { data: users } = await supabase
            .from('users')
            .select('id, email, first_name, last_name')
            .in('id', thesisUserIds)

          if (users) {
            users.forEach(u => thesisUsersMap.set(u.id, u))
          }
        }
      }

      // Process quick thoughts
      if (thoughtsResult.data) {
        for (const thought of thoughtsResult.data) {
          allItems.push({
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
          } as QuickThoughtItem)
        }
      }

      // Process trade ideas
      if (tradeIdeasResult.data) {
        for (const trade of tradeIdeasResult.data) {
          allItems.push({
            id: trade.id,
            type: 'trade_idea',
            content: trade.rationale || '',
            created_at: trade.created_at,
            author: mapUserToAuthor(tradeIdeasUsersMap.get(trade.created_by)),
            action: trade.action,
            urgency: trade.urgency,
            rationale: trade.rationale,
            status: trade.status,
            pair_id: trade.pair_id,
            asset: tradeIdeasAssetsMap.get(trade.asset_id),
            portfolio: trade.portfolios
          } as TradeIdeaItem)
        }
      }

      // Process notes
      if (Array.isArray(notesResult)) {
        allItems.push(...notesResult)
      }

      // Process thesis updates
      if (thesisUpdatesResult.data) {
        for (const contribution of thesisUpdatesResult.data) {
          allItems.push({
            id: contribution.id,
            type: 'thesis_update',
            content: contribution.content || '',
            created_at: contribution.created_at,
            updated_at: contribution.updated_at,
            author: mapUserToAuthor(thesisUsersMap.get(contribution.created_by)),
            section: contribution.section || 'General',
            field_name: contribution.section, // For backwards compatibility
            new_value: contribution.content,
            change_type: 'created',
            asset: contribution.assets
          } as ThesisUpdateItem)
        }
      }

      // Apply additional filters
      let filteredItems = allItems

      if (filters.authors?.length) {
        filteredItems = filteredItems.filter(item =>
          filters.authors!.includes(item.author.id)
        )
      }

      if (filters.assets?.length) {
        filteredItems = filteredItems.filter(item => {
          if ('asset' in item && item.asset) {
            return filters.assets!.includes(item.asset.id)
          }
          return false
        })
      }

      if (filters.tags?.length) {
        filteredItems = filteredItems.filter(item => {
          if ('tags' in item && item.tags) {
            return item.tags.some(tag => filters.tags!.includes(tag))
          }
          return false
        })
      }

      // Sort by created_at descending
      filteredItems.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )

      // Apply pagination
      return filteredItems.slice(offset, offset + limit)
    },
    staleTime: 30000,
    refetchOnWindowFocus: false
  })
}

async function fetchAllNotes(timeFilter: string, limit: number): Promise<NoteItem[]> {
  const notes: NoteItem[] = []
  const perTableLimit = Math.floor(limit / 4) || 1

  // Fetch notes without user joins (FK points to auth.users, not public.users)
  const [assetNotes, portfolioNotes, themeNotes, customNotes] = await Promise.all([
    supabase
      .from('asset_notes')
      .select(`
        *,
        assets (id, symbol, company_name)
      `)
      .neq('is_deleted', true)
      .gte('created_at', timeFilter)
      .order('created_at', { ascending: false })
      .limit(perTableLimit),

    supabase
      .from('portfolio_notes')
      .select(`
        *,
        portfolios (id, name)
      `)
      .neq('is_deleted', true)
      .gte('created_at', timeFilter)
      .order('created_at', { ascending: false })
      .limit(perTableLimit),

    supabase
      .from('theme_notes')
      .select(`
        *,
        themes (id, name)
      `)
      .neq('is_deleted', true)
      .gte('created_at', timeFilter)
      .order('created_at', { ascending: false })
      .limit(perTableLimit),

    supabase
      .from('custom_notebook_notes')
      .select(`
        *,
        custom_notebooks (id, name)
      `)
      .neq('is_deleted', true)
      .gte('created_at', timeFilter)
      .order('created_at', { ascending: false })
      .limit(perTableLimit)
  ])

  // Collect all user IDs and fetch users separately
  const allNoteData = [
    ...(assetNotes.data || []),
    ...(portfolioNotes.data || []),
    ...(themeNotes.data || []),
    ...(customNotes.data || [])
  ]
  const userIds = [...new Set(allNoteData.map(n => n.created_by).filter(Boolean))]

  let notesUsersMap = new Map<string, any>()
  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('id, email, first_name, last_name')
      .in('id', userIds)

    if (users) {
      users.forEach(u => notesUsersMap.set(u.id, u))
    }
  }

  // Map asset notes
  if (assetNotes.data) {
    for (const note of assetNotes.data) {
      notes.push({
        id: note.id,
        type: 'note',
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        author: mapUserToAuthor(notesUsersMap.get(note.created_by)),
        title: note.title,
        note_type: 'asset',
        source: note.assets ? {
          id: note.assets.id,
          name: note.assets.symbol,
          type: 'asset'
        } : undefined,
        preview: note.content?.substring(0, 200) || ''
      })
    }
  }

  // Map portfolio notes
  if (portfolioNotes.data) {
    for (const note of portfolioNotes.data) {
      notes.push({
        id: note.id,
        type: 'note',
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        author: mapUserToAuthor(notesUsersMap.get(note.created_by)),
        title: note.title,
        note_type: 'portfolio',
        source: note.portfolios ? {
          id: note.portfolios.id,
          name: note.portfolios.name,
          type: 'portfolio'
        } : undefined,
        preview: note.content?.substring(0, 200) || ''
      })
    }
  }

  // Map theme notes
  if (themeNotes.data) {
    for (const note of themeNotes.data) {
      notes.push({
        id: note.id,
        type: 'note',
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        author: mapUserToAuthor(notesUsersMap.get(note.created_by)),
        title: note.title,
        note_type: 'theme',
        source: note.themes ? {
          id: note.themes.id,
          name: note.themes.name,
          type: 'theme'
        } : undefined,
        preview: note.content?.substring(0, 200) || ''
      })
    }
  }

  // Map custom notes
  if (customNotes.data) {
    for (const note of customNotes.data) {
      notes.push({
        id: note.id,
        type: 'note',
        content: note.content,
        created_at: note.created_at,
        updated_at: note.updated_at,
        author: mapUserToAuthor(notesUsersMap.get(note.created_by)),
        title: note.title,
        note_type: 'custom',
        source: note.custom_notebooks ? {
          id: note.custom_notebooks.id,
          name: note.custom_notebooks.name,
          type: 'notebook'
        } : undefined,
        preview: note.content?.substring(0, 200) || ''
      })
    }
  }

  return notes
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
      // Default to last 365 days for 'all'
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString()
  }
}
