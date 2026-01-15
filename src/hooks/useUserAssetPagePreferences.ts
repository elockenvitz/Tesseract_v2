/**
 * useUserAssetPagePreferences Hook
 *
 * Manages user-specific preferences for asset page research field layout.
 * Allows users to show/hide fields, reorder them, and save named layouts.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

// Types
export interface FieldPreference {
  id: string
  user_id: string
  field_id: string
  is_visible: boolean
  display_order: number | null
  is_collapsed: boolean
  created_at: string
  updated_at: string
}

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

      // console.log('Asset layout selection fetched:', {
      //   assetId,
      //   layout_id: data?.layout_id,
      //   layout_name: data?.layout?.name,
      //   has_layout: !!data?.layout
      // })

      return data as {
        layout_id: string | null
        layout: SavedLayout | null
        field_overrides: FieldOverride[] | null
        section_overrides: SectionOverride[] | null
      } | null
    },
    enabled: !!user?.id && !!assetId,
    staleTime: 0, // Always refetch to ensure fresh data
    refetchOnMount: 'always'
  })

  // Fetch user's field preferences (fallback for legacy support)
  const { data: preferences, isLoading: preferencesLoading } = useQuery({
    queryKey: ['user-asset-page-preferences', user?.id],
    queryFn: async () => {
      if (!user?.id) return []

      const { data, error } = await supabase
        .from('user_asset_page_preferences')
        .select('*')
        .eq('user_id', user.id)

      if (error) throw error
      return (data || []) as FieldPreference[]
    },
    enabled: !!user?.id
  })

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

  // Determine which layout to use:
  // 1. Asset-specific layout selection (if assetId provided and selection exists)
  // 2. User's default layout
  // 3. System default (all fields visible)
  const activeLayout = assetLayoutSelection?.layout || defaultLayout

  // Get asset-specific field overrides (if any)
  const assetFieldOverrides = assetLayoutSelection?.field_overrides || []

  // Get asset-specific section overrides (if any)
  const assetSectionOverrides: SectionOverride[] = assetLayoutSelection?.section_overrides || []

  // Check if this asset has any customizations (layout or overrides)
  const hasAssetCustomization = !!(assetLayoutSelection?.layout_id || assetFieldOverrides.length > 0 || assetSectionOverrides.length > 0)

  // Combine fields with preferences from active layout
  const fieldsWithPreferences: FieldWithPreference[] = (availableFields || []).map(field => {
    const defaultSection = field.research_sections as { id: string; name: string; slug: string; display_order: number }

    // Check asset-specific overrides first (highest priority)
    const assetOverride = assetFieldOverrides.find(o => o.field_id === field.id)

    // Check layout's field_config (template section assignment)
    // Need to handle preset field IDs which may have timestamps like "preset-slug-1234567890"
    const layoutConfig = activeLayout?.field_config?.find(fc => {
      // Direct ID match
      if (fc.field_id === field.id) return true
      // Match preset fields by slug (handles timestamp variations)
      if (fc.field_id.startsWith('preset-') && field.slug) {
        const parts = fc.field_id.split('-')
        if (parts.length >= 2) {
          // Extract slug: "preset-some_slug-123456789" -> "some_slug"
          // or "preset-some_slug" -> "some_slug"
          const lastPart = parts[parts.length - 1]
          const isTimestamp = /^\d+$/.test(lastPart)
          const slug = isTimestamp ? parts.slice(1, -1).join('-') : parts.slice(1).join('-')
          if (slug === field.slug) return true
        }
      }
      return false
    })

    // Determine section: asset override > template section > default section
    const overrideSectionId = assetOverride?.section_id || layoutConfig?.section_id
    let section = defaultSection
    if (overrideSectionId && allSections) {
      const overrideSection = allSections.find(s => s.id === overrideSectionId)
      if (overrideSection) {
        section = overrideSection as typeof defaultSection
      }
    }

    // Fallback to individual preferences (legacy support)
    const pref = preferences?.find(p => p.field_id === field.id)

    // A field is "custom" if it was created by a user (has created_by set)
    // Standard fields have created_by = null
    const isCustomField = !!(field as any).created_by
    const creator = (field as any).creator as { id: string; first_name: string; last_name: string } | null

    // Check if we're using a custom template with field_config
    const isUsingCustomTemplate = activeLayout && activeLayout.field_config && activeLayout.field_config.length > 0

    // For Default template: only universal fields are visible by default
    // Universal fields are the core fields that define the Default template
    const defaultVisible = field.is_universal === true

    // Priority: asset override > layout config > template default > individual pref > default
    // When using a custom template, fields NOT in the template's config should be hidden
    let isVisible: boolean
    if (assetOverride?.is_visible !== undefined) {
      // Asset-specific override takes highest priority
      isVisible = assetOverride.is_visible
    } else if (layoutConfig) {
      // Field is in the template config - use its visibility setting
      isVisible = layoutConfig.is_visible
    } else if (isUsingCustomTemplate) {
      // Using custom template but field is NOT in its config - field should be hidden
      isVisible = false
    } else {
      // Not using custom template (Default) - fall through to pref or defaultVisible
      isVisible = pref?.is_visible ?? defaultVisible
    }
    const displayOrder = assetOverride?.display_order ?? layoutConfig?.display_order ?? pref?.display_order ?? null
    const isCollapsed = layoutConfig?.is_collapsed ?? pref?.is_collapsed ?? false

    return {
      field_id: field.id,
      field_name: field.name,
      field_slug: field.slug,
      field_description: (field as any).description || null,
      field_type: field.field_type,
      section_id: section.id,
      section_name: section.name,
      section_slug: section.slug,
      default_section_id: defaultSection.id, // Track original section
      is_visible: isVisible,
      display_order: displayOrder,
      default_display_order: (field as any).display_order ?? 0,
      is_collapsed: isCollapsed,
      is_universal: field.is_universal,
      is_system: (field as any).is_system ?? false,
      is_custom: isCustomField,
      has_custom_preference: !!assetOverride || !!layoutConfig || !!pref,
      has_section_override: !!overrideSectionId,
      created_by: (field as any).created_by || null,
      creator_name: creator ? `${creator.first_name} ${creator.last_name}`.trim() : null,
      created_at: (field as any).created_at || null
    }
  })

  // Debug: Log visibility summary (disabled for performance)
  // const visibleFields = fieldsWithPreferences.filter(f => f.is_visible)
  // const hiddenFields = fieldsWithPreferences.filter(f => !f.is_visible)
  // console.log('👁️ Field Visibility Summary:', {
  //   totalFields: fieldsWithPreferences.length,
  //   visibleCount: visibleFields.length,
  //   hiddenCount: hiddenFields.length,
  //   visibleFields: visibleFields.map(f => ({ name: f.field_name, section: f.section_slug })),
  //   hiddenFields: hiddenFields.map(f => ({ name: f.field_name, section: f.section_slug }))
  // })

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

  // Helper to check if a field is in the template (handles preset field ID matching)
  const isFieldInTemplate = (fieldId: string, fieldSlug: string): boolean => {
    return templateFieldConfig.some(fc => {
      // Direct ID match
      if (fc.field_id === fieldId) return true
      // Match preset fields by slug (handles timestamp variations)
      if (fc.field_id.startsWith('preset-') && fieldSlug) {
        const parts = fc.field_id.split('-')
        if (parts.length >= 2) {
          const lastPart = parts[parts.length - 1]
          const isTimestamp = /^\d+$/.test(lastPart)
          const slug = isTimestamp ? parts.slice(1, -1).join('-') : parts.slice(1).join('-')
          if (slug === fieldSlug) return true
        }
      }
      return false
    })
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

  // Update field preference
  const updatePreference = useMutation({
    mutationFn: async ({
      fieldId,
      isVisible,
      displayOrder,
      isCollapsed
    }: {
      fieldId: string
      isVisible?: boolean
      displayOrder?: number | null
      isCollapsed?: boolean
    }) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Check if preference exists
      const existingPref = preferences?.find(p => p.field_id === fieldId)

      if (existingPref) {
        // Update existing
        const updates: Partial<FieldPreference> = {}
        if (isVisible !== undefined) updates.is_visible = isVisible
        if (displayOrder !== undefined) updates.display_order = displayOrder
        if (isCollapsed !== undefined) updates.is_collapsed = isCollapsed

        const { error } = await supabase
          .from('user_asset_page_preferences')
          .update(updates)
          .eq('id', existingPref.id)

        if (error) throw error
      } else {
        // Insert new
        const { error } = await supabase
          .from('user_asset_page_preferences')
          .insert({
            user_id: user.id,
            field_id: fieldId,
            is_visible: isVisible ?? true,
            display_order: displayOrder ?? null,
            is_collapsed: isCollapsed ?? false
          })

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-preferences', user?.id] })
    }
  })

  // Toggle field visibility (global preference - affects all assets)
  const toggleFieldVisibility = useMutation({
    mutationFn: async (fieldId: string) => {
      const field = fieldsWithPreferences.find(f => f.field_id === fieldId)
      if (!field) throw new Error('Field not found')

      await updatePreference.mutateAsync({
        fieldId,
        isVisible: !field.is_visible
      })
    }
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
        templateDefaultVisibility = field.is_universal === true // Default template = universal visible
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

  // Toggle field collapsed state
  const toggleFieldCollapsed = useMutation({
    mutationFn: async (fieldId: string) => {
      const field = fieldsWithPreferences.find(f => f.field_id === fieldId)
      if (!field) throw new Error('Field not found')

      await updatePreference.mutateAsync({
        fieldId,
        isCollapsed: !field.is_collapsed
      })
    }
  })

  // Bulk update field order
  const updateFieldOrder = useMutation({
    mutationFn: async (orderedFieldIds: string[]) => {
      if (!user?.id) throw new Error('Not authenticated')

      // Update each field with its new order
      const updates = orderedFieldIds.map((fieldId, index) => ({
        user_id: user.id,
        field_id: fieldId,
        display_order: index,
        is_visible: fieldsWithPreferences.find(f => f.field_id === fieldId)?.is_visible ?? true,
        is_collapsed: fieldsWithPreferences.find(f => f.field_id === fieldId)?.is_collapsed ?? false
      }))

      // Upsert all preferences
      const { error } = await supabase
        .from('user_asset_page_preferences')
        .upsert(updates, { onConflict: 'user_id,field_id' })

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-preferences', user?.id] })
    }
  })

  // Reset all preferences to default
  const resetToDefaults = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Not authenticated')

      const { error } = await supabase
        .from('user_asset_page_preferences')
        .delete()
        .eq('user_id', user.id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-preferences', user?.id] })
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
    preferences,
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
    isLoading: preferencesLoading || fieldsLoading || sectionsLoading || layoutLoading || (assetId ? assetLayoutLoading : false),

    // Mutations
    updatePreference,
    toggleFieldVisibility,
    toggleAssetFieldVisibility,
    addFieldToSection,
    removeFieldFromSection,
    toggleFieldCollapsed,
    updateFieldOrder,
    resetToDefaults,
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
    isUpdating: updatePreference.isPending || toggleFieldVisibility.isPending || toggleAssetFieldVisibility.isPending || toggleFieldCollapsed.isPending || updateSectionOverride.isPending,
    isResetting: resetToDefaults.isPending
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
    onSettled: () => {
      // Refetch to sync with server
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
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
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
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
      const previousLayouts = queryClient.getQueryData(['user-asset-page-layouts', user?.id])

      queryClient.setQueryData(['user-asset-page-layouts', user?.id], (old: LayoutWithSharing[] = []) => {
        return old.filter(layout => layout.id !== layoutId)
      })

      return { previousLayouts }
    },
    onError: (_err, _vars, context) => {
      if (context?.previousLayouts) {
        queryClient.setQueryData(['user-asset-page-layouts', user?.id], context.previousLayouts)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
    }
  })

  // Apply layout (sets preferences from saved layout)
  const applyLayout = useMutation({
    mutationFn: async (layoutId: string) => {
      if (!user?.id) throw new Error('Not authenticated')

      const layout = layouts?.find(l => l.id === layoutId)
      if (!layout) throw new Error('Layout not found')

      // Delete existing preferences
      await supabase
        .from('user_asset_page_preferences')
        .delete()
        .eq('user_id', user.id)

      // Insert preferences from layout
      if (layout.field_config.length > 0) {
        const prefs = layout.field_config.map(config => ({
          user_id: user.id,
          field_id: config.field_id,
          is_visible: config.is_visible,
          display_order: config.display_order,
          is_collapsed: config.is_collapsed
        }))

        const { error } = await supabase
          .from('user_asset_page_preferences')
          .insert(prefs)

        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-preferences', user?.id] })
      queryClient.invalidateQueries({ queryKey: ['user-asset-page-layouts', user?.id] })
    }
  })

  // Get default layout
  const defaultLayout = layouts?.find(l => l.is_default)

  return {
    layouts,
    defaultLayout,
    isLoading,
    saveLayout,
    updateLayout,
    deleteLayout,
    applyLayout,
    isSaving: saveLayout.isPending,
    isApplying: applyLayout.isPending
  }
}
