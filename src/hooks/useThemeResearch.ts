import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'

// =========================================================================
// Types
// =========================================================================

export type ThemeContributionVisibility = 'org' | 'shared'

export type ThemeFieldType =
  | 'rich_text'
  | 'checklist'
  | 'timeline'
  | 'metric'
  | 'numeric'
  | 'date'
  | 'rating'

export interface ThemeResearchSection {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  display_order: number
  is_system: boolean
}

export interface ThemeResearchField {
  id: string
  organization_id: string
  section_id: string
  name: string
  slug: string
  description: string | null
  placeholder: string | null
  field_type: ThemeFieldType
  config: Record<string, any>
  is_universal: boolean
  is_system: boolean
  is_archived: boolean
  display_order: number
}

export interface ThemeContribution {
  id: string
  theme_id: string
  section: string // field slug
  content: string
  supporting_detail: string | null
  attachments: any[]
  created_by: string
  organization_id: string
  visibility: ThemeContributionVisibility
  is_pinned: boolean
  is_archived: boolean
  pinned_by: string | null
  pinned_at: string | null
  sort_order: number
  draft_content: string | null
  draft_updated_at: string | null
  created_at: string
  updated_at: string
  author?: {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
  } | null
}

export interface ThemeContributionHistoryItem {
  id: string
  contribution_id: string
  old_content: string | null
  new_content: string
  old_supporting_detail: string | null
  new_supporting_detail: string | null
  changed_by: string
  changed_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    email: string | null
  } | null
}

// =========================================================================
// Sections + Fields (org-scoped, shared across all themes in the org)
// =========================================================================

export function useThemeResearchLayout() {
  const { currentOrgId } = useOrganization()

  const sections = useQuery({
    queryKey: ['theme-research-sections', currentOrgId],
    enabled: !!currentOrgId,
    queryFn: async (): Promise<ThemeResearchSection[]> => {
      const { data, error } = await supabase
        .from('theme_research_sections')
        .select('*')
        .eq('organization_id', currentOrgId!)
        .order('display_order', { ascending: true })
      if (error) throw error
      return (data || []) as ThemeResearchSection[]
    }
  })

  const fields = useQuery({
    queryKey: ['theme-research-fields', currentOrgId],
    enabled: !!currentOrgId,
    queryFn: async (): Promise<ThemeResearchField[]> => {
      const { data, error } = await supabase
        .from('theme_research_fields')
        .select('*')
        .eq('organization_id', currentOrgId!)
        .eq('is_archived', false)
        .order('display_order', { ascending: true })
      if (error) throw error
      return (data || []) as ThemeResearchField[]
    }
  })

  const layout = useMemo(() => {
    const secs = sections.data || []
    const fs = fields.data || []
    return secs.map(s => ({
      ...s,
      fields: fs
        .filter(f => f.section_id === s.id)
        .sort((a, b) => a.display_order - b.display_order)
    }))
  }, [sections.data, fields.data])

  return {
    sections: sections.data || [],
    fields: fields.data || [],
    layout,
    isLoading: sections.isLoading || fields.isLoading,
    isError: sections.isError || fields.isError,
  }
}

// =========================================================================
// Field mutations (add/rename/reorder/archive)
// =========================================================================

