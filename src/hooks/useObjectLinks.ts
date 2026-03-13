/**
 * Query hooks for the object_links table.
 *
 * These hooks provide bidirectional lookup:
 * - Forward: "What does this note reference?"
 * - Reverse (backlinks): "What notes reference this object?"
 *
 * PRIVACY: Backlink queries always join through the source object's table,
 * so RLS on the source table filters out notes the user can't see.
 * The object_links row itself is just (type, UUID) pairs — no sensitive data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { LinkableEntityType } from '../lib/object-links'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ObjectLink {
  id: string
  source_type: LinkableEntityType
  source_id: string
  target_type: LinkableEntityType
  target_id: string
  link_type: string
  context: string | null
  is_auto: boolean
  created_by: string | null
  created_at: string
}

export interface BacklinkNote {
  link_id: string
  link_type: string
  is_auto: boolean
  note_id: string
  note_title: string
  note_type: string | null
  note_source_type: LinkableEntityType
  created_by: string | null
  updated_at: string
  // Enriched fields from the note table join
  author_name?: string
  entity_name?: string
}

// ---------------------------------------------------------------------------
// Forward links: "What does this object link to?"
// ---------------------------------------------------------------------------

export function useForwardLinks(
  sourceType: LinkableEntityType,
  sourceId: string | undefined,
) {
  return useQuery({
    queryKey: ['object-links', 'forward', sourceType, sourceId],
    enabled: !!sourceId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('object_links')
        .select('*')
        .eq('source_type', sourceType)
        .eq('source_id', sourceId!)
        .order('created_at', { ascending: false })

      if (error) throw error
      return (data || []) as ObjectLink[]
    },
  })
}

// ---------------------------------------------------------------------------
// Backlinks: "What notes reference this object?"
// ---------------------------------------------------------------------------

/**
 * Fetch notes that reference a given object (e.g., an asset).
 *
 * This performs a two-step query:
 * 1. Fetch link rows where target matches
 * 2. For each source note type, join through the note table (RLS enforced)
 *
 * Only returns notes the current user can actually read.
 */
export function useBacklinks(
  targetType: LinkableEntityType,
  targetId: string | undefined,
) {
  return useQuery({
    queryKey: ['object-links', 'backlinks', targetType, targetId],
    enabled: !!targetId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!targetId) return []

      // Step 1: Get link rows pointing to this target
      const { data: links, error: linkError } = await supabase
        .from('object_links')
        .select('id, source_type, source_id, link_type, is_auto, created_at')
        .eq('target_type', targetType)
        .eq('target_id', targetId)
        .order('created_at', { ascending: false })

      if (linkError) throw linkError
      if (!links || links.length === 0) return []

      // Step 2: Group by source_type, then fetch actual note data
      // (RLS on each note table filters out unauthorized notes)
      const noteTypes: Record<string, { table: string; fkJoin: string }> = {
        asset_note:     { table: 'asset_notes',           fkJoin: 'assets(symbol, company_name)' },
        portfolio_note: { table: 'portfolio_notes',       fkJoin: 'portfolios(name)' },
        theme_note:     { table: 'theme_notes',           fkJoin: 'themes(name)' },
        custom_note:    { table: 'custom_notebook_notes', fkJoin: 'custom_notebooks(name)' },
      }

      const results: BacklinkNote[] = []

      for (const [sourceType, config] of Object.entries(noteTypes)) {
        const sourceLinks = links.filter(l => l.source_type === sourceType)
        if (sourceLinks.length === 0) continue

        const noteIds = sourceLinks.map(l => l.source_id)

        const { data: notes, error: noteError } = await supabase
          .from(config.table)
          .select(`id, title, note_type, created_by, updated_at, users!created_by(first_name, last_name, email)`)
          .in('id', noteIds)
          .eq('is_deleted', false)

        if (noteError) {
          console.warn(`[useBacklinks] Error fetching ${config.table}:`, noteError)
          continue
        }

        if (!notes) continue

        const noteMap = new Map(notes.map((n: any) => [n.id, n]))

        for (const link of sourceLinks) {
          const note = noteMap.get(link.source_id)
          if (!note) continue // RLS filtered it out — user can't see this note

          const user = (note as any).users
          const authorName = user
            ? [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email
            : null

          results.push({
            link_id: link.id,
            link_type: link.link_type,
            is_auto: link.is_auto,
            note_id: note.id,
            note_title: (note as any).title,
            note_type: (note as any).note_type,
            note_source_type: sourceType as LinkableEntityType,
            created_by: (note as any).created_by,
            updated_at: (note as any).updated_at,
            author_name: authorName ?? undefined,
          })
        }
      }

      // Sort by updated_at descending
      results.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

      return results
    },
  })
}

// ---------------------------------------------------------------------------
// Count-only backlinks (lightweight, for badges)
// ---------------------------------------------------------------------------

