/**
 * Which lists contain one asset, and whether this reader may take it out.
 *
 * ── Why this replaced the Asset page's own lists query ───────────────────
 *
 * The page already read `asset_list_items` for the asset, but it selected only
 * the joined `asset_lists` row — dropping the membership id and `added_by`. So
 * the surface could NAME the lists and nothing else: no row to delete, and no
 * way to answer "may I". This is that same single request, widened. It is not
 * a second fetch; the old one is gone.
 *
 * ── The permission answer is the existing one ───────────────────────────
 *
 * `listPermissions` is the rule the List tab enforces, extracted so it can be
 * asked per row. Collaborations are nested in the same request: RLS shows a
 * collaborator exactly their own collaboration row, which is precisely the row
 * the rule looks up. See `lib/lists/list-permissions` for why that is enough.
 *
 * RLS posture — no new table, no new policy, no widening:
 *   asset_list_items          SELECT/DELETE  owner or write/admin collaborator
 *   asset_lists               SELECT         own or shared
 *   asset_list_collaborations SELECT         user_id = auth.uid() (or owner)
 * The DELETE policy is broader than the product rule on a collaborative list
 * (it admits any write collaborator), so `canRemove` is the narrower gate and
 * the one the UI must honour.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { listPermissions, type CollaboratorLike } from '../../lib/lists/list-permissions'

export interface AssetListMembership {
  /** `asset_list_items.id` — the row a removal deletes. */
  itemId: string
  listId: string
  name: string
  description: string | null
  listType: 'mutual' | 'collaborative'
  /** Carried so a caller opening the list can hand the List tab a row whose
   *  ownership it can read — it derives its own permissions from this. */
  createdBy: string | null
  addedAt: string | null
  /** The existing rule, asked for this row. Never assumed from write access. */
  canRemove: boolean
}

export const assetListMembershipsKey = (assetId: string | undefined, userId: string | null | undefined) =>
  ['asset-list-memberships', assetId, userId] as const

/**
 * Every cache entry that answers "which lists contain this asset".
 *
 * There are four, owned by four surfaces, and a mutation that misses one
 * leaves a stale answer visible next to a fresh one. `asset-context-lists` is
 * the one the header chips read and the one the add path used to forget — the
 * chip count stayed on its old number until something else refetched it.
 */
export function invalidateAssetListMembership(qc: QueryClient, assetId: string) {
  qc.invalidateQueries({ queryKey: ['asset-list-memberships', assetId] })
  qc.invalidateQueries({ queryKey: ['asset-context-lists', assetId] })
  qc.invalidateQueries({ queryKey: ['asset-lists-for-link', assetId] })
  qc.invalidateQueries({ queryKey: ['asset-lists'] })
  qc.invalidateQueries({ queryKey: ['asset-list-items'] })
}

export function useAssetListMemberships(assetId: string | undefined) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const query = useQuery({
    queryKey: assetListMembershipsKey(assetId, user?.id),
    queryFn: async (): Promise<AssetListMembership[]> => {
      const { data, error } = await supabase
        .from('asset_list_items')
        .select(`
          id,
          added_at,
          added_by,
          asset_lists(
            id, name, description, list_type, created_by,
            asset_list_collaborations(user_id, permission)
          )
        `)
        .eq('asset_id', assetId!)
        .order('added_at', { ascending: false })

      if (error) throw error

      /* The shape PostgREST returns for the select above. A nested embed comes
         back as an object (or null) for a to-one relationship, so the join can
         legitimately be absent and each row is checked before it is used. */
      type Row = {
        id: string
        added_at: string | null
        added_by: string | null
        asset_lists: {
          id: string
          name: string
          description: string | null
          list_type: 'mutual' | 'collaborative'
          created_by: string | null
          asset_list_collaborations: CollaboratorLike[] | null
        } | null
      }

      return ((data ?? []) as unknown as Row[]).flatMap((row): AssetListMembership[] => {
        const list = row.asset_lists
        if (!list) return []
        const perms = listPermissions({
          list,
          collaborators: list.asset_list_collaborations ?? [],
          userId: user?.id ?? null,
        })
        return [{
          itemId: row.id,
          listId: list.id,
          name: list.name,
          description: list.description ?? null,
          listType: list.list_type,
          createdBy: list.created_by ?? null,
          addedAt: row.added_at ?? null,
          canRemove: perms.canRemoveItem({ added_by: row.added_by ?? null }),
        }]
      })
    },
    enabled: !!assetId && !!user?.id,
  })

  const remove = useMutation({
    mutationFn: async (itemId: string) => {
      /* The same statement the List tab's removal runs. Deleting the
         membership row, never the list. */
      const { error } = await supabase.from('asset_list_items').delete().eq('id', itemId)
      if (error) throw error
      return itemId
    },
    onSuccess: () => {
      if (assetId) invalidateAssetListMembership(queryClient, assetId)
    },
  })

  return {
    memberships: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    remove,
  }
}
