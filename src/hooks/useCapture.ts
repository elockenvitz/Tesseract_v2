import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type {
  Capture,
  CaptureInsert,
  CaptureType,
  CaptureEntityType,
  CaptureSourceType,
  EntitySnapshot
} from '../types/capture'

interface CreateEntityCaptureParams {
  sourceType: CaptureSourceType
  sourceId: string
  entityType: CaptureEntityType
  entityId: string
  entityDisplay: string
  captureMode: 'live' | 'static'
  snapshotData?: Record<string, any>
  displayTitle?: string
  contextType?: string
  contextId?: string
}

interface CreateScreenshotCaptureParams {
  sourceType: CaptureSourceType
  sourceId: string
  screenshotPath: string
  sourceUrl?: string
  title?: string
  notes?: string
  tags?: string[]
  contextType?: string
  contextId?: string
}

interface CreateEmbedCaptureParams {
  sourceType: CaptureSourceType
  sourceId: string
  url: string
  title?: string
  description?: string
  imageUrl?: string
  faviconUrl?: string
  metadata?: Record<string, any>
  contextType?: string
  contextId?: string
}

export function useCapture() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Create entity capture (live or static)
  const createEntityCapture = useMutation({
    mutationFn: async (params: CreateEntityCaptureParams): Promise<Capture> => {
      if (!user) throw new Error('User not authenticated')

      const captureData: CaptureInsert = {
        source_type: params.sourceType,
        source_id: params.sourceId,
        capture_type: params.captureMode === 'live' ? 'entity_live' : 'entity_static',
        entity_type: params.entityType,
        entity_id: params.entityId,
        entity_display: params.entityDisplay,
        display_title: params.displayTitle || params.entityDisplay,
        created_by: user.id
      }

      // Add snapshot data for static captures
      if (params.captureMode === 'static' && params.snapshotData) {
        captureData.snapshot_data = params.snapshotData
        captureData.snapshot_at = new Date().toISOString()
      }

      const { data, error } = await supabase
        .from('captures')
        .insert(captureData)
        .select()
        .single()

      if (error) throw error
      return data as Capture
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures'] })
    }
  })

  // Create screenshot capture
  const createScreenshotCapture = useMutation({
    mutationFn: async (params: CreateScreenshotCaptureParams): Promise<Capture> => {
      if (!user) throw new Error('User not authenticated')

      const captureData: CaptureInsert = {
        source_type: params.sourceType,
        source_id: params.sourceId,
        capture_type: 'screenshot',
        screenshot_storage_path: params.screenshotPath,
        screenshot_source_url: params.sourceUrl,
        screenshot_notes: params.notes,
        screenshot_tags: params.tags,
        display_title: params.title || 'Screenshot',
        created_by: user.id
      }

      const { data, error } = await supabase
        .from('captures')
        .insert(captureData)
        .select()
        .single()

      if (error) throw error
      return data as Capture
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures'] })
    }
  })

  // Create URL embed capture
  const createEmbedCapture = useMutation({
    mutationFn: async (params: CreateEmbedCaptureParams): Promise<Capture> => {
      if (!user) throw new Error('User not authenticated')

      const captureData: CaptureInsert = {
        source_type: params.sourceType,
        source_id: params.sourceId,
        capture_type: 'embed',
        external_url: params.url,
        external_title: params.title,
        external_description: params.description,
        external_image_url: params.imageUrl,
        external_favicon_url: params.faviconUrl,
        external_metadata: params.metadata,
        display_title: params.title || new URL(params.url).hostname,
        created_by: user.id
      }

      const { data, error } = await supabase
        .from('captures')
        .insert(captureData)
        .select()
        .single()

      if (error) throw error
      return data as Capture
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures'] })
    }
  })

  // Update capture
  const updateCapture = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<Capture> }): Promise<Capture> => {
      if (!user) throw new Error('User not authenticated')

      const { data, error } = await supabase
        .from('captures')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as Capture
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures'] })
    }
  })

  // Delete capture
  const deleteCapture = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      if (!user) throw new Error('User not authenticated')

      // First get the capture to check for screenshot path
      const { data: capture } = await supabase
        .from('captures')
        .select('screenshot_storage_path')
        .eq('id', id)
        .single()

      // Delete screenshot from storage if exists
      if (capture?.screenshot_storage_path) {
        await supabase.storage
          .from('captures')
          .remove([capture.screenshot_storage_path])
      }

      // Delete the capture record
      const { error } = await supabase
        .from('captures')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captures'] })
    }
  })

  // Upload screenshot to storage
  const uploadScreenshot = async (blob: Blob, fileName?: string): Promise<string> => {
    if (!user) throw new Error('User not authenticated')

    const timestamp = Date.now()
    const randomId = Math.random().toString(36).substring(2, 8)
    const extension = blob.type === 'image/png' ? 'png' : 'jpg'
    const path = `${user.id}/${timestamp}_${randomId}.${extension}`

    const { error } = await supabase.storage
      .from('captures')
      .upload(path, blob, {
        contentType: blob.type,
        cacheControl: '3600'
      })

    if (error) throw error
    return path
  }

  // Get public URL for screenshot
  const getScreenshotUrl = (path: string): string => {
    const { data } = supabase.storage
      .from('captures')
      .getPublicUrl(path)
    return data.publicUrl
  }

  return {
    createEntityCapture: createEntityCapture.mutateAsync,
    createScreenshotCapture: createScreenshotCapture.mutateAsync,
    createEmbedCapture: createEmbedCapture.mutateAsync,
    updateCapture: updateCapture.mutateAsync,
    deleteCapture: deleteCapture.mutateAsync,
    uploadScreenshot,
    getScreenshotUrl,
    isCreating: createEntityCapture.isPending || createScreenshotCapture.isPending || createEmbedCapture.isPending,
    isUpdating: updateCapture.isPending,
    isDeleting: deleteCapture.isPending
  }
}

