import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { updateRevisionNote } from '../lib/revision-service'

export interface RevisionEventRow {
  id: string
  category: string
  field_key: string
  before_value: string | null
  after_value: string | null
  significance_tier: number
  created_at: string
}

export interface RevisionRow {
  id: string
  asset_id: string
  view_scope_type: 'firm' | 'user'
  view_scope_user_id: string | null
  actor_user_id: string
  created_at: string
  last_activity_at: string
  revision_note: string | null
  actor: {
    id: string
    first_name: string | null
    last_name: string | null
  } | null
  events: RevisionEventRow[]
}

/**
 * Fetches revision sessions with their events for an asset.
 * Returns newest-first.
 */
export function useAssetRevisions(assetId: string | undefined) {
  const { data: revisions = [], isLoading, error } = useQuery({
    queryKey: ['asset-revisions', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_revisions')
        .select(`
          id,
          asset_id,
          view_scope_type,
          view_scope_user_id,
          actor_user_id,
          created_at,
          last_activity_at,
          revision_note,
          actor:users!asset_revisions_actor_user_id_fkey(id, first_name, last_name),
          events:asset_revision_events(
            id,
            category,
            field_key,
            before_value,
            after_value,
            significance_tier,
            created_at
          )
        `)
        .eq('asset_id', assetId!)
        .order('last_activity_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return (data || []) as RevisionRow[]
    },
    enabled: !!assetId,
    staleTime: 30_000,
  })

  return { revisions, isLoading, error }
}

/**
 * Mutation to update a revision note.
 */
export function useUpdateRevisionNote(assetId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ revisionId, note }: { revisionId: string; note: string | null }) => {
      await updateRevisionNote(revisionId, note)
    },
    onSuccess: () => {
      if (assetId) {
        queryClient.invalidateQueries({ queryKey: ['asset-revisions', assetId] })
      }
    },
  })
}
