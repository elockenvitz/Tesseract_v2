import { useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import {
  assertVisibilityNamesAnAudience,
  type AudienceVisibility,
} from '../lib/contributions/audience-reach'

// =========================================================================
// Types
// =========================================================================

/**
 * Who can read a piece of theme research.
 *
 * ── This used to be ('org' | 'shared'), and it meant nothing ─────────────
 *
 * The column existed and the policy ignored it. Production's SELECT policy
 * was `... AND (visibility = 'shared' OR organization_id = current_org_id())`,
 * and every row's `organization_id` IS the current org for anyone who can
 * reach it, so the second half was always true: every piece of theme research
 * was readable by the whole organization whatever its visibility said. All
 * six rows were 'org'; 'shared' had none.
 *
 * So this is not a renaming. It is the same five scopes the asset page has,
 * now backed by a policy that actually restricts
 * (`20261104140000_theme_contribution_audience.sql`), with the targets in
 * `theme_contribution_visibility_targets` and every write going through
 * `set_theme_contribution_audience`.
 *
 * An alias, deliberately: a second copy of the union is how the two pages
 * drift apart again. See `src/lib/contributions/audience-reach.ts`.
 */
export type ThemeContributionVisibility = AudienceVisibility

/** One group a contribution is shared with. Mirrors the asset page's
 *  `VisibilityTarget`. */
export interface ThemeVisibilityTarget {
  node_id: string
  node?: { id: string; name: string; color?: string | null; node_type?: string } | null
}

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
  /** The groups a non-firm audience names. `[]` at a non-firm level means the
   *  restriction reaches nobody but its author — see
   *  `assertVisibilityNamesAnAudience`. */
  visibility_targets?: ThemeVisibilityTarget[]
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

/**
 * Can the server hold a theme audience yet?
 *
 * The two audience migrations
 * (`20261104140000_theme_contribution_audience.sql` and its RPC) are not
 * applied in every environment, and the frontend has to work in both. The
 * vocabulary is the part that cannot straddle: the old CHECK admits
 * `('org','shared')` and the new one admits the five levels, and the two sets
 * are disjoint, so a brand-new contribution's `visibility` is either accepted
 * or rejected with 23514 depending purely on which migration state the
 * database is in.
 *
 * This answers that question once per session, from the table the same
 * migration creates. `false` when the answer is not in yet, because the
 * fallback has to be the behaviour that works everywhere: write the legacy
 * value and offer no audience control. A control that promises a restriction
 * the database cannot store is the original defect, and offering one
 * optimistically would reintroduce it one layer up.
 *
 * It self-heals: the moment the migration lands, this flips and the picker
 * appears, with no second deploy.
 */
export function useThemeAudienceCapability(): boolean {
  const { data } = useQuery({
    queryKey: ['theme-audience-capability'],
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    queryFn: async (): Promise<boolean> => {
      // `limit(1)` so this costs nothing; only the ERROR is of interest.
      const { error } = await supabase
        .from('theme_contribution_visibility_targets')
        .select('contribution_id')
        .limit(1)
      return !error
    },
  })
  return data ?? false
}

/** What `set_theme_contribution_audience` reports it stored. */
export interface ThemeContributionAudience {
  contribution_id: string
  visibility: ThemeContributionVisibility
  node_ids: string[]
  node_count: number
}

/**
 * Change who can read a piece of theme research.
 *
 * The ONLY way the client may do this, for the same reason as on the asset
 * page: `theme_contributions_v2.visibility` is pinned against direct UPDATE
 * by the `a_pin_audience` trigger, which silently RESTORES the old value. A
 * `.update({ visibility })` therefore reports success and changes nothing —
 * the worst of the three possible outcomes, because the UI then shows a
 * restriction the database does not have.
 *
 * Errors are thrown, never swallowed. The server's message names the actual
 * refusal ("a team audience must name at least one group", "2 target(s) are
 * groups you do not belong to"), and "please try again" contradicts every one
 * of them.
 */
async function setThemeContributionAudience(
  contributionId: string,
  visibility: ThemeContributionVisibility,
  targetIds: string[]
): Promise<ThemeContributionAudience> {
  const { data, error } = await supabase.rpc('set_theme_contribution_audience', {
    p_contribution_id: contributionId,
    p_visibility: visibility,
    p_node_ids: targetIds,
  } as never)

  if (error) {
    throw new Error(error.message || 'Could not change who can see this research.')
  }
  return (data ?? null) as unknown as ThemeContributionAudience
}

export function useThemeContributionsV2(themeId: string | undefined) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: ['theme-contributions-v2', themeId],
    enabled: !!themeId,
    queryFn: async (): Promise<ThemeContribution[]> => {
      /*
       * ── Why the targets are NOT an embed ────────────────────────────────
       *
       * They were, for one commit, and it took the whole page down. PostgREST
       * resolves `visibility_targets:theme_contribution_visibility_targets(..)`
       * at request time, and that table does not exist until
       * `20261104140000_theme_contribution_audience.sql` is applied. An
       * unknown embedded relation is not an empty embed -- it is a 400 on the
       * WHOLE request, so every contribution vanished and the page said "No
       * team research yet" about research that was sitting in the table.
       *
       * Measured: GET .../theme_contributions_v2?select=*,visibility_targets:
       * theme_contribution_visibility_targets(...) -> 400.
       *
       * So the contributions are read on their own, and the audience is a
       * SECOND request that is allowed to fail. Research is the thing a reader
       * came for; who else can see it is an annotation on it. An annotation
       * must never be able to hide the thing it annotates.
       *
       * This also makes the two halves of this feature deploy in either
       * order, which nothing else in it does.
       */
      const { data, error } = await supabase
        .from('theme_contributions_v2')
        .select('*')
        .eq('theme_id', themeId!)
        .eq('is_archived', false)
        .order('created_at', { ascending: true })
      if (error) throw error
      const rows = ((data || []) as ThemeContribution[]).map(r => ({
        ...r,
        visibility_targets: [] as ThemeVisibilityTarget[],
      }))

      const userIds = [...new Set(rows.map(r => r.created_by))]
      if (userIds.length === 0) return rows

      const { data: users, error: uErr } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)
      if (uErr) throw uErr
      const byId = new Map((users || []).map(u => [u.id, u]))

      /*
       * The audience, separately and softly. If the targets table is not
       * there yet the error is swallowed and every row keeps `[]`, which is
       * exactly what a firm-wide audience looks like -- so the page degrades
       * to the behaviour it had before this feature rather than to a blank
       * screen.
       *
       * It is NOT thrown, and that is the whole point of splitting it out.
       */
      const byContribution = new Map<string, ThemeVisibilityTarget[]>()
      const { data: targets, error: tErr } = await supabase
        .from('theme_contribution_visibility_targets')
        .select('contribution_id, node_id, node:org_chart_nodes(id, name, color, node_type)')
        .in('contribution_id', rows.map(r => r.id))
      if (!tErr) {
        for (const t of (targets ?? []) as unknown as Array<
          ThemeVisibilityTarget & { contribution_id: string }
        >) {
          const list = byContribution.get(t.contribution_id) ?? []
          list.push({ node_id: t.node_id, node: t.node ?? null })
          byContribution.set(t.contribution_id, list)
        }
      }

      return rows.map(r => ({
        ...r,
        author: byId.get(r.created_by) ?? null,
        visibility_targets: byContribution.get(r.id) ?? [],
      }))
    }
  })

  const audienceReady = useThemeAudienceCapability()

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
      /**
       * Omit to PRESERVE the contribution's current audience.
       *
       * This used to default to `'org'`, so every content save restated the
       * visibility. That was harmless only because the column was inert; now
       * that it restricts, a prose edit that restates the audience is a prose
       * edit that can destroy one. Absence means "leave it alone", exactly as
       * on the asset page.
       */
      visibility?: ThemeContributionVisibility
      /** Required when `visibility` is given and not `'firm'`. Ignored otherwise. */
      targetIds?: string[]
      draft_content?: string | null
    }) => {
      /*
       * An explicit level is the only thing that may touch the audience.
       * `undefined` is preservation; `[]` is not a substitute for it.
       *
       * Ignored outright when the server cannot hold an audience: the RPC
       * does not exist and the CHECK would refuse the word, so honouring a
       * level here could only turn a prose save into a 23514. Saving the
       * prose is what the analyst asked for.
       */
      const isVisibilityChange = audienceReady && input.visibility !== undefined
      if (isVisibilityChange) {
        assertVisibilityNamesAnAudience(input.visibility!, input.targetIds ?? [])
      }
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
        /* The generated types do not describe this table, so `existing` comes
           back as `never`. Narrowed once, here, rather than cast at each use:
           the id is the only field selected. */
        const existingId = (existing as unknown as { id: string }).id
        const patch: Record<string, any> = {}
        if (input.content !== undefined)           patch.content = input.content
        if (input.supporting_detail !== undefined) patch.supporting_detail = input.supporting_detail
        /* `visibility` is NOT in the patch, and must not be: the pin trigger
           reverts it and the write would silently do nothing. It goes through
           the RPC below. */
        if (input.draft_content !== undefined) {
          patch.draft_content = input.draft_content
          patch.draft_updated_at = input.draft_content === null ? null : new Date().toISOString()
        }
        if (Object.keys(patch).length > 0) {
          const { error } = await supabase
            .from('theme_contributions_v2')
            .update(patch)
            .eq('id', existingId)
          if (error) throw error
        }

        /*
         * After the content write, so a refused audience change cannot
         * discard the prose just typed. The two are not atomic with each
         * other, deliberately: losing an edit to a rejected visibility choice
         * is the worse failure. Same choice as `saveContribution`.
         */
        if (isVisibilityChange) {
          await setThemeContributionAudience(
            existingId, input.visibility!, input.targetIds ?? []
          )
        }
        return { id: existingId }
      }

      const { data, error } = await supabase
        .from('theme_contributions_v2')
        .insert({
          theme_id: themeId,
          section: input.section,
          content: input.content ?? '',
          supporting_detail: input.supporting_detail ?? null,
          /*
           * A new row has no prior audience to preserve, so the default is
           * the widest -- the same reach every pre-existing row had.
           *
           * WHICH WORD that is depends on the migration state, and getting it
           * wrong is a 23514 on the analyst's first save in a field. 'firm'
           * once the five-level CHECK is in; the legacy 'org' until then,
           * which is the only value the old CHECK admits. This is the one
           * place the two vocabularies meet, and it is why `audienceReady`
           * exists.
           *
           * The pin trigger is BEFORE UPDATE, so an INSERT may still write
           * the column; the target ROWS cannot be written directly and go
           * through the RPC below.
           */
          visibility: audienceReady ? (input.visibility ?? 'firm') : 'org',
          created_by: user.id,
          organization_id: currentOrgId,
        })
        .select('id')
        .single()
      if (error) throw error

      /* Fail closed: if this throws, the row exists as restricted with no
         targets, which is readable by its author alone. The thrown error says
         why rather than leaving a lock the server will not honour. */
      if (isVisibilityChange && input.visibility !== 'firm') {
        await setThemeContributionAudience(
          (data as { id: string }).id, input.visibility, input.targetIds ?? []
        )
      }
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

  /**
   * Change the audience of research that already exists, with no content edit.
   *
   * The picker's Apply needs this: on the asset page the toolbar picker is
   * persisted by the next content save, which means a reader who only changes
   * who can see their work and then leaves has changed nothing. Here the
   * change is written when it is made, for every one of the author's own
   * contributions on this theme — the picker is a page-level control, so a
   * per-field audience would be a promise the control does not make.
   */
  const updateVisibility = useMutation({
    mutationFn: async ({
      visibility, targetIds,
    }: { visibility: ThemeContributionVisibility; targetIds: string[] }) => {
      if (!user?.id) throw new Error('Not signed in')
      /* Refused loudly rather than silently dropped: unlike a prose save,
         changing the audience IS the whole request, so reporting success
         would be the lie. The control is hidden when this is false, so
         reaching here means something went around it. */
      if (!audienceReady) {
        throw new Error(
          'Audiences are not enabled on this server yet. Your research stays visible to the firm.'
        )
      }
      assertVisibilityNamesAnAudience(visibility, targetIds)

      const own = (query.data || []).filter(c => c.created_by === user.id)
      /* Nothing written yet is not a failure: the level is held by the page
         and applied by the first save. Returning [] says so rather than
         throwing at someone who opened the picker first. */
      const results: ThemeContributionAudience[] = []
      for (const c of own) {
        results.push(await setThemeContributionAudience(c.id, visibility, targetIds))
      }
      return results
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
    updateVisibility: updateVisibility.mutateAsync,
    isUpdatingVisibility: updateVisibility.isPending,
    /** False until the audience migrations are applied; the picker hides. */
    audienceReady,
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
