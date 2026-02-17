import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'

// ── Types ──────────────────────────────────────────────────────────────

export interface ListSurfaceMetrics {
  assetCount: number
  portfolioName: string | null
}

export interface LastListActivity {
  activity_type: string
  actor_name: string
  created_at: string
  metadata: Record<string, unknown>
}

export interface ListSurface {
  id: string
  name: string
  description: string | null
  color: string | null
  is_default: boolean | null
  list_type: 'mutual' | 'collaborative'
  portfolio_id: string | null
  created_at: string | null
  updated_at: string | null
  created_by: string | null
  updated_by: string | null
  updated_by_user: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
  created_by_user: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
  item_count: number
  assetIds: string[]
  collaborators: Array<{
    id: string
    user_id: string
    permission: string
  }>
  portfolio: { id: string; name: string } | null
}

export type ListSortKey = 'recent' | 'alpha' | 'assets' | 'portfolio' | 'owner' | 'access'

// ── Sort helpers ───────────────────────────────────────────────────────

function sortLists(
  lists: ListSurface[],
  sortBy: ListSortKey,
  metrics: Map<string, ListSurfaceMetrics>
): ListSurface[] {
  const sorted = [...lists]
  sorted.sort((a, b) => {
    const ma = metrics.get(a.id)
    const mb = metrics.get(b.id)
    switch (sortBy) {
      case 'recent':
        return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      case 'alpha':
        return a.name.localeCompare(b.name)
      case 'assets':
        return (mb?.assetCount ?? 0) - (ma?.assetCount ?? 0)
      case 'portfolio': {
        const pa = ma?.portfolioName || ''
        const pb = mb?.portfolioName || ''
        const cmp = pa.localeCompare(pb)
        if (cmp !== 0) return cmp
        return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      }
      case 'owner':
      case 'access':
        // Table-only sort keys; fall through to recency for grid view
        return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
      default:
        return 0
    }
  })
  return sorted
}

// ── Hook ───────────────────────────────────────────────────────────────

