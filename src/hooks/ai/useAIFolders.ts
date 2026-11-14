/**
 * The reader's ACT AI project folders, for the organization they are in.
 *
 * RLS posture — one new table, four policies, nothing widened:
 *   ai_project_folders  SELECT/INSERT/UPDATE/DELETE  TO authenticated
 *                       USING/WITH CHECK (user_id = auth.uid()
 *                                         AND is_member_of_org(organization_id))
 * No anon grant. The folder is private to its owner even inside the firm,
 * and live membership is checked on every verb, so losing a seat closes the
 * folder rather than leaving it readable. `ai_conversations.folder_id` is
 * guarded by a definer trigger (`ai_conversations_folder_own`) that refuses a
 * folder the conversation's owner does not own: the conversation's own policy
 * only checks who owns the conversation, so without the trigger a reader
 * could file a thread into a stranger's shelf by id.
 *
 * The organization is in the query key AND in the filter. It is in the key
 * because a cached list from the other firm must not be shown while the new
 * one loads, and in the filter because the key is a client-side convention
 * and the boundary is the server's.
 */
import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../useAuth'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import {
  shapeFolders, validateFolderName,
  type AIProjectFolder, type AIProjectFolderRow,
} from '../../lib/ai/folders'

const FOLDER_COLUMNS = 'id, name, is_archived, organization_id, updated_at'

/**
 * Why every write payload below is cast.
 *
 * `src/types/database.ts` is hand-maintained, and against the installed
 * supabase-js its write generics collapse: the `insert`/`update` parameter
 * resolves to `never` for EVERY table in the file, including the ones whose
 * own comments claim otherwise. Measured by probe: `files.insert(...)` with a
 * complete, correct payload fails the same way. That collapse is most of the
 * repository's 8,579 standing type errors, and fixing it is a separate lane
 * -- it would turn thousands of silenced sites into real diagnostics at once.
 *
 * So the shape is declared here, checked here, and cast once at the call.
 * The cast hides nothing a reader cannot see: the payload above it is typed.
 */
type FolderInsert = { user_id: string; organization_id: string; name: string }
type FolderUpdate = { name?: string; is_archived?: boolean }

export const aiFoldersKey = (userId: string | null | undefined, orgId: string | null | undefined) =>
  ['ai-project-folders', userId ?? null, orgId ?? null] as const

export interface UseAIFolders {
  folders: AIProjectFolder[]
  /** Archived shelves, kept out of the main list but reachable. */
  archivedFolders: AIProjectFolder[]
  isLoading: boolean
  /** Null while the organization is unknown, which is not the same as none. */
  organizationId: string | null
  canManage: boolean
  createFolder: (name: string) => Promise<AIProjectFolder | null>
  renameFolder: (id: string, name: string) => Promise<void>
  setFolderArchived: (id: string, archived: boolean) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  /** The last rejection, as a sentence for the reader. Null when clean. */
  lastError: string | null
}

export function useAIFolders(): UseAIFolders {
  const { user } = useAuth()
  /* Optional: this hook is mounted inside panes that render outside an
     organization provider in tests and in the mobile shell, and a sidebar
     must not throw for a value it only uses to scope a list. */
  const org = useOrganizationOptional()
  const organizationId = org?.currentOrgId ?? null
  const queryClient = useQueryClient()

  const enabled = !!user?.id && !!organizationId

  const { data, isLoading, error } = useQuery<AIProjectFolder[]>({
    queryKey: aiFoldersKey(user?.id, organizationId),
    queryFn: async () => {
      const { data: rows, error: err } = await supabase
        .from('ai_project_folders')
        .select(FOLDER_COLUMNS)
        .eq('user_id', user!.id)
        .eq('organization_id', organizationId!)
        .order('name', { ascending: true })
      if (err) throw err
      return shapeFolders(rows as unknown as AIProjectFolderRow[])
    },
    enabled,
    staleTime: 60_000,
  })

  const all = data ?? []
  const folders = useMemo(() => all.filter(f => !f.isArchived), [all])
  const archivedFolders = useMemo(() => all.filter(f => f.isArchived), [all])

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ai-project-folders'] })
    /* The sidebar reads `folder_id` off the conversation rows, so a move or a
       delete changes that list too. */
    queryClient.invalidateQueries({ queryKey: ['ai-conversations'] })
  }, [queryClient])

  const createMutation = useMutation({
    mutationFn: async (name: string): Promise<AIProjectFolder | null> => {
      if (!user?.id || !organizationId) return null
      const verdict = validateFolderName(name, all)
      if (!verdict.ok) throw new Error(verdict.message)
      const payload: FolderInsert = {
        user_id: user.id,
        organization_id: organizationId,
        name: verdict.name,
      }
      const { data: row, error: err } = await supabase
        .from('ai_project_folders')
        .insert(payload as never)
        .select(FOLDER_COLUMNS)
        .single()
      if (err) throw err
      return shapeFolders([row as unknown as AIProjectFolderRow])[0] ?? null
    },
    onSuccess: invalidate,
  })

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const verdict = validateFolderName(name, all, id)
      if (!verdict.ok) throw new Error(verdict.message)
      const patch: FolderUpdate = { name: verdict.name }
      const { error: err } = await supabase
        .from('ai_project_folders').update(patch as never).eq('id', id)
      if (err) throw err
    },
    onSuccess: invalidate,
  })

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: string; archived: boolean }) => {
      const patch: FolderUpdate = { is_archived: archived }
      const { error: err } = await supabase
        .from('ai_project_folders').update(patch as never).eq('id', id)
      if (err) throw err
    },
    onSuccess: invalidate,
  })

  /*
   * Deleting the shelf, never its contents.
   *
   * `folder_id` is ON DELETE SET NULL, so the threads become unfiled. The
   * warning the reader confirms says exactly that, and it is composed in
   * `lib/ai/folders` where it can be tested.
   */
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error: err } = await supabase.from('ai_project_folders').delete().eq('id', id)
      if (err) throw err
    },
    onSuccess: invalidate,
  })

  const firstMessage = (e: unknown): string | null =>
    e instanceof Error ? e.message : e ? String(e) : null

  return {
    folders,
    archivedFolders,
    isLoading: enabled && isLoading,
    organizationId,
    canManage: enabled,
    createFolder: (name: string) => createMutation.mutateAsync(name),
    renameFolder: (id: string, name: string) => renameMutation.mutateAsync({ id, name }).then(() => undefined),
    setFolderArchived: (id: string, archived: boolean) =>
      archiveMutation.mutateAsync({ id, archived }).then(() => undefined),
    deleteFolder: (id: string) => deleteMutation.mutateAsync(id).then(() => undefined),
    lastError:
      firstMessage(createMutation.error)
      ?? firstMessage(renameMutation.error)
      ?? firstMessage(archiveMutation.error)
      ?? firstMessage(deleteMutation.error)
      ?? firstMessage(error),
  }
}
