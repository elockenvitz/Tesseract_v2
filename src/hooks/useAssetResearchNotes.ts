/**
 * Asset Research Library — data layer (Slice 1).
 *
 * The Research Library is a first-class, durable research workspace on an asset.
 * It does NOT introduce a new research model: a "research artifact" is an
 * `asset_notes` row with `note_type = 'research'`, which already gives us named,
 * rich, org-scoped, soft-deletable, reopenable content with server-forced
 * tenancy (triggers set organization_id + created_by). `UniversalNoteEditor`
 * owns creation/editing/persistence/versioning; this hook adds only the two
 * research-specific pieces that the generic note editor does not:
 *
 *   1. `ensureAssetLink(noteId)` — an EXPLICIT `object_links` edge
 *      (asset_note → asset, `references`). The editor syncs links found in a
 *      note's prose; a research artifact should be connected to the asset it is
 *      about even when the prose does not @mention it. Idempotent (upsert on the
 *      links' natural key), so it is safe to call every time a note is opened.
 *
 *   2. `notes` — the research-artifact index for the library header / empty
 *      state / relationship tests. Org isolation is enforced by RLS on
 *      asset_notes (SELECT is `organization_id = current_org_id()`); the query
 *      also pins `asset_id` and `note_type = 'research'`.
 *
 * Governed source documents (files/file_links) live in `useAssetResearchDocuments`
 * below — they are linked to the ASSET, never to an individual note.
 */
import { useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { useUploadFile, useLinkFile, useFileUrl, type FileRecord } from './useFiles'

export const RESEARCH_NOTE_TYPE = 'research' as const

export interface ResearchArtifact {
  id: string
  title: string
  contentPreview: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/**
 * The research artifacts on an asset, plus the explicit asset-link helper.
 * `enabled` is false without an org so the query never runs unscoped.
 */
/**
 * @param enabled Whether to fetch the notes LIST. `createArtifact` works
 *   either way — it needs only the asset, the user and the organization — so
 *   a caller that wants the write seam and not the list (the Process
 *   workbench, which already has the notes via `useAssetWorkspace`) passes
 *   false and adds no query.
 */
export function useAssetResearchNotes(assetId: string | null, enabled = true) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const listKey = ['asset-research-notes', assetId, currentOrgId] as const

  const { data: notes = [], isLoading, error } = useQuery<ResearchArtifact[]>({
    queryKey: listKey,
    enabled: !!assetId && !!currentOrgId && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_notes')
        .select('id, title, content_preview, created_by, created_at, updated_at')
        .eq('asset_id', assetId!)
        .eq('note_type', RESEARCH_NOTE_TYPE)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
      if (error) throw new Error(error.message)
      return ((data ?? []) as any[]).map((r): ResearchArtifact => ({
        id: r.id,
        title: r.title || 'Untitled',
        contentPreview: r.content_preview ?? null,
        createdBy: r.created_by ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }))
    },
  })

  /**
   * Create (if absent) the explicit research-artifact → asset relationship.
   * organization_id is stamped by the object_links trigger; the upsert's
   * natural-key conflict target makes repeat calls no-ops.
   */
  const ensureAssetLink = useCallback(async (noteId: string) => {
    if (!assetId || !user?.id) return
    const { error } = await supabase
      .from('object_links')
      .upsert(
        [{
          source_type: 'asset_note',
          source_id: noteId,
          target_type: 'asset',
          target_id: assetId,
          link_type: 'references',
          is_auto: false,
          created_by: user.id,
        }] as any,
        { onConflict: 'source_type,source_id,target_type,target_id,link_type', ignoreDuplicates: true },
      )
    if (error) {
      // Non-fatal: a missing relationship must not break opening a note.
      console.warn('[useAssetResearchNotes] ensureAssetLink failed:', error.message)
    }
  }, [assetId, user?.id])

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: listKey })
  }, [queryClient, listKey])

  const [isCreating, setIsCreating] = useState(false)

  /**
   * Create a research artifact deliberately (user clicked "New"). Connects it
   * to the asset and refreshes the list, returning the new note id so the
   * caller can open it in the drawer. Nothing here runs on mount, so no empty
   * artifact is ever created implicitly.
   *
   * `organization_id` is stated, not left to the trigger.
   *
   * `set_note_org_id_from_caller` fills it from `users.current_organization_id`
   * when the insert omits it, which is right in the ordinary case and wrong in
   * the one that matters: this hook already knows which organisation the app is
   * showing, and that is not guaranteed to be the column's value at the moment
   * of the write. If they ever disagree the note lands in the other workspace,
   * silently — there is no error, and the row simply does not come back. The
   * trigger keeps `IF NEW.organization_id IS NOT NULL THEN RETURN NEW`, so
   * saying it here wins and the fallback stays for callers that cannot.
   *
   * It is also the client-side filter the org-scope guard is asking for. RLS on
   * `asset_notes` is not organisation-aware, so for this table the explicit
   * value is the only thing that separates workspaces.
   */
  const createArtifact = useCallback(async (): Promise<string | null> => {
    if (!assetId || !user?.id || !currentOrgId) return null
    setIsCreating(true)
    try {
      const { data, error } = await supabase
        .from('asset_notes')
        .insert([{
          asset_id: assetId,
          organization_id: currentOrgId,
          title: 'Untitled',
          content: '',
          note_type: RESEARCH_NOTE_TYPE,
          created_by: user.id,
          updated_by: user.id,
        }] as any)
        .select('id')
        .single()
      if (error) throw new Error(error.message)
      const id = (data as any).id as string
      await ensureAssetLink(id)
      await queryClient.invalidateQueries({ queryKey: listKey })
      return id
    } finally {
      setIsCreating(false)
    }
  }, [assetId, user?.id, currentOrgId, ensureAssetLink, queryClient, listKey])

  return {
    notes,
    isLoading,
    error: (error as Error) ?? null,
    ensureAssetLink,
    createArtifact,
    isCreating,
    refetch,
    ready: !!assetId && !!currentOrgId,
  }
}

