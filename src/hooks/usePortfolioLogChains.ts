/**
 * usePortfolioLogChains
 *
 * Queries object_links for `results_in` edges between portfolio log entries,
 * then builds parent→child chain structures for display.
 *
 * Chains are derived from the platform's universal object_links infrastructure.
 * Each edge represents a "results in" relationship: parent → child.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { LinkableEntityType } from '../lib/object-links'

// ---------------------------------------------------------------------------
// Source object types — the DB-table-aligned types used in the Portfolio Log.
// Maps 1:1 with the tables fetched in fetchPortfolioLog().
// ---------------------------------------------------------------------------

export type SourceObjectType =
  | 'quick_thought'
  | 'portfolio_note'
  | 'trade_queue_item'
  | 'trade_proposal'

// ---------------------------------------------------------------------------
// Type mappings between SourceObjectType ↔ LinkableEntityType
// ---------------------------------------------------------------------------

const SOURCE_TO_LINKABLE: Record<SourceObjectType, LinkableEntityType> = {
  quick_thought: 'quick_thought',
  portfolio_note: 'portfolio_note',
  trade_queue_item: 'trade_idea',
  trade_proposal: 'trade_proposal',
}

const LINKABLE_TO_SOURCE: Partial<Record<LinkableEntityType, SourceObjectType>> = {
  quick_thought: 'quick_thought',
  portfolio_note: 'portfolio_note',
  trade_idea: 'trade_queue_item',
  trade_proposal: 'trade_proposal',
}

export { SOURCE_TO_LINKABLE, LINKABLE_TO_SOURCE }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LineageEdge {
  linkId: string
  parentType: LinkableEntityType
  parentId: string
  childType: LinkableEntityType
  childId: string
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const chainsKey = (pid: string) => ['portfolio-log-chains', pid] as const

export function usePortfolioLogChains(
  portfolioId: string,
  /** All source object IDs from the portfolio log entries */
  entryObjectIds: string[],
) {
  const qc = useQueryClient()

  // Use sorted IDs joined as a stable fingerprint so the cache invalidates
  // when the set of entry IDs changes, not just when the count changes.
  const idFingerprint = entryObjectIds.slice().sort().join(',')

  const { data: edges, isLoading } = useQuery({
    queryKey: [...chainsKey(portfolioId), idFingerprint],
    enabled: !!portfolioId && entryObjectIds.length > 0,
    queryFn: async () => {
      if (entryObjectIds.length === 0) return []

      // Query all results_in links involving any of our entry IDs
      // Since UUIDs are globally unique, we can query by ID alone
      const idList = entryObjectIds.join(',')
      const { data, error } = await supabase
        .from('object_links')
        .select('id, source_type, source_id, target_type, target_id')
        .eq('link_type', 'results_in')
        .or(`source_id.in.(${idList}),target_id.in.(${idList})`)

      if (error) throw error

      return (data || []).map((row: any): LineageEdge => ({
        linkId: row.id,
        parentType: row.source_type,
        parentId: row.source_id,
        childType: row.target_type,
        childId: row.target_id,
      }))
    },
    staleTime: 60_000,
  })

  // Build lookup maps from edges
  // parentOf: childId → parentId
  // childrenOf: parentId → childId[]
  const parentOf = new Map<string, string>()
  const childrenOf = new Map<string, string[]>()
  const edgeByChild = new Map<string, LineageEdge>()

  for (const edge of edges || []) {
    parentOf.set(edge.childId, edge.parentId)
    edgeByChild.set(edge.childId, edge)
    const children = childrenOf.get(edge.parentId) || []
    children.push(edge.childId)
    childrenOf.set(edge.parentId, children)
  }

  // Delete a lineage edge
  const unlinkEdge = useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase
        .from('object_links')
        .delete()
        .eq('id', linkId)
        .eq('link_type', 'results_in')
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: chainsKey(portfolioId) })
      qc.invalidateQueries({ queryKey: ['portfolio-log', portfolioId] })
    },
  })

  return {
    edges: edges || [],
    parentOf,
    childrenOf,
    edgeByChild,
    isLoading,
    unlinkEdge,
  }
}
