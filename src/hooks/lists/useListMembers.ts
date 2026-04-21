import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

export interface ListMember {
  user_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  role: 'owner' | 'admin' | 'write' | 'read'
}

/**
 * Returns the canonical set of users who can be assignees for rows in
 * this list: the owner + all collaborators, deduplicated.
 *
 * Used by the assignee-picker. Order: owner first, then collaborators
 * sorted by name for stable UI.
 */
export function useListMembers(listId: string | null | undefined) {
  return useQuery<ListMember[]>({
    queryKey: ['list-members', listId],
    queryFn: async () => {
      if (!listId) return []

      const { data: list, error: listError } = await supabase
        .from('asset_lists')
        .select('created_by, owner:users!asset_lists_created_by_fkey(id, email, first_name, last_name)')
        .eq('id', listId)
        .single()
      if (listError) throw listError

      const { data: collabs, error: collabError } = await supabase
        .from('asset_list_collaborations')
        .select('permission, user:users!asset_list_collaborations_user_id_fkey(id, email, first_name, last_name)')
        .eq('list_id', listId)
      if (collabError) throw collabError

      const members: ListMember[] = []
      const seen = new Set<string>()

      // Owner first
      const owner = (list as any)?.owner
      if (owner?.id) {
        members.push({
          user_id: owner.id,
          email: owner.email ?? null,
          first_name: owner.first_name ?? null,
          last_name: owner.last_name ?? null,
          role: 'owner'
        })
        seen.add(owner.id)
      }

      // Collaborators, deduped
      for (const c of (collabs ?? []) as any[]) {
        const u = c.user
        if (!u?.id || seen.has(u.id)) continue
        members.push({
          user_id: u.id,
          email: u.email ?? null,
          first_name: u.first_name ?? null,
          last_name: u.last_name ?? null,
          role: (c.permission ?? 'read') as 'admin' | 'write' | 'read'
        })
        seen.add(u.id)
      }

      // Owner stays first; sort the rest by display name
      const ownerFirst = members[0]?.role === 'owner' ? 1 : 0
      const rest = members.slice(ownerFirst)
      rest.sort((a, b) => {
        const an = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim() || a.email || ''
        const bn = `${b.first_name ?? ''} ${b.last_name ?? ''}`.trim() || b.email || ''
        return an.localeCompare(bn)
      })
      return ownerFirst ? [members[0], ...rest] : rest
    },
    enabled: !!listId
  })
}
