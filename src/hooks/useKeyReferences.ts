import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Types
export type ReferenceType = 'note' | 'model' | 'file' | 'external_link' | 'slide'
export type ReferenceCategory = 'model' | 'research' | 'filings' | 'presentations' | 'other'
export type ReferenceImportance = 'critical' | 'high' | 'normal' | 'low'

export interface KeyReference {
  id: string
  asset_id: string
  user_id: string
  reference_type: ReferenceType
  target_id: string | null
  target_table: string | null
  external_url: string | null
  external_provider: string | null
  title: string
  description: string | null
  category: ReferenceCategory | null
  importance: ReferenceImportance
  is_pinned: boolean
  display_order: number | null
  created_at: string
  updated_at: string
  // Joined data
  target_note?: {
    id: string
    title: string
    content: string
    source_type: string
    file_path: string | null
    file_name: string | null
    file_type: string | null
    external_url: string | null
    created_at: string
    updated_at: string
    user?: {
      id: string
      first_name: string | null
      last_name: string | null
    }
  }
  target_model?: {
    id: string
    name: string
    description: string | null
    source_type: string
    file_path: string | null
    file_name: string | null
    file_type: string | null
    external_url: string | null
    external_provider: string | null
    version: number
    created_at: string
    updated_at: string
    user?: {
      id: string
      first_name: string | null
      last_name: string | null
    }
  }
}

export interface CreateReferenceData {
  asset_id: string
  reference_type: ReferenceType
  target_id?: string
  target_table?: string
  external_url?: string
  external_provider?: string
  title: string
  description?: string
  category?: ReferenceCategory
  importance?: ReferenceImportance
}

export interface UpdateReferenceData {
  title?: string
  description?: string
  category?: ReferenceCategory
  importance?: ReferenceImportance
  is_pinned?: boolean
  display_order?: number
}

export function useKeyReferences(assetId: string | undefined) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch user's references for an asset with joined note/model data
  const { data: references = [], isLoading, error, refetch } = useQuery({
    queryKey: ['key-references', assetId, user?.id],
    queryFn: async (): Promise<KeyReference[]> => {
      if (!assetId || !user) return []

      // Fetch base references
      const { data: refs, error: refError } = await supabase
        .from('user_asset_references')
        .select('*')
        .eq('asset_id', assetId)
        .eq('user_id', user.id)
        .order('importance', { ascending: true }) // critical first
        .order('is_pinned', { ascending: false })
        .order('updated_at', { ascending: false })

      if (refError) throw refError
      if (!refs || refs.length === 0) return []

      // Get unique note IDs and model IDs to fetch in batch
      const noteIds = refs
        .filter(r => r.reference_type === 'note' && r.target_id)
        .map(r => r.target_id)
      const modelIds = refs
        .filter(r => r.reference_type === 'model' && r.target_id)
        .map(r => r.target_id)

      // Fetch notes and models in parallel
      const [notesResult, modelsResult] = await Promise.all([
        noteIds.length > 0
          ? supabase
              .from('asset_notes')
              .select(`
                id, title, content, source_type, file_path, file_name, file_type, external_url,
                created_at, updated_at,
                user:users!asset_notes_created_by_fkey(id, first_name, last_name)
              `)
              .in('id', noteIds)
          : Promise.resolve({ data: [] }),
        modelIds.length > 0
          ? supabase
              .from('asset_models')
              .select(`
                id, name, description, source_type, file_path, file_name, file_type,
                external_url, external_provider, version, created_at, updated_at,
                user:users!asset_models_created_by_fkey(id, first_name, last_name)
              `)
              .in('id', modelIds)
          : Promise.resolve({ data: [] })
      ])

      // Create lookup maps
      const notesById = new Map(
        (notesResult.data || []).map(n => [n.id, n])
      )
      const modelsById = new Map(
        (modelsResult.data || []).map(m => [m.id, m])
      )

      // Merge data
      return refs.map(ref => ({
        ...ref,
        target_note: ref.reference_type === 'note' && ref.target_id
          ? notesById.get(ref.target_id)
          : undefined,
        target_model: ref.reference_type === 'model' && ref.target_id
          ? modelsById.get(ref.target_id)
          : undefined
      })) as KeyReference[]
    },
    enabled: !!assetId && !!user
  })

  // Create a new reference
  const createReference = useMutation({
    mutationFn: async (data: CreateReferenceData) => {
      if (!user) throw new Error('Not authenticated')

      const { data: ref, error } = await supabase
        .from('user_asset_references')
        .insert({
          asset_id: data.asset_id,
          user_id: user.id,
          reference_type: data.reference_type,
          target_id: data.target_id || null,
          target_table: data.target_table || null,
          external_url: data.external_url || null,
          external_provider: data.external_provider || null,
          title: data.title,
          description: data.description || null,
          category: data.category || 'other',
          importance: data.importance || 'normal'
        })
        .select()
        .single()

      if (error) throw error
      return ref as KeyReference
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['key-references', assetId, user?.id] })
    }
  })

  // Update a reference
  const updateReference = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateReferenceData }) => {
      const { data: ref, error } = await supabase
        .from('user_asset_references')
        .update(data)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return ref as KeyReference
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['key-references', assetId, user?.id] })
    }
  })

  // Delete a reference
  const deleteReference = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('user_asset_references')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['key-references', assetId, user?.id] })
    }
  })

  // Reorder references (for drag & drop)
  const reorderReferences = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      // Update display_order for each reference
      const updates = orderedIds.map((id, index) => ({
        id,
        display_order: index
      }))

      // Batch update
      for (const update of updates) {
        const { error } = await supabase
          .from('user_asset_references')
          .update({ display_order: update.display_order })
          .eq('id', update.id)

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['key-references', assetId, user?.id] })
    }
  })

  // Toggle pinned status
  const togglePinned = async (id: string) => {
    const ref = references.find(r => r.id === id)
    if (!ref) return

    await updateReference.mutateAsync({
      id,
      data: { is_pinned: !ref.is_pinned }
    })
  }

  // Update importance
  const setImportance = async (id: string, importance: ReferenceImportance) => {
    await updateReference.mutateAsync({
      id,
      data: { importance }
    })
  }

  // Update annotation
  const setAnnotation = async (id: string, description: string) => {
    await updateReference.mutateAsync({
      id,
      data: { description }
    })
  }

  // Filter references by category
  const getReferencesByCategory = (category: ReferenceCategory | 'all') => {
    if (category === 'all') return references
    return references.filter(r => r.category === category)
  }

  // Get references by importance
  const getCriticalReferences = () => references.filter(r => r.importance === 'critical')
  const getHighPriorityReferences = () => references.filter(r => r.importance === 'high' || r.importance === 'critical')

  // Check if a note/model is already in references
  const isReferenced = (targetId: string) => {
    return references.some(r => r.target_id === targetId)
  }

  return {
    references,
    isLoading,
    error,
    refetch,
    // CRUD
    createReference: createReference.mutateAsync,
    updateReference: (id: string, data: UpdateReferenceData) => updateReference.mutateAsync({ id, data }),
    deleteReference: deleteReference.mutateAsync,
    reorderReferences: reorderReferences.mutateAsync,
    // Convenience methods
    togglePinned,
    setImportance,
    setAnnotation,
    getReferencesByCategory,
    getCriticalReferences,
    getHighPriorityReferences,
    isReferenced,
    // Loading states
    isCreating: createReference.isPending,
    isUpdating: updateReference.isPending,
    isDeleting: deleteReference.isPending
  }
}

