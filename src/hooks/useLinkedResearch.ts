/**
 * useLinkedResearch — Hooks for querying and mutating research linked to
 * trade ideas and their arguments via the universal object_links table.
 *
 * "Research" here means notes, thoughts, and prompt outputs — any object
 * that provides evidence or context for an investment idea or argument.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { LinkableEntityType } from '../lib/object-links'
import { grantEvidenceReadAccess } from '../lib/services/evidence-access-service'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LinkedResearchItem {
  link_id: string
  link_type: string
  object_id: string
  object_type: LinkableEntityType
  title: string
  preview?: string
  author_name?: string
  created_at: string
  /** Which argument this is linked to (null = linked directly to idea) */
  argument_id: string | null
  argument_direction?: 'bull' | 'bear' | string
}

/** Counts of research items linked to each argument */
export type ArgumentResearchCounts = Record<string, number>

// Research-bearing source types we look up in object_links
const RESEARCH_TYPES: LinkableEntityType[] = [
  'asset_note', 'portfolio_note', 'theme_note', 'custom_note', 'quick_thought',
]

const NOTE_TABLES: Record<string, string> = {
  asset_note: 'asset_notes',
  portfolio_note: 'portfolio_notes',
  theme_note: 'theme_notes',
  custom_note: 'custom_notebook_notes',
}

// ---------------------------------------------------------------------------
// useArgumentResearchCounts — lightweight badge counts per argument
// ---------------------------------------------------------------------------

/**
 * For each argument (thesis) on an idea, count how many research objects
 * are linked to it. Returns Record<argumentId, count>.
 */
export function useArgumentResearchCounts(argumentIds: string[]) {
  return useQuery({
    queryKey: ['argument-research-counts', ...argumentIds.sort()],
    enabled: argumentIds.length > 0,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      if (argumentIds.length === 0) return {} as ArgumentResearchCounts

      // Query links where research objects point to these arguments
      const { data, error } = await supabase
        .from('object_links')
        .select('target_id')
        .eq('target_type', 'trade_idea_thesis')
        .in('target_id', argumentIds)

      // Gracefully handle errors (e.g. if object_links RLS doesn't cover this pattern yet)
      if (error) {
        console.warn('[useArgumentResearchCounts] Query failed, returning empty counts:', error.message)
        const empty: ArgumentResearchCounts = {}
        for (const id of argumentIds) empty[id] = 0
        return empty
      }

      const counts: ArgumentResearchCounts = {}
      for (const id of argumentIds) counts[id] = 0
      for (const row of (data || [])) {
        counts[row.target_id] = (counts[row.target_id] || 0) + 1
      }
      return counts
    },
  })
}

// ---------------------------------------------------------------------------
// useLinkedResearchForIdea — all research linked to an idea + its arguments
// ---------------------------------------------------------------------------

/**
 * Fetches all research objects linked to a trade idea and/or its arguments.
 * Groups by source type, resolves display info from note tables.
 */
