import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { assetsPath, ASSETS_BUCKET } from '../lib/storage/asset-paths'
import { validateUpload } from '../lib/files/file-format'

/**
 * The Files repository: one data path for desktop and mobile.
 *
 * Everything that reads or writes a repository file goes through here. The
 * phone and the desktop render differently and query identically — the
 * alternative is two sets of filters that drift until one of them is wrong,
 * which is what happened to Projects' progress calculation (recomputed in
 * four places).
 *
 * RLS is the authority. Nothing in this file is a permission check; the
 * client gates below exist so the UI does not offer an action that the
 * database will refuse, which is a different job from enforcing it.
 */

export interface FileRecord {
  id: string
  organization_id: string
  name: string
  original_name: string
  storage_bucket: string
  storage_path: string
  mime_type: string | null
  size_bytes: number | null
  uploaded_by: string
  created_at: string
  updated_at: string
  deleted_at: string | null
  uploader?: {
    id: string
    email: string | null
    first_name: string | null
    last_name: string | null
  } | null
  file_links?: FileLinkRecord[]
}

export interface FileLinkRecord {
  id: string
  file_id: string
  target_type: 'asset' | 'project'
  target_id: string
  created_by: string
  created_at: string
}

const FILE_COLUMNS = `
  id, organization_id, name, original_name, storage_bucket, storage_path,
  mime_type, size_bytes, uploaded_by, created_at, updated_at, deleted_at,
  uploader:users!files_uploaded_by_fkey(id, email, first_name, last_name),
  file_links(id, file_id, target_type, target_id, created_by, created_at)
`

/**
 * The write client, typed loosely, at one named place.
 *
 * `src/types/database.ts` is hand-maintained and does not declare
 * `Relationships` on any table, so supabase-js v2's generic resolution
 * collapses every Insert and Update payload in this application to `never`.
 * That is why essentially every `.insert()` and `.update()` in this codebase
 * carries a TS2769 or TS2345 — it is systemic, pre-existing, and not
 * something a feature lane should fix by rewriting a 1,000-line generated
 * type it cannot regenerate (the Files tables do not exist in production, so
 * `supabase gen types` would not emit them either).
 *
 * So the cast happens once, here, with a name and a reason, rather than four
 * times at the call sites or as four more errors absorbed into a ceiling.
 * Reads keep the real types: only writes go through this.
 *
 * When the type file is regenerated properly, delete this and the call sites
 * keep working.
 */
const writeDb = supabase as unknown as SupabaseClient

export const filesKeys = {
  all: (orgId: string | null | undefined) => ['files', orgId] as const,
  list: (orgId: string | null | undefined, search: string) => ['files', orgId, 'list', search] as const,
  detail: (orgId: string | null | undefined, fileId: string) => ['files', orgId, 'detail', fileId] as const,
}

/**
 * The repository list.
 *
 * `search` filters on filename, server-side, so a large repository does not
 * have to arrive in the browser to be searched. Archived files are excluded
 * by the policy itself for other members; the explicit `is('deleted_at', null)`
 * here is what excludes your OWN archived files, which the policy
 * deliberately still shows you.
 */
export function useFiles(search = '') {
  const { currentOrgId } = useOrganization()
  const term = search.trim()

  return useQuery({
    queryKey: filesKeys.list(currentOrgId, term),
    enabled: !!currentOrgId,
    staleTime: 30_000,
    queryFn: async (): Promise<FileRecord[]> => {
      let q = supabase
        .from('files')
        .select(FILE_COLUMNS)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })

      if (term) {
        // `%` and `_` are wildcards in ilike; a filename containing them
        // would otherwise match more than the user typed.
        const escaped = term.replace(/[%_]/g, (c) => `\\${c}`)
        q = q.ilike('name', `%${escaped}%`)
      }

      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as unknown as FileRecord[]
    },
  })
}

export function useFile(fileId: string | null | undefined) {
  const { currentOrgId } = useOrganization()

  return useQuery({
    queryKey: filesKeys.detail(currentOrgId, fileId ?? ''),
    enabled: !!currentOrgId && !!fileId,
    queryFn: async (): Promise<FileRecord | null> => {
      const { data, error } = await supabase
        .from('files')
        .select(FILE_COLUMNS)
        .eq('id', fileId as string)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as FileRecord | null
    },
  })
}

export class FileUploadError extends Error {
  /** True when bytes landed but the metadata row did not. */
  readonly orphanedPath?: string
  /** True when we also failed to remove those bytes. */
  readonly cleanupFailed?: boolean

  constructor(message: string, opts?: { orphanedPath?: string; cleanupFailed?: boolean }) {
    super(message)
    this.name = 'FileUploadError'
    this.orphanedPath = opts?.orphanedPath
    this.cleanupFailed = opts?.cleanupFailed
  }
}

