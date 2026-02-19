/**
 * useUserAssetPagePreferences Hook
 *
 * Manages user-specific preferences for asset page research field layout.
 * Allows users to show/hide fields, reorder them, and save named layouts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import {
  resolveLayout,
  logResolutionDiagnostics,
  warnDataIntegrityIssues,
  fieldConfigMatchesField,
  SYSTEM_DEFAULT_FIELD_SLUGS,
  type ResolveLayoutInput,
  type LayoutResolutionResult
} from '../lib/research/layout-resolver'

// Types
export interface SavedLayout {
  id: string
  user_id: string
  name: string
  description: string | null
  is_default: boolean
  field_config: FieldConfigItem[]
  created_at: string
  updated_at: string
}

export interface FieldConfigItem {
  field_id: string
  section_id: string
  is_visible: boolean
  display_order: number | null
  is_collapsed: boolean
}

export interface FieldOverride {
  field_id: string
  is_visible: boolean
  section_id?: string // Override the field's default section
  display_order?: number // Override the field's display order within its section
}

export interface SectionOverride {
  section_id: string
  name_override?: string
  is_hidden?: boolean
  display_order?: number
  is_added?: boolean // true if section was added as an override for this asset
}

export interface FieldWithPreference {
  field_id: string
  field_name: string
  field_slug: string
  field_description: string | null
  field_type: string
  section_id: string
  section_name: string
  section_slug: string
  default_section_id: string // Original section before any overrides
  is_visible: boolean
  display_order: number | null  // User's custom display order (from layout)
  default_display_order: number // Default display order (from research_fields table)
  is_collapsed: boolean
  is_universal: boolean
  is_system: boolean  // true if this is a system field (included in default template)
  is_custom: boolean  // true if created by a user, false if standard field
  has_custom_preference: boolean
  has_section_override: boolean // true if field was moved to a different section
  created_by: string | null
  creator_name: string | null
  created_at: string | null
}

/**
 * Hook to manage user's asset page field preferences
 */