/**
 * Returns only the count of backlinks for an object.
 *
 * PRIVACY: Joins through source note tables so RLS filters out
 * notes the user can't see. Only counts visible backlinks.
 */
export function useBacklinkCount(
  targetType: LinkableEntityType,
  targetId: string | undefined,
) {
  return useQuery({
    queryKey: ['object-links', 'backlink-count', targetType, targetId],
    enabled: !!targetId,
    staleTime: 120_000,
    queryFn: async () => {
      if (!targetId) return 0

      // Step 1: Get link rows pointing to this target
      const { data: links, error: linkError } = await supabase
        .from('object_links')
        .select('id, source_type, source_id')
        .eq('target_type', targetType)
        .eq('target_id', targetId)

      if (linkError) throw linkError
      if (!links || links.length === 0) return 0

      // Step 2: Group by source_type and verify existence via note tables (RLS enforced)
      const noteTypes: Record<string, string> = {
        asset_note: 'asset_notes',
        portfolio_note: 'portfolio_notes',
        theme_note: 'theme_notes',
        custom_note: 'custom_notebook_notes',
      }

      let visibleCount = 0

      for (const [sourceType, table] of Object.entries(noteTypes)) {
        const sourceLinks = links.filter(l => l.source_type === sourceType)
        if (sourceLinks.length === 0) continue

        const noteIds = sourceLinks.map(l => l.source_id)
        const { count, error } = await supabase
          .from(table)
          .select('id', { count: 'exact', head: true })
          .in('id', noteIds)
          .eq('is_deleted', false)

        if (!error && count) {
          visibleCount += count
        }
      }

      // Non-note source types (asset, workflow, etc.) — count directly
      // These don't have note-level RLS concerns
      const nonNoteLinks = links.filter(l => !noteTypes[l.source_type])
      visibleCount += nonNoteLinks.length

      return visibleCount
    },
  })
}

// ---------------------------------------------------------------------------
// Enriched forward links (with display labels from target tables)
// ---------------------------------------------------------------------------

export interface EnrichedForwardLink extends ObjectLink {
  label: string
  subtitle?: string
}

/**
 * Fetches forward links with display labels resolved from target tables.
 * Groups links by target_type, fetches labels in batches, and merges.
 */
