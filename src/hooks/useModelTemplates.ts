import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export interface FieldMapping {
  field: string // tesseract field name: price_target, rating, eps_fy25, etc.
  cell: string // Excel cell reference: Summary!B5
  type: 'currency' | 'number' | 'percent' | 'text' | 'date' | 'multiple'
  label?: string // Display label
  required?: boolean
  isPreset?: boolean // Whether this is a preset field (locked from editing)
  // For estimates
  metricKey?: string // eps, revenue, ebitda
  periodType?: 'annual' | 'quarterly'
  fiscalYear?: number
  fiscalQuarter?: number
}

// Dynamic field mapping - finds data by row/column labels instead of fixed cells
export interface DynamicFieldMapping {
  id: string // Unique ID for this mapping
  name: string // Display name: "EPS by Year", "Revenue Quarterly"

  // Field pattern with placeholders: "eps_fy{year}", "revenue_q{quarter}_{year}"
  field_pattern: string

  // How to find the data row
  row_match: {
    label_contains?: string   // Row label contains this text (e.g., "EPS")
    label_equals?: string     // Row label exactly equals this
    label_column: string      // Which column has row labels (e.g., "A")
    sheet?: string            // Which sheet to look in
  }

  // How to find data columns (scans headers for year/quarter patterns)
  column_match: {
    header_row: number        // Row number containing headers (1-indexed)
    year_pattern?: string     // Regex to extract year, e.g., "FY(\\d{4})" or "(20\\d{2})"
    quarter_pattern?: string  // Regex to extract quarter+year, e.g., "Q([1-4])\\s*(\\d{4})"
    start_column?: string     // Start scanning from this column (e.g., "B")
    end_column?: string       // Stop scanning at this column (e.g., "Z")
  }

  type: 'currency' | 'number' | 'percent' | 'text' | 'date' | 'multiple'

  // Optional: limit which years/quarters to extract
  year_filter?: {
    min_year?: number         // Only extract years >= this
    max_year?: number         // Only extract years <= this
    relative_to_current?: number // e.g., -2 to +3 means 2 years back to 3 forward
  }
}

export interface SnapshotRange {
  name: string // "Summary", "Model"
  range: string // "Summary!A1:H30"
}

export interface DetectionRules {
  filename_patterns?: string[] // ["*OnePager*", "*1P*"]
  sheet_names?: string[] // ["Summary", "Model"]
  cell_checks?: Array<{
    cell: string
    contains?: string
    equals?: string
  }>
}