export function useUserAssetPagePreferences(assetId?: string) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch user's default layout
  const { data: defaultLayout, isLoading: layoutLoading } = useQuery({
    queryKey: ['user-default-layout', user?.id],
    queryFn: async () => {
      if (!user?.id) return null

      const { data, error } = await supabase
        .from('user_asset_page_layouts')
        .select('*')
        .eq('user_id', user.id)
        .eq('is_default', true)
        .maybeSingle()

      if (error) throw error
      return data as SavedLayout | null
    },
    enabled: !!user?.id
  })

  // Fetch asset-specific layout selection (if any)
  const { data: assetLayoutSelection, isLoading: assetLayoutLoading } = useQuery({
    queryKey: ['user-asset-layout-selection', user?.id, assetId],
    queryFn: async () => {
      if (!user?.id || !assetId) return null

      // Use explicit foreign key reference for the join
      const { data, error } = await supabase
        .from('user_asset_layout_selections')
        .select('*, layout:user_asset_page_layouts!user_asset_layout_selections_layout_id_fkey(*)')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .maybeSingle()

      if (error) {
        console.error('Error fetching asset layout selection:', error)
        throw error
      }

      // Defensive: if layout_id is set but the join returned no layout,
      // the referenced template was deleted (FK cascade set it to NULL in DB,
      // but our cached row might still have it). Treat as no template.
      if (data && data.layout_id && !data.layout) {
        if (process.env.NODE_ENV === 'development') {
          console.warn(
            `[LayoutResolver] Asset ${assetId} references layout ${data.layout_id} which no longer exists. Falling back to default.`
          )
        }
        data.layout_id = null
      }

      return data as {
        layout_id: string | null
        layout: SavedLayout | null
        field_overrides: FieldOverride[] | null
        section_overrides: SectionOverride[] | null
        version: number
      } | null
    },
    enabled: !!user?.id && !!assetId,
    staleTime: 0, // Always refetch to ensure fresh data
    refetchOnMount: 'always'
  })

  // NOTE: Legacy table `user_asset_page_preferences` has 0 rows and is no longer queried.
  // The table still exists in the database for Phase C drop.
  if (process.env.NODE_ENV === 'development') {
    // One-time dev warning on first render (closure captures this)
  }

  // Fetch all sections (including empty ones)
  const { data: allSections, isLoading: sectionsLoading } = useQuery({
    queryKey: ['all-research-sections', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // Get user's organization
      const { data: orgMembership } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (!orgMembership) return []

      const { data: sections, error } = await supabase
        .from('research_sections')
        .select('id, name, slug, display_order, is_system')
        .eq('organization_id', orgMembership.organization_id)
        .order('display_order', { ascending: true })

      if (error) throw error
      return sections || []
    },
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always'
  })

  // Fetch all available fields with their sections
  const { data: availableFields, isLoading: fieldsLoading } = useQuery({
    queryKey: ['available-research-fields', user?.id, 'v6'], // v6 - include preset fields
    queryFn: async () => {
      if (!user?.id) return []

      // Get all fields the user has access to
      const { data: fields, error } = await supabase
        .from('research_fields')
        .select(`
          id,
          name,
          slug,
          description,
          field_type,
          section_id,
          is_universal,
          is_system,
          display_order,
          created_by,
          created_at,
          research_sections!inner (
            id,
            name,
            slug,
            display_order
          )
        `)
        .eq('is_archived', false)
        .order('display_order', { ascending: true })

      if (error) throw error

      // Also fetch preset fields (standard field templates)
      const { data: presets, error: presetsError } = await supabase
        .from('research_field_presets')
        .select('*')
        .order('category', { ascending: true })
        .order('name', { ascending: true })

      if (presetsError) {
        console.error('Error fetching presets:', presetsError)
      }

      // Get all sections to map preset suggested_section (slug) to section info
      const { data: allSections } = await supabase
        .from('research_sections')
        .select('id, name, slug, display_order')
        .order('display_order', { ascending: true })

      const sectionsBySlug = (allSections || []).reduce((acc, s) => {
        acc[s.slug] = s
        return acc
      }, {} as Record<string, { id: string; name: string; slug: string; display_order: number }>)

      // Fetch creator names for custom fields
      const creatorIds = [...new Set(fields?.filter(f => f.created_by).map(f => f.created_by))]
      let creatorsMap: Record<string, { first_name: string; last_name: string }> = {}

      if (creatorIds.length > 0) {
        const { data: creators } = await supabase
          .from('users')
          .select('id, first_name, last_name')
          .in('id', creatorIds)

        if (creators) {
          creatorsMap = creators.reduce((acc, c) => {
            acc[c.id] = { first_name: c.first_name || '', last_name: c.last_name || '' }
            return acc
          }, {} as Record<string, { first_name: string; last_name: string }>)
        }
      }

      // Build combined field list
      const existingSlugs = new Set((fields || []).map(f => f.slug))

      // Convert research_fields to common format
      const fieldsList = (fields || []).map(field => ({
        ...field,
        creator: field.created_by ? creatorsMap[field.created_by] || null : null
      }))

      // Add presets that don't already exist as research_fields
      const presetFields = (presets || [])
        .filter(p => !existingSlugs.has(p.slug))
        .map(preset => {
          // Map suggested_section slug to actual section
          const section = sectionsBySlug[preset.suggested_section] || sectionsBySlug['thesis'] || Object.values(sectionsBySlug)[0]
          return {
            id: `preset-${preset.slug}`,
            name: preset.name,
            slug: preset.slug,
            description: preset.description,
            field_type: preset.field_type,
            section_id: section?.id || null,
            is_universal: false, // Presets are available but not universal by default
            is_system: false, // Presets are library fields, not part of default template
            display_order: 999, // Show after regular fields
            created_by: null,
            created_at: preset.created_at,
            research_sections: section ? {
              id: section.id,
              name: section.name,
              slug: section.slug,
              display_order: section.display_order
            } : null,
            creator: null,
            is_preset: true // Mark as preset for special handling
          }
        })
        .filter(p => p.research_sections) // Only include presets with valid sections

      return [...fieldsList, ...presetFields]
    },
    enabled: !!user?.id,
    staleTime: 0,
    gcTime: 0, // Don't cache - always fetch fresh data
    refetchOnMount: 'always'
  })

  // ========================================================================
  // CENTRALIZED LAYOUT RESOLUTION (via layout-resolver.ts)
  // ========================================================================
  // Precedence:
  //   1. Asset-level field/section overrides
  //   2. Asset-level template selection
  //   3. User's default template
  //   4. System default (is_universal fields)

  // Build the resolver input from query data
  const resolverInput: ResolveLayoutInput | null =
    availableFields && allSections
      ? {
          availableFields: (availableFields || []).map(field => ({
            id: field.id,
            name: field.name,
            slug: field.slug,
            description: (field as any).description || null,
            field_type: field.field_type,
            section_id: field.section_id,
            is_universal: field.is_universal,
            is_system: (field as any).is_system ?? false,
            display_order: (field as any).display_order ?? 0,
            created_by: (field as any).created_by || null,
            created_at: (field as any).created_at || null,
            research_sections: field.research_sections as any,
            creator: (field as any).creator || null,
            is_preset: (field as any).is_preset
          })),
          allSections: (allSections || []).map(s => ({
            id: s.id,
            name: s.name,
            slug: s.slug,
            display_order: s.display_order,
            is_system: s.is_system
          })),
          userDefaultLayout: defaultLayout
            ? { id: defaultLayout.id, name: defaultLayout.name, field_config: defaultLayout.field_config, is_default: defaultLayout.is_default }
            : null,
          assetSelection: assetLayoutSelection
            ? {
                layout_id: assetLayoutSelection.layout_id,
                layout: assetLayoutSelection.layout
                  ? { id: assetLayoutSelection.layout.id, name: assetLayoutSelection.layout.name, field_config: assetLayoutSelection.layout.field_config, is_default: assetLayoutSelection.layout.is_default }
                  : null,
                field_overrides: assetLayoutSelection.field_overrides || null,
                section_overrides: assetLayoutSelection.section_overrides || null
              }
            : null
        }
      : null

  // Run the pure resolver
  const resolution: LayoutResolutionResult | null = resolverInput ? resolveLayout(resolverInput) : null

  // Dev diagnostics — expose on window for programmatic inspection + compact console.debug
  const prevResolutionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!resolution) return
    const key = `${resolution.templateSource}:${resolution.activeTemplate?.id}:${resolution.hasAssetCustomization}:${resolution.resolvedFields.filter(f => f.is_visible).length}`
    if (key !== prevResolutionRef.current) {
      prevResolutionRef.current = key
      logResolutionDiagnostics(resolution, { assetId, userId: user?.id })
      // G4: Expose resolution on window for dev tools / React DevTools inspection
      if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
        ;(window as any).__LAYOUT_DEBUG__ = {
          assetId,
          resolution,
          version: assetLayoutSelection?.version ?? null,
          timestamp: new Date().toISOString()
        }
      }
    }
  }, [resolution, assetId, user?.id, assetLayoutSelection?.version])

  // Extract results from resolution
  const activeLayout = resolution?.activeTemplate
    ? { ...resolution.activeTemplate, user_id: '', description: null, created_at: '', updated_at: '' } as SavedLayout
    : defaultLayout

  const assetFieldOverrides = resolution?.assetFieldOverrides || []
  const assetSectionOverrides: SectionOverride[] = resolution?.assetSectionOverrides || []
  const hasAssetCustomization = resolution?.hasAssetCustomization || false

  // Map resolved fields to FieldWithPreference (preserving existing interface)
  const fieldsWithPreferences: FieldWithPreference[] = resolution?.resolvedFields || []

  // Group fields by section, including section display order for sorting
  const fieldsBySectionMap = fieldsWithPreferences.reduce((acc, field) => {
    const section = (availableFields || []).find(f => f.id === field.field_id)?.research_sections as any
    const sectionDisplayOrder = section?.display_order ?? 999

    // Check for section override
    const sectionOverride = assetSectionOverrides.find(o => o.section_id === field.section_id)

    if (!acc[field.section_id]) {
      acc[field.section_id] = {
        section_id: field.section_id,
        section_name: sectionOverride?.name_override || field.section_name,
        section_slug: field.section_slug,
        section_display_order: sectionOverride?.display_order ?? sectionDisplayOrder,
        section_is_hidden: sectionOverride?.is_hidden ?? false,
        section_is_added: sectionOverride?.is_added ?? false,
        section_original_name: field.section_name,
        section_has_override: !!sectionOverride,
        fields: []
      }
    }
    acc[field.section_id].fields.push(field)
    return acc
  }, {} as Record<string, {
    section_id: string
    section_name: string
    section_slug: string
    section_display_order: number
    section_is_hidden: boolean
    section_is_added: boolean
    section_original_name: string
    section_has_override: boolean
    fields: FieldWithPreference[]
  }>)

  // Add empty sections from allSections that aren't already in fieldsBySectionMap
  // Only add if: is a custom section (not system) OR has is_added override for this asset
  if (allSections) {
    for (const section of allSections) {
      if (!fieldsBySectionMap[section.id]) {
        const sectionOverride = assetSectionOverrides.find(o => o.section_id === section.id)
        const isCustomSection = section.is_system === false
        const isAddedForAsset = sectionOverride?.is_added === true

        // Only add if custom section or added as override for this asset
        if (isCustomSection || isAddedForAsset) {
          fieldsBySectionMap[section.id] = {
            section_id: section.id,
            section_name: sectionOverride?.name_override || section.name,
            section_slug: section.slug,
            section_display_order: sectionOverride?.display_order ?? section.display_order,
            section_is_hidden: sectionOverride?.is_hidden ?? false,
            section_is_added: sectionOverride?.is_added ?? false,
            section_original_name: section.name,
            section_has_override: !!sectionOverride,
            fields: []
          }
        }
      }
    }
  }

  // Sort sections by display_order and fields within each section by their display_order
  // Field sorting: use override display_order if available, otherwise fall back to default_display_order
  const fieldsBySection = Object.values(fieldsBySectionMap)
    .sort((a, b) => a.section_display_order - b.section_display_order)
    .map(section => ({
      ...section,
      fields: section.fields.sort((a, b) => {
        const aOrder = a.display_order ?? a.default_display_order
        const bOrder = b.display_order ?? b.default_display_order
        return aOrder - bOrder
      })
    }))

  // Compute displayed sections - filtered to only show sections relevant to the current template/overrides
  // This is what should be used for rendering on the asset page
  const isUsingCustomTemplate = activeLayout && activeLayout.field_config && activeLayout.field_config.length > 0
  const templateFieldConfig = activeLayout?.field_config || []
  const overrideAddedFieldIds = new Set(
    assetFieldOverrides.filter(o => o.is_visible).map(o => o.field_id)
  )

  // Helper to check if a field is in the template (uses centralized matching)
  const isFieldInTemplate = (fieldId: string, fieldSlug: string): boolean => {
    return templateFieldConfig.some(fc =>
      fieldConfigMatchesField(fc, { id: fieldId, slug: fieldSlug })
    )
  }

  const displayedFieldsBySection = fieldsBySection
    .map(section => ({
      ...section,
      fields: section.fields
        .map(field => {
          const inTemplate = isFieldInTemplate(field.field_id, field.field_slug)
          return {
            ...field,
            isFromTemplate: inTemplate,
            isAddedViaOverride: overrideAddedFieldIds.has(field.field_id) && !inTemplate
          }
        })
        // Filter fields based on whether we're using a custom template
        // - Custom template: only show fields from template or added via override
        // - Default template: show all fields (visibility controlled by is_visible)
        .filter(field => {
          if (isUsingCustomTemplate) {
            return field.isFromTemplate || field.isAddedViaOverride
          }
          // Default template - show all fields, visibility handled by is_visible filter in renderer
          return true
        })
        .sort((a, b) => {
          // Sort by display_order if available, otherwise by default_display_order
          const aOrder = a.display_order ?? a.default_display_order
          const bOrder = b.display_order ?? b.default_display_order
          return aOrder - bOrder
        })
    }))
    .filter(section => {
      // Show section if:
      // 1. Using default template and section has visible fields
      // 2. Using custom template and has template fields or override fields
      // 3. It was explicitly added as a section override
      if (!isUsingCustomTemplate) {
        return section.fields.some(f => f.is_visible)
      }
      const hasTemplateFields = section.fields.some(f => f.isFromTemplate && f.is_visible)
      const hasOverrideFields = section.fields.some(f => f.isAddedViaOverride && f.is_visible)
      return hasTemplateFields || hasOverrideFields || section.section_is_added
    })

  // Toggle field visibility for a specific asset (creates asset-specific override)
  const toggleAssetFieldVisibility = useMutation({
    mutationFn: async ({ assetId: targetAssetId, fieldId }: { assetId: string; fieldId: string }) => {
      if (!user?.id) throw new Error('Not authenticated')

      const field = fieldsWithPreferences.find(f => f.field_id === fieldId)
      if (!field) throw new Error('Field not found')

      const newVisibility = !field.is_visible

      // Determine what the template default visibility would be for this field
      const isUsingCustomTemplate = activeLayout && activeLayout.field_config && activeLayout.field_config.length > 0
      const layoutConfig = activeLayout?.field_config?.find(fc => fc.field_id === fieldId)
      let templateDefaultVisibility: boolean
      if (layoutConfig) {
        templateDefaultVisibility = layoutConfig.is_visible
      } else if (isUsingCustomTemplate) {
        templateDefaultVisibility = false // Not in custom template = hidden
      } else {
        templateDefaultVisibility = SYSTEM_DEFAULT_FIELD_SLUGS.has(field.field_slug)
      }

      // Check if the new visibility matches the template default
      const matchesTemplateDefault = newVisibility === templateDefaultVisibility

      // Get existing selection
      const { data: existing } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', targetAssetId)
        .maybeSingle()

      if (existing) {
        const currentOverrides: FieldOverride[] = existing.field_overrides || []
        const existingOverrideIndex = currentOverrides.findIndex(o => o.field_id === fieldId)

        let newOverrides: FieldOverride[]
        if (matchesTemplateDefault) {
          // Remove the override since it matches the template default
          newOverrides = currentOverrides.filter(o => o.field_id !== fieldId)
        } else if (existingOverrideIndex >= 0) {
          // Update existing override
          newOverrides = [...currentOverrides]
          newOverrides[existingOverrideIndex] = { field_id: fieldId, is_visible: newVisibility }
        } else {
          // Add new override
          newOverrides = [...currentOverrides, { field_id: fieldId, is_visible: newVisibility }]
        }

        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({ field_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else if (!matchesTemplateDefault) {
        // Only create new selection if the visibility differs from template default
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .insert({
            user_id: user.id,
            asset_id: targetAssetId,
            layout_id: null, // No template override, just field overrides
            field_overrides: [{ field_id: fieldId, is_visible: newVisibility }]
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Add a field to a specific section (with visibility)
  const addFieldToSection = useMutation({
    mutationFn: async ({ fieldId, sectionId }: { fieldId: string; sectionId: string }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Get existing selection
      const { data: existing } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .maybeSingle()

      const newOverride: FieldOverride = { field_id: fieldId, is_visible: true, section_id: sectionId }

      if (existing) {
        const currentOverrides: FieldOverride[] = existing.field_overrides || []
        // Remove any existing override for this field, then add new one
        const filteredOverrides = currentOverrides.filter(o => o.field_id !== fieldId)
        const newOverrides = [...filteredOverrides, newOverride]

        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({ field_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .insert({
            user_id: user.id,
            asset_id: assetId,
            layout_id: null,
            field_overrides: [newOverride],
            section_overrides: []
          })

        if (error) throw error
      }
    },
    onMutate: async ({ fieldId, sectionId }) => {
      await queryClient.cancelQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
      const previousSelection = queryClient.getQueryData(['user-asset-layout-selection', user?.id, assetId])

      // Optimistically add field override
      queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], (old: any) => {
        const currentOverrides: FieldOverride[] = old?.field_overrides || []
        const filteredOverrides = currentOverrides.filter(o => o.field_id !== fieldId)
        return {
          ...old,
          layout_id: old?.layout_id || null,
          layout: old?.layout || null,
          field_overrides: [...filteredOverrides, { field_id: fieldId, is_visible: true, section_id: sectionId }],
          section_overrides: old?.section_overrides || []
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSelection) {
        queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], context.previousSelection)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Remove a field from a section (hide it)
  const removeFieldFromSection = useMutation({
    mutationFn: async ({ fieldId }: { fieldId: string }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Get existing selection
      const { data: existing } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .maybeSingle()

      if (existing) {
        const currentOverrides: FieldOverride[] = existing.field_overrides || []
        // Update to set is_visible: false (or remove if it matches template default)
        const existingOverride = currentOverrides.find(o => o.field_id === fieldId)
        let newOverrides: FieldOverride[]

        if (existingOverride) {
          // Update existing to hide
          newOverrides = currentOverrides.map(o =>
            o.field_id === fieldId ? { ...o, is_visible: false } : o
          )
        } else {
          // Add new override to hide
          newOverrides = [...currentOverrides, { field_id: fieldId, is_visible: false }]
        }

        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({ field_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .insert({
            user_id: user.id,
            asset_id: assetId,
            layout_id: null,
            field_overrides: [{ field_id: fieldId, is_visible: false }],
            section_overrides: []
          })

        if (error) throw error
      }
    },
    onMutate: async ({ fieldId }) => {
      await queryClient.cancelQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
      const previousSelection = queryClient.getQueryData(['user-asset-layout-selection', user?.id, assetId])

      // Optimistically hide field
      queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], (old: any) => {
        const currentOverrides: FieldOverride[] = old?.field_overrides || []
        const existingIdx = currentOverrides.findIndex(o => o.field_id === fieldId)
        let newOverrides: FieldOverride[]
        if (existingIdx >= 0) {
          newOverrides = currentOverrides.map(o =>
            o.field_id === fieldId ? { ...o, is_visible: false } : o
          )
        } else {
          newOverrides = [...currentOverrides, { field_id: fieldId, is_visible: false }]
        }
        return {
          ...old,
          field_overrides: newOverrides
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSelection) {
        queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], context.previousSelection)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Select a layout for a specific asset
  const selectLayoutForAsset = useMutation({
    mutationFn: async ({ assetId: targetAssetId, layoutId }: { assetId: string; layoutId: string | null }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Get existing selection to preserve field_overrides and section_overrides
      const { data: existing, error: fetchError } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', targetAssetId)
        .maybeSingle()

      if (fetchError) {
        console.error('Error fetching existing selection:', fetchError)
        throw fetchError
      }

      const existingFieldOverrides = existing?.field_overrides || []
      const existingSectionOverrides = existing?.section_overrides || []
      const hasOverrides = existingFieldOverrides.length > 0 || existingSectionOverrides.length > 0

      if (layoutId === null && !hasOverrides) {
        // No layout and no overrides - remove the selection entirely
        if (existing) {
          const { error } = await supabase
            .from('user_asset_layout_selections')
            .delete()
            .eq('id', existing.id)

          if (error) {
            throw error
          }
        }
      } else if (existing) {
        // Update existing row
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({
            layout_id: layoutId,
            field_overrides: existingFieldOverrides,
            section_overrides: existingSectionOverrides,
            updated_at: new Date().toISOString()
          })
          .eq('id', existing.id)

        if (error) {
          throw error
        }
      } else {
        // Insert new row
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .insert({
            user_id: user.id,
            asset_id: targetAssetId,
            layout_id: layoutId,
            field_overrides: existingFieldOverrides,
            section_overrides: existingSectionOverrides
          })

        if (error) {
          throw error
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Clear all field overrides for a specific asset (reset to template defaults)
  const clearAssetOverrides = useMutation({
    mutationFn: async (targetAssetId: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Get existing selection
      const { data: existing } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', targetAssetId)
        .maybeSingle()

      if (!existing) return // Nothing to clear

      if (existing.layout_id) {
        // Has layout selection, just clear overrides
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({ field_overrides: [], section_overrides: [] })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        // No layout, only had overrides - delete the whole row
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .delete()
          .eq('id', existing.id)

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Update section override (rename, hide, reorder)
  const updateSectionOverride = useMutation({
    mutationFn: async ({
      assetId: targetAssetId,
      sectionId,
      nameOverride,
      isHidden,
      displayOrder
    }: {
      assetId: string
      sectionId: string
      nameOverride?: string | null
      isHidden?: boolean
      displayOrder?: number
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Get existing selection
      const { data: existing } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', targetAssetId)
        .maybeSingle()

      const newOverride: SectionOverride = { section_id: sectionId }
      if (nameOverride !== undefined) newOverride.name_override = nameOverride || undefined
      if (isHidden !== undefined) newOverride.is_hidden = isHidden
      if (displayOrder !== undefined) newOverride.display_order = displayOrder

      // Check if this override has any actual values (not just section_id)
      const hasValues = newOverride.name_override || newOverride.is_hidden || newOverride.display_order !== undefined

      if (existing) {
        const currentOverrides: SectionOverride[] = existing.section_overrides || []
        const existingIndex = currentOverrides.findIndex(o => o.section_id === sectionId)

        let newOverrides: SectionOverride[]
        if (existingIndex >= 0) {
          if (hasValues) {
            // Update existing override
            newOverrides = [...currentOverrides]
            newOverrides[existingIndex] = newOverride
          } else {
            // Remove override if no values
            newOverrides = currentOverrides.filter(o => o.section_id !== sectionId)
          }
        } else if (hasValues) {
          // Add new override
          newOverrides = [...currentOverrides, newOverride]
        } else {
          return // Nothing to do
        }

        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({ section_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else if (hasValues) {
        // Create new selection with the section override
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .insert({
            user_id: user.id,
            asset_id: targetAssetId,
            layout_id: null,
            field_overrides: [],
            section_overrides: [newOverride]
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Create a new section (and optionally add it as an asset-specific override)
  const createSection = useMutation({
    mutationFn: async ({ name, addAsOverride = true }: { name: string; addAsOverride?: boolean }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // First get user's organization
      const { data: orgMembership, error: orgError } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (orgError || !orgMembership) throw new Error('Could not find organization')

      // Generate base slug from name
      const baseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

      // Check for existing sections with similar slugs to generate a unique one
      const { data: existingSections } = await supabase
        .from('research_sections')
        .select('slug')
        .eq('organization_id', orgMembership.organization_id)
        .like('slug', `${baseSlug}%`)

      // Find a unique slug
      let slug = baseSlug
      if (existingSections && existingSections.length > 0) {
        const existingSlugs = new Set(existingSections.map(s => s.slug))
        if (existingSlugs.has(baseSlug)) {
          let counter = 2
          while (existingSlugs.has(`${baseSlug}_${counter}`)) {
            counter++
          }
          slug = `${baseSlug}_${counter}`
        }
      }

      // Get max display order
      const { data: sections } = await supabase
        .from('research_sections')
        .select('display_order')
        .eq('organization_id', orgMembership.organization_id)
        .order('display_order', { ascending: false })
        .limit(1)

      const maxOrder = sections?.[0]?.display_order ?? 0

      const { data: newSection, error } = await supabase
        .from('research_sections')
        .insert({
          organization_id: orgMembership.organization_id,
          name,
          slug,
          display_order: maxOrder + 1,
          is_system: false
        })
        .select()
        .single()

      if (error) throw error

      // If assetId is provided and addAsOverride is true, add section override
      if (assetId && addAsOverride) {
        // Get existing selection or create new one
        const { data: existing } = await supabase
          .from('user_asset_layout_selections')
          .select('*')
          .eq('user_id', user.id)
          .eq('asset_id', assetId)
          .maybeSingle()

        const sectionOverride: SectionOverride = {
          section_id: newSection.id,
          is_added: true
        }

        if (existing) {
          const currentOverrides: SectionOverride[] = existing.section_overrides || []
          const { error: updateError } = await supabase
            .from('user_asset_layout_selections')
            .update({
              section_overrides: [...currentOverrides, sectionOverride]
            })
            .eq('id', existing.id)

          if (updateError) throw updateError
        } else {
          const { error: insertError } = await supabase
            .from('user_asset_layout_selections')
            .insert({
              user_id: user.id,
              asset_id: assetId,
              layout_id: null,
              field_overrides: [],
              section_overrides: [sectionOverride]
            })

          if (insertError) throw insertError
        }
      }

      return newSection
    },
    onMutate: async ({ name }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['all-research-sections', user?.id] })
      await queryClient.cancelQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })

      // Snapshot previous values
      const previousSections = queryClient.getQueryData(['all-research-sections', user?.id])
      const previousSelection = queryClient.getQueryData(['user-asset-layout-selection', user?.id, assetId])

      // Generate optimistic section with temp ID
      const tempId = `temp-${Date.now()}`
      const tempSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      const optimisticSection = {
        id: tempId,
        name,
        slug: tempSlug,
        display_order: 999,
        is_system: false
      }

      // Optimistically add section to allSections
      queryClient.setQueryData(['all-research-sections', user?.id], (old: any[] = []) => {
        return [...old, optimisticSection]
      })

      // Optimistically add section override to asset layout selection
      if (assetId) {
        queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], (old: any) => {
          const currentOverrides: SectionOverride[] = old?.section_overrides || []
          return {
            ...old,
            layout_id: old?.layout_id || null,
            layout: old?.layout || null,
            field_overrides: old?.field_overrides || [],
            section_overrides: [...currentOverrides, { section_id: tempId, is_added: true }]
          }
        })
      }

      return { previousSections, previousSelection, tempId }
    },
    onSuccess: (newSection, _vars, context) => {
      // Replace temp ID with real ID in the cache (no flash)
      if (context?.tempId && newSection) {
        // Update allSections: replace temp section with real one
        queryClient.setQueryData(['all-research-sections', user?.id], (old: any[] = []) => {
          return old.map(s => s.id === context.tempId ? {
            id: newSection.id,
            name: newSection.name,
            slug: newSection.slug,
            display_order: newSection.display_order,
            is_system: newSection.is_system
          } : s)
        })

        // Update asset layout selection: replace temp section_id with real one
        if (assetId) {
          queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], (old: any) => {
            if (!old) return old
            const updatedOverrides = (old.section_overrides || []).map((o: SectionOverride) =>
              o.section_id === context.tempId ? { ...o, section_id: newSection.id } : o
            )
            return { ...old, section_overrides: updatedOverrides }
          })
        }
      }
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previousSections) {
        queryClient.setQueryData(['all-research-sections', user?.id], context.previousSections)
      }
      if (context?.previousSelection) {
        queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], context.previousSelection)
      }
    }
  })

  // Delete a section that was added as an override for this asset
  const deleteAddedSection = useMutation({
    mutationFn: async ({ sectionId }: { sectionId: string }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Remove the section override from user_asset_layout_selections
      const { data: existing } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .maybeSingle()

      if (existing) {
        const currentOverrides: SectionOverride[] = existing.section_overrides || []
        const newOverrides = currentOverrides.filter(o => o.section_id !== sectionId)

        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({ section_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      }
    },
    onMutate: async ({ sectionId }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })

      // Snapshot previous value
      const previousSelection = queryClient.getQueryData(['user-asset-layout-selection', user?.id, assetId])

      // Optimistically remove section override
      queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], (old: any) => {
        if (!old) return old
        const currentOverrides: SectionOverride[] = old.section_overrides || []
        return {
          ...old,
          section_overrides: currentOverrides.filter(o => o.section_id !== sectionId)
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previousSelection) {
        queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], context.previousSelection)
      }
    },
    onSettled: () => {
      // Refetch to sync with server
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Reorder sections for this asset
  const reorderSections = useMutation({
    mutationFn: async ({ orderedSectionIds }: { orderedSectionIds: string[] }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Get existing selection
      const { data: existing } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .maybeSingle()

      // Build section overrides with new display_order
      const currentOverrides: SectionOverride[] = existing?.section_overrides || []
      const newOverrides: SectionOverride[] = orderedSectionIds.map((sectionId, index) => {
        const existingOverride = currentOverrides.find(o => o.section_id === sectionId)
        return {
          ...existingOverride,
          section_id: sectionId,
          display_order: index
        }
      })

      if (existing) {
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({ section_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .insert({
            user_id: user.id,
            asset_id: assetId,
            layout_id: null,
            field_overrides: [],
            section_overrides: newOverrides
          })

        if (error) throw error
      }
    },
    onMutate: async ({ orderedSectionIds }) => {
      await queryClient.cancelQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
      const previousSelection = queryClient.getQueryData(['user-asset-layout-selection', user?.id, assetId])

      // Optimistically update section order
      queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], (old: any) => {
        const currentOverrides: SectionOverride[] = old?.section_overrides || []
        const newOverrides: SectionOverride[] = orderedSectionIds.map((sectionId, index) => {
          const existingOverride = currentOverrides.find(o => o.section_id === sectionId)
          return {
            ...existingOverride,
            section_id: sectionId,
            display_order: index
          }
        })
        return {
          ...old,
          section_overrides: newOverrides
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSelection) {
        queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], context.previousSelection)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Reorder fields within a section for this asset
  const reorderFieldsInSection = useMutation({
    mutationFn: async ({ sectionId, orderedFieldIds, hiddenFieldIds = [] }: { sectionId: string; orderedFieldIds: string[]; hiddenFieldIds?: string[] }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Get existing selection
      const { data: existing } = await supabase
        .from('user_asset_layout_selections')
        .select('*')
        .eq('user_id', user.id)
        .eq('asset_id', assetId)
        .maybeSingle()

      // Build field overrides with new display_order
      const currentOverrides: FieldOverride[] = existing?.field_overrides || []

      // Update/add overrides for reordered fields
      const newOverrides = [...currentOverrides]
      orderedFieldIds.forEach((fieldId, index) => {
        const existingIdx = newOverrides.findIndex(o => o.field_id === fieldId)
        if (existingIdx >= 0) {
          newOverrides[existingIdx] = {
            ...newOverrides[existingIdx],
            is_visible: true,
            display_order: index,
            section_id: sectionId
          }
        } else {
          newOverrides.push({
            field_id: fieldId,
            is_visible: true,
            display_order: index,
            section_id: sectionId
          })
        }
      })

      // Update/add overrides for hidden fields (removed from section)
      hiddenFieldIds.forEach((fieldId) => {
        const existingIdx = newOverrides.findIndex(o => o.field_id === fieldId)
        if (existingIdx >= 0) {
          newOverrides[existingIdx] = {
            ...newOverrides[existingIdx],
            is_visible: false
          }
        } else {
          newOverrides.push({
            field_id: fieldId,
            is_visible: false,
            section_id: sectionId
          })
        }
      })

      if (existing) {
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .update({ field_overrides: newOverrides })
          .eq('id', existing.id)

        if (error) throw error
      } else {
        const { error } = await supabase
          .from('user_asset_layout_selections')
          .insert({
            user_id: user.id,
            asset_id: assetId,
            layout_id: null,
            field_overrides: newOverrides,
            section_overrides: []
          })

        if (error) throw error
      }
    },
    onMutate: async ({ sectionId, orderedFieldIds }) => {
      await queryClient.cancelQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
      const previousSelection = queryClient.getQueryData(['user-asset-layout-selection', user?.id, assetId])

      // Optimistically update field order
      queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], (old: any) => {
        const currentOverrides: FieldOverride[] = old?.field_overrides || []
        const newOverrides = [...currentOverrides]

        orderedFieldIds.forEach((fieldId, index) => {
          const existingIdx = newOverrides.findIndex(o => o.field_id === fieldId)
          if (existingIdx >= 0) {
            newOverrides[existingIdx] = {
              ...newOverrides[existingIdx],
              display_order: index,
              section_id: sectionId
            }
          } else {
            newOverrides.push({
              field_id: fieldId,
              is_visible: true,
              display_order: index,
              section_id: sectionId
            })
          }
        })

        return {
          ...old,
          field_overrides: newOverrides
        }
      })

      return { previousSelection }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousSelection) {
        queryClient.setQueryData(['user-asset-layout-selection', user?.id, assetId], context.previousSelection)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
    }
  })

  // Atomic save via RPC — single transaction, auth.uid() enforced server-side
  const saveCustomization = useMutation({
    mutationFn: async (params: {
      layoutId?: string | null
      fieldOverrides: FieldOverride[]
      sectionOverrides: SectionOverride[]
      newSections: Array<{ temp_id: string; name: string }>
      clearAll?: boolean
    }) => {
      if (!user?.id || !assetId) throw new Error('Not authenticated or no asset')

      // Pass current version for optimistic concurrency control
      const currentVersion = assetLayoutSelection?.version ?? null

      const { data, error } = await supabase.rpc('save_asset_layout_customization', {
        p_asset_id: assetId,
        p_layout_id: params.layoutId ?? null,
        p_field_overrides: params.fieldOverrides,
        p_section_overrides: params.sectionOverrides,
        p_new_sections: params.newSections,
        p_clear_all: params.clearAll ?? false,
        p_expected_version: currentVersion
      })

      if (error) {
        // Surface concurrency conflicts with a clear message
        if (error.message?.includes('CONFLICT:')) {
          throw new Error('This layout was modified in another tab or session. Please refresh and try again.')
        }
        throw error
      }
      return data as {
        status: string
        selection_id: string | null
        created_sections: Array<{ temp_id: string; real_id: string; name: string; slug: string }>
        version: number | null
      }
    },
    onSuccess: () => {
      // Invalidate all relevant queries to ensure fresh data
      queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user?.id, assetId] })
      queryClient.invalidateQueries({ queryKey: ['user-default-layout', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['all-research-sections', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['available-research-fields', user?.id] })
    }
  })

  // Helper to check if a field is visible (for use by other features)
  const isFieldVisible = (fieldId: string): boolean => {
    const field = fieldsWithPreferences.find(f => f.field_id === fieldId)
    return field?.is_visible ?? false
  }

  // Helper to check if a field is visible by slug (for use by other features)
  const isFieldVisibleBySlug = (fieldSlug: string): boolean => {
    const field = fieldsWithPreferences.find(f => f.field_slug === fieldSlug)
    return field?.is_visible ?? false
  }

  // Helper to get visible field IDs (for filtering contributions in other features)
  const getVisibleFieldIds = (): Set<string> => {
    return new Set(fieldsWithPreferences.filter(f => f.is_visible).map(f => f.field_id))
  }

  // Helper to get visible field slugs (for filtering contributions in other features)
  const getVisibleFieldSlugs = (): Set<string> => {
    return new Set(fieldsWithPreferences.filter(f => f.is_visible).map(f => f.field_slug))
  }

  return {
    // Data
    availableFields,
    allSections,
    fieldsWithPreferences,
    fieldsBySection,
    displayedFieldsBySection,
    activeLayout,
    defaultLayout,
    assetLayoutSelection,
    assetFieldOverrides,
    assetSectionOverrides,
    hasAssetCustomization,

    // Loading states
    isLoading: fieldsLoading || sectionsLoading || layoutLoading || (assetId ? assetLayoutLoading : false),

    // Mutations
    saveCustomization,
    toggleAssetFieldVisibility,
    addFieldToSection,
    removeFieldFromSection,
    selectLayoutForAsset,
    clearAssetOverrides,
    updateSectionOverride,
    createSection,
    deleteAddedSection,
    reorderSections,
    reorderFieldsInSection,

    // Helpers for field visibility (for use by other features)
    isFieldVisible,
    isFieldVisibleBySlug,
    getVisibleFieldIds,
    getVisibleFieldSlugs,

    // Mutation states
    isUpdating: toggleAssetFieldVisibility.isPending || updateSectionOverride.isPending
  }
}

export interface LayoutWithSharing extends SavedLayout {
  is_shared_with_me?: boolean
  shared_by?: {
    id: string
    first_name?: string
    last_name?: string
    email?: string
  }
  my_permission?: 'view' | 'edit' | 'admin' | 'owner'
}

/**
 * Fire-and-forget audit event for layout template CRUD.
 * Never throws — audit logging should not break main flow.
 */
async function logLayoutAuditEvent(
  userId: string,
  entityId: string,
  actionType: string,
  templateName: string
) {
  try {
    const { data: orgMembership } = await supabase
      .from('organization_memberships')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single()

    if (!orgMembership) return

    await supabase.from('audit_events').insert({
      actor_id: userId,
      actor_type: 'user',
      entity_type: 'layout_template',
      entity_id: entityId,
      entity_display_name: templateName,
      action_type: actionType,
      action_category: 'research_layout',
      metadata: { ui_source: 'template_manager' },
      org_id: orgMembership.organization_id,
      search_text: `${actionType} layout template ${templateName}`,
      checksum: `${userId}-${entityId}-${Date.now()}`
    })
  } catch {
    // Audit logging should never break the main flow
  }
}

/**
 * Hook to manage saved asset page layouts
 */
export function useUserAssetPageLayouts() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Fetch user's own layouts + layouts shared with them
  const { data: layouts, isLoading } = useQuery({
    queryKey: ['user-asset-page-layouts', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      // 1. Get user's own layouts
      const { data: ownLayouts, error: ownError } = await supabase
        .from('user_asset_page_layouts')
        .select('*')
        .eq('user_id', user.id)
        .order('name')

      if (ownError) throw ownError

      // 2. Get layouts shared with user directly
      const { data: directShares, error: directError } = await supabase
        .from('layout_collaborations')
        .select(`
          permission,
          layout:user_asset_page_layouts!layout_collaborations_layout_id_fkey(*)
        `)
        .eq('user_id', user.id)

      if (directError) throw directError

      // 3. Get layouts shared via teams user belongs to
      const { data: teamMemberships } = await supabase
        .from('team_memberships')
        .select('team_id')
        .eq('user_id', user.id)

      const teamIds = (teamMemberships || []).map(tm => tm.team_id)

      let teamShares: any[] = []
      if (teamIds.length > 0) {
        const { data, error: teamError } = await supabase
          .from('layout_collaborations')
          .select(`
            permission,
            layout:user_asset_page_layouts!layout_collaborations_layout_id_fkey(*)
          `)
          .in('team_id', teamIds)

        if (teamError) throw teamError
        teamShares = data || []
      }

      // 4. Get layouts shared via org nodes user belongs to
      const { data: nodeMemberships } = await supabase
        .from('org_chart_node_members')
        .select('node_id')
        .eq('user_id', user.id)

      const nodeIds = (nodeMemberships || []).map(nm => nm.node_id)

      let nodeShares: any[] = []
      if (nodeIds.length > 0) {
        const { data, error: nodeError } = await supabase
          .from('layout_collaborations')
          .select(`
            permission,
            layout:user_asset_page_layouts!layout_collaborations_layout_id_fkey(*)
          `)
          .in('org_node_id', nodeIds)

        if (nodeError) throw nodeError
        nodeShares = data || []
      }

      // 5. Get layouts shared with entire organization
      const { data: orgMembership } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      let orgShares: any[] = []
      if (orgMembership) {
        const { data, error: orgError } = await supabase
          .from('layout_collaborations')
          .select(`
            permission,
            layout:user_asset_page_layouts!layout_collaborations_layout_id_fkey(*)
          `)
          .is('user_id', null)
          .is('team_id', null)
          .is('org_node_id', null)

        if (orgError) throw orgError
        orgShares = data || []
      }

      // Combine all shared layouts
      const allShares = [...directShares || [], ...teamShares, ...nodeShares, ...orgShares]

      // Collect unique owner user IDs to fetch their info
      const ownerUserIds = new Set<string>()
      for (const share of allShares) {
        if (share.layout?.user_id && share.layout.user_id !== user.id) {
          ownerUserIds.add(share.layout.user_id)
        }
      }

      // Fetch owner info from public.users
      let ownersMap = new Map<string, { id: string; first_name?: string; last_name?: string; email?: string }>()
      if (ownerUserIds.size > 0) {
        const { data: owners } = await supabase
          .from('users')
          .select('id, first_name, last_name, email')
          .in('id', Array.from(ownerUserIds))

        for (const owner of owners || []) {
          ownersMap.set(owner.id, owner)
        }
      }

      // Deduplicate and find highest permission for each layout
      const sharedLayoutsMap = new Map<string, { permission: string; layout: any; owner?: any }>()
      for (const share of allShares) {
        if (!share.layout || share.layout.user_id === user.id) continue // Skip own layouts

        const existing = sharedLayoutsMap.get(share.layout.id)
        const permissionRank = { view: 1, edit: 2, admin: 3 }
        const currentRank = permissionRank[share.permission as keyof typeof permissionRank] || 0
        const existingRank = existing ? permissionRank[existing.permission as keyof typeof permissionRank] || 0 : 0

        if (!existing || currentRank > existingRank) {
          const owner = ownersMap.get(share.layout.user_id)
          sharedLayoutsMap.set(share.layout.id, { ...share, owner })
        }
      }

      // Format own layouts
      const formattedOwnLayouts: LayoutWithSharing[] = (ownLayouts || []).map(layout => ({
        ...layout,
        is_shared_with_me: false,
        my_permission: 'owner' as const
      }))

      // Format shared layouts
      const formattedSharedLayouts: LayoutWithSharing[] = Array.from(sharedLayoutsMap.values()).map(share => ({
        ...share.layout,
        is_shared_with_me: true,
        shared_by: share.owner,
        my_permission: share.permission as 'view' | 'edit' | 'admin'
      }))

      // Combine and sort
      const allLayouts = [...formattedOwnLayouts, ...formattedSharedLayouts]
      allLayouts.sort((a, b) => a.name.localeCompare(b.name))

      return allLayouts
    },
    enabled: !!user?.id
  })

  // Save current layout
  const saveLayout = useMutation({
    mutationFn: async ({
      name,
      description,
      fieldConfig,
      isDefault = false
    }: {
      name: string
      description?: string
      fieldConfig: FieldConfigItem[]
      isDefault?: boolean
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // If setting as default, clear other defaults first
      if (isDefault) {
        await supabase
          .from('user_asset_page_layouts')
          .update({ is_default: false })
          .eq('user_id', user.id)
      }

      const { data, error } = await supabase
        .from('user_asset_page_layouts')
        .insert({
          user_id: user.id,
          name,
          description: description || null,
          is_default: isDefault,
          field_config: fieldConfig
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onMutate: async ({ name, description, fieldConfig, isDefault }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['user-asset-page-layouts', user?.id] })

      // Snapshot previous value
      const previousLayouts = queryClient.getQueryData(['user-asset-page-layouts', user?.id])

      // Optimistically add the new layout
      const optimisticLayout: LayoutWithSharing = {
        id: `temp-${Date.now()}`,
        user_id: user?.id || '',
        name,
        description: description || null,
        is_default: isDefault || false,
        field_config: fieldConfig,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_shared_with_me: false,
        my_permission: 'owner'
      }

      queryClient.setQueryData(['user-asset-page-layouts', user?.id], (old: LayoutWithSharing[] = []) => {
        // If setting as default, clear other defaults
        const updated = isDefault
          ? old.map(l => ({ ...l, is_default: false }))
          : old
        return [...updated, optimisticLayout].sort((a, b) => a.name.localeCompare(b.name))
      })

      return { previousLayouts }
    },
    onError: (_err, _vars, context) => {
      // Rollback on error
      if (context?.previousLayouts) {
        queryClient.setQueryData(['user-asset-page-layouts', user?.id], context.previousLayouts)
      }
    },
    onSettled: (_data, _err, vars) => {
      // Refetch to sync with server
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
      // Also invalidate default layout query so preferences hook picks up changes
      queryClient.invalidateQueries({ queryKey: ['user-default-layout', user?.id] })

      // Fire-and-forget audit event for template creation
      if (_data && !_err && user?.id) {
        logLayoutAuditEvent(user.id, _data.id, 'create', vars.name)
      }
    }
  })

  // Update layout
  const updateLayout = useMutation({
    mutationFn: async ({
      layoutId,
      name,
      description,
      fieldConfig,
      isDefault
    }: {
      layoutId: string
      name?: string
      description?: string
      fieldConfig?: FieldConfigItem[]
      isDefault?: boolean
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // If setting as default, clear other defaults first
      if (isDefault) {
        await supabase
          .from('user_asset_page_layouts')
          .update({ is_default: false })
          .eq('user_id', user.id)
      }

      const updates: Partial<SavedLayout> = {}
      if (name !== undefined) updates.name = name
      if (description !== undefined) updates.description = description
      if (fieldConfig !== undefined) updates.field_config = fieldConfig
      if (isDefault !== undefined) updates.is_default = isDefault

      const { error } = await supabase
        .from('user_asset_page_layouts')
        .update(updates)
        .eq('id', layoutId)

      if (error) throw error
    },
    onMutate: async ({ layoutId, name, description, fieldConfig, isDefault }) => {
      await queryClient.cancelQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
      const previousLayouts = queryClient.getQueryData(['user-asset-page-layouts', user?.id])

      queryClient.setQueryData(['user-asset-page-layouts', user?.id], (old: LayoutWithSharing[] = []) => {
        return old.map(layout => {
          // Clear other defaults if setting this as default
          if (isDefault && layout.id !== layoutId) {
            return { ...layout, is_default: false }
          }
          if (layout.id !== layoutId) return layout
          return {
            ...layout,
            ...(name !== undefined && { name }),
            ...(description !== undefined && { description }),
            ...(fieldConfig !== undefined && { field_config: fieldConfig }),
            ...(isDefault !== undefined && { is_default: isDefault }),
            updated_at: new Date().toISOString()
          }
        }).sort((a, b) => a.name.localeCompare(b.name))
      })

      return { previousLayouts }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousLayouts) {
        queryClient.setQueryData(['user-asset-page-layouts', user?.id], context.previousLayouts)
      }
    },
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['user-default-layout', user?.id] })

      // Fire-and-forget audit event for template update
      if (!_err && user?.id) {
        const layout = layouts?.find(l => l.id === vars.layoutId)
        logLayoutAuditEvent(user.id, vars.layoutId, 'update_fields', layout?.name || vars.name || 'Unknown')
      }
    }
  })

  // Delete layout
  const deleteLayout = useMutation({
    mutationFn: async (layoutId: string) => {
      const { error } = await supabase
        .from('user_asset_page_layouts')
        .delete()
        .eq('id', layoutId)

      if (error) throw error
    },
    onMutate: async (layoutId) => {
      await queryClient.cancelQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
      const previousLayouts = queryClient.getQueryData(['user-asset-page-layouts', user?.id]) as LayoutWithSharing[] | undefined
      const deletedName = previousLayouts?.find(l => l.id === layoutId)?.name

      queryClient.setQueryData(['user-asset-page-layouts', user?.id], (old: LayoutWithSharing[] = []) => {
        return old.filter(layout => layout.id !== layoutId)
      })

      return { previousLayouts, deletedName }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousLayouts) {
        queryClient.setQueryData(['user-asset-page-layouts', user?.id], context.previousLayouts)
      }
    },
    onSettled: (_data, _err, layoutId, context) => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
      // Deleted template may have been the default — refetch
      queryClient.invalidateQueries({ queryKey: ['user-default-layout', user?.id] })

      // Fire-and-forget audit event for template deletion
      if (!_err && user?.id) {
        logLayoutAuditEvent(user.id, layoutId, 'delete', context?.deletedName || 'Unknown')
      }
    }
  })

  // Get default layout
  const defaultLayout = layouts?.find(l => l.is_default)

  // Dev diagnostics: warn about data integrity issues
  useEffect(() => {
    if (!layouts || layouts.length === 0) return
    warnDataIntegrityIssues(
      layouts.map(l => ({ id: l.id, name: l.name, field_config: l.field_config, is_default: l.is_default })),
      { userId: user?.id }
    )
  }, [layouts, user?.id])

  return {
    layouts,
    defaultLayout,
    isLoading,
    saveLayout,
    updateLayout,
    deleteLayout,
    isSaving: saveLayout.isPending
  }
}

// ============================================================================
// LAYOUT USAGE METRICS
// ============================================================================

import type {
  LayoutUsageMetric,
  LayoutCollaborationSummary,
} from '../lib/research/layout-card-model'

/**
 * Fetches per-layout usage counts from user_asset_layout_selections.
 *
 * Returns:
 *  - perLayout: LayoutUsageMetric[] (assets_using + assets_with_overrides per layout_id)
 *  - globalOverrideCount: total assets with any overrides (field or section)
 */
export function useLayoutUsageMetrics() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['layout-usage-metrics', user?.id],
    queryFn: async () => {
      if (!user?.id) return { perLayout: [] as LayoutUsageMetric[], globalOverrideCount: 0 }

      // Fetch all layout selections for this user
      const { data, error } = await supabase
        .from('user_asset_layout_selections')
        .select('layout_id, field_overrides, section_overrides')
        .eq('user_id', user.id)

      if (error) throw error
      const rows = data || []

      // Aggregate per layout
      const layoutMap = new Map<string, { assets_using: number; assets_with_overrides: number }>()
      let globalOverrideCount = 0

      for (const row of rows) {
        const lid = row.layout_id || '__none__'
        const entry = layoutMap.get(lid) || { assets_using: 0, assets_with_overrides: 0 }
        entry.assets_using++

        const hasOverrides =
          (Array.isArray(row.field_overrides) && row.field_overrides.length > 0) ||
          (Array.isArray(row.section_overrides) && row.section_overrides.length > 0)

        if (hasOverrides) {
          entry.assets_with_overrides++
          globalOverrideCount++
        }

        layoutMap.set(lid, entry)
      }

      const perLayout: LayoutUsageMetric[] = Array.from(layoutMap.entries())
        .filter(([key]) => key !== '__none__')
        .map(([layout_id, counts]) => ({
          layout_id,
          ...counts,
        }))

      return { perLayout, globalOverrideCount }
    },
    enabled: !!user?.id,
    staleTime: 30_000, // Cache for 30s — usage counts don't need to be real-time
  })
}

/**
 * Fetches collaboration summary per owned layout for scope derivation.
 *
 * Returns an array of LayoutCollaborationSummary — one per layout that has collaborations.
 * Layouts with no collaborations won't appear (scope defaults to 'personal').
 */
export function useLayoutCollabSummaries() {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['layout-collab-summaries', user?.id],
    queryFn: async () => {
      if (!user?.id) return [] as LayoutCollaborationSummary[]

      // Step 1: Get owned layout IDs
      const { data: layouts } = await supabase
        .from('user_asset_page_layouts')
        .select('id')
        .eq('user_id', user.id)

      if (!layouts || layouts.length === 0) return [] as LayoutCollaborationSummary[]

      // Step 2: Get all collaborations for those layouts
      const layoutIds = layouts.map(l => l.id)
      const { data: collabs, error } = await supabase
        .from('layout_collaborations')
        .select('layout_id, user_id, team_id, org_node_id')
        .in('layout_id', layoutIds)

      if (error) throw error

      return aggregateCollabSummaries(collabs || [])
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  })
}

function aggregateCollabSummaries(
  rows: Array<{ layout_id: string; user_id: string | null; team_id: string | null; org_node_id: string | null }>
): LayoutCollaborationSummary[] {
  const map = new Map<string, LayoutCollaborationSummary>()

  for (const row of rows) {
    const entry = map.get(row.layout_id) || {
      layout_id: row.layout_id,
      has_org_wide_share: false,
      has_team_share: false,
      has_user_share: false,
    }

    // Org-wide: all target fields are null
    if (!row.user_id && !row.team_id && !row.org_node_id) {
      entry.has_org_wide_share = true
    } else if (row.team_id || row.org_node_id) {
      entry.has_team_share = true
    } else if (row.user_id) {
      entry.has_user_share = true
    }

    map.set(row.layout_id, entry)
  }

  return Array.from(map.values())
}

// ============================================================================
// AFFECTED ASSETS — for summary tile drilldown drawers
// ============================================================================

export interface AffectedAsset {
  asset_id: string
  symbol: string
  company_name: string
  layout_id: string | null
  layout_name: string | null
  has_overrides: boolean
  updated_at: string | null
}

/**
 * Fetches the list of assets that have layout selections (custom layout or overrides).
 * Used by the summary tile drilldown drawers to show exactly which assets are affected.
 *
 * kind = 'custom_layouts' → assets where layout_id is set (non-default)
 * kind = 'overrides'      → assets with field or section overrides
 * kind = 'by_layout'      → assets assigned to a specific layout (requires layoutId)
 *
 * Lazy-loaded: only runs when `enabled` is true (drawer is open).
 */
export function useAffectedAssets(
  kind: 'custom_layouts' | 'overrides' | 'by_layout',
  enabled: boolean,
  layoutId?: string | null,
) {
  const { user } = useAuth()

  return useQuery({
    queryKey: ['affected-assets', kind, layoutId ?? null, user?.id],
    queryFn: async (): Promise<AffectedAsset[]> => {
      if (!user?.id) return []

      let query = supabase
        .from('user_asset_layout_selections')
        .select(`
          asset_id,
          layout_id,
          field_overrides,
          section_overrides,
          updated_at,
          asset:assets!user_asset_layout_selections_asset_id_fkey(id, symbol, company_name),
          layout:user_asset_page_layouts!user_asset_layout_selections_layout_id_fkey(id, name)
        `)
        .eq('user_id', user.id)

      // For by_layout, filter at the DB level for efficiency
      if (kind === 'by_layout' && layoutId) {
        query = query.eq('layout_id', layoutId)
      }

      const { data, error } = await query

      if (error) throw error
      if (!data) return []

      return data
        .map(row => {
          const asset = row.asset as any
          const layout = row.layout as any
          if (!asset) return null

          const hasOverrides =
            (Array.isArray(row.field_overrides) && row.field_overrides.length > 0) ||
            (Array.isArray(row.section_overrides) && row.section_overrides.length > 0)

          return {
            asset_id: asset.id,
            symbol: asset.symbol || '???',
            company_name: asset.company_name || '',
            layout_id: row.layout_id,
            layout_name: layout?.name || null,
            has_overrides: hasOverrides,
            updated_at: row.updated_at,
          } as AffectedAsset
        })
        .filter((a): a is AffectedAsset => a !== null)
    },
    enabled: enabled && !!user?.id,
    staleTime: 30_000,
  })
}