export function useForwardLinksEnriched(
  sourceType: LinkableEntityType,
  sourceId: string | undefined,
) {
  return useQuery({
    queryKey: ['object-links', 'forward-enriched', sourceType, sourceId],
    enabled: !!sourceId,
    staleTime: 60_000,
    queryFn: async () => {
      if (!sourceId) return []

      const { data, error } = await supabase
        .from('object_links')
        .select('*')
        .eq('source_type', sourceType)
        .eq('source_id', sourceId)
        .order('created_at', { ascending: false })

      if (error) throw error
      if (!data || data.length === 0) return []

      const links = data as ObjectLink[]

      // Group by target_type for batch label resolution
      const byType = new Map<string, ObjectLink[]>()
      for (const link of links) {
        const group = byType.get(link.target_type) || []
        group.push(link)
        byType.set(link.target_type, group)
      }

      const enriched: EnrichedForwardLink[] = []

      // Resolve labels per type
      for (const [targetType, typeLinks] of byType) {
        const ids = typeLinks.map(l => l.target_id)
        let labelMap = new Map<string, { label: string; subtitle?: string }>()

        try {
          switch (targetType) {
            case 'asset': {
              const { data: assets } = await supabase.from('assets').select('id, symbol, company_name').in('id', ids)
              if (assets) assets.forEach(a => labelMap.set(a.id, { label: a.symbol, subtitle: a.company_name }))
              break
            }
            case 'portfolio': {
              const { data: portfolios } = await supabase.from('portfolios').select('id, name, description').in('id', ids)
              if (portfolios) portfolios.forEach(p => labelMap.set(p.id, { label: p.name, subtitle: p.description }))
              break
            }
            case 'theme': {
              const { data: themes } = await supabase.from('org_themes_v').select('id, name').in('id', ids)
              if (themes) themes.forEach(t => labelMap.set(t.id, { label: t.name }))
              break
            }
            case 'workflow': {
              const { data: workflows } = await supabase.from('org_workflows_v').select('id, name').in('id', ids)
              if (workflows) workflows.forEach(w => labelMap.set(w.id, { label: w.name }))
              break
            }
            case 'project': {
              const { data: projects } = await supabase.from('projects').select('id, name, status').in('id', ids)
              if (projects) projects.forEach(p => labelMap.set(p.id, { label: p.name, subtitle: p.status }))
              break
            }
            case 'trade_idea': {
              const { data: ideas } = await supabase.from('trade_queue_items').select('id, action, assets(symbol)').in('id', ids)
              if (ideas) ideas.forEach((i: any) => labelMap.set(i.id, {
                label: `${i.action || 'Trade'} ${i.assets?.symbol || '?'}`,
              }))
              break
            }
            case 'trade': {
              const { data: variants } = await supabase.from('lab_variants').select('id, direction, sizing_input, asset:assets(symbol)').in('id', ids)
              if (variants) (variants as any[]).forEach(v => labelMap.set(v.id, {
                label: `${v.direction || 'Trade'} ${v.asset?.symbol || '?'}`,
                subtitle: v.sizing_input || undefined,
              }))
              break
            }
            case 'trade_sheet': {
              const { data: sheets } = await supabase.from('trade_sheets').select('id, name, status').in('id', ids)
              if (sheets) (sheets as any[]).forEach(s => labelMap.set(s.id, {
                label: s.name || 'Trade Sheet',
                subtitle: s.status || undefined,
              }))
              break
            }
            case 'calendar_event': {
              const { data: events } = await supabase.from('calendar_events').select('id, title, start_time').in('id', ids)
              if (events) events.forEach((e: any) => {
                let timeLabel = ''
                if (e.start_time) {
                  try {
                    const d = new Date(e.start_time)
                    timeLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  } catch { /* ignore */ }
                }
                labelMap.set(e.id, { label: e.title || 'Meeting', subtitle: timeLabel || undefined })
              })
              break
            }
            case 'user': {
              const { data: users } = await supabase.from('users').select('id, first_name, last_name, email').in('id', ids)
              if (users) users.forEach(u => labelMap.set(u.id, {
                label: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email || 'Unknown',
              }))
              break
            }
            case 'asset_note':
            case 'portfolio_note':
            case 'theme_note':
            case 'custom_note': {
              const tables: Record<string, string> = {
                asset_note: 'asset_notes',
                portfolio_note: 'portfolio_notes',
                theme_note: 'theme_notes',
                custom_note: 'custom_notebook_notes',
              }
              const table = tables[targetType]
              if (table) {
                const { data: notes } = await supabase.from(table).select('id, title').in('id', ids).eq('is_deleted', false)
                if (notes) notes.forEach((n: any) => labelMap.set(n.id, { label: n.title || 'Untitled' }))
              }
              break
            }
            case 'quick_thought': {
              const { data: thoughts } = await supabase.from('quick_thoughts').select('id, content, idea_type').in('id', ids)
              if (thoughts) thoughts.forEach((t: any) => {
                const preview = t.content?.slice(0, 60) || (t.idea_type === 'prompt' ? 'Prompt' : 'Thought')
                labelMap.set(t.id, { label: preview, subtitle: t.idea_type || undefined })
              })
              break
            }
            case 'trade_proposal': {
              const { data: proposals } = await supabase
                .from('trade_proposals')
                .select('id, weight, shares, trade_queue_items:trade_queue_item_id (action, assets:asset_id (symbol))')
                .in('id', ids)
              if (proposals) (proposals as any[]).forEach(p => {
                const tqi = p.trade_queue_items
                const action = tqi?.action || 'Trade'
                const sym = tqi?.assets?.symbol || '?'
                labelMap.set(p.id, { label: `${action} ${sym}` })
              })
              break
            }
          }
        } catch (err) {
          console.warn(`[useForwardLinksEnriched] Error resolving ${targetType}:`, err)
        }

        for (const link of typeLinks) {
          const resolved = labelMap.get(link.target_id)
          enriched.push({
            ...link,
            label: resolved?.label || link.target_id.slice(0, 8),
            subtitle: resolved?.subtitle,
          })
        }
      }

      return enriched
    },
  })
}

// ---------------------------------------------------------------------------
// Manual link mutations (create / delete)
// ---------------------------------------------------------------------------

/**
 * Hook for creating and deleting manual object links.
 */
export function useManualLinks(
  sourceType: LinkableEntityType,
  sourceId: string | undefined,
) {
  const queryClient = useQueryClient()

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['object-links', 'forward', sourceType, sourceId] })
    queryClient.invalidateQueries({ queryKey: ['object-links', 'forward-enriched', sourceType, sourceId] })
  }

  const createManualLink = useMutation({
    mutationFn: async ({
      targetType,
      targetId,
      label,
      userId,
      linkType = 'references',
    }: {
      targetType: LinkableEntityType
      targetId: string
      label: string
      userId: string
      linkType?: string
    }) => {
      const { data, error } = await supabase
        .from('object_links')
        .upsert({
          source_type: sourceType,
          source_id: sourceId!,
          target_type: targetType,
          target_id: targetId,
          link_type: linkType,
          is_auto: false,
          context: label,
          created_by: userId,
        }, {
          onConflict: 'source_type,source_id,target_type,target_id,link_type',
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: invalidate,
  })

  const deleteManualLink = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase
        .from('object_links')
        .delete()
        .eq('id', linkId)
        .eq('is_auto', false) // Safety: only delete manual links

      if (error) throw error
    },
    onSuccess: invalidate,
  })

  return { createManualLink, deleteManualLink }
}
