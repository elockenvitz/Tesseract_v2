import { useMemo } from 'react'
import { useAuth } from '../useAuth'
import {
  listPermissions,
  type CollaboratorLike,
  type ListDataLike,
  type ListPermissions,
} from '../../lib/lists/list-permissions'

export type { ListPermissions } from '../../lib/lists/list-permissions'

interface UseListPermissionsOptions {
  list: ListDataLike | null | undefined
  collaborators?: Collaborator[]
}

type Collaborator = CollaboratorLike

/**
 * The permissions for ONE list, for the signed-in reader.
 *
 * The rule itself lives in `lib/lists/list-permissions` so surfaces that ask
 * about several lists at once — the Asset page's membership row — can call it
 * per row without calling a hook in a loop. This is the hook shape the List
 * tab already uses; it holds no rule of its own.
 */
export function useListPermissions({
  list,
  collaborators = [],
}: UseListPermissionsOptions): ListPermissions {
  const { user } = useAuth()

  return useMemo(
    () => listPermissions({ list, collaborators, userId: user?.id ?? null }),
    [list, collaborators, user?.id]
  )
}

export default useListPermissions