// Fetch entity data for live preview
export async function fetchEntityData(
  entityType: CaptureEntityType,
  entityId: string
): Promise<Record<string, any> | null> {
  const queries: Record<CaptureEntityType, () => Promise<any>> = {
    asset: async () => {
      const { data } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, market_cap, priority, process_stage, quick_note')
        .eq('id', entityId)
        .single()
      return data
    },
    portfolio: async () => {
      const { data } = await supabase
        .from('portfolios')
        .select('id, name, description')
        .eq('id', entityId)
        .single()
      return data
    },
    theme: async () => {
      const { data } = await supabase
        .from('themes')
        .select('id, name, description')
        .eq('id', entityId)
        .single()
      return data
    },
    note: async () => {
      const { data } = await supabase
        .from('asset_notes')
        .select('id, title, note_type, content_preview')
        .eq('id', entityId)
        .single()
      return data
    },
    list: async () => {
      const { data } = await supabase
        .from('asset_lists')
        .select('id, name, description')
        .eq('id', entityId)
        .single()
      return data
    },
    workflow: async () => {
      const { data } = await supabase
        .from('workflows')
        .select('id, name, description, status')
        .eq('id', entityId)
        .single()
      return data
    },
    project: async () => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, description, status')
        .eq('id', entityId)
        .single()
      return data
    },
    chart: async () => {
      // Charts are typically rendered dynamically, return minimal data
      return { id: entityId, type: 'chart' }
    },
    price_target: async () => {
      const { data } = await supabase
        .from('analyst_price_targets')
        .select('id, asset_id, bull_target, base_target, bear_target, timeframe')
        .eq('id', entityId)
        .single()
      return data
    },
    workflow_item: async () => {
      const { data } = await supabase
        .from('asset_workflow_checklist')
        .select('id, title, description, is_completed')
        .eq('id', entityId)
        .single()
      return data
    }
  }

  try {
    const query = queries[entityType]
    if (!query) return null
    return await query()
  } catch (error) {
    console.error(`Failed to fetch ${entityType} data:`, error)
    return null
  }
}
