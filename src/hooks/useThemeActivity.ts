import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export type ThemeActivityType =
  | 'theme.created'
  | 'theme.renamed'
  | 'theme.description_updated'
  | 'theme.color_changed'
  | 'theme.lifecycle_changed'
  | 'theme.archived'
  | 'theme.unarchived'
  | 'theme.asset_added'
  | 'theme.asset_removed'
  | 'theme.contribution_added'
  | 'theme.discussion_posted'

export interface ThemeActivityEvent {
  id: string
  theme_id: string
  actor_id: string | null
  activity_type: ThemeActivityType
  metadata: Record<string, any>
  created_at: string
  actor?: {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
  } | null
}

export function useThemeActivity(themeId: string | undefined, limit = 50) {
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['theme-activity', themeId, limit],
    enabled: !!themeId,
    queryFn: async (): Promise<ThemeActivityEvent[]> => {
      const { data, error } = await supabase
        .from('theme_activity')
        .select('*')
        .eq('theme_id', themeId!)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      const rows = (data || []) as ThemeActivityEvent[]

      const userIds = [...new Set(rows.map(r => r.actor_id).filter(Boolean) as string[])]
      if (userIds.length === 0) return rows

      const { data: users, error: uErr } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
      if (uErr) throw uErr
      const byId = new Map((users || []).map(u => [u.id, u]))
      return rows.map(r => ({ ...r, actor: r.actor_id ? byId.get(r.actor_id) ?? null : null }))
    }
  })

  useEffect(() => {
    if (!themeId) return
    const channel = supabase
      .channel(`theme-activity-${themeId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'theme_activity', filter: `theme_id=eq.${themeId}` },
        () => queryClient.invalidateQueries({ queryKey: ['theme-activity', themeId, limit] })
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [themeId, limit, queryClient])

  return {
    events: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