export function useLinkedResearchForIdea(
  ideaId: string | undefined,
  argumentIds: string[],
) {
  return useQuery({
    queryKey: ['linked-research', ideaId, ...argumentIds.sort()],
    enabled: !!ideaId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!ideaId) return []

      // Fetch links targeting the idea or any of its arguments
      const targetIds = [ideaId, ...argumentIds]
      const targetTypes: LinkableEntityType[] = ['trade_idea', 'trade_idea_thesis']

      // Build OR filter: (target_type=trade_idea AND target_id=ideaId) OR (target_type=trade_idea_thesis AND target_id IN argumentIds)
      let query = supabase
        .from('object_links')
        .select('id, source_type, source_id, target_type, target_id, link_type, created_at')
        .in('source_type', RESEARCH_TYPES)

      if (argumentIds.length > 0) {
        query = query.in('target_id', targetIds)
      } else {
        query = query.eq('target_id', ideaId)
      }

      const { data: links, error } = await query.order('created_at', { ascending: false })
      if (error) throw error
      if (!links || links.length === 0) return []

      // Resolve display data from source tables
      const results: LinkedResearchItem[] = []

      // Notes
      for (const [sourceType, table] of Object.entries(NOTE_TABLES)) {
        const noteLinks = links.filter(l => l.source_type === sourceType)
        if (noteLinks.length === 0) continue

        const noteIds = noteLinks.map(l => l.source_id)
        const { data: notes } = await supabase
          .from(table)
          .select('id, title, content, created_by, created_at, users!created_by(first_name, last_name, email)')
          .in('id', noteIds)
          .eq('is_deleted', false)

        if (!notes) continue
        const noteMap = new Map((notes as any[]).map(n => [n.id, n]))

        for (const link of noteLinks) {
          const note = noteMap.get(link.source_id)
          if (!note) continue
          const user = note.users
          const authorName = user
            ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email
            : undefined

          results.push({
            link_id: link.id,
            link_type: link.link_type,
            object_id: note.id,
            object_type: sourceType as LinkableEntityType,
            title: note.title || 'Untitled',
            preview: note.content?.replace(/<[^>]*>/g, '').slice(0, 100) || undefined,
            author_name: authorName,
            created_at: note.created_at,
            argument_id: link.target_type === 'trade_idea_thesis' ? link.target_id : null,
          })
        }
      }

      // Quick thoughts
      const thoughtLinks = links.filter(l => l.source_type === 'quick_thought')
      if (thoughtLinks.length > 0) {
        const thoughtIds = thoughtLinks.map(l => l.source_id)
        const { data: thoughts } = await supabase
          .from('quick_thoughts')
          .select('id, content, idea_type, created_by, created_at, users!created_by(first_name, last_name, email)')
          .in('id', thoughtIds)

        if (thoughts) {
          const thoughtMap = new Map((thoughts as any[]).map(t => [t.id, t]))
          for (const link of thoughtLinks) {
            const thought = thoughtMap.get(link.source_id)
            if (!thought) continue
            const user = thought.users
            const authorName = user
              ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email
              : undefined

            results.push({
              link_id: link.id,
              link_type: link.link_type,
              object_id: thought.id,
              object_type: 'quick_thought',
              title: thought.idea_type === 'prompt' ? 'Prompt' : 'Thought',
              preview: thought.content?.slice(0, 100) || undefined,
              author_name: authorName,
              created_at: thought.created_at,
              argument_id: link.target_type === 'trade_idea_thesis' ? link.target_id : null,
            })
          }
        }
      }

      // Sort by created_at desc
      results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      return results
    },
  })
}

// ---------------------------------------------------------------------------
// useCreateResearchLink — link existing research to an idea or argument
// ---------------------------------------------------------------------------

export function useCreateResearchLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      sourceType,
      sourceId,
      targetType,
      targetId,
      linkType = 'supports',
      userId,
      ideaId,
    }: {
      sourceType: LinkableEntityType
      sourceId: string
      targetType: 'trade_idea' | 'trade_idea_thesis'
      targetId: string
      linkType?: string
      userId: string
      /** Trade idea ID — used to grant read access to stakeholders. Pass explicitly
       *  when targetType is 'trade_idea_thesis'; for 'trade_idea' it defaults to targetId. */
      ideaId?: string
    }) => {
      const { data, error } = await supabase
        .from('object_links')
        .upsert({
          source_type: sourceType,
          source_id: sourceId,
          target_type: targetType,
          target_id: targetId,
          link_type: linkType,
          is_auto: false,
          created_by: userId,
        }, {
          onConflict: 'source_type,source_id,target_type,target_id,link_type',
        })
        .select()
        .single()

      if (error) throw error

      // Grant read access on evidence notes to all trade idea stakeholders
      const resolvedIdeaId = ideaId || (targetType === 'trade_idea' ? targetId : undefined)
      if (resolvedIdeaId) {
        await grantEvidenceReadAccess({
          sourceType,
          sourceId,
          ideaId: resolvedIdeaId,
          currentUserId: userId,
        })
      }

      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linked-research'] })
      queryClient.invalidateQueries({ queryKey: ['argument-research-counts'] })
      queryClient.invalidateQueries({ queryKey: ['object-links'] })
    },
  })
}

// ---------------------------------------------------------------------------
// useUpdateResearchLinkType — change the relationship type on an existing link
// ---------------------------------------------------------------------------

export function useUpdateResearchLinkType() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ linkId, linkType }: { linkId: string; linkType: string }) => {
      const { error } = await supabase
        .from('object_links')
        .update({ link_type: linkType })
        .eq('id', linkId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linked-research'] })
      queryClient.invalidateQueries({ queryKey: ['object-links'] })
    },
  })
}

// ---------------------------------------------------------------------------
// useDeleteResearchLink — unlink research from an idea or argument
// ---------------------------------------------------------------------------

export function useDeleteResearchLink() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase
        .from('object_links')
        .delete()
        .eq('id', linkId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linked-research'] })
      queryClient.invalidateQueries({ queryKey: ['argument-research-counts'] })
      queryClient.invalidateQueries({ queryKey: ['object-links'] })
    },
  })
}