export interface ModelTemplate {
  id: string
  name: string
  description: string | null
  field_mappings: FieldMapping[]
  dynamic_mappings?: DynamicFieldMapping[] // Dynamic label-based mappings
  snapshot_ranges: SnapshotRange[]
  detection_rules: DetectionRules
  is_firm_template: boolean
  organization_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  // Base template file (optional Excel file to use as starting point)
  base_template_path?: string | null
  base_template_filename?: string | null
  base_template_size?: number | null
  base_template_uploaded_at?: string | null
  creator?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

export interface ModelFile {
  id: string
  asset_id: string
  user_id: string
  filename: string
  storage_path: string
  file_size: number | null
  mime_type: string | null
  template_id: string | null
  extracted_data: Record<string, any> | null
  snapshot_images: Array<{ name: string; url: string }> | null
  sync_status: 'pending' | 'processing' | 'synced' | 'error'
  sync_error: string | null
  synced_at: string | null
  version: number
  is_latest: boolean
  previous_version_id: string | null
  created_at: string
  updated_at: string
  template?: ModelTemplate
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

const getFullName = (user: { first_name?: string | null; last_name?: string | null } | null) => {
  if (!user) return 'Unknown User'
  const parts = [user.first_name, user.last_name].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : 'Unknown User'
}

// ============================================================================
// Model Templates Hook
// ============================================================================

export function useModelTemplates() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const {
    data: templates,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['model-templates', user?.id],
    queryFn: async () => {
      if (!user) return []

      // Get templates user created
      const { data: ownTemplates, error: ownError } = await supabase
        .from('model_templates')
        .select(`
          *,
          creator:users!model_templates_created_by_fkey(id, first_name, last_name)
        `)
        .eq('created_by', user.id)
        .order('name')

      if (ownError) throw ownError

      // Get user's org chart node memberships
      const { data: userNodeMemberships } = await supabase
        .from('org_chart_node_members')
        .select('node_id')
        .eq('user_id', user.id)

      const userNodeIds = (userNodeMemberships || []).map(m => m.node_id)

      // Get templates shared with user (via collaboration entries)
      // Check: direct user, org-wide (null/null/null), or via org node membership
      let collabQuery = supabase
        .from('model_template_collaborations')
        .select(`
          template:model_templates!model_template_collaborations_template_id_fkey(
            *,
            creator:users!model_templates_created_by_fkey(id, first_name, last_name)
          )
        `)

      // Build OR conditions
      const orConditions = [
        `user_id.eq.${user.id}`,
        'and(user_id.is.null,team_id.is.null,org_node_id.is.null)' // org-wide
      ]

      // Add org node conditions if user has memberships
      if (userNodeIds.length > 0) {
        orConditions.push(`org_node_id.in.(${userNodeIds.join(',')})`)
      }

      const { data: sharedCollabs, error: collabError } = await collabQuery.or(orConditions.join(','))

      if (collabError) throw collabError

      // Also get legacy firm templates (for backwards compatibility)
      const { data: firmTemplatesData, error: firmError } = await supabase
        .from('model_templates')
        .select(`
          *,
          creator:users!model_templates_created_by_fkey(id, first_name, last_name)
        `)
        .eq('is_firm_template', true)
        .neq('created_by', user.id)
        .order('name')

      if (firmError) throw firmError

      // Combine and dedupe
      const sharedTemplatesFromCollabs = (sharedCollabs || [])
        .map(c => c.template)
        .filter((t): t is ModelTemplate => t !== null && t.created_by !== user.id)

      const allShared = [...sharedTemplatesFromCollabs, ...(firmTemplatesData || [])]
      const uniqueShared = allShared.filter((t, i, arr) =>
        arr.findIndex(x => x.id === t.id) === i
      )

      return [...(ownTemplates || []), ...uniqueShared] as ModelTemplate[]
    },
    enabled: !!user,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000
  })

  const myTemplates = templates?.filter(t => t.created_by === user?.id) || []
  const sharedTemplates = templates?.filter(t => t.created_by !== user?.id) || []

