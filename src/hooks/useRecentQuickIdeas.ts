import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { QuickIdeaSignal } from '../components/thoughts/RecentQuickIdeas'

// ---------------------------------------------------------------------------
// RecentItem — normalised union type for the typed feed
// ---------------------------------------------------------------------------

interface RecentItemBase {
  id: string
  text: string
  createdAt: string
  signal: QuickIdeaSignal | null
  contextTag?: { type: 'asset' | 'portfolio' | 'theme' | 'other'; label: string }
}

export interface RecentThought extends RecentItemBase {
  kind: 'thought'
}

export interface RecentPrompt extends RecentItemBase {
  kind: 'prompt'
  title?: string
  status: 'open' | 'responded' | 'closed'
  assigneeName?: string
}

export type RecentItem = RecentThought | RecentPrompt

// ---------------------------------------------------------------------------
// Raw DB shape
// ---------------------------------------------------------------------------

interface RawQuickThought {
  id: string
  content: string
  created_at: string
  sentiment: QuickIdeaSignal | null
  idea_type: string | null
  tags: string[] | null
  asset_id: string | null
  portfolio_id: string | null
  theme_id: string | null
  assets?: { id: string; symbol: string; company_name: string } | null
  portfolios?: { id: string; name: string } | null
  themes?: { id: string; name: string } | null
}

// ---------------------------------------------------------------------------
// Tag helpers
// ---------------------------------------------------------------------------

function extractTag(tags: string[] | null, prefix: string): string | undefined {
  if (!tags) return undefined
  const match = tags.find(t => t.startsWith(prefix))
  return match ? match.slice(prefix.length) : undefined
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook to fetch recent Quick Ideas (quick_thoughts only, personal)
 * for display in the sidebar. Includes thoughts AND prompts as a typed feed.
 */
export function useRecentQuickIdeas(limit: number = 5) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['recent-quick-ideas', user?.id, limit],
    queryFn: async (): Promise<RecentItem[]> => {
      if (!user?.id) return []

      // Fetch recent quick thoughts (personal only, no trade ideas)
      const { data: thoughts, error: thoughtsError } = await supabase
        .from('quick_thoughts')
        .select(`
          id,
          content,
          created_at,
          sentiment,
          idea_type,
          tags,
          asset_id,
          portfolio_id,
          theme_id,
          assets:asset_id (id, symbol, company_name),
          portfolios:portfolio_id (id, name),
          themes:theme_id (id, name)
        `)
        .eq('created_by', user.id)
        .eq('is_archived', false)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (thoughtsError) {
        console.error('Error fetching quick thoughts:', thoughtsError)
        return []
      }

      // Collect assignee UUIDs from prompt rows for a single batch lookup
      const assigneeIds = new Set<string>()
      for (const t of (thoughts || []) as RawQuickThought[]) {
        if (t.idea_type === 'prompt') {
          const uid = extractTag(t.tags, 'assignee:')
          if (uid) assigneeIds.add(uid)
        }
      }

      // Batch-fetch assignee names (no new backend endpoint — reuses users table)
      let nameMap: Record<string, string> = {}
      if (assigneeIds.size > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, first_name, last_name, email')
          .in('id', Array.from(assigneeIds))
        if (users) {
          for (const u of users) {
            const name = u.first_name
              ? u.last_name ? `${u.first_name} ${u.last_name}` : u.first_name
              : u.email?.split('@')[0] || 'Unknown'
            nameMap[u.id] = name
          }
        }
      }

      // Transform into RecentItem union
      return (thoughts || []).map((t: RawQuickThought): RecentItem => {
        // Build context tag
        let contextTag: RecentItemBase['contextTag'] | undefined
        if (t.assets?.symbol) {
          contextTag = { type: 'asset', label: t.assets.symbol }
        } else if (t.portfolios?.name) {
          contextTag = { type: 'portfolio', label: t.portfolios.name }
        } else if (t.themes?.name) {
          contextTag = { type: 'theme', label: t.themes.name }
        }

        const base: RecentItemBase = {
          id: t.id,
          text: t.content,
          createdAt: t.created_at,
          signal: t.sentiment,
          contextTag,
        }

        if (t.idea_type === 'prompt') {
          const assigneeId = extractTag(t.tags, 'assignee:')
          const title = extractTag(t.tags, 'title:')
          return {
            ...base,
            kind: 'prompt',
            title,
            status: 'open', // No status column yet — safe default
            assigneeName: assigneeId ? nameMap[assigneeId] : undefined,
          }
        }

        return { ...base, kind: 'thought' }
      })
    },
    enabled: !!user?.id,
    staleTime: 30000, // 30 seconds
    refetchOnWindowFocus: true,
  })

  // Function to invalidate/refetch after creating a new idea
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['recent-quick-ideas'] })
  }

  // Check if there are more items beyond the limit
  const { data: totalCount } = useQuery({
    queryKey: ['recent-quick-ideas-count', user?.id],
    queryFn: async (): Promise<number> => {
      if (!user?.id) return 0

      const { count, error } = await supabase
        .from('quick_thoughts')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', user.id)
        .eq('is_archived', false)

      if (error) {
        console.error('Error counting quick thoughts:', error)
        return 0
      }

      return count || 0
    },
    enabled: !!user?.id,
    staleTime: 60000, // 1 minute
  })

  return {
    ...query,
    invalidate,
    totalCount: totalCount || 0,
    hasMore: (totalCount || 0) > limit,
  }
}