export interface ResearchDocument {
  linkId: string
  file: FileRecord
  linkedAt: string
}

/**
 * Governed source documents linked to the ASSET (not to a note).
 *
 * Reuses the files repository: upload → `files` (org-first, signed-URL only),
 * link → `file_links` (target_type 'asset'). file_links.target_type is
 * CHECK-limited to asset|project, so note-level attachment is intentionally out
 * of scope for this slice.
 */
export function useAssetResearchDocuments(assetId: string | null) {
  const { currentOrgId } = useOrganization()
  const uploadFile = useUploadFile()
  const linkFile = useLinkFile()
  const getUrl = useFileUrl()
  const queryClient = useQueryClient()

  const listKey = ['asset-research-documents', assetId, currentOrgId] as const

  const { data: documents = [], isLoading, error } = useQuery<ResearchDocument[]>({
    queryKey: listKey,
    enabled: !!assetId && !!currentOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('file_links')
        .select('id, created_at, files:file_id(*)')
        .eq('target_type', 'asset')
        .eq('target_id', assetId!)
        .order('created_at', { ascending: false })
      if (error) throw new Error(error.message)
      return ((data ?? []) as any[])
        .filter(r => r.files && !r.files.deleted_at)
        .map((r): ResearchDocument => ({ linkId: r.id, file: r.files as FileRecord, linkedAt: r.created_at }))
    },
  })

  const uploadAndAttach = useCallback(async (file: File) => {
    const record = await uploadFile.mutateAsync(file)
    await linkFile.mutateAsync({ fileId: record.id, targetType: 'asset', targetId: assetId! })
    queryClient.invalidateQueries({ queryKey: listKey })
    return record
  }, [uploadFile, linkFile, assetId, queryClient, listKey])

  return {
    documents,
    isLoading,
    error: (error as Error) ?? null,
    uploadAndAttach,
    getUrl,
    isAttaching: uploadFile.isPending || linkFile.isPending,
    ready: !!assetId && !!currentOrgId,
  }
}
