import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type NoteType = 'asset' | 'portfolio' | 'theme' | 'custom'

export interface NoteVersion {
  id: string
  note_id: string
  note_type: NoteType
  version_number: number
  title: string
  content: string | null
  note_type_category: string | null
  created_by: string | null
  created_at: string
  version_reason: string
  // Joined user info
  user?: {
    id: string
    email: string
    first_name: string | null
    last_name: string | null
  }
}

interface CreateVersionParams {
  noteId: string
  noteType: NoteType
  title: string
  content: string
  noteTypeCategory?: string
  reason?: 'auto' | 'manual' | 'restore'
}

interface RestoreVersionParams {
  versionId: string
  noteId: string
  noteType: NoteType
}

export function useNoteVersions(noteId: string | undefined, noteType: NoteType) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch versions for a note (metadata only - no content for fast loading)
  const { data: versions = [], isLoading, error } = useQuery({
    queryKey: ['note-versions', noteId, noteType],
    queryFn: async (): Promise<NoteVersion[]> => {
      if (!noteId) return []

      const { data, error } = await supabase
        .from('note_versions')
        .select(`
          id,
          note_id,
          note_type,
          version_number,
          title,
          note_type_category,
          created_by,
          created_at,
          version_reason,
          user:users!note_versions_created_by_fkey (
            id,
            email,
            first_name,
            last_name
          )
        `)
        .eq('note_id', noteId)
        .eq('note_type', noteType)
        .order('version_number', { ascending: false })

      if (error) throw error
      // Add null content placeholder for type safety
      return (data || []).map(v => ({ ...v, content: null }))
    },
    enabled: !!noteId
  })

  // Fetch content for a specific version (lazy loading)
  const fetchVersionContent = async (versionId: string): Promise<string | null> => {
    const { data, error } = await supabase
      .from('note_versions')
      .select('content')
      .eq('id', versionId)
      .single()

    if (error) throw error
    return data?.content || null
  }

  // Create a new version
  const createVersion = useMutation({
    mutationFn: async (params: CreateVersionParams) => {
      if (!user) throw new Error('User not authenticated')

      // Get next version number
      const { data: existingVersions } = await supabase
        .from('note_versions')
        .select('version_number')
        .eq('note_id', params.noteId)
        .eq('note_type', params.noteType)
        .order('version_number', { ascending: false })
        .limit(1)

      const nextVersionNumber = (existingVersions?.[0]?.version_number || 0) + 1

      const { data, error } = await supabase
        .from('note_versions')
        .insert({
          note_id: params.noteId,
          note_type: params.noteType,
          version_number: nextVersionNumber,
          title: params.title,
          content: params.content,
          note_type_category: params.noteTypeCategory,
          created_by: user.id,
          version_reason: params.reason || 'auto'
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['note-versions', noteId, noteType] })
    }
  })

  // Restore a specific version
  const restoreVersion = useMutation({
    mutationFn: async (params: RestoreVersionParams) => {
      if (!user) throw new Error('User not authenticated')

      // Get the version to restore
      const { data: version, error: versionError } = await supabase
        .from('note_versions')
        .select('*')
        .eq('id', params.versionId)
        .single()

      if (versionError) throw versionError
      if (!version) throw new Error('Version not found')

      // Get current note content to create a backup version first
      let tableName: string
      switch (params.noteType) {
        case 'asset':
          tableName = 'asset_notes'
          break
        case 'portfolio':
          tableName = 'portfolio_notes'
          break
        case 'theme':
          tableName = 'theme_notes'
          break
        case 'custom':
          tableName = 'custom_notebook_notes'
          break
        default:
          throw new Error(`Unknown note type: ${params.noteType}`)
      }

      // Get current note state
      const { data: currentNote, error: noteError } = await supabase
        .from(tableName)
        .select('*')
        .eq('id', params.noteId)
        .single()

      if (noteError) throw noteError
      if (!currentNote) throw new Error('Note not found')

      // Create a backup version of current state before restoring
      await createVersion.mutateAsync({
        noteId: params.noteId,
        noteType: params.noteType,
        title: currentNote.title,
        content: currentNote.content,
        noteTypeCategory: currentNote.note_type,
        reason: 'restore'
      })

      // Update the note with the restored version
      const { error: updateError } = await supabase
        .from(tableName)
        .update({
          title: version.title,
          content: version.content,
          note_type: version.note_type_category,
          updated_by: user.id,
          updated_at: new Date().toISOString()
        })
        .eq('id', params.noteId)

      if (updateError) throw updateError

      return { restoredVersion: version, backupCreated: true }
    },
    onSuccess: (_, params) => {
      // Invalidate both versions and the note itself
      queryClient.invalidateQueries({ queryKey: ['note-versions', params.noteId, params.noteType] })

      // Invalidate the notes query based on type
      switch (params.noteType) {
        case 'asset':
          queryClient.invalidateQueries({ queryKey: ['asset-notes'] })
          break
        case 'portfolio':
          queryClient.invalidateQueries({ queryKey: ['portfolio-notes'] })
          break
        case 'theme':
          queryClient.invalidateQueries({ queryKey: ['theme-notes'] })
          break
      }
    }
  })

  // Get formatted user name for a version
  const getVersionAuthor = (version: NoteVersion): string => {
    if (version.user?.first_name && version.user?.last_name) {
      return `${version.user.first_name} ${version.user.last_name}`
    }
    if (version.user?.email) {
      return version.user.email.split('@')[0]
    }
    return 'Unknown'
  }

  return {
    versions,
    isLoading,
    error,
    createVersion: createVersion.mutate,
    createVersionAsync: createVersion.mutateAsync,
    isCreating: createVersion.isPending,
    restoreVersion: restoreVersion.mutate,
    restoreVersionAsync: restoreVersion.mutateAsync,
    isRestoring: restoreVersion.isPending,
    getVersionAuthor,
    fetchVersionContent
  }
}

// Hook for automatic version creation on significant edits
export function useAutoVersioning(
  noteId: string | undefined,
  noteType: NoteType,
  currentTitle: string,
  currentContent: string,
  noteTypeCategory?: string
) {
  const { createVersionAsync } = useNoteVersions(noteId, noteType)
  const lastVersionedContent = { current: '' }
  const lastVersionTime = { current: 0 }

  // Create a version if significant changes detected
  // Called periodically or before closing
  const createVersionIfNeeded = async (force: boolean = false): Promise<boolean> => {
    if (!noteId || !currentContent) return false

    const now = Date.now()
    const timeSinceLastVersion = now - lastVersionTime.current
    const contentChanged = currentContent !== lastVersionedContent.current

    // Create version if:
    // 1. Forced (e.g., before closing)
    // 2. Content has changed significantly AND enough time has passed (5 min)
    const significantChange = contentChanged && (
      Math.abs(currentContent.length - lastVersionedContent.current.length) > 100 ||
      force
    )

    if (significantChange && (force || timeSinceLastVersion > 5 * 60 * 1000)) {
      try {
        await createVersionAsync({
          noteId,
          noteType,
          title: currentTitle,
          content: currentContent,
          noteTypeCategory,
          reason: force ? 'manual' : 'auto'
        })
        lastVersionedContent.current = currentContent
        lastVersionTime.current = now
        return true
      } catch (error) {
        console.error('Failed to create note version:', error)
        return false
      }
    }

    return false
  }

  return { createVersionIfNeeded }
}