  // Create a new template
  const createTemplate = useMutation({
    mutationFn: async ({
      name,
      description,
      fieldMappings,
      dynamicMappings,
      snapshotRanges,
      detectionRules,
      isFirmTemplate = false
    }: {
      name: string
      description?: string
      fieldMappings: FieldMapping[]
      dynamicMappings?: DynamicFieldMapping[]
      snapshotRanges?: SnapshotRange[]
      detectionRules?: DetectionRules
      isFirmTemplate?: boolean
    }) => {
      if (!user) throw new Error('Not authenticated')

      // Get user's organization for firm templates
      let organizationId = null
      if (isFirmTemplate) {
        const { data: membership } = await supabase
          .from('organization_memberships')
          .select('organization_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .single()

        organizationId = membership?.organization_id
      }

      const { data, error } = await supabase
        .from('model_templates')
        .insert({
          name,
          description: description || null,
          field_mappings: fieldMappings,
          dynamic_mappings: dynamicMappings || null,
          snapshot_ranges: snapshotRanges || [],
          detection_rules: detectionRules || {},
          is_firm_template: isFirmTemplate,
          organization_id: organizationId,
          created_by: user.id
        })
        .select()
        .single()

      if (error) throw error
      return data as ModelTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-templates'] })
    }
  })

  // Update a template
  const updateTemplate = useMutation({
    mutationFn: async ({
      id,
      name,
      description,
      fieldMappings,
      dynamicMappings,
      snapshotRanges,
      detectionRules,
      isFirmTemplate
    }: {
      id: string
      name?: string
      description?: string
      fieldMappings?: FieldMapping[]
      dynamicMappings?: DynamicFieldMapping[]
      snapshotRanges?: SnapshotRange[]
      detectionRules?: DetectionRules
      isFirmTemplate?: boolean
    }) => {
      const updateData: any = { updated_at: new Date().toISOString() }
      if (name !== undefined) updateData.name = name
      if (description !== undefined) updateData.description = description
      if (fieldMappings !== undefined) updateData.field_mappings = fieldMappings
      if (dynamicMappings !== undefined) updateData.dynamic_mappings = dynamicMappings
      if (snapshotRanges !== undefined) updateData.snapshot_ranges = snapshotRanges
      if (detectionRules !== undefined) updateData.detection_rules = detectionRules
      if (isFirmTemplate !== undefined) updateData.is_firm_template = isFirmTemplate

      const { data, error } = await supabase
        .from('model_templates')
        .update(updateData)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data as ModelTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-templates'] })
    }
  })

  // Delete a template
  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('model_templates')
        .delete()
        .eq('id', id)
        .eq('created_by', user?.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-templates'] })
    }
  })

  // Duplicate a template
  const duplicateTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      if (!user) throw new Error('Not authenticated')

      // Fetch the template directly from database to ensure we have latest data
      const { data: template, error: fetchError } = await supabase
        .from('model_templates')
        .select('*')
        .eq('id', templateId)
        .single()

      if (fetchError || !template) throw new Error('Template not found')

      // First, create the new template record to get its ID
      const { data: newTemplate, error: insertError } = await supabase
        .from('model_templates')
        .insert({
          name: `${template.name} (Copy)`,
          description: template.description,
          field_mappings: template.field_mappings,
          dynamic_mappings: template.dynamic_mappings || null,
          snapshot_ranges: template.snapshot_ranges,
          detection_rules: template.detection_rules,
          is_firm_template: false,
          organization_id: null,
          created_by: user.id
        })
        .select()
        .single()

      if (insertError) throw insertError

      // If the original template has a base template file, copy it
      console.log('[duplicateTemplate] Original template base_template_path:', template.base_template_path, 'filename:', template.base_template_filename)
      if (template.base_template_path && template.base_template_filename) {
        try {
          // Generate new path for the copy
          const randomId = Math.random().toString(36).substring(2, 10)
          const extension = template.base_template_filename.split('.').pop() || 'xlsx'
          const newStoragePath = `model-templates/${newTemplate.id}/${Date.now()}_${randomId}.${extension}`

          console.log('[duplicateTemplate] Copying file from:', template.base_template_path, 'to:', newStoragePath)

          // Use Supabase's copy method to copy the file server-side
          // Note: Files are stored in the 'assets' bucket
          const { error: copyError } = await supabase.storage
            .from('assets')
            .copy(template.base_template_path, newStoragePath)

          if (copyError) {
            console.error('Failed to copy base template file:', copyError)
          } else {
            console.log('[duplicateTemplate] File copied successfully to:', newStoragePath)
            // Update the new template with the file path and return updated data
            const { data: updatedTemplate, error: updateError } = await supabase
              .from('model_templates')
              .update({
                base_template_path: newStoragePath,
                base_template_filename: template.base_template_filename
              })
              .eq('id', newTemplate.id)
              .select()
              .single()

            if (updateError) {
              console.error('Failed to update template with base template path:', updateError)
            } else if (updatedTemplate) {
              console.log('[duplicateTemplate] Template updated with base template path:', updatedTemplate.base_template_path)
              return updatedTemplate as ModelTemplate
            }
          }
        } catch (err) {
          console.error('Error copying base template file:', err)
          // Don't throw - the template was still created, just without the base file
        }
      }

      return newTemplate as ModelTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-templates'] })
    }
  })

  // Upload a base template file for a template
  const uploadBaseTemplate = useMutation({
    mutationFn: async ({
      templateId,
      file
    }: {
      templateId: string
      file: File
    }) => {
      if (!user) throw new Error('Not authenticated')

      // Generate a random ID like other working uploads in the codebase
      const randomId = Math.random().toString(36).substring(2, 10)
      const extension = file.name.split('.').pop() || 'xlsx'

      // Use same pattern as other working uploads (models, documents, notes)
      const storagePath = `model-templates/${templateId}/${Date.now()}_${randomId}.${extension}`

      console.log('Uploading base template to:', storagePath, 'File:', file.name, 'Size:', file.size, 'Type:', file.type)

      // Get auth session for manual upload
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('No auth session')

      // Use fetch API directly - the Supabase JS client sometimes has issues with file uploads
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
      const uploadUrl = `${supabaseUrl}/storage/v1/object/assets/${storagePath}`

      console.log('Upload URL:', uploadUrl)

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'x-upsert': 'false'
        },
        body: file
      })

      console.log('Upload response status:', response.status, response.statusText)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Upload error response:', errorText)
        throw new Error(`Upload failed: ${response.status} ${response.statusText} - ${errorText}`)
      }

      const uploadData = await response.json()
      console.log('Upload success:', uploadData)

      // Update template with file info
      const { data, error } = await supabase
        .from('model_templates')
        .update({
          base_template_path: storagePath,
          base_template_filename: file.name,
          base_template_size: file.size,
          base_template_uploaded_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', templateId)
        .eq('created_by', user.id)
        .select()
        .single()

      if (error) throw error
      return data as ModelTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-templates'] })
    }
  })

  // Delete base template file
  const deleteBaseTemplate = useMutation({
    mutationFn: async (templateId: string) => {
      if (!user) throw new Error('Not authenticated')

      // Get current template to find storage path
      const template = templates?.find(t => t.id === templateId)
      if (template?.base_template_path) {
        await supabase.storage
          .from('assets')
          .remove([template.base_template_path])
      }

      // Clear file info from template
      const { data, error } = await supabase
        .from('model_templates')
        .update({
          base_template_path: null,
          base_template_filename: null,
          base_template_size: null,
          base_template_uploaded_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', templateId)
        .eq('created_by', user.id)
        .select()
        .single()

      if (error) throw error
      return data as ModelTemplate
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-templates'] })
    }
  })

  // Get download URL for a base template file
  const getBaseTemplateUrl = async (storagePath: string) => {
    const { data, error } = await supabase.storage
      .from('assets')
      .createSignedUrl(storagePath, 60 * 60) // 1 hour

    if (error) throw error
    return data.signedUrl
  }

  return {
    templates: templates || [],
    myTemplates,
    sharedTemplates,
    isLoading,
    error,
    refetch,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    uploadBaseTemplate,
    deleteBaseTemplate,
    getBaseTemplateUrl
  }
}

// ============================================================================
// Model Files Hook
// ============================================================================

interface UseModelFilesOptions {
  assetId: string
  userId?: string
  latestOnly?: boolean
}

export function useModelFiles({ assetId, userId, latestOnly = true }: UseModelFilesOptions) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const {
    data: files,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['model-files', assetId, userId, latestOnly],
    queryFn: async () => {
      let query = supabase
        .from('model_files')
        .select(`
          *,
          template:model_templates!model_files_template_id_fkey(id, name),
          user:users!model_files_user_id_fkey(id, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .order('created_at', { ascending: false })

      if (userId) {
        query = query.eq('user_id', userId)
      }

      if (latestOnly) {
        query = query.eq('is_latest', true)
      }

      const { data, error } = await query

      if (error) throw error

      return (data || []).map(f => ({
        ...f,
        user: f.user ? { ...f.user, full_name: getFullName(f.user) } : undefined
      })) as ModelFile[]
    },
    enabled: !!assetId,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000
  })

  const myFiles = files?.filter(f => f.user_id === user?.id) || []
  const myLatestFile = myFiles.find(f => f.is_latest)

  // Upload a new model file
  const uploadFile = useMutation({
    mutationFn: async ({
      file,
      templateId,
      extractedData,
      snapshotImages
    }: {
      file: File
      templateId?: string
      extractedData?: Record<string, any>
      snapshotImages?: Array<{ name: string; url: string }>
    }) => {
      if (!user) throw new Error('Not authenticated')

      // Mark previous versions as not latest
      await supabase
        .from('model_files')
        .update({ is_latest: false })
        .eq('asset_id', assetId)
        .eq('user_id', user.id)
        .eq('is_latest', true)

      // Get next version number
      const { data: prevFiles } = await supabase
        .from('model_files')
        .select('version')
        .eq('asset_id', assetId)
        .eq('user_id', user.id)
        .order('version', { ascending: false })
        .limit(1)

      const nextVersion = (prevFiles?.[0]?.version || 0) + 1
      const previousVersionId = prevFiles?.[0]?.id

      // Upload file to storage
      const storagePath = `models/${assetId}/${user.id}/${Date.now()}_${file.name}`
      const { error: uploadError } = await supabase.storage
        .from('model-files')
        .upload(storagePath, file)

      if (uploadError) throw uploadError

      // Create file record
      const { data, error } = await supabase
        .from('model_files')
        .insert({
          asset_id: assetId,
          user_id: user.id,
          filename: file.name,
          storage_path: storagePath,
          file_size: file.size,
          mime_type: file.type,
          template_id: templateId || null,
          extracted_data: extractedData || null,
          snapshot_images: snapshotImages || null,
          sync_status: extractedData ? 'synced' : 'pending',
          synced_at: extractedData ? new Date().toISOString() : null,
          version: nextVersion,
          is_latest: true,
          previous_version_id: previousVersionId || null
        })
        .select()
        .single()

      if (error) throw error
      return data as ModelFile
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-files', assetId] })
    }
  })

  // Update file sync status
  const updateSyncStatus = useMutation({
    mutationFn: async ({
      fileId,
      status,
      extractedData,
      snapshotImages,
      error: syncError
    }: {
      fileId: string
      status: 'pending' | 'processing' | 'synced' | 'error'
      extractedData?: Record<string, any>
      snapshotImages?: Array<{ name: string; url: string }>
      error?: string
    }) => {
      const updateData: any = {
        sync_status: status,
        updated_at: new Date().toISOString()
      }

      if (status === 'synced') {
        updateData.synced_at = new Date().toISOString()
        if (extractedData) updateData.extracted_data = extractedData
        if (snapshotImages) updateData.snapshot_images = snapshotImages
      }

      if (status === 'error' && syncError) {
        updateData.sync_error = syncError
      }

      const { data, error } = await supabase
        .from('model_files')
        .update(updateData)
        .eq('id', fileId)
        .select()
        .single()

      if (error) throw error
      return data as ModelFile
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-files', assetId] })
    }
  })

  // Delete a file
  const deleteFile = useMutation({
    mutationFn: async (fileId: string) => {
      // Get file to delete from storage
      const file = files?.find(f => f.id === fileId)

      if (file?.storage_path) {
        await supabase.storage
          .from('model-files')
          .remove([file.storage_path])
      }

      const { error } = await supabase
        .from('model_files')
        .delete()
        .eq('id', fileId)
        .eq('user_id', user?.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-files', assetId] })
    }
  })

  // Get download URL for a file
  const getDownloadUrl = async (storagePath: string) => {
    const { data, error } = await supabase.storage
      .from('model-files')
      .createSignedUrl(storagePath, 60 * 60) // 1 hour

    if (error) throw error
    return data.signedUrl
  }

  // Re-sync a file (re-apply extracted data to estimates/ratings/targets)
  const resyncFile = useMutation({
    mutationFn: async (fileId: string) => {
      // Get the file with its extracted data
      const file = files?.find(f => f.id === fileId)
      if (!file) throw new Error('File not found')
      if (!file.extracted_data?.values) throw new Error('No extracted data to resync')

      // Update sync status to processing
      await supabase
        .from('model_files')
        .update({
          sync_status: 'processing',
          updated_at: new Date().toISOString()
        })
        .eq('id', fileId)

      // The actual sync will be handled by the component that calls this
      // Return the file data for the caller to process
      return file
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['model-files', assetId] })
    }
  })

  return {
    files: files || [],
    myFiles,
    myLatestFile,
    isLoading,
    error,
    refetch,
    uploadFile,
    updateSyncStatus,
    deleteFile,
    getDownloadUrl,
    resyncFile
  }
}

// ============================================================================
// Preset System - Metric + Period Selection
// ============================================================================

// Period types user can select
export type PeriodTypeOption = 'FY' | 'CY' | 'Q1' | 'Q2' | 'Q3' | 'Q4'

export interface PeriodType {
  id: PeriodTypeOption
  label: string
  category: 'annual' | 'quarterly'
  quarter?: number
}

export const PERIOD_TYPES: PeriodType[] = [
  { id: 'FY', label: 'Fiscal Year', category: 'annual' },
  { id: 'CY', label: 'Calendar Year', category: 'annual' },
  { id: 'Q1', label: 'Q1', category: 'quarterly', quarter: 1 },
  { id: 'Q2', label: 'Q2', category: 'quarterly', quarter: 2 },
  { id: 'Q3', label: 'Q3', category: 'quarterly', quarter: 3 },
  { id: 'Q4', label: 'Q4', category: 'quarterly', quarter: 4 },
]

// Years available for selection: last 3 full years + next 10 years
const currentYear = new Date().getFullYear()
export const AVAILABLE_YEARS = [
  // Last 3 full years
  ...Array.from({ length: 3 }, (_, i) => currentYear - 3 + i),
  // Current year + next 9 years (10 total)
  ...Array.from({ length: 10 }, (_, i) => currentYear + i),
]

// Time period interface (for backward compatibility)
export interface TimePeriod {
  id: string
  label: string
  shortLabel: string
  periodType: 'annual' | 'quarterly'
  fiscalYear: number
  fiscalQuarter?: number
  calendarYear?: boolean
}

// Helper to build a TimePeriod from type + year
// Note: Uses full year in id (e.g., fy2027) to match detection format in excelParser.ts
export function buildTimePeriod(periodType: PeriodTypeOption, year: number): TimePeriod {
  const yearShort = String(year).slice(-2)
  const fullYearId = `${periodType.toLowerCase()}${year}`

  if (periodType === 'FY') {
    return {
      id: fullYearId,  // Full year to match detection format
      label: `FY ${year}`,
      shortLabel: `FY${yearShort}`,
      periodType: 'annual',
      fiscalYear: year,
    }
  }

  if (periodType === 'CY') {
    return {
      id: `cy${year}`,  // Full year to match detection format
      label: `CY ${year}`,
      shortLabel: `CY${yearShort}`,
      periodType: 'annual',
      fiscalYear: year,
      calendarYear: true,
    }
  }

  // Quarterly
  const quarter = parseInt(periodType.slice(1))
  return {
    id: `q${quarter}_${year}`,  // Full year to match detection format
    label: `${periodType} ${year}`,
    shortLabel: `${periodType}'${yearShort}`,
    periodType: 'quarterly',
    fiscalYear: year,
    fiscalQuarter: quarter,
  }
}

// Legacy: Generate all periods for backward compatibility
export const TIME_PERIODS: TimePeriod[] = [
  // Generate FY periods
  ...AVAILABLE_YEARS.slice(0, 6).map(year => buildTimePeriod('FY', year)),
  // Generate some quarterly periods
  ...AVAILABLE_YEARS.slice(1, 4).flatMap(year =>
    (['Q1', 'Q2', 'Q3', 'Q4'] as PeriodTypeOption[]).map(q => buildTimePeriod(q, year))
  ),
]

// Metric definitions - can be combined with time periods
export interface MetricDefinition {
  id: string
  label: string
  metricKey: string
  type: 'currency' | 'number' | 'percent' | 'multiple'
  supportsPeriods: boolean
  periodsAllowed?: ('annual' | 'quarterly')[]
}

export interface MetricCategory {
  name: string
  metrics: MetricDefinition[]
}

export const METRIC_CATEGORIES: MetricCategory[] = [
  {
    name: 'Earnings',
    metrics: [
      { id: 'eps', label: 'EPS', metricKey: 'eps', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'net_income', label: 'Net Income', metricKey: 'net_income', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'operating_income', label: 'Operating Income', metricKey: 'operating_income', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'eps_growth', label: 'EPS Growth %', metricKey: 'eps_growth', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Revenue',
    metrics: [
      { id: 'revenue', label: 'Revenue', metricKey: 'revenue', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'revenue_growth', label: 'Revenue Growth %', metricKey: 'revenue_growth', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'EBITDA',
    metrics: [
      { id: 'ebitda', label: 'EBITDA', metricKey: 'ebitda', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'ebitda_margin', label: 'EBITDA Margin', metricKey: 'ebitda_margin', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'ebitda_growth', label: 'EBITDA Growth %', metricKey: 'ebitda_growth', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Margins',
    metrics: [
      { id: 'gross_margin', label: 'Gross Margin', metricKey: 'gross_margin', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'operating_margin', label: 'Operating Margin', metricKey: 'operating_margin', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'net_margin', label: 'Net Margin', metricKey: 'net_margin', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Cash Flow',
    metrics: [
      { id: 'fcf', label: 'Free Cash Flow', metricKey: 'fcf', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'ocf', label: 'Operating Cash Flow', metricKey: 'ocf', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'capex', label: 'CapEx', metricKey: 'capex', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'fcf_yield', label: 'FCF Yield', metricKey: 'fcf_yield', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'fcf_margin', label: 'FCF Margin', metricKey: 'fcf_margin', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'fcf_conversion', label: 'FCF Conversion', metricKey: 'fcf_conversion', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Valuation',
    metrics: [
      { id: 'pe', label: 'P/E Ratio', metricKey: 'pe', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'ev_ebitda', label: 'EV/EBITDA', metricKey: 'ev_ebitda', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'ev_sales', label: 'EV/Sales', metricKey: 'ev_sales', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'ev_fcf', label: 'EV/FCF', metricKey: 'ev_fcf', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'price_to_book', label: 'Price/Book', metricKey: 'price_to_book', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'peg_ratio', label: 'PEG Ratio', metricKey: 'peg_ratio', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Returns',
    metrics: [
      { id: 'roe', label: 'ROE', metricKey: 'roe', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'roic', label: 'ROIC', metricKey: 'roic', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'roa', label: 'ROA', metricKey: 'roa', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'roce', label: 'ROCE', metricKey: 'roce', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Balance Sheet',
    metrics: [
      { id: 'total_debt', label: 'Total Debt', metricKey: 'total_debt', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'net_debt', label: 'Net Debt', metricKey: 'net_debt', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'cash', label: 'Cash & Equivalents', metricKey: 'cash', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'total_assets', label: 'Total Assets', metricKey: 'total_assets', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'total_equity', label: 'Total Equity', metricKey: 'total_equity', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'book_value', label: 'Book Value', metricKey: 'book_value', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'enterprise_value', label: 'Enterprise Value', metricKey: 'enterprise_value', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'net_debt_ebitda', label: 'Net Debt/EBITDA', metricKey: 'net_debt_ebitda', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'debt_to_equity', label: 'Debt/Equity', metricKey: 'debt_to_equity', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Dividends & Buybacks',
    metrics: [
      { id: 'dividend_yield', label: 'Dividend Yield', metricKey: 'dividend_yield', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'dividend_per_share', label: 'Dividend Per Share', metricKey: 'dividend_per_share', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'payout_ratio', label: 'Payout Ratio', metricKey: 'payout_ratio', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'buyback_yield', label: 'Buyback Yield', metricKey: 'buyback_yield', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'total_shareholder_return', label: 'Total Shareholder Return', metricKey: 'total_shareholder_return', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Per Share Data',
    metrics: [
      { id: 'book_value_per_share', label: 'Book Value Per Share', metricKey: 'book_value_per_share', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'tangible_book_per_share', label: 'Tangible Book Per Share', metricKey: 'tangible_book_per_share', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'cash_per_share', label: 'Cash Per Share', metricKey: 'cash_per_share', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'fcf_per_share', label: 'FCF Per Share', metricKey: 'fcf_per_share', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
  {
    name: 'Shares & Market Data',
    metrics: [
      { id: 'shares_outstanding', label: 'Shares Outstanding', metricKey: 'shares_outstanding', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'market_cap', label: 'Market Cap', metricKey: 'market_cap', type: 'currency', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'float_pct', label: 'Float %', metricKey: 'float_pct', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'short_interest', label: 'Short Interest %', metricKey: 'short_interest', type: 'percent', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
      { id: 'avg_volume', label: 'Avg Daily Volume', metricKey: 'avg_volume', type: 'number', supportsPeriods: true, periodsAllowed: ['annual', 'quarterly'] },
    ]
  },
]

// Static presets that don't need time periods
export interface StaticPresetCategory {
  name: string
  presets: Record<string, Omit<FieldMapping, 'cell'> & { cell: string }>
}

export const STATIC_PRESET_CATEGORIES: StaticPresetCategory[] = [
  {
    name: 'Model Settings',
    presets: {
      model_currency: { field: 'model_currency', cell: '', type: 'text', label: 'Model Currency', isPreset: true },
      model_units: { field: 'model_units', cell: '', type: 'text', label: 'Model Units (M/B/K)', isPreset: true },
      fiscal_year_end: { field: 'fiscal_year_end', cell: '', type: 'text', label: 'Fiscal Year End', isPreset: true },
    }
  },
  {
    name: 'Price Targets',
    presets: {
      price_target: { field: 'price_target', cell: '', type: 'currency', label: 'Price Target (Base)', required: true, isPreset: true },
      bull_price_target: { field: 'bull_price_target', cell: '', type: 'currency', label: 'Price Target (Bull)', isPreset: true },
      bear_price_target: { field: 'bear_price_target', cell: '', type: 'currency', label: 'Price Target (Bear)', isPreset: true },
      upside_pct: { field: 'upside_pct', cell: '', type: 'percent', label: 'Upside %', isPreset: true },
      downside_pct: { field: 'downside_pct', cell: '', type: 'percent', label: 'Downside %', isPreset: true },
    }
  },
  {
    name: 'Rating & Recommendation',
    presets: {
      rating: { field: 'rating', cell: '', type: 'text', label: 'Rating', required: true, isPreset: true },
      conviction: { field: 'conviction', cell: '', type: 'text', label: 'Conviction Level', isPreset: true },
      risk_rating: { field: 'risk_rating', cell: '', type: 'text', label: 'Risk Rating', isPreset: true },
    }
  },
]

// Helper to generate a field mapping from metric + period
export function generateFieldMapping(metric: MetricDefinition, period?: TimePeriod): FieldMapping {
  if (!period) {
    return {
      field: metric.id,
      cell: '',
      type: metric.type,
      label: metric.label,
      metricKey: metric.metricKey,
      isPreset: true,
    }
  }

  // Use period.id directly - it already has the correct format (e.g., fy2027, q1_2027)
  // This matches the detection format in excelParser.ts
  return {
    field: `${metric.id}_${period.id}`,
    cell: '',
    type: metric.type,
    label: `${period.shortLabel} ${metric.label}`,
    metricKey: metric.metricKey,
    periodType: period.periodType,
    fiscalYear: period.fiscalYear,
    fiscalQuarter: period.fiscalQuarter,
    isPreset: true,
  }
}

// Legacy: Flatten static presets for backward compatibility
export const COMMON_FIELD_MAPPINGS: Record<string, FieldMapping> = STATIC_PRESET_CATEGORIES.reduce(
  (acc, category) => ({ ...acc, ...category.presets }),
  {} as Record<string, FieldMapping>
)

// Legacy: Keep PRESET_CATEGORIES for any code that still references it
export const PRESET_CATEGORIES = STATIC_PRESET_CATEGORIES