// Hook to add a note as a key reference
export function useAddNoteToReferences(assetId: string | undefined) {
  const { createReference } = useKeyReferences(assetId)

  const addNote = async (note: {
    id: string
    title: string
    source_type?: string
  }, options?: {
    description?: string
    category?: ReferenceCategory
    importance?: ReferenceImportance
  }) => {
    if (!assetId) throw new Error('No asset ID')

    return createReference({
      asset_id: assetId,
      reference_type: 'note',
      target_id: note.id,
      target_table: 'asset_notes',
      title: note.title,
      description: options?.description,
      category: options?.category || 'research',
      importance: options?.importance || 'normal'
    })
  }

  return { addNote }
}

// Hook to add a model as a key reference
export function useAddModelToReferences(assetId: string | undefined) {
  const { createReference } = useKeyReferences(assetId)

  const addModel = async (model: {
    id: string
    name: string
  }, options?: {
    description?: string
    importance?: ReferenceImportance
  }) => {
    if (!assetId) throw new Error('No asset ID')

    return createReference({
      asset_id: assetId,
      reference_type: 'model',
      target_id: model.id,
      target_table: 'asset_models',
      title: model.name,
      description: options?.description,
      category: 'model',
      importance: options?.importance || 'normal'
    })
  }

  return { addModel }
}

// Hook to add an external link as a key reference
export function useAddExternalLinkToReferences(assetId: string | undefined) {
  const { createReference } = useKeyReferences(assetId)

  const addExternalLink = async (link: {
    url: string
    title: string
    provider?: string
  }, options?: {
    description?: string
    category?: ReferenceCategory
    importance?: ReferenceImportance
  }) => {
    if (!assetId) throw new Error('No asset ID')

    return createReference({
      asset_id: assetId,
      reference_type: 'external_link',
      external_url: link.url,
      external_provider: link.provider,
      title: link.title,
      description: options?.description,
      category: options?.category || 'research',
      importance: options?.importance || 'normal'
    })
  }

  return { addExternalLink }
}
