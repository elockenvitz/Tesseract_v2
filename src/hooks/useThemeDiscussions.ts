import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'

export type ThemeDiscussionVisibility = 'org' | 'shared'

export interface ThemeDiscussionPost {
  id: string
  theme_id: string
  author_id: string
  organization_id: string
  visibility: ThemeDiscussionVisibility
  content: string
  is_edited: boolean
  is_deleted: boolean
  created_at: string
  updated_at: string
  author?: {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
  } | null
}

export function useThemeDiscussions(themeId: string | undefined) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['theme-discussions', themeId],
    enabled: !!themeId,
    queryFn: async (): Promise<ThemeDiscussionPost[]> => {
      const { data, error } = await supabase
        .from('theme_discussions')
        .select('*')
        .eq('theme_id', themeId!)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = (data || []) as ThemeDiscussionPost[]

      const userIds = [...new Set(rows.map(r => r.author_id))]
      if (userIds.length === 0) return rows

      const { data: users, error: uErr } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
      if (uErr) throw uErr
      const byId = new Map((users || []).map(u => [u.id, u]))
      return rows.map(r => ({ ...r, author: byId.get(r.author_id) ?? null }))
    }
  })

  // Realtime: invalidate on any change to this theme's discussion rows
  useEffect(() => {
    if (!themeId) return
    const channel = supabase
      .channel(`theme-discussions-${themeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'theme_discussions', filter: `theme_id=eq.${themeId}` },
        () => queryClient.invalidateQueries({ queryKey: ['theme-discussions', themeId] })
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [themeId, queryClient])

  const createMutation = useMutation({
    mutationFn: async ({ content, visibility }: { content: string; visibility: ThemeDiscussionVisibility }) => {
      if (!themeId) throw new Error('Missing themeId')
      if (!user?.id) throw new Error('Not signed in')
      if (!currentOrgId) throw new Error('Missing organization')
      const trimmed = content.trim()
      if (!trimmed) throw new Error('Empty post')

      const { data, error } = await supabase
        .from('theme_discussions')
        .insert({
          theme_id: themeId,
          author_id: user.id,
          organization_id: currentOrgId,
          visibility,
          content: trimmed,
        })
        .select('*')
        .single()
      if (error) throw error
      return data as ThemeDiscussionPost
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-discussions', themeId] })
    }
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, content, visibility }: { id: string; content?: string; visibility?: ThemeDiscussionVisibility }) => {
      const patch: Record<string, any> = {}
      if (content !== undefined) patch.content = content.trim()
      if (visibility !== undefined) patch.visibility = visibility
      if (Object.keys(patch).length === 0) return null
      const { error } = await supabase
        .from('theme_discussions')
        .update(patch)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-discussions', themeId] })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      // Soft delete so realtime subscribers still see the UPDATE event
      const { error } = await supabase
        .from('theme_discussions')
        .update({ is_deleted: true, content: '' })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-discussions', themeId] })
    }
  })

  return {
    posts: query.data || [],
    isLoading: query.isLoading,
    isError: query.isError,
    currentOrgId,
    create: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    update: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
    remove: deleteMutation.mutateAsync,
    isRemoving: deleteMutation.isPending,
  }
}
