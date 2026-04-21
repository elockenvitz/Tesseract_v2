import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'

export type ThemeReferenceType = 'note' | 'file' | 'external_link'
export type ThemeReferenceCategory = 'research' | 'filings' | 'presentations' | 'other'
export type ThemeReferenceImportance = 'critical' | 'high' | 'normal' | 'low'

export interface ThemeKeyReference {
  id: string
  theme_id: string
  user_id: string
  organization_id: string
  reference_type: ThemeReferenceType
  target_id: string | null
  target_table: string | null
  external_url: string | null
  external_provider: string | null
  title: string
  description: string | null
  category: ThemeReferenceCategory | null
  importance: ThemeReferenceImportance
  is_pinned: boolean
  display_order: number | null
  created_at: string
  updated_at: string
  target_note?: {
    id: string
    title: string
    content: string | null
  } | null
}

export function useThemeKeyReferences(themeId: string | undefined) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['theme-key-references', themeId],
    enabled: !!themeId,
    queryFn: async (): Promise<ThemeKeyReference[]> => {
      const { data, error } = await supabase
        .from('theme_key_references')
        .select('*')
        .eq('theme_id', themeId!)
        .order('is_pinned', { ascending: false })
        .order('display_order', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      const rows = (data || []) as ThemeKeyReference[]

      // Join target notes
      const noteIds = rows.filter(r => r.reference_type === 'note' && r.target_id).map(r => r.target_id!)
      if (noteIds.length === 0) return rows

      const { data: notes } = await supabase
        .from('theme_notes')
        .select('id, title, content')
        .in('id', noteIds)
      const byId = new Map((notes || []).map(n => [n.id, n]))
      return rows.map(r =>
        r.reference_type === 'note' && r.target_id
          ? { ...r, target_note: (byId.get(r.target_id) as any) ?? null }
          : r
      )
    }
  })

  useEffect(() => {
    if (!themeId) return
    const channel = supabase
      .channel(`theme-key-refs-${themeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'theme_key_references', filter: `theme_id=eq.${themeId}` },
        () => queryClient.invalidateQueries({ queryKey: ['theme-key-references', themeId] })
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [themeId, queryClient])

  const add = useMutation({
    mutationFn: async (input: {
      reference_type: ThemeReferenceType
      title: string
      external_url?: string
      target_id?: string
      target_table?: string
      category?: ThemeReferenceCategory
      importance?: ThemeReferenceImportance
    }) => {
      if (!themeId) throw new Error('Missing themeId')
      if (!user?.id) throw new Error('Not signed in')
      if (!currentOrgId) throw new Error('Missing organization')
      const { data, error } = await supabase
        .from('theme_key_references')
        .insert({
          theme_id: themeId,
          user_id: user.id,
          organization_id: currentOrgId,
          reference_type: input.reference_type,
          title: input.title,
          external_url: input.external_url ?? null,
          target_id: input.target_id ?? null,
          target_table: input.target_table ?? null,
          category: input.category ?? null,
          importance: input.importance ?? 'normal',
        })
        .select('*')
        .single()
      if (error) throw error
      return data as ThemeKeyReference
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['theme-key-references', themeId] }),
  })

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<ThemeKeyReference> }) => {
      const { error } = await supabase.from('theme_key_references').update(patch as any).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['theme-key-references', themeId] }),
  })

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('theme_key_references').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['theme-key-references', themeId] }),
  })

  return {
    references: query.data || [],
    isLoading: query.isLoading,
    add: add.mutateAsync,
    isAdding: add.isPending,
    update: update.mutateAsync,
    remove: remove.mutateAsync,
  }
}