/**
 * Upload: bytes first, then metadata, with the bytes removed if the metadata
 * fails.
 *
 * The order matters. Metadata-first would leave a row pointing at an object
 * that does not exist — a file in the list that cannot be opened, which is
 * worse than no file, because the user cannot tell it is broken until they
 * try. Bytes-first fails toward an orphaned object: invisible to the product,
 * costing storage, and cleanable.
 *
 * Three outcomes, all of them reported honestly:
 *   - bytes fail            → nothing was written, plain error
 *   - metadata fails        → bytes removed, error says the upload did not
 *                             complete
 *   - metadata AND cleanup fail → error says so and names the orphan, because
 *                             an orphan nobody is told about is one nobody
 *                             cleans up
 */
export function useUploadFile() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  return useMutation({
    mutationFn: async (file: File): Promise<FileRecord> => {
      if (!currentOrgId) throw new FileUploadError('No organization is selected.')
      if (!user?.id) throw new FileUploadError('You are not signed in.')

      const check = validateUpload(file)
      if (!check.ok) throw new FileUploadError(check.reason)

      // The id is chosen here so the storage path and the row agree, and so
      // two uploads of the same filename cannot collide.
      const fileId = crypto.randomUUID()

      // assetsPath throws rather than building an unscoped path — an object
      // outside the org prefix would be unreadable to everyone, forever.
      const storagePath = assetsPath(currentOrgId, 'files', fileId, file.name)

      const { error: uploadError } = await supabase.storage
        .from(ASSETS_BUCKET)
        .upload(storagePath, file, {
          contentType: file.type || 'application/octet-stream',
          upsert: false,
        })

      if (uploadError) {
        throw new FileUploadError(`Upload failed: ${uploadError.message}`)
      }

      const { data, error: insertError } = await writeDb
        .from('files')
        .insert({
          id: fileId,
          organization_id: currentOrgId,
          name: file.name,
          original_name: file.name,
          storage_bucket: ASSETS_BUCKET,
          storage_path: storagePath,
          mime_type: file.type || null,
          size_bytes: file.size,
          uploaded_by: user.id,
        })
        .select(FILE_COLUMNS)
        .single()

      if (insertError) {
        let cleanupFailed = false
        try {
          const { error: removeError } = await supabase.storage
            .from(ASSETS_BUCKET)
            .remove([storagePath])
          cleanupFailed = !!removeError
        } catch {
          cleanupFailed = true
        }

        throw new FileUploadError(
          cleanupFailed
            ? `Upload did not complete, and the partial file could not be removed. Storage path: ${storagePath}`
            : 'Upload did not complete. Nothing was saved.',
          { orphanedPath: cleanupFailed ? storagePath : undefined, cleanupFailed },
        )
      }

      return data as unknown as FileRecord
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: filesKeys.all(currentOrgId) })
    },
  })
}

export function useRenameFile() {
  const queryClient = useQueryClient()
  const { currentOrgId } = useOrganization()

  return useMutation({
    mutationFn: async ({ fileId, name }: { fileId: string; name: string }) => {
      const next = name.trim()
      if (!next) throw new Error('A file needs a name.')

      const { error } = await writeDb.from('files').update({ name: next }).eq('id', fileId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: filesKeys.all(currentOrgId) })
    },
  })
}

/**
 * Archive. Never removes the storage object — V1 has no physical delete, and
 * the table has no DELETE policy to reach even if it wanted one.
 */
export function useArchiveFile() {
  const queryClient = useQueryClient()
  const { currentOrgId } = useOrganization()

  return useMutation({
    mutationFn: async (fileId: string) => {
      const { error } = await writeDb
        .from('files')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', fileId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: filesKeys.all(currentOrgId) })
    },
  })
}

export function useLinkFile() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  return useMutation({
    mutationFn: async ({
      fileId,
      targetType,
      targetId,
    }: { fileId: string; targetType: 'asset' | 'project'; targetId: string }) => {
      if (!currentOrgId || !user?.id) throw new Error('Not signed in.')

      const { error } = await writeDb.from('file_links').insert({
        organization_id: currentOrgId,
        file_id: fileId,
        target_type: targetType,
        target_id: targetId,
        created_by: user.id,
      })
      // The unique constraint is the duplicate guard; saying "already linked"
      // is friendlier than surfacing a constraint name.
      if (error) {
        throw new Error(
          error.code === '23505' ? 'That is already linked.' : error.message,
        )
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: filesKeys.all(currentOrgId) })
    },
  })
}

export function useUnlinkFile() {
  const queryClient = useQueryClient()
  const { currentOrgId } = useOrganization()

  return useMutation({
    mutationFn: async (linkId: string) => {
      const { error } = await supabase.from('file_links').delete().eq('id', linkId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: filesKeys.all(currentOrgId) })
    },
  })
}

/**
 * A short-lived signed URL for one object.
 *
 * The bucket is private and stays private: there are no public file URLs in
 * this product. A signed URL cannot be persisted anywhere — it expires — so
 * this is called at the moment of preview or download and never stored, which
 * is the mistake the note-attachment extension documents having made.
 */
export function useFileUrl() {
  return useCallback(async (file: Pick<FileRecord, 'storage_bucket' | 'storage_path'>) => {
    const { data, error } = await supabase.storage
      .from(file.storage_bucket || ASSETS_BUCKET)
      .createSignedUrl(file.storage_path, 60 * 60)

    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? 'Could not open that file.')
    }
    return data.signedUrl
  }, [])
}