export function useListSurfaces(sortBy: ListSortKey = 'recent') {
  const { user } = useAuth()
  const userId = user?.id

  // Query 1 — All visible lists (RLS returns owned + shared)
  const {
    data: rawLists,
    isLoading: listsLoading,
    error: listsError
  } = useQuery({
    queryKey: ['list-surfaces'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_lists')
        .select(`
          *,
          asset_list_items(asset_id),
          asset_list_collaborations(id, user_id, permission),
          portfolio:portfolios!asset_lists_portfolio_id_fkey(id, name),
          updated_by_user:users!asset_lists_updated_by_fkey(id, first_name, last_name, email),
          created_by_user:users!asset_lists_created_by_fkey(id, first_name, last_name, email)
        `)
        .order('is_default', { ascending: false })
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []).map((list: any) => ({
        id: list.id,
        name: list.name,
        description: list.description,
        color: list.color,
        is_default: list.is_default,
        list_type: list.list_type,
        portfolio_id: list.portfolio_id,
        created_at: list.created_at,
        updated_at: list.updated_at,
        created_by: list.created_by,
        updated_by: list.updated_by,
        updated_by_user: list.updated_by_user ?? null,
        created_by_user: list.created_by_user ?? null,
        item_count: list.asset_list_items?.length || 0,
        assetIds: (list.asset_list_items || []).map((i: any) => i.asset_id),
        collaborators: list.asset_list_collaborations || [],
        portfolio: list.portfolio
      })) as ListSurface[]
    },
    enabled: !!userId
  })

  // Query 2 — Favorites
  const { data: favoriteLists } = useQuery({
    queryKey: ['user-favorite-lists', userId],
    queryFn: async () => {
      if (!userId) return []
      const { data, error } = await supabase
        .from('asset_list_favorites')
        .select('list_id')
        .eq('user_id', userId)
      if (error) throw error
      return (data || []).map(f => f.list_id)
    },
    enabled: !!userId
  })

  // Query 4 — Portfolios for filter dropdown
  const { data: portfolios } = useQuery({
    queryKey: ['list-surface-portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name, team_id, teams:teams!portfolios_team_id_fkey(id, name)')
        .order('name')
      if (error) throw error
      return data || []
    },
    enabled: !!userId
  })

  // Query 5 — User states (last opened timestamps)
  const { data: userStates } = useQuery({
    queryKey: ['list-user-states', userId],
    queryFn: async () => {
      if (!userId) return []
      const { data, error } = await supabase
        .from('asset_list_user_state')
        .select('list_id, last_opened_at')
        .eq('user_id', userId)
      if (error) throw error
      return data || []
    },
    enabled: !!userId
  })

  // Query 6 — Activity counts (updates since last open)
  const { data: activityCounts } = useQuery({
    queryKey: ['list-activity-counts', userId],
    queryFn: async () => {
      if (!userId) return []
      const { data, error } = await supabase.rpc('get_list_activity_counts', { p_user_id: userId })
      if (error) throw error
      return data || []
    },
    enabled: !!userId
  })

  const lastOpenedMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of userStates || []) map.set(s.list_id, s.last_opened_at)
    return map
  }, [userStates])

  const updateCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of activityCounts || []) map.set(c.list_id, Number(c.update_count))
    return map
  }, [activityCounts])

  const selfUpdateCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of activityCounts || []) map.set(c.list_id, Number(c.self_count))
    return map
  }, [activityCounts])

  // Collect all list IDs for batch activity lookup
  const allListIds = useMemo(() => {
    if (!rawLists) return []
    return rawLists.map(l => l.id)
  }, [rawLists])

  // Query 7 — Latest activity per list (for Updated tooltip)
  const { data: latestActivities } = useQuery({
    queryKey: ['list-latest-activities', allListIds.length],
    queryFn: async () => {
      if (allListIds.length === 0) return []
      const { data, error } = await supabase.rpc('get_latest_list_activities', { p_list_ids: allListIds })
      if (error) throw error
      return data || []
    },
    enabled: allListIds.length > 0
  })

  const lastActivityMap = useMemo(() => {
    const map = new Map<string, LastListActivity>()
    for (const a of latestActivities || []) {
      map.set(a.list_id, {
        activity_type: a.activity_type,
        actor_name: a.actor_name,
        created_at: a.created_at,
        metadata: a.metadata || {}
      })
    }
    return map
  }, [latestActivities])

  // ── Compute metrics per list ──────────────────────────────────────────
  const metrics = useMemo(() => {
    const map = new Map<string, ListSurfaceMetrics>()
    if (!rawLists) return map

    for (const list of rawLists) {
      map.set(list.id, {
        assetCount: list.item_count,
        portfolioName: list.portfolio?.name || null
      })
    }
    return map
  }, [rawLists])

  // ── Favorites set ─────────────────────────────────────────────────────
  const favoriteSet = useMemo(
    () => new Set(favoriteLists || []),
    [favoriteLists]
  )

  // ── Section lists ─────────────────────────────────────────────────────
  // Deterministic categorization — each list lands in exactly one bucket:
  //   Collaborative: list_type === 'collaborative' (always, regardless of owner)
  //   My Lists:      owned by current user AND not collaborative
  //   Shared:        not owned by current user AND not collaborative
  const { myLists, collaborative, sharedWithMe } = useMemo(() => {
    if (!rawLists || !userId) {
      return { myLists: [], collaborative: [], sharedWithMe: [] }
    }

    const mine: ListSurface[] = []
    const collab: ListSurface[] = []
    const shared: ListSurface[] = []

    for (const list of rawLists) {
      if (list.list_type === 'collaborative') {
        collab.push(list)
      } else if (list.created_by === userId) {
        mine.push(list)
      } else {
        shared.push(list)
      }
    }

    // Dev-only sanity check: ensure no list appears in multiple buckets
    if (process.env.NODE_ENV === 'development') {
      const total = mine.length + collab.length + shared.length
      if (total !== rawLists.length) {
        console.warn(
          `[useListSurfaces] Bucket mismatch: ${mine.length} mine + ${collab.length} collab + ${shared.length} shared = ${total}, but rawLists has ${rawLists.length}`
        )
      }
    }

    return {
      myLists: sortLists(mine, sortBy, metrics),
      collaborative: sortLists(collab, sortBy, metrics),
      sharedWithMe: sortLists(shared, sortBy, metrics)
    }
  }, [rawLists, userId, sortBy, metrics])

  return {
    myLists,
    collaborative,
    sharedWithMe,
    allLists: rawLists || [],
    isLoading: listsLoading,
    error: listsError,
    metrics,
    favoriteSet,
    portfolios: portfolios || [],
    lastOpenedMap,
    updateCountMap,
    selfUpdateCountMap,
    lastActivityMap,
    sortLists: (lists: ListSurface[]) => sortLists(lists, sortBy, metrics)
  }
}
