import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export type ModelSourceType = 'uploaded' | 'external_link'
export type ExternalProvider = 'google_sheets' | 'airtable' | 'excel_online' | 'smartsheet' | 'other'

export interface AssetModel {
  id: string
  asset_id: string
  name: string
  description: string | null
  source_type: ModelSourceType
  file_path: string | null
  file_name: string | null
  file_size: number | null
  file_type: string | null
  external_url: string | null
  external_provider: ExternalProvider | null
  version: number
  is_shared: boolean
  created_by: string
  created_at: string
  updated_at: string
  is_deleted: boolean
  // Joined user data
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
    email: string
  }
}

interface CreateModelData {
  asset_id: string
  name: string
  description?: string
  source_type: ModelSourceType
  file_path?: string
  file_name?: string
  file_size?: number
  file_type?: string
  external_url?: string
  external_provider?: ExternalProvider
  is_shared?: boolean
}

interface UpdateModelData {
  name?: string
  description?: string
  is_shared?: boolean
  version?: number
  external_url?: string
}

export function useAssetModels(assetId: string | undefined) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch all models for an asset
  const { data: models = [], isLoading, error, refetch } = useQuery({
    queryKey: ['asset-models', assetId],
    queryFn: async () => {
      if (!assetId) return []

      const { data, error } = await supabase
        .from('asset_models')
        .select(`
          *,
          user:users!asset_models_created_by_fkey(id, first_name, last_name, email)
        `)
        .eq('asset_id', assetId)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return (data || []) as AssetModel[]
    },
    enabled: !!assetId
  })

  // Create model (for external links - no file upload)
  const createModel = useMutation({
    mutationFn: async (data: CreateModelData) => {
      if (!user) throw new Error('Not authenticated')

      const { data: model, error } = await supabase
        .from('asset_models')
        .insert({
          asset_id: data.asset_id,
          name: data.name,
          description: data.description || null,
          source_type: data.source_type,
          file_path: data.file_path || null,
          file_name: data.file_name || null,
          file_size: data.file_size || null,
          file_type: data.file_type || null,
          external_url: data.external_url || null,
          external_provider: data.external_provider || null,
          is_shared: data.is_shared ?? false,
          created_by: user.id
        })
        .select(`
          *,
          user:users!asset_models_created_by_fkey(id, first_name, last_name, email)
        `)
        .single()

      if (error) throw error
      return model as AssetModel
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-models', assetId] })
    }
  })

  // Upload file and create model
  const uploadModel = useMutation({
    mutationFn: async ({
      file,
      name,
      description,
      is_shared
    }: {
      file: File
      name: string
      description?: string
      is_shared?: boolean
    }) => {
      if (!user || !assetId) throw new Error('Not authenticated or no asset')

      // Generate unique file path
      const randomId = Math.random().toString(36).substring(2, 10)
      const extension = file.name.split('.').pop() || 'bin'
      const filePath = `models/${assetId}/${Date.now()}_${randomId}.${extension}`

      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('assets')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // Create model record
      const { data: model, error } = await supabase
        .from('asset_models')
        .insert({
          asset_id: assetId,
          name,
          description: description || null,
          source_type: 'uploaded',
          file_path: filePath,
          file_name: file.name,
          file_size: file.size,
          file_type: file.type,
          is_shared: is_shared ?? false,
          created_by: user.id
        })
        .select(`
          *,
          user:users!asset_models_created_by_fkey(id, first_name, last_name, email)
        `)
        .single()

      if (error) {
        // Clean up uploaded file if db insert fails
        await supabase.storage.from('assets').remove([filePath])
        throw error
      }

      return model as AssetModel
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-models', assetId] })
    }
  })

  // Update model
  const updateModel = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateModelData }) => {
      const { data: model, error } = await supabase
        .from('asset_models')
        .update(data)
        .eq('id', id)
        .select(`
          *,
          user:users!asset_models_created_by_fkey(id, first_name, last_name, email)
        `)
        .single()

      if (error) throw error
      return model as AssetModel
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-models', assetId] })
    }
  })

  // Soft delete model
  const deleteModel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('asset_models')
        .update({ is_deleted: true })
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-models', assetId] })
    }
  })

  // Get download URL for uploaded model
  const getDownloadUrl = async (model: AssetModel): Promise<string | null> => {
    if (model.source_type !== 'uploaded' || !model.file_path) return null

    const { data } = await supabase.storage
      .from('assets')
      .createSignedUrl(model.file_path, 3600) // 1 hour expiry

    return data?.signedUrl || null
  }

  // Increment version
  const incrementVersion = useMutation({
    mutationFn: async (id: string) => {
      // Get current version
      const { data: current, error: fetchError } = await supabase
        .from('asset_models')
        .select('version')
        .eq('id', id)
        .single()

      if (fetchError) throw fetchError

      const { data: model, error } = await supabase
        .from('asset_models')
        .update({ version: (current?.version || 1) + 1 })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return model as AssetModel
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-models', assetId] })
    }
  })

  return {
    models,
    isLoading,
    error,
    refetch,
    createModel: createModel.mutateAsync,
    uploadModel: uploadModel.mutateAsync,
    updateModel: (id: string, data: UpdateModelData) => updateModel.mutateAsync({ id, data }),
    deleteModel: deleteModel.mutateAsync,
    getDownloadUrl,
    incrementVersion: incrementVersion.mutateAsync,
    isCreating: createModel.isPending,
    isUploading: uploadModel.isPending,
    isUpdating: updateModel.isPending,
    isDeleting: deleteModel.isPending
  }
}