export function useThemeResearchFieldMutations() {
  const { currentOrgId } = useOrganization()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['theme-research-fields', currentOrgId] })
    queryClient.invalidateQueries({ queryKey: ['theme-research-sections', currentOrgId] })
  }

  const createField = useMutation({
    mutationFn: async (input: {
      sectionId: string
      name: string
      slug: string
      placeholder?: string
      field_type?: ThemeFieldType
      display_order?: number
    }) => {
      if (!currentOrgId) throw new Error('Missing organization')
      const { data, error } = await supabase
        .from('theme_research_fields')
        .insert({
          organization_id: currentOrgId,
          section_id: input.sectionId,
          name: input.name,
          slug: input.slug,
          placeholder: input.placeholder ?? null,
          field_type: input.field_type || 'rich_text',
          display_order: input.display_order ?? 999,
          is_system: false,
          is_universal: true,
          created_by: user?.id ?? null,
        })
        .select('*')
        .single()
      if (error) throw error
      return data as ThemeResearchField
    },
    onSuccess: invalidate,
  })

  const updateField = useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      placeholder?: string
      field_type?: ThemeFieldType
      display_order?: number
      is_archived?: boolean
      section_id?: string
    }) => {
      const patch: Record<string, any> = {}
      if (input.name !== undefined) patch.name = input.name
      if (input.placeholder !== undefined) patch.placeholder = input.placeholder
      if (input.field_type !== undefined) patch.field_type = input.field_type
      if (input.display_order !== undefined) patch.display_order = input.display_order
      if (input.is_archived !== undefined) patch.is_archived = input.is_archived
      if (input.section_id !== undefined) patch.section_id = input.section_id
      if (Object.keys(patch).length === 0) return null
      const { error } = await supabase
        .from('theme_research_fields')
        .update(patch)
        .eq('id', input.id)
      if (error) throw error
    },
    onSuccess: invalidate,
  })

  const reorderFields = useMutation({
    mutationFn: async (order: { id: string; display_order: number }[]) => {
      // Use sequential updates — small N, keeps RLS policy simple
      for (const row of order) {
        const { error } = await supabase
          .from('theme_research_fields')
          .update({ display_order: row.display_order })
          .eq('id', row.id)
        if (error) throw error
      }
    },
    onSuccess: invalidate,
  })

  const createSection = useMutation({
    mutationFn: async (input: { name: string; slug: string; display_order?: number }) => {
      if (!currentOrgId) throw new Error('Missing organization')
      const { data, error } = await supabase
        .from('theme_research_sections')
        .insert({
          organization_id: currentOrgId,
          name: input.name,
          slug: input.slug,
          display_order: input.display_order ?? 999,
          is_system: false,
        })
        .select('*')
        .single()
      if (error) throw error
      return data as ThemeResearchSection
    },
    onSuccess: invalidate,
  })

  return {
    createField: createField.mutateAsync,
    updateField: updateField.mutateAsync,
    reorderFields: reorderFields.mutateAsync,
    createSection: createSection.mutateAsync,
  }
}

// =========================================================================
// Contributions per theme
// =========================================================================

