import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { QuickIdea, QuickIdeaSignal } from '../components/thoughts/RecentQuickIdeas'

interface RawQuickThought {
  id: string
  content: string
  created_at: string
  sentiment: QuickIdeaSignal | null
  asset_id: string | null
  portfolio_id: string | null
  theme_id: string | null
  assets?: { id: string; symbol: string; company_name: string } | null
  portfolios?: { id: string; name: string } | null
  themes?: { id: string; name: string } | null
}

/**
 * Hook to fetch recent Quick Ideas (quick_thoughts only, personal)
 * for display in the sidebar. Does NOT include Trade Ideas.
 */
export function useRecentQuickIdeas(limit: number = 5) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['recent-quick-ideas', user?.id, limit],
    queryFn: async (): Promise<QuickIdea[]> => {
      if (!user?.id) return []

      // Fetch recent quick thoughts (personal only, no trade ideas)
      const { data: thoughts, error: thoughtsError } = await supabase
        .from('quick_thoughts')
        .select(`
          id,
          content,
          created_at,
          sentiment,
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

      // Transform quick thoughts
      return (thoughts || []).map((t: RawQuickThought) => {
        // Determine context tag
        let contextTag: QuickIdea['contextTag'] | undefined

        if (t.assets?.symbol) {
          contextTag = {
            type: 'asset',
            label: t.assets.symbol,
          }
        } else if (t.portfolios?.name) {
          contextTag = {
            type: 'portfolio',
            label: t.portfolios.name,
          }
        } else if (t.themes?.name) {
          contextTag = {
            type: 'theme',
            label: t.themes.name,
          }
        }

        return {
          id: t.id,
          text: t.content,
          createdAt: t.created_at,
          signal: t.sentiment,
          contextTag,
        }
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