export function useThemeContributionsV2(themeId: string | undefined) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['theme-contributions-v2', themeId],
    enabled: !!themeId,
    queryFn: async (): Promise<ThemeContribution[]> => {
      const { data, error } = await supabase
        .from('theme_contributions_v2')
        .select('*')
        .eq('theme_id', themeId!)
        .eq('is_archived', false)
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = (data || []) as ThemeContribution[]

      const userIds = [...new Set(rows.map(r => r.created_by))]
      if (userIds.length === 0) return rows

      const { data: users, error: uErr } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
      if (uErr) throw uErr
      const byId = new Map((users || []).map(u => [u.id, u]))
      return rows.map(r => ({ ...r, author: byId.get(r.created_by) ?? null }))
    }
  })

  useEffect(() => {
    if (!themeId) return
    const channel = supabase
      .channel(`theme-contributions-v2-${themeId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'theme_contributions_v2', filter: `theme_id=eq.${themeId}` },
        () => queryClient.invalidateQueries({ queryKey: ['theme-contributions-v2', themeId] })
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [themeId, queryClient])

  const upsertContribution = useMutation({
    mutationFn: async (input: {
      section: string
      content?: string
      supporting_detail?: string | null
      visibility?: ThemeContributionVisibility
      draft_content?: string | null
    }) => {
      if (!themeId) throw new Error('Missing themeId')
      if (!user?.id) throw new Error('Not signed in')
      if (!currentOrgId) throw new Error('Missing organization')

      // Find existing non-archived row for this (theme, section, user)
      const { data: existing, error: selErr } = await supabase
        .from('theme_contributions_v2')
        .select('id')
        .eq('theme_id', themeId)
        .eq('section', input.section)
        .eq('created_by', user.id)
        .eq('is_archived', false)
        .maybeSingle()
      if (selErr) throw selErr

      if (existing) {
        const patch: Record<string, any> = {}
        if (input.content !== undefined)           patch.content = input.content
        if (input.supporting_detail !== undefined) patch.supporting_detail = input.supporting_detail
        if (input.visibility !== undefined)        patch.visibility = input.visibility
        if (input.draft_content !== undefined) {
          patch.draft_content = input.draft_content
          patch.draft_updated_at = input.draft_content === null ? null : new Date().toISOString()
        }
        if (Object.keys(patch).length === 0) return existing as { id: string }
        const { error } = await supabase
          .from('theme_contributions_v2')
          .update(patch)
          .eq('id', (existing as any).id)
        if (error) throw error
        return existing as { id: string }
      }

      const { data, error } = await supabase
        .from('theme_contributions_v2')
        .insert({
          theme_id: themeId,
          section: input.section,
          content: input.content ?? '',
          supporting_detail: input.supporting_detail ?? null,
          visibility: input.visibility ?? 'org',
          created_by: user.id,
          organization_id: currentOrgId,
        })
        .select('id')
        .single()
      if (error) throw error
      return data as { id: string }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-contributions-v2', themeId] })
    }
  })

  const deleteContribution = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('theme_contributions_v2').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-contributions-v2', themeId] })
    }
  })

  const togglePin = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      const { error } = await supabase
        .from('theme_contributions_v2')
        .update({
          is_pinned: pinned,
          pinned_by: pinned ? user?.id ?? null : null,
          pinned_at: pinned ? new Date().toISOString() : null,
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-contributions-v2', themeId] })
    }
  })

  // Distinct contributors across all fields on this theme, sorted with current
  // user first (if they have any contribution) then by most recent update.
  const contributors = useMemo(() => {
    const rows = query.data || []
    const byUser = new Map<string, {
      user_id: string
      author: ThemeContribution['author']
      latest: string
      hasContent: boolean
    }>()
    for (const c of rows) {
      const existing = byUser.get(c.created_by)
      const contentful = (c.content || '').replace(/<[^>]*>/g, '').trim().length > 0
      if (!existing) {
        byUser.set(c.created_by, {
          user_id: c.created_by,
          author: c.author ?? null,
          latest: c.updated_at,
          hasContent: contentful,
        })
      } else {
        if (c.updated_at > existing.latest) existing.latest = c.updated_at
        if (contentful) existing.hasContent = true
      }
    }
    const list = Array.from(byUser.values())
    return list.sort((a, b) => {
      if (a.user_id === user?.id) return -1
      if (b.user_id === user?.id) return 1
      return b.latest.localeCompare(a.latest)
    })
  }, [query.data, user?.id])

  return {
    contributions: query.data || [],
    contributors,
    isLoading: query.isLoading,
    isError: query.isError,
    upsertContribution: upsertContribution.mutateAsync,
    isUpserting: upsertContribution.isPending,
    deleteContribution: deleteContribution.mutateAsync,
    togglePin: togglePin.mutateAsync,
    currentOrgId,
  }
}

// =========================================================================
// Revision history for a single contribution
// =========================================================================

/**
 * Aggregate history across ALL contributions on a theme. Optionally filtered to a specific user.
 * Returns events ordered newest-first with denormalized user + field info for the timeline.
 */
export function useThemeAggregateHistory(
  themeId: string | undefined,
  filterUserId: string | null = null,
  limit = 80
) {
  return useQuery({
    queryKey: ['theme-aggregate-history', themeId, filterUserId, limit],
    enabled: !!themeId,
    queryFn: async () => {
      // 1. Fetch all contributions on this theme (gives us id → { section, created_by })
      const { data: contribs, error: cErr } = await supabase
        .from('theme_contributions_v2')
        .select('id, section, created_by, created_at')
        .eq('theme_id', themeId!)
      if (cErr) throw cErr
      const contribMap = new Map((contribs || []).map(c => [c.id, c]))
      const contribIds = (contribs || []).map(c => c.id)
      if (contribIds.length === 0) return [] as Array<any>

      // 2. Fetch history rows for all those contributions
      let q = supabase
        .from('theme_contribution_history')
        .select('*')
        .in('contribution_id', contribIds)
        .order('changed_at', { ascending: false })
        .limit(limit)
      const { data: history, error: hErr } = await q
      if (hErr) throw hErr

      // 3. Also include contribution-creation events (so "first post" shows up)
      const creationEvents = (contribs || []).map(c => ({
        id: `create:${c.id}`,
        contribution_id: c.id,
        old_content: null,
        new_content: '',
        changed_by: c.created_by,
        changed_at: c.created_at,
        is_creation: true as const,
      }))

      // 4. Merge + filter by user if requested
      const merged: Array<{
        id: string
        contribution_id: string
        old_content: string | null
        new_content: string
        changed_by: string
        changed_at: string
        is_creation?: boolean
      }> = [...(history || []).map(h => ({ ...h })), ...creationEvents]

      const withMeta = merged
        .filter(ev => {
          if (!filterUserId) return true
          return ev.changed_by === filterUserId
        })
        .map(ev => ({
          ...ev,
          contribution: contribMap.get(ev.contribution_id),
        }))
        .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
        .slice(0, limit)

      // 5. Fetch user profiles for display
      const userIds = [...new Set(withMeta.map(ev => ev.changed_by).filter(Boolean))]
      let userMap = new Map<string, { id: string; email: string | null; first_name: string | null; last_name: string | null }>()
      if (userIds.length) {
        const { data: users, error: uErr } = await supabase
          .from('users')
          .select('id, email, first_name, last_name')
          .in('id', userIds)
        if (uErr) throw uErr
        userMap = new Map((users || []).map(u => [u.id, u]))
      }

      // 6. Fetch field display names for the fields referenced
      const sectionSlugs = [...new Set(withMeta.map(ev => ev.contribution?.section).filter(Boolean) as string[])]
      let fieldMap = new Map<string, { name: string; slug: string }>()
      if (sectionSlugs.length) {
        const { data: fields, error: fErr } = await supabase
          .from('theme_research_fields')
          .select('name, slug')
          .in('slug', sectionSlugs)
        if (fErr) throw fErr
        fieldMap = new Map((fields || []).map(f => [f.slug, f]))
      }

      return withMeta.map(ev => ({
        ...ev,
        user: userMap.get(ev.changed_by) || null,
        field: ev.contribution ? fieldMap.get(ev.contribution.section) || { name: ev.contribution.section, slug: ev.contribution.section } : null,
      }))
    }
  })
}

export function useThemeContributionHistory(contributionId: string | undefined) {
  return useQuery({
    queryKey: ['theme-contribution-history', contributionId],
    enabled: !!contributionId,
    queryFn: async (): Promise<ThemeContributionHistoryItem[]> => {
      const { data, error } = await supabase
        .from('theme_contribution_history')
        .select('*')
        .eq('contribution_id', contributionId!)
        .order('changed_at', { ascending: false })
      if (error) throw error
      const rows = (data || []) as ThemeContributionHistoryItem[]

      const userIds = [...new Set(rows.map(r => r.changed_by).filter(Boolean))]
      if (userIds.length === 0) return rows
      const { data: users, error: uErr } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
      if (uErr) throw uErr
      const byId = new Map((users || []).map(u => [u.id, u]))
      return rows.map(r => ({ ...r, user: byId.get(r.changed_by) ?? null }))
    }
  })
}
