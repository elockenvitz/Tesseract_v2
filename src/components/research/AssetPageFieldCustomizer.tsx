/**
 * AssetPageFieldCustomizer Component
 *
 * Allows users to customize which research fields appear on their asset pages.
 * Shows ALL sections and fields from the field library, with visibility toggles.
 * Changes are saved as asset-specific overrides.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  pointerWithin,
  rectIntersection,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
  Star,
  Layout,
  Check,
  Copy,
  RotateCcw,
  Settings2,
  AlertCircle,
  Plus,
  Search,
  Pencil,
  EyeOffIcon,
  Trash2,
  MoreVertical,
  FolderPlus,
  GripVertical,
  ArrowRight,
  FileText,
  Hash,
  Calendar,
  CheckSquare,
  Clock,
  Gauge
} from 'lucide-react'
import {
  useUserAssetPagePreferences,
  useUserAssetPageLayouts,
  type FieldWithPreference,
  type LayoutWithSharing,
  type SectionOverride,
  type FieldOverride
} from '../../hooks/useUserAssetPagePreferences'
import { useResearchFields } from '../../hooks/useResearchFields'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'

// Draft state types for local changes before saving
interface DraftFieldOverride {
  field_id: string
  is_visible: boolean
  section_id?: string
  display_order?: number
}

interface DraftSectionOverride {
  section_id: string
  name_override?: string
  is_hidden?: boolean
  display_order?: number
  is_added?: boolean
}

interface DraftNewSection {
  temp_id: string
  name: string
}
import { Button } from '../ui/Button'

interface AssetPageFieldCustomizerProps {
  isOpen: boolean
  onClose: () => void
  assetId?: string
  assetName?: string
  /** Current view filter: 'aggregated' or a user ID */
  viewFilter?: 'aggregated' | string
  /** Current user's ID */
  currentUserId?: string
}

export function AssetPageFieldCustomizer({
  isOpen,
  onClose,
  assetId,
  assetName,
  viewFilter = 'aggregated',
  currentUserId
}: AssetPageFieldCustomizerProps) {
  // Can only change layout when viewing own view (not aggregated or other users' views)
  const isViewingOwnView = viewFilter === currentUserId
  const canChangeLayout = isViewingOwnView

  const {
    fieldsWithPreferences,
    fieldsBySection,
    allSections,
    activeLayout,
    assetLayoutSelection,
    assetFieldOverrides,
    assetSectionOverrides,
    hasAssetCustomization,
    isLoading,
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
    isUpdating
  } = useUserAssetPagePreferences(assetId)

  const {
    layouts,
    isLoading: layoutsLoading,
    saveLayout
  } = useUserAssetPageLayouts()

  const { createField, deleteField, isDeleting: isDeletingField } = useResearchFields()
  const { user } = useAuth()
  const [fieldToDelete, setFieldToDelete] = useState<{ id: string; name: string } | null>(null)
  const queryClient = useQueryClient()

  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set())
  const [showTemplateSelector, setShowTemplateSelector] = useState(false)
  const [showCopyDialog, setShowCopyDialog] = useState(false)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [addFieldSearch, setAddFieldSearch] = useState('')

  // Expand library categories
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Section creation state
  const [showCreateSection, setShowCreateSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')
  const [pendingFieldForNewSection, setPendingFieldForNewSection] = useState<string | null>(null)
  const sectionNameInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus section name input when creating a new section
  useEffect(() => {
    if (showCreateSection) {
      // Small delay to ensure the input is rendered
      setTimeout(() => {
        sectionNameInputRef.current?.focus()
      }, 50)
    }
  }, [showCreateSection])

  // Field creation state
  const [showCreateField, setShowCreateField] = useState(false)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState('rich_text')
  const [newFieldCategory, setNewFieldCategory] = useState<string>('')
  const [isCreatingField, setIsCreatingField] = useState(false)

  // ============================================
  // DRAFT STATE - Changes are only saved on "Done"
  // ============================================
  const [draftFieldOverrides, setDraftFieldOverrides] = useState<Map<string, DraftFieldOverride>>(new Map())
  const [draftSectionOverrides, setDraftSectionOverrides] = useState<Map<string, DraftSectionOverride>>(new Map())
  const [draftNewSections, setDraftNewSections] = useState<DraftNewSection[]>([])
  const [draftLayoutId, setDraftLayoutId] = useState<string | null | undefined>(undefined) // undefined = no change
  const [isSaving, setIsSaving] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const hasInitializedRef = useRef(false)

  // Initialize draft state when modal opens
  useEffect(() => {
    if (isOpen && !isLoading && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      // Initialize from current overrides
      const fieldMap = new Map<string, DraftFieldOverride>()
      for (const override of assetFieldOverrides) {
        fieldMap.set(override.field_id, { ...override })
      }
      setDraftFieldOverrides(fieldMap)

      const sectionMap = new Map<string, DraftSectionOverride>()
      for (const override of assetSectionOverrides) {
        sectionMap.set(override.section_id, { ...override })
      }
      setDraftSectionOverrides(sectionMap)

      setDraftNewSections([])
      setDraftLayoutId(undefined) // No change to layout yet
      setHasUnsavedChanges(false)
    }
    // Reset init flag when modal closes
    if (!isOpen) {
      hasInitializedRef.current = false
    }
  }, [isOpen, isLoading, assetFieldOverrides, assetSectionOverrides])

  // Field addition with section picker
  const [addingFieldId, setAddingFieldId] = useState<string | null>(null)
  const [addFieldPosition, setAddFieldPosition] = useState<{ top: number; left: number } | null>(null)

  // Section editing state
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingSectionName, setEditingSectionName] = useState('')
  const [sectionMenuOpen, setSectionMenuOpen] = useState<string | null>(null)
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const menuOpenRef = useRef<string | null>(null)

  // Discard confirmation dialog
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  // Drag and drop state
  const [activeDragId, setActiveDragId] = useState<string | null>(null)
  const [activeDragType, setActiveDragType] = useState<'section' | 'field' | 'library-field' | null>(null)
  const [dragOverSectionId, setDragOverSectionId] = useState<string | null>(null)
  const [dragOverPositionId, setDragOverPositionId] = useState<string | null>(null)
  const [draggedFieldData, setDraggedFieldData] = useState<FieldWithPreference | null>(null)

  // dnd-kit sensors - lower activation distance for snappier feel
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5
      }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  )

  // Custom collision detection that prioritizes droppable sections for library fields
  const customCollisionDetection: CollisionDetection = useCallback((args) => {
    // For library field drags, use pointer within detection for droppable sections
    if (activeDragType === 'library-field') {
      const pointerCollisions = pointerWithin(args)

      // Check for position-specific drop zones first (highest priority)
      const positionCollisions = pointerCollisions.filter(
        collision => String(collision.id).startsWith('field-position-')
      )
      if (positionCollisions.length > 0) {
        return positionCollisions
      }

      // Check for new section zone next
      const newSectionCollision = pointerCollisions.find(
        collision => String(collision.id) === 'droppable-new-section'
      )
      if (newSectionCollision) {
        return [newSectionCollision]
      }

      // Then check for existing section droppables
      const droppableSectionCollisions = pointerCollisions.filter(
        collision => String(collision.id).startsWith('droppable-section-')
      )
      if (droppableSectionCollisions.length > 0) {
        return droppableSectionCollisions
      }
      return pointerCollisions
    }
    // For section/field reordering, use closest center
    return closestCenter(args)
  }, [activeDragType])

  // Keep ref in sync with state
  useEffect(() => {
    menuOpenRef.current = sectionMenuOpen
  }, [sectionMenuOpen])

  // Close field addition picker when clicking outside
  useEffect(() => {
    if (!addingFieldId) return

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement
      if (target.closest('[data-field-picker]')) return
      setAddingFieldId(null)
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [addingFieldId])

  // Close section menu when clicking outside
  useEffect(() => {
    if (!sectionMenuOpen) return

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as HTMLElement
      // Check if click is on a menu button or inside a menu
      if (target.closest('[data-section-menu]')) return
      setSectionMenuOpen(null)
    }

    // Add listener after a short delay to avoid catching the opening click
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 100)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [sectionMenuOpen])

  // Get current template info (what's actually saved)
  const savedTemplateName = activeLayout?.name || 'Default'
  const isUsingDefault = !activeLayout || activeLayout.id === 'system-default'

  // Computed values for draft template selection UI
  // draftLayoutId: undefined = no change, null = default selected, string = specific layout selected
  const isDraftDefault = draftLayoutId === null || (draftLayoutId === undefined && isUsingDefault)
  const getDraftLayoutSelected = (layoutId: string) =>
    draftLayoutId === layoutId || (draftLayoutId === undefined && activeLayout?.id === layoutId)

  // Get the template name to DISPLAY (reflects draft selection if changed)
  const displayTemplateName = useMemo(() => {
    if (draftLayoutId === undefined) {
      // No change - show current saved template
      return savedTemplateName
    }
    if (draftLayoutId === null) {
      // User selected Default
      return 'Default'
    }
    // User selected a specific template - find its name
    const selectedLayout = layouts?.find(l => l.id === draftLayoutId)
    return selectedLayout?.name || savedTemplateName
  }, [draftLayoutId, savedTemplateName, layouts])

  // Is the DISPLAYED template the default? (for showing read-only label)
  const isDisplayingDefault = draftLayoutId === null || (draftLayoutId === undefined && isUsingDefault)

  // Get the draft-selected layout object (for previewing field configuration)
  // This is the layout that WOULD be active if the user saves their changes
  const draftActiveLayout = useMemo(() => {
    if (draftLayoutId === undefined) {
      // No change - use current active layout
      return activeLayout
    }
    if (draftLayoutId === null) {
      // User selected Default - no layout
      return null
    }
    // User selected a specific layout - find it
    return layouts?.find(l => l.id === draftLayoutId) || null
  }, [draftLayoutId, activeLayout, layouts])

  // Is the draft selection using the default template?
  const isDraftUsingDefault = draftLayoutId === null || (draftLayoutId === undefined && isUsingDefault)

  // Check if this asset has field overrides
  const hasFieldOverrides = assetFieldOverrides.length > 0

  // Get template field IDs for comparison - uses DRAFT layout for preview
  const templateFieldIds = useMemo(() => {
    if (isDraftUsingDefault) {
      // Default template = universal fields
      return new Set(fieldsWithPreferences.filter(f => f.is_universal).map(f => f.field_id))
    }
    if (draftActiveLayout?.field_config && draftActiveLayout.field_config.length > 0) {
      return new Set(draftActiveLayout.field_config.map(fc => fc.field_id))
    }
    return new Set(fieldsWithPreferences.map(f => f.field_id))
  }, [isDraftUsingDefault, draftActiveLayout, fieldsWithPreferences])

  // Get field IDs that were added via DRAFT override (visible but not in template)
  const draftOverrideAddedFieldIds = useMemo(() => {
    const ids = new Set<string>()
    draftFieldOverrides.forEach((override, fieldId) => {
      if (override.is_visible && !templateFieldIds.has(fieldId)) {
        ids.add(fieldId)
      }
    })
    return ids
  }, [draftFieldOverrides, templateFieldIds])

  // Compute displayed sections using DRAFT state
  // This shows what the layout will look like when saved
  const displayedFieldsBySection = useMemo(() => {

    // First, build a map of field_id -> target section_id from draft overrides
    // This tells us which fields have been moved to different sections
    const fieldToTargetSection = new Map<string, string>()
    draftFieldOverrides.forEach((override, fieldId) => {
      if (override.section_id && override.is_visible) {
        fieldToTargetSection.set(fieldId, override.section_id)
      }
    })

    // Create a map of field_id -> field data for quick lookup
    const fieldMap = new Map<string, FieldWithPreference>()
    fieldsWithPreferences.forEach(f => fieldMap.set(f.field_id, f))

    // Also create a map by slug for matching preset fields with timestamps
    // e.g., "preset-competitive_landscape-1768168549905" should match field with slug "competitive_landscape"
    const fieldBySlugMap = new Map<string, FieldWithPreference>()
    fieldsWithPreferences.forEach(f => fieldBySlugMap.set(f.field_slug, f))

    // Helper to find a field by ID, with fallback to slug matching for preset IDs
    const findField = (fieldId: string): FieldWithPreference | undefined => {
      // First try direct ID match
      const directMatch = fieldMap.get(fieldId)
      if (directMatch) return directMatch

      // If it's a preset ID with timestamp (e.g., "preset-some_slug-123456789")
      // try to match by extracting the slug
      if (fieldId.startsWith('preset-')) {
        // Extract slug: "preset-competitive_landscape-1768168549905" -> "competitive_landscape"
        const parts = fieldId.split('-')
        if (parts.length >= 3) {
          // Remove 'preset' prefix and timestamp suffix, join the middle parts
          const slug = parts.slice(1, -1).join('-')
          const slugMatch = fieldBySlugMap.get(slug)
          if (slugMatch) return slugMatch

          // Also try matching preset ID without timestamp
          const presetIdWithoutTimestamp = `preset-${slug}`
          const presetMatch = fieldMap.get(presetIdWithoutTimestamp)
          if (presetMatch) return presetMatch
        }
      }

      return undefined
    }

    // Create a map of section_id -> section info from allSections
    const sectionInfoMap = new Map<string, { id: string; name: string; slug: string; display_order: number }>()
    if (allSections) {
      allSections.forEach(s => sectionInfoMap.set(s.id, { id: s.id, name: s.name, slug: s.slug, display_order: s.display_order }))
    }
    // Also add sections from fieldsBySection for fallback
    fieldsBySection.forEach(s => {
      if (!sectionInfoMap.has(s.section_id)) {
        sectionInfoMap.set(s.section_id, { id: s.section_id, name: s.section_name, slug: s.section_slug, display_order: s.section_display_order })
      }
    })

    // Build sections based on draft template
    const sectionsMap = new Map<string, {
      section_id: string
      section_name: string
      section_slug: string
      section_display_order: number
      section_is_hidden: boolean
      section_is_added: boolean
      section_original_name: string
      section_has_override: boolean
      fields: Array<FieldWithPreference & { isFromTemplate?: boolean; isAddedViaOverride?: boolean }>
    }>()

    // Helper to get or create section entry
    const getOrCreateSection = (sectionId: string) => {
      if (!sectionsMap.has(sectionId)) {
        const sectionInfo = sectionInfoMap.get(sectionId)
        const draftSectionOverride = draftSectionOverrides.get(sectionId)
        sectionsMap.set(sectionId, {
          section_id: sectionId,
          section_name: draftSectionOverride?.name_override || sectionInfo?.name || 'Unknown Section',
          section_slug: sectionInfo?.slug || sectionId,
          section_display_order: draftSectionOverride?.display_order ?? sectionInfo?.display_order ?? 999,
          section_is_hidden: draftSectionOverride?.is_hidden ?? false,
          section_is_added: draftSectionOverride?.is_added ?? false,
          section_original_name: sectionInfo?.name || 'Unknown Section',
          section_has_override: !!draftSectionOverride,
          fields: []
        })
      }
      return sectionsMap.get(sectionId)!
    }

    // Helper to calculate visibility for a field
    const getFieldVisibility = (field: FieldWithPreference, layoutConfig?: { is_visible: boolean }) => {
      const draftOverride = draftFieldOverrides.get(field.field_id)
      if (draftOverride?.is_visible !== undefined) {
        return draftOverride.is_visible
      }
      if (isDraftUsingDefault) {
        return field.is_universal === true
      }
      if (layoutConfig) {
        return layoutConfig.is_visible
      }
      return false
    }

    // For custom templates: group fields by the template's section_id
    if (!isDraftUsingDefault && draftActiveLayout?.field_config && draftActiveLayout.field_config.length > 0) {
      // Process fields from the template's field_config
      draftActiveLayout.field_config.forEach(config => {
        const field = findField(config.field_id)
        if (!field) return

        // Check if field has been moved via draft override
        const overrideTargetSection = fieldToTargetSection.get(config.field_id)
        // Use override section, or template's section
        const targetSectionId = overrideTargetSection || config.section_id

        // Skip fields that are being moved to a NEW section (temp ID)
        // These will be handled in the draftNewSections loop below
        if (targetSectionId && draftNewSections.some(ns => ns.temp_id === targetSectionId)) {
          return
        }

        const section = getOrCreateSection(targetSectionId)
        const draftOverride = draftFieldOverrides.get(field.field_id)
        const isVisible = draftOverride?.is_visible ?? config.is_visible
        const displayOrder = draftOverride?.display_order ?? config.display_order ?? field.default_display_order

        section.fields.push({
          ...field,
          section_id: targetSectionId,
          is_visible: isVisible,
          display_order: displayOrder,
          isFromTemplate: true,
          isAddedViaOverride: false
        })
      })

      // Add fields from draft overrides that aren't in the template
      draftFieldOverrides.forEach((override, fieldId) => {
        if (override.is_visible && !templateFieldIds.has(fieldId)) {
          const field = findField(fieldId)
          if (!field) return

          const targetSectionId = override.section_id || field.section_id

          // Skip fields that are being moved to a NEW section (temp ID)
          // These will be handled in the draftNewSections loop below
          if (targetSectionId && draftNewSections.some(ns => ns.temp_id === targetSectionId)) {
            return
          }

          const section = getOrCreateSection(targetSectionId)

          // Check if field was already added
          if (!section.fields.some(f => f.field_id === fieldId)) {
            section.fields.push({
              ...field,
              section_id: targetSectionId,
              is_visible: true,
              display_order: override.display_order ?? field.default_display_order,
              isFromTemplate: false,
              isAddedViaOverride: true
            })
          }
        }
      })
    } else {
      // Default template: use fields grouped by their default sections
      fieldsBySection.forEach(section => {
        const draftSectionOverride = draftSectionOverrides.get(section.section_id)

        section.fields.forEach(field => {
          // For default template, only include universal fields (unless overridden)
          const draftOverride = draftFieldOverrides.get(field.field_id)
          const isInTemplate = field.is_universal === true
          const isAddedViaOverride = draftOverride?.is_visible === true && !isInTemplate

          if (!isInTemplate && !isAddedViaOverride) return

          // Check if field has been moved via draft override
          const overrideTargetSection = fieldToTargetSection.get(field.field_id)

          // Skip fields that are being moved to a NEW section (temp ID)
          // These will be handled in the draftNewSections loop below
          if (overrideTargetSection && draftNewSections.some(ns => ns.temp_id === overrideTargetSection)) {
            return
          }

          const targetSectionId = overrideTargetSection || section.section_id

          const targetSection = getOrCreateSection(targetSectionId)
          const isVisible = draftOverride?.is_visible ?? (isInTemplate ? true : false)
          const displayOrder = draftOverride?.display_order ?? field.display_order

          targetSection.fields.push({
            ...field,
            section_id: targetSectionId,
            is_visible: isVisible,
            display_order: displayOrder,
            isFromTemplate: isInTemplate,
            isAddedViaOverride: isAddedViaOverride
          })
        })

        // Apply section override if present
        if (sectionsMap.has(section.section_id) && draftSectionOverride) {
          const s = sectionsMap.get(section.section_id)!
          s.section_name = draftSectionOverride.name_override || section.section_name
          s.section_is_hidden = draftSectionOverride.is_hidden ?? false
          s.section_display_order = draftSectionOverride.display_order ?? section.section_display_order
        }
      })
    }

    // Convert map to array and sort
    const sectionsWithDraft = Array.from(sectionsMap.values()).map(section => ({
      ...section,
      fields: section.fields.sort((a, b) => {
        // Use display_order first, then default_display_order, then fallback to 9999 for stable sorting
        const aOrder = a.display_order ?? a.default_display_order ?? 9999
        const bOrder = b.display_order ?? b.default_display_order ?? 9999
        return aOrder - bOrder
      })
    }))

    // Add new sections from draft
    for (const newSection of draftNewSections) {
      const draftOverride = draftSectionOverrides.get(newSection.temp_id)

      // Find fields that have been assigned to this new section
      const newSectionFields: typeof fieldsWithPreferences = []
      fieldsWithPreferences.forEach(field => {
        const targetSection = fieldToTargetSection.get(field.field_id)
        if (targetSection === newSection.temp_id) {
          newSectionFields.push(field)
        }
      })

      sectionsWithDraft.push({
        section_id: newSection.temp_id,
        section_name: newSection.name,
        section_slug: newSection.name.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
        section_display_order: draftOverride?.display_order ?? 999,
        section_is_hidden: draftOverride?.is_hidden ?? false,
        section_is_added: true,
        section_original_name: newSection.name,
        section_has_override: true,
        fields: newSectionFields.map(field => {
          const fieldDraftOverride = draftFieldOverrides.get(field.field_id)
          // Fields added to new sections should be visible by default
          return {
            ...field,
            is_visible: fieldDraftOverride?.is_visible ?? true,
            display_order: fieldDraftOverride?.display_order ?? field.display_order,
            isFromTemplate: false,
            isAddedViaOverride: true
          }
        }).sort((a, b) => {
          // Sort by display_order with fallback for stable ordering
          const aOrder = a.display_order ?? a.default_display_order ?? 9999
          const bOrder = b.display_order ?? b.default_display_order ?? 9999
          return aOrder - bOrder
        })
      })
    }

    // Sort by display order and filter
    return sectionsWithDraft
      .sort((a, b) => a.section_display_order - b.section_display_order)
      .filter(section => section.fields.length > 0 || section.section_is_added)
  }, [fieldsBySection, templateFieldIds, draftOverrideAddedFieldIds, draftFieldOverrides, draftSectionOverrides, draftNewSections, isDraftUsingDefault, draftActiveLayout, fieldsWithPreferences, allSections])

  // ALL fields from library for the Add Field dropdown, filtered by search
  // Show all fields, marking which are already visible (using draft state)
  const allLibraryFields = useMemo(() => {
    const search = addFieldSearch.toLowerCase().trim()
    return fieldsWithPreferences
      .filter(f => !search ||
        f.field_name.toLowerCase().includes(search) ||
        f.section_name.toLowerCase().includes(search) ||
        (f.field_description?.toLowerCase().includes(search)) ||
        (f.creator_name?.toLowerCase().includes(search))
      )
      .map(f => {
        // Calculate template default visibility based on DRAFT selection
        let templateDefaultVisibility: boolean
        if (isDraftUsingDefault) {
          templateDefaultVisibility = f.is_universal === true
        } else if (draftActiveLayout?.field_config) {
          const layoutConfig = draftActiveLayout.field_config.find(fc => fc.field_id === f.field_id)
          templateDefaultVisibility = layoutConfig?.is_visible ?? false
        } else {
          templateDefaultVisibility = f.is_visible
        }

        // Apply draft override, then template default
        const draftOverride = draftFieldOverrides.get(f.field_id)
        return {
          ...f,
          is_visible: draftOverride?.is_visible ?? templateDefaultVisibility
        }
      })
      .sort((a, b) => a.section_name.localeCompare(b.section_name) || a.field_name.localeCompare(b.field_name))
  }, [fieldsWithPreferences, addFieldSearch, draftFieldOverrides, isDraftUsingDefault, draftActiveLayout])

  // Count visible and total fields - use displayedFieldsBySection to respect template filtering
  const allDisplayedFields = displayedFieldsBySection.flatMap(s => s.fields)
  const visibleCount = allDisplayedFields.filter(f => f.is_visible).length
  const totalCount = allDisplayedFields.length

  // Find similar existing fields based on name input (must be before early return)
  const similarFields = useMemo(() => {
    if (!newFieldName.trim() || newFieldName.trim().length < 2) return []
    if (!fieldsWithPreferences || fieldsWithPreferences.length === 0) return []

    const searchTerms = newFieldName.toLowerCase().trim().split(/\s+/)

    return fieldsWithPreferences
      .filter(field => {
        const fieldName = (field.field_name || '').toLowerCase()
        const fieldSlug = (field.field_slug || '').toLowerCase()

        // Check if any search term matches
        return searchTerms.some(term =>
          fieldName.includes(term) || fieldSlug.includes(term)
        )
      })
      .slice(0, 5) // Limit to 5 suggestions
  }, [newFieldName, fieldsWithPreferences])

  // Early return after all hooks
  if (!isOpen) return null

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  // ============================================
  // DRAFT HANDLERS - Modify local state, not database
  // ============================================

  const handleToggleVisibility = (fieldId: string) => {
    setDraftFieldOverrides(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(fieldId)
      const field = fieldsWithPreferences.find(f => f.field_id === fieldId)
      const currentVisible = existing?.is_visible ?? field?.is_visible ?? false

      newMap.set(fieldId, {
        field_id: fieldId,
        is_visible: !currentVisible,
        section_id: existing?.section_id,
        display_order: existing?.display_order
      })
      return newMap
    })
    setHasUnsavedChanges(true)
  }

  const handleClearOverrides = () => {
    setDraftFieldOverrides(new Map())
    setDraftSectionOverrides(new Map())
    setDraftNewSections([])
    setHasUnsavedChanges(true)
  }

  // Section management handlers
  const handleStartEditSection = (sectionId: string, currentName: string) => {
    setEditingSectionId(sectionId)
    setEditingSectionName(currentName)
    setSectionMenuOpen(null)
  }

  const handleSaveEditSection = () => {
    if (!editingSectionId || !editingSectionName.trim()) {
      setEditingSectionId(null)
      setEditingSectionName('')
      return
    }

    const section = displayedFieldsBySection.find(s => s.section_id === editingSectionId)
    const originalName = section?.section_original_name || ''

    // If name matches original, clear the override
    const nameOverride = editingSectionName.trim() === originalName ? undefined : editingSectionName.trim()

    setDraftSectionOverrides(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(editingSectionId) || { section_id: editingSectionId }
      newMap.set(editingSectionId, {
        ...existing,
        name_override: nameOverride
      })
      return newMap
    })

    setEditingSectionId(null)
    setEditingSectionName('')
    setHasUnsavedChanges(true)
  }

  const handleToggleSectionVisibility = (sectionId: string, currentlyHidden: boolean) => {
    setDraftSectionOverrides(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(sectionId) || { section_id: sectionId }
      newMap.set(sectionId, {
        ...existing,
        is_hidden: !currentlyHidden
      })
      return newMap
    })
    setSectionMenuOpen(null)
    setHasUnsavedChanges(true)
  }

  // Drag and drop handlers
  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event
    const id = String(active.id)

    if (id.startsWith('section-')) {
      setActiveDragId(id.replace('section-', ''))
      setActiveDragType('section')
      setDraggedFieldData(null)
    } else if (id.startsWith('library-field-')) {
      const fieldId = id.replace('library-field-', '')
      setActiveDragId(fieldId)
      setActiveDragType('library-field')
      // Find the field data for the overlay
      const field = fieldsWithPreferences.find(f => f.field_id === fieldId)
      setDraggedFieldData(field || null)
    } else if (id.startsWith('field-')) {
      setActiveDragId(id.replace('field-', ''))
      setActiveDragType('field')
      setDraggedFieldData(null)
    }
  }

  const handleDragOver = (event: DragOverEvent) => {
    const { over } = event
    if (!over) {
      setDragOverSectionId(null)
      setDragOverPositionId(null)
      return
    }

    const overId = String(over.id)

    // When dragging a library field, track which section and position we're over
    if (activeDragType === 'library-field') {
      // Check for position-specific drop zones first
      if (overId.startsWith('field-position-')) {
        setDragOverPositionId(overId)
        // Extract section ID from position ID (format: field-position-{sectionId}-{index})
        const parts = overId.replace('field-position-', '').split('-')
        const sectionId = parts.slice(0, -1).join('-') // Everything except the last part (index)
        setDragOverSectionId(sectionId)
      } else if (overId.startsWith('droppable-section-')) {
        setDragOverSectionId(overId.replace('droppable-section-', ''))
        setDragOverPositionId(null)
      } else if (overId.startsWith('section-')) {
        setDragOverSectionId(overId.replace('section-', ''))
        setDragOverPositionId(null)
      } else {
        setDragOverSectionId(null)
        setDragOverPositionId(null)
      }
    }
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    const currentDragType = activeDragType
    const currentDragId = activeDragId

    setActiveDragId(null)
    setActiveDragType(null)
    setDragOverSectionId(null)
    setDragOverPositionId(null)
    setDraggedFieldData(null)

    if (!over) return

    const activeId = String(active.id)
    const overId = String(over.id)

    // Handle dropping a library field onto a section or new section zone
    if (currentDragType === 'library-field' && currentDragId) {
      // Check if dropped on "new section" zone
      if (overId === 'droppable-new-section') {
        handleCreateSectionWithField(currentDragId)
        return
      }

      // Check if dropped on a specific position within a section
      if (overId.startsWith('field-position-')) {
        // Parse position ID (format: field-position-{sectionId}-{index})
        const withoutPrefix = overId.replace('field-position-', '')
        const lastDashIndex = withoutPrefix.lastIndexOf('-')
        const targetSectionId = withoutPrefix.substring(0, lastDashIndex)
        const targetIndex = parseInt(withoutPrefix.substring(lastDashIndex + 1), 10)

        handleAddFieldToSectionAtPosition(currentDragId, targetSectionId, targetIndex)
        return
      }

      let targetSectionId: string | null = null

      if (overId.startsWith('droppable-section-')) {
        targetSectionId = overId.replace('droppable-section-', '')
      } else if (overId.startsWith('section-')) {
        targetSectionId = overId.replace('section-', '')
      }

      if (targetSectionId) {
        // Add the field to the section (at the end)
        handleAddFieldToSection(currentDragId, targetSectionId)
      }
      return
    }

    if (active.id === over.id) return

    // Handle section reorder - update draft state
    if (activeId.startsWith('section-') && overId.startsWith('section-')) {
      const activeSectionId = activeId.replace('section-', '')
      const overSectionId = overId.replace('section-', '')

      const oldIndex = displayedFieldsBySection.findIndex(s => s.section_id === activeSectionId)
      const newIndex = displayedFieldsBySection.findIndex(s => s.section_id === overSectionId)

      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrder = arrayMove(displayedFieldsBySection, oldIndex, newIndex)
        // Update draft section overrides with new display_order
        setDraftSectionOverrides(prev => {
          const newMap = new Map(prev)
          newOrder.forEach((section, index) => {
            const existing = newMap.get(section.section_id) || { section_id: section.section_id }
            newMap.set(section.section_id, {
              ...existing,
              display_order: index
            })
          })
          return newMap
        })
        setHasUnsavedChanges(true)
      }
    }

    // Handle field reorder within section - update draft state
    if (activeId.startsWith('field-') && overId.startsWith('field-')) {
      const activeFieldId = activeId.replace('field-', '')
      const overFieldId = overId.replace('field-', '')

      // Find which section contains these fields
      for (const section of displayedFieldsBySection) {
        const activeIdx = section.fields.findIndex(f => f.field_id === activeFieldId)
        const overIdx = section.fields.findIndex(f => f.field_id === overFieldId)

        if (activeIdx !== -1 && overIdx !== -1) {
          const newOrder = arrayMove(section.fields, activeIdx, overIdx)
          // Update draft field overrides with new display_order
          setDraftFieldOverrides(prev => {
            const newMap = new Map(prev)
            newOrder.forEach((field, index) => {
              const existing = newMap.get(field.field_id) || { field_id: field.field_id, is_visible: field.is_visible }
              newMap.set(field.field_id, {
                ...existing,
                display_order: index,
                section_id: section.section_id
              })
            })
            return newMap
          })
          setHasUnsavedChanges(true)
          break
        }
      }
    }
  }

  const handleSelectTemplate = (layout: LayoutWithSharing | null) => {
    setDraftLayoutId(layout?.id || null)
    setShowTemplateSelector(false)
    setHasUnsavedChanges(true)
  }

  // Add field to section (draft)
  const handleAddFieldToSection = (fieldId: string, sectionId: string) => {
    // Calculate the max display_order in the target section to add at the bottom
    const targetSection = displayedFieldsBySection.find(s => s.section_id === sectionId)
    const maxOrder = targetSection?.fields.reduce((max, f) => Math.max(max, f.display_order || 0), 0) || 0

    setDraftFieldOverrides(prev => {
      const newMap = new Map(prev)
      newMap.set(fieldId, {
        field_id: fieldId,
        is_visible: true,
        section_id: sectionId,
        display_order: maxOrder + 1 // Add at the bottom of the section
      })
      return newMap
    })
    setAddingFieldId(null)
    setHasUnsavedChanges(true)
  }

  // Add field to a specific position within a section (draft)
  const handleAddFieldToSectionAtPosition = (fieldId: string, sectionId: string, position: number) => {
    const targetSection = displayedFieldsBySection.find(s => s.section_id === sectionId)
    if (!targetSection) {
      // Fallback to adding at end if section not found
      handleAddFieldToSection(fieldId, sectionId)
      return
    }

    setDraftFieldOverrides(prev => {
      const newMap = new Map(prev)

      // Set display_order for ALL existing fields in the section
      // Fields before insertion point keep their index
      // Fields at and after insertion point shift down by 1
      targetSection.fields.forEach((field, idx) => {
        const existing = newMap.get(field.field_id) || {
          field_id: field.field_id,
          is_visible: field.is_visible
        }
        const newOrder = idx < position ? idx : idx + 1
        newMap.set(field.field_id, {
          ...existing,
          section_id: sectionId,
          display_order: newOrder
        })
      })

      // Add the new field at the target position
      newMap.set(fieldId, {
        field_id: fieldId,
        is_visible: true,
        section_id: sectionId,
        display_order: position
      })

      return newMap
    })
    setAddingFieldId(null)
    setHasUnsavedChanges(true)
  }

  // Remove field from section (draft)
  const handleRemoveFieldFromSection = (fieldId: string) => {
    setDraftFieldOverrides(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(fieldId)

      // Check if this field is from the template
      const isFromTemplate = templateFieldIds.has(fieldId)

      if (isFromTemplate) {
        // Field is from template - set is_visible: false to hide it (this is an override)
        newMap.set(fieldId, {
          field_id: fieldId,
          is_visible: false,
          section_id: existing?.section_id,
          display_order: existing?.display_order
        })
      } else {
        // Field was added as an override - mark for removal (will be cleaned up on save)
        newMap.set(fieldId, {
          field_id: fieldId,
          is_visible: false,
          section_id: existing?.section_id,
          display_order: existing?.display_order,
          _removeFromDatabase: true // Flag to indicate this should be removed entirely
        } as DraftFieldOverride & { _removeFromDatabase?: boolean })
      }

      return newMap
    })
    setHasUnsavedChanges(true)
  }

  // Create new section (draft)
  const handleCreateSection = (name: string) => {
    const tempId = `temp-${Date.now()}`
    setDraftNewSections(prev => [...prev, { temp_id: tempId, name }])
    setDraftSectionOverrides(prev => {
      const newMap = new Map(prev)
      newMap.set(tempId, {
        section_id: tempId,
        is_added: true,
        display_order: 999
      })
      return newMap
    })
    setShowCreateSection(false)
    setNewSectionName('')
    setHasUnsavedChanges(true)
  }

  // Prompt for new section name when dropping a field on "new section" zone
  const handleCreateSectionWithField = (fieldId: string) => {
    // Store the field ID and show the section name prompt
    setPendingFieldForNewSection(fieldId)
    setNewSectionName('')
    setShowCreateSection(true)
  }

  // Actually create the section with the pending field
  const handleConfirmNewSectionWithField = (sectionName: string) => {
    if (!pendingFieldForNewSection) return

    const tempId = `temp-${Date.now()}`

    // Add the new section
    setDraftNewSections(prev => [...prev, { temp_id: tempId, name: sectionName }])
    setDraftSectionOverrides(prev => {
      const newMap = new Map(prev)
      newMap.set(tempId, {
        section_id: tempId,
        is_added: true,
        display_order: displayedFieldsBySection.length // Place at end
      })
      return newMap
    })

    // Add the field to the new section
    setDraftFieldOverrides(prev => {
      const newMap = new Map(prev)
      newMap.set(pendingFieldForNewSection, {
        field_id: pendingFieldForNewSection,
        is_visible: true,
        section_id: tempId,
        display_order: 0
      })
      return newMap
    })

    // Expand the new section so user can see the field
    setExpandedSections(prev => new Set([...prev, tempId]))
    setHasUnsavedChanges(true)

    // Reset state
    setPendingFieldForNewSection(null)
    setShowCreateSection(false)
    setNewSectionName('')
  }

  // Delete section (draft)
  const handleDeleteSection = (sectionId: string) => {
    // Remove from new sections if it's a temp section
    setDraftNewSections(prev => prev.filter(s => s.temp_id !== sectionId))
    // Remove section override
    setDraftSectionOverrides(prev => {
      const newMap = new Map(prev)
      newMap.delete(sectionId)
      return newMap
    })
    // Remove all field overrides for this section
    setDraftFieldOverrides(prev => {
      const newMap = new Map(prev)
      newMap.forEach((override, fieldId) => {
        if (override.section_id === sectionId) {
          newMap.set(fieldId, { ...override, is_visible: false })
        }
      })
      return newMap
    })
    setSectionMenuOpen(null)
    setHasUnsavedChanges(true)
  }

  // Reset section to default (draft)
  const handleResetSection = (sectionId: string) => {
    setDraftSectionOverrides(prev => {
      const newMap = new Map(prev)
      newMap.delete(sectionId)
      return newMap
    })
    setSectionMenuOpen(null)
    setHasUnsavedChanges(true)
  }

  // ============================================
  // SAVE FUNCTION - Commits all draft changes
  // ============================================
  const handleSaveChanges = async () => {
    if (!assetId || !hasUnsavedChanges) {
      setSectionMenuOpen(null)
      onClose()
      return
    }

    setIsSaving(true)
    try {
      // 1. Handle layout change if needed
      if (draftLayoutId !== undefined) {
        await selectLayoutForAsset.mutateAsync({
          assetId,
          layoutId: draftLayoutId
        })
      }

      // 1b. Check if user clicked Reset (all draft overrides are empty)
      // If so, clear all overrides from database and exit
      const hasNoOverrides = draftFieldOverrides.size === 0 &&
                             draftSectionOverrides.size === 0 &&
                             draftNewSections.length === 0

      if (hasNoOverrides) {
        // User clicked Reset - clear all overrides from database
        await clearAssetOverrides.mutateAsync(assetId)
        setSectionMenuOpen(null)
        onClose()
        return
      }

      // 2. Create any new sections first
      const sectionIdMap = new Map<string, string>() // temp_id -> real_id
      for (const newSection of draftNewSections) {
        const result = await createSection.mutateAsync({
          name: newSection.name,
          addAsOverride: true
        })
        if (result?.id) {
          sectionIdMap.set(newSection.temp_id, result.id)
        }
      }

      // 3. Build field overrides, replacing temp section IDs with real ones
      const fieldOverridesToSave: FieldOverride[] = []
      draftFieldOverrides.forEach((override, fieldId) => {
        const sectionId = override.section_id
          ? (sectionIdMap.get(override.section_id) || override.section_id)
          : undefined

        fieldOverridesToSave.push({
          field_id: fieldId,
          is_visible: override.is_visible,
          section_id: sectionId,
          display_order: override.display_order
        })
      })

      // 4. Build section overrides, replacing temp IDs with real ones
      const sectionOverridesToSave: SectionOverride[] = []
      draftSectionOverrides.forEach((override, sectionId) => {
        // Skip temp sections (they were already created above)
        if (sectionId.startsWith('temp-')) return

        sectionOverridesToSave.push({
          section_id: sectionId,
          name_override: override.name_override,
          is_hidden: override.is_hidden,
          display_order: override.display_order,
          is_added: override.is_added
        })
      })

      // 5. Save field overrides - directly update database with only actual overrides
      // This preserves display_order values and only saves fields that have real changes
      if (draftFieldOverrides.size > 0 && user?.id) {
        // Build the list of overrides to save (excluding fields marked for removal)
        const overridesToSave: FieldOverride[] = []
        const fieldsToRemoveFromDb: string[] = []

        draftFieldOverrides.forEach((override, fieldId) => {
          // Check if this field should be completely removed from database
          if ((override as DraftFieldOverride & { _removeFromDatabase?: boolean })._removeFromDatabase) {
            fieldsToRemoveFromDb.push(fieldId)
            return
          }

          // Map temp section IDs to real IDs
          const sectionId = override.section_id
            ? (sectionIdMap.get(override.section_id) || override.section_id)
            : undefined

          overridesToSave.push({
            field_id: fieldId,
            is_visible: override.is_visible,
            section_id: sectionId,
            display_order: override.display_order
          })
        })

        // Fetch current field_overrides from database
        const { data: currentSelection } = await supabase
          .from('user_asset_layout_selections')
          .select('id, field_overrides')
          .eq('user_id', user.id)
          .eq('asset_id', assetId)
          .maybeSingle()

        // Merge overrides: update existing, add new, remove marked for deletion
        let mergedOverrides: FieldOverride[] = []

        if (currentSelection?.field_overrides) {
          // Start with existing overrides, excluding those being updated or removed
          const existingOverrides = currentSelection.field_overrides as FieldOverride[]
          const updatedFieldIds = new Set(overridesToSave.map(o => o.field_id))
          const removedFieldIds = new Set(fieldsToRemoveFromDb)

          mergedOverrides = existingOverrides.filter(o =>
            !updatedFieldIds.has(o.field_id) && !removedFieldIds.has(o.field_id)
          )
        }

        // Add the new/updated overrides
        mergedOverrides.push(...overridesToSave)

        // Save to database
        if (currentSelection) {
          await supabase
            .from('user_asset_layout_selections')
            .update({ field_overrides: mergedOverrides })
            .eq('id', currentSelection.id)
        } else if (mergedOverrides.length > 0) {
          // Create new selection record if needed
          await supabase
            .from('user_asset_layout_selections')
            .insert({
              user_id: user.id,
              asset_id: assetId,
              layout_id: draftLayoutId,
              field_overrides: mergedOverrides,
              section_overrides: []
            })
        }

        // Invalidate query cache so modal loads fresh data on reopen
        await queryClient.invalidateQueries({ queryKey: ['user-asset-layout-selection', user.id, assetId] })
      }

      // Save section overrides by reordering sections
      const orderedSectionIds = Array.from(draftSectionOverrides.entries())
        .filter(([id]) => !id.startsWith('temp-'))
        .sort((a, b) => (a[1].display_order ?? 0) - (b[1].display_order ?? 0))
        .map(([id]) => id)

      if (orderedSectionIds.length > 0) {
        await reorderSections.mutateAsync({ orderedSectionIds })
      }


      // Handle section name and visibility overrides
      for (const override of sectionOverridesToSave) {
        if (override.name_override !== undefined || override.is_hidden !== undefined) {
          await updateSectionOverride.mutateAsync({
            assetId,
            sectionId: override.section_id,
            nameOverride: override.name_override,
            isHidden: override.is_hidden
          })
        }
      }

      setSectionMenuOpen(null)
      onClose()
    } catch (error) {
      console.error('Failed to save changes:', error)
    } finally {
      setIsSaving(false)
    }
  }

  // Handle cancel - show confirmation if unsaved changes
  const handleCancel = () => {
    setSectionMenuOpen(null) // Close any open section menu
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true)
    } else {
      onClose()
    }
  }

  // Confirm discard and close
  const handleConfirmDiscard = () => {
    setShowDiscardConfirm(false)
    setSectionMenuOpen(null) // Close any open section menu
    onClose()
  }

  const handleCopyTemplate = async () => {
    if (!newTemplateName.trim()) return

    // Create a new template with current field config
    const fieldConfig = fieldsWithPreferences.map(f => ({
      field_id: f.field_id,
      section_id: f.section_id,
      is_visible: f.is_visible,
      display_order: f.display_order,
      is_collapsed: f.is_collapsed
    }))

    await saveLayout.mutateAsync({
      name: newTemplateName.trim(),
      fieldConfig,
      isDefault: false
    })

    setShowCopyDialog(false)
    setNewTemplateName('')
  }

  // Field categories for the create field dialog
  const fieldCategories = [
    { value: 'analysis', label: 'Analysis', description: 'Research analysis and thesis fields' },
    { value: 'data', label: 'Data', description: 'Metrics, ratings, and numerical data' },
    { value: 'events', label: 'Events', description: 'Catalysts, timelines, and milestones' },
    { value: 'specialized', label: 'Specialized', description: 'Documents, links, and other fields' }
  ]

  // Field types for the create field dialog
  const fieldTypes = [
    { value: 'rich_text', label: 'Rich Text', description: 'Formatted text with headings, lists, and links' },
    { value: 'checklist', label: 'Checklist', description: 'Track items with checkboxes' },
    { value: 'timeline', label: 'Timeline', description: 'Events and milestones over time' },
    { value: 'metric', label: 'Metric', description: 'Track numerical KPIs with charts' },
    { value: 'numeric', label: 'Numeric', description: 'Single number value' },
    { value: 'date', label: 'Date', description: 'Date picker field' }
  ]

  // Field type icon helper
  const getFieldTypeIcon = (type: string) => {
    const icons: Record<string, React.ReactNode> = {
      rich_text: <FileText className="w-4 h-4" />,
      numeric: <Hash className="w-4 h-4" />,
      date: <Calendar className="w-4 h-4" />,
      checklist: <CheckSquare className="w-4 h-4" />,
      timeline: <Clock className="w-4 h-4" />,
      metric: <Gauge className="w-4 h-4" />
    }
    return icons[type] || <FileText className="w-4 h-4" />
  }

  // Map category to a default section (use first available section as fallback)
  const getCategorySectionId = (category: string): string => {
    // Try to find a section that matches the category name
    const categoryToSlugMap: Record<string, string[]> = {
      'analysis': ['thesis', 'investment_thesis', 'analysis'],
      'data': ['data', 'metrics', 'ratings'],
      'events': ['catalysts', 'events', 'catalysts_events'],
      'specialized': ['documents', 'specialized', 'other']
    }

    const slugsToTry = categoryToSlugMap[category] || []
    for (const slug of slugsToTry) {
      const section = allSections?.find(s => s.slug === slug || s.name.toLowerCase().includes(slug))
      if (section) return section.id
    }

    // Fallback to first available section
    return allSections?.[0]?.id || ''
  }

  // Handle creating a new custom field
  const handleCreateField = async () => {
    if (!newFieldName.trim() || !user?.id || !newFieldCategory) return

    const sectionId = getCategorySectionId(newFieldCategory)
    if (!sectionId) {
      console.error('No section available for category:', newFieldCategory)
      return
    }

    setIsCreatingField(true)
    try {
      const slug = newFieldName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

      await createField.mutateAsync({
        name: newFieldName.trim(),
        slug,
        section_id: sectionId,
        field_type: newFieldType as any,
        is_universal: false
      })

      // Refresh the field list so the new field appears in the Field Library
      // The user can then drag it to their layout if they want it visible
      // Use invalidateQueries to properly match queries with additional key parts (user id, version)
      await queryClient.invalidateQueries({ queryKey: ['available-research-fields'] })
      await queryClient.invalidateQueries({ queryKey: ['research-fields'] })
      // Force refetch to ensure data is immediately available
      await queryClient.refetchQueries({ queryKey: ['available-research-fields'], exact: false })
      await queryClient.refetchQueries({ queryKey: ['research-fields'], exact: false })

      // Reset and close dialog
      setNewFieldName('')
      setNewFieldType('rich_text')
      setNewFieldCategory('')
      setShowCreateField(false)
    } catch (error) {
      console.error('Failed to create field:', error)
    } finally {
      setIsCreatingField(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-[900px] h-[700px] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Customize Layout</h2>
              {hasAssetCustomization && (
                <span className="px-2 py-0.5 text-xs bg-amber-100 text-amber-700 rounded-full font-medium">
                  Customized
                </span>
              )}
            </div>
            {assetName && (
              <p className="text-sm text-gray-500 mt-0.5">{assetName}</p>
            )}
          </div>
          <div className="flex items-center gap-3">
            {/* Override indicator in header - shows DRAFT state (real-time) */}
            {(draftFieldOverrides.size > 0 || draftSectionOverrides.size > 0 || draftNewSections.length > 0) && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-200">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs text-amber-700 font-medium">
                  Overrides:{' '}
                  {draftFieldOverrides.size > 0 && (
                    <span>{draftFieldOverrides.size} field{draftFieldOverrides.size !== 1 ? 's' : ''}</span>
                  )}
                  {draftFieldOverrides.size > 0 && (draftSectionOverrides.size > 0 || draftNewSections.length > 0) && ', '}
                  {(draftSectionOverrides.size > 0 || draftNewSections.length > 0) && (
                    <span>{draftSectionOverrides.size + draftNewSections.length} section{(draftSectionOverrides.size + draftNewSections.length) !== 1 ? 's' : ''}</span>
                  )}
                </span>
                <button
                  onClick={handleClearOverrides}
                  disabled={isUpdating}
                  className="flex items-center gap-1 text-xs text-amber-700 hover:text-amber-900 font-medium hover:bg-amber-100 rounded px-1.5 py-0.5 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              </div>
            )}
            <button
              onClick={handleCancel}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading || layoutsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Current Template Section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-gray-700">Template</h3>
                  {canChangeLayout ? (
                    <div className="flex items-center gap-2">
                      {isUsingDefault && (
                        <button
                          onClick={() => setShowCopyDialog(true)}
                          className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-700 font-medium"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          Copy
                        </button>
                      )}
                      <button
                        onClick={() => setShowTemplateSelector(!showTemplateSelector)}
                        className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                      >
                        {showTemplateSelector ? 'Cancel' : 'Change'}
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-400">Switch to your view to change</span>
                  )}
                </div>

                {/* Template Card */}
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-primary-100 flex items-center justify-center">
                      <Layout className="w-4 h-4 text-primary-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 text-sm">{displayTemplateName}</span>
                        {isDisplayingDefault && (
                          <span className="text-xs text-gray-500">(read-only)</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500">
                        {visibleCount} of {totalCount} fields visible
                      </p>
                    </div>
                  </div>
                </div>

                {/* Copy Dialog */}
                {canChangeLayout && showCopyDialog && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-700 mb-2">
                      Create a copy of the Default template that you can customize:
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newTemplateName}
                        onChange={(e) => setNewTemplateName(e.target.value)}
                        placeholder="Template name..."
                        className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                        autoFocus
                      />
                      <Button
                        size="sm"
                        onClick={handleCopyTemplate}
                        disabled={!newTemplateName.trim() || saveLayout.isPending}
                      >
                        {saveLayout.isPending ? 'Creating...' : 'Create'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setShowCopyDialog(false)
                          setNewTemplateName('')
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Template Selector Dropdown */}
                {canChangeLayout && showTemplateSelector && (
                  <div className="mt-2 bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden max-h-64 overflow-y-auto">
                    {/* Default option */}
                    <button
                      onClick={() => handleSelectTemplate(null)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors',
                        isDraftDefault && 'bg-primary-50'
                      )}
                    >
                      <div className="w-7 h-7 rounded-md bg-gray-100 flex items-center justify-center shrink-0">
                        <Layout className="w-3.5 h-3.5 text-gray-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-gray-900 text-sm">Default</span>
                        <p className="text-xs text-gray-500">Standard layout for all users</p>
                      </div>
                      {isDraftDefault && (
                        <Check className="w-4 h-4 text-primary-600 shrink-0" />
                      )}
                    </button>

                    {/* Saved layouts */}
                    {layouts && layouts.filter(l => l.id !== 'system-default').length > 0 && (
                      <>
                        <div className="px-3 py-1.5 bg-gray-50 border-y border-gray-100 sticky top-0">
                          <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Your Templates ({layouts.filter(l => l.id !== 'system-default').length})
                          </span>
                        </div>
                        {layouts.filter(l => l.id !== 'system-default').map(layout => (
                          <button
                            key={layout.id}
                            onClick={() => handleSelectTemplate(layout)}
                            className={clsx(
                              'w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 transition-colors',
                              getDraftLayoutSelected(layout.id) && 'bg-primary-50'
                            )}
                          >
                            <div className="w-7 h-7 rounded-md bg-primary-100 flex items-center justify-center shrink-0">
                              <Layout className="w-3.5 h-3.5 text-primary-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-900 text-sm truncate">{layout.name}</span>
                                {layout.is_default && (
                                  <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                                )}
                              </div>
                              {layout.description && (
                                <p className="text-xs text-gray-500 truncate">{layout.description}</p>
                              )}
                            </div>
                            {getDraftLayoutSelected(layout.id) && (
                              <Check className="w-4 h-4 text-primary-600 shrink-0" />
                            )}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Two-Column Layout: Current Layout + Field Library */}
              <DndContext
                sensors={sensors}
                collisionDetection={customCollisionDetection}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                autoScroll={{
                  enabled: true,
                  threshold: { x: 0, y: 0.15 },
                  acceleration: 25,
                  interval: 2,
                  canScroll(element) {
                    // Only allow auto-scroll on the Current Layout container
                    return element.getAttribute('data-autoscroll-container') === 'current-layout'
                  }
                }}
              >
              <div className="flex gap-4 h-[420px]">
                {/* Left Column: Current Layout */}
                <div className="flex-1 flex flex-col min-w-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-700">Current Layout</h3>
                    <span className="text-xs text-gray-500">{visibleCount} visible</span>
                  </div>
                  <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden flex flex-col">
                    <div className="flex-1 overflow-y-auto" data-autoscroll-container="current-layout">
                      {displayedFieldsBySection.length === 0 ? (
                        <div className={clsx(
                          "flex flex-col items-center justify-center h-full text-gray-500 p-4",
                          activeDragType === 'library-field' && "bg-amber-50 border-2 border-dashed border-amber-300 m-2 rounded-lg"
                        )}>
                          {activeDragType === 'library-field' ? (
                            <>
                              <FolderPlus className="w-8 h-8 text-amber-400 mb-2" />
                              <p className="text-sm text-amber-600 font-medium">Create a section first</p>
                              <p className="text-xs text-amber-500">Use the button below to create a section</p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm">No sections yet</p>
                              <p className="text-xs text-gray-400 mt-1">Create a section, then drag fields from the library</p>
                            </>
                          )}
                        </div>
                      ) : (
                        <SortableContext
                          items={displayedFieldsBySection.map(s => `section-${s.section_id}`)}
                          strategy={verticalListSortingStrategy}
                        >
                          <div className="p-2 space-y-2">
                            {displayedFieldsBySection.map(section => (
                              <DroppableSection
                                key={section.section_id}
                                sectionId={section.section_id}
                                isOver={dragOverSectionId === section.section_id}
                                isDraggingLibraryField={activeDragType === 'library-field'}
                              >
                                <SortableSection
                                  section={section}
                                  isExpanded={expandedSections.has(section.section_id)}
                                  onToggle={() => toggleSection(section.section_id)}
                                  editingSectionId={editingSectionId}
                                  editingSectionName={editingSectionName}
                                  setEditingSectionName={setEditingSectionName}
                                  handleSaveEditSection={handleSaveEditSection}
                                  setEditingSectionId={setEditingSectionId}
                                  sectionMenuOpen={sectionMenuOpen}
                                  setSectionMenuOpen={setSectionMenuOpen}
                                  menuPosition={menuPosition}
                                  setMenuPosition={setMenuPosition}
                                  handleStartEditSection={handleStartEditSection}
                                  handleToggleSectionVisibility={handleToggleSectionVisibility}
                                  handleDeleteSection={handleDeleteSection}
                                  handleResetSection={handleResetSection}
                                  handleRemoveFieldFromSection={handleRemoveFieldFromSection}
                                  handleToggleVisibility={handleToggleVisibility}
                                  isSaving={isSaving}
                                  isDraggingLibraryField={activeDragType === 'library-field'}
                                  dragOverPositionId={dragOverPositionId}
                                />
                              </DroppableSection>
                            ))}

                            {/* Drop zone to create new section */}
                            {activeDragType === 'library-field' && (
                              <NewSectionDropZone
                                onDrop={(fieldId) => handleCreateSectionWithField(fieldId)}
                              />
                            )}
                          </div>
                        </SortableContext>
                      )}
                    </div>
                    {/* Create Section Button */}
                    <div className="border-t border-gray-200 p-2 bg-gray-50">
                      {showCreateSection ? (
                        <div className="space-y-2">
                          {/* Show pending field info if creating section with a field */}
                          {pendingFieldForNewSection && (() => {
                            const pendingField = fieldsWithPreferences.find(f => f.field_id === pendingFieldForNewSection)
                            return pendingField ? (
                              <div className="flex items-center gap-2 px-2 py-1.5 bg-blue-50 rounded-lg text-xs">
                                <span className="text-blue-600">Adding field:</span>
                                <span className="font-medium text-blue-700">{pendingField.field_name}</span>
                              </div>
                            ) : null
                          })()}
                          <div className="flex items-center gap-2">
                            <input
                              ref={sectionNameInputRef}
                              type="text"
                              value={newSectionName}
                              onChange={(e) => setNewSectionName(e.target.value)}
                              placeholder="Enter section name..."
                              className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                              onKeyDown={(e) => {
                                if (e.key === 'Escape') {
                                  setShowCreateSection(false)
                                  setNewSectionName('')
                                  setPendingFieldForNewSection(null)
                                }
                                if (e.key === 'Enter' && newSectionName.trim()) {
                                  e.preventDefault()
                                  if (pendingFieldForNewSection) {
                                    handleConfirmNewSectionWithField(newSectionName.trim())
                                  } else {
                                    handleCreateSection(newSectionName.trim())
                                  }
                                }
                              }}
                            />
                            <button
                              onClick={() => {
                                if (!newSectionName.trim()) return
                                if (pendingFieldForNewSection) {
                                  handleConfirmNewSectionWithField(newSectionName.trim())
                                } else {
                                  handleCreateSection(newSectionName.trim())
                                }
                              }}
                              disabled={!newSectionName.trim()}
                              className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Create
                            </button>
                            <button
                              onClick={() => {
                                setShowCreateSection(false)
                                setNewSectionName('')
                                setPendingFieldForNewSection(null)
                              }}
                              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowCreateSection(true)}
                          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                        >
                          <FolderPlus className="w-4 h-4" />
                          Create Section
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Column: Field Library */}
                <div className="w-[340px] flex flex-col shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-gray-700">Field Library</h3>
                    <div className="flex items-center gap-2">
                      {activeDragType === 'library-field' ? (
                        <span className="text-xs text-primary-600 font-medium animate-pulse">
                          Drop on a section ←
                        </span>
                      ) : (
                        <>
                          <button
                            onClick={() => setShowCreateField(true)}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            Create
                          </button>
                          <span className="text-xs text-gray-500">{fieldsWithPreferences.length} fields</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex-1 border border-gray-200 rounded-lg overflow-hidden flex flex-col bg-gray-50">
                    {/* Search */}
                    <div className="p-2 border-b border-gray-200 bg-white">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                          type="text"
                          value={addFieldSearch}
                          onChange={(e) => setAddFieldSearch(e.target.value)}
                          placeholder="Search fields..."
                          className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    </div>
                    {/* Field List */}
                    <div className="flex-1 overflow-y-auto">
                      {allLibraryFields.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-gray-500">
                          <p className="text-sm">No matching fields</p>
                        </div>
                      ) : (
                        (() => {
                          const fieldTypeDisplayNames: Record<string, string> = {
                            'rich_text': 'Rich Text',
                            'checklist': 'Checklists',
                            'metric': 'Metrics',
                            'numeric': 'Numeric Values',
                            'timeline': 'Timelines',
                            'date': 'Dates',
                            'text': 'Text',
                            'rating': 'Ratings',
                            'select': 'Selections',
                            'multi_select': 'Multi-Select',
                            'url': 'Links',
                            'file': 'Files',
                            'boolean': 'Yes/No Fields',
                            'currency': 'Currency',
                            'price_targets': 'Price Targets',
                            'documents': 'Documents'
                          }
                          const categories = new Map<string, typeof allLibraryFields>()
                          allLibraryFields.forEach(f => {
                            const category = f.field_type || 'other'
                            const existing = categories.get(category) || []
                            existing.push(f)
                            categories.set(category, existing)
                          })
                          const sortedCategories = Array.from(categories.entries()).sort(([a], [b]) => {
                            const nameA = fieldTypeDisplayNames[a] || a
                            const nameB = fieldTypeDisplayNames[b] || b
                            return nameA.localeCompare(nameB)
                          })
                          return sortedCategories.map(([category, fields]) => {
                            const isExpanded = expandedCategories.has(category) || addFieldSearch.trim() !== ''
                            const addedCount = fields.filter(f => f.is_visible).length
                            return (
                              <div key={category}>
                                <button
                                  onClick={() => {
                                    if (addFieldSearch.trim()) return // Don't collapse when searching
                                    setExpandedCategories(prev => {
                                      const next = new Set(prev)
                                      if (next.has(category)) {
                                        next.delete(category)
                                      } else {
                                        next.add(category)
                                      }
                                      return next
                                    })
                                  }}
                                  className="w-full px-3 py-2 bg-gray-100 text-xs font-medium text-gray-600 uppercase tracking-wider sticky top-0 border-b border-gray-200 flex items-center gap-2 hover:bg-gray-200 transition-colors"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="w-3 h-3 text-gray-400" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-gray-400" />
                                  )}
                                  <span className="flex-1 text-left">
                                    {fieldTypeDisplayNames[category] || category.replace(/_/g, ' ')}
                                  </span>
                                  <span className="text-gray-400 font-normal normal-case">
                                    {addedCount > 0 && <span className="text-green-600 mr-1">{addedCount} added</span>}
                                    ({fields.length})
                                  </span>
                                </button>
                                {isExpanded && fields.map(field => (
                                  <DraggableLibraryField
                                    key={field.field_id}
                                    field={field}
                                    isAlreadyVisible={field.is_visible}
                                    onRemove={() => handleRemoveFieldFromSection(field.field_id)}
                                    canDelete={field.is_custom && field.created_by === user?.id}
                                    onDelete={() => setFieldToDelete({ id: field.field_id, name: field.field_name })}
                                    isDeleting={isDeletingField && fieldToDelete?.id === field.field_id}
                                  />
                                ))}
                              </div>
                            )
                          })
                        })()
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Drag Overlay - shows a preview of what's being dragged */}
              <DragOverlay dropAnimation={null}>
                {activeDragType === 'library-field' && draggedFieldData && (
                  <div className="px-3 py-2 bg-white border-2 border-primary-400 rounded-lg shadow-xl w-[300px]">
                    <div className="flex items-center gap-2">
                      <GripVertical className="w-4 h-4 text-primary-500" />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900 truncate block">
                          {draggedFieldData.field_name}
                        </span>
                        <span className="text-[10px] text-gray-400">
                          {draggedFieldData.section_name}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </DragOverlay>
              </DndContext>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-200 bg-gray-50 rounded-b-xl">
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={handleCancel}
              className="flex-1"
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveChanges}
              className="flex-1"
              disabled={isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : hasUnsavedChanges ? (
                'Save Changes'
              ) : (
                'Done'
              )}
            </Button>
          </div>
          {hasUnsavedChanges && (
            <p className="text-xs text-amber-600 text-center mt-2">
              You have unsaved changes
            </p>
          )}
        </div>
      </div>

      {/* Discard Changes Confirmation Dialog */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-[400px] mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Discard Changes?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600">
                You have unsaved changes. Are you sure you want to discard them? This action cannot be undone.
              </p>
            </div>
            <div className="px-5 py-3 bg-gray-50 flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setShowDiscardConfirm(false)}
              >
                Keep Editing
              </Button>
              <Button
                variant="danger"
                onClick={handleConfirmDiscard}
              >
                Discard Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Create Field Dialog */}
      {showCreateField && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-[500px] h-[600px] mx-4 overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between shrink-0">
              <h3 className="text-lg font-semibold text-gray-900">Create Custom Field</h3>
              <button
                onClick={() => {
                  setShowCreateField(false)
                  setNewFieldName('')
                  setNewFieldType('rich_text')
                  setNewFieldCategory('')
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              {/* Field Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Field Name
                </label>
                <input
                  type="text"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  placeholder="e.g., Key Metrics, Competitors, Notes"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  autoFocus
                />
              </div>

              {/* Similar Fields Warning */}
              {similarFields.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-amber-800 mb-2">
                    Similar fields already exist - consider using one of these instead:
                  </p>
                  <div className="space-y-1.5">
                    {similarFields.map(field => (
                      <div
                        key={field.field_id}
                        className="flex items-center justify-between bg-white rounded px-2 py-1.5 border border-amber-200"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm font-medium text-gray-900 truncate">
                            {field.field_name}
                          </span>
                          <span className="text-[10px] text-gray-500 shrink-0">
                            {field.field_type.replace('_', ' ')}
                          </span>
                          {field.is_custom && field.creator_name && (
                            <span className="text-[10px] text-blue-600 shrink-0">
                              by {field.creator_name}
                            </span>
                          )}
                        </div>
                        {!field.is_visible && (
                          <button
                            onClick={() => {
                              // Add existing field instead of creating new one
                              // Use category-based section if selected, otherwise use field's original section
                              const sectionId = newFieldCategory ? getCategorySectionId(newFieldCategory) : field.section_id
                              if (sectionId) {
                                setDraftFieldOverrides(prev => {
                                  const next = new Map(prev)
                                  next.set(field.field_id, {
                                    field_id: field.field_id,
                                    is_visible: true,
                                    section_id: sectionId,
                                    display_order: 0
                                  })
                                  return next
                                })
                                setHasUnsavedChanges(true)
                                setShowCreateField(false)
                                setNewFieldName('')
                                setNewFieldCategory('')
                              }
                            }}
                            className="text-xs text-primary-600 hover:text-primary-700 font-medium shrink-0"
                          >
                            Use this
                          </button>
                        )}
                        {field.is_visible && (
                          <span className="text-[10px] text-green-600 shrink-0">Already added</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category Selector */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Category
                </label>
                <select
                  value={newFieldCategory}
                  onChange={(e) => setNewFieldCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white"
                >
                  <option value="">Select a category...</option>
                  {fieldCategories.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label} - {cat.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Field Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Field Type
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {fieldTypes.map((ft) => (
                    <button
                      key={ft.value}
                      onClick={() => setNewFieldType(ft.value)}
                      className={`flex items-start gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                        newFieldType === ft.value
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`p-1.5 rounded-lg ${
                        newFieldType === ft.value ? 'bg-primary-100 text-primary-600' : 'bg-gray-100 text-gray-500'
                      }`}>
                        {getFieldTypeIcon(ft.value)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium block ${
                          newFieldType === ft.value ? 'text-primary-700' : 'text-gray-700'
                        }`}>
                          {ft.label}
                        </span>
                        <span className="text-xs text-gray-500 line-clamp-1">
                          {ft.description}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Info about custom fields */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-700">
                  Custom fields you create will be marked with your name and available in the Field Library for reuse across all assets.
                </p>
              </div>
            </div>
            <div className="px-5 py-3 bg-gray-50 flex items-center justify-end gap-3 border-t border-gray-200 shrink-0">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCreateField(false)
                  setNewFieldName('')
                  setNewFieldType('rich_text')
                  setNewFieldCategory('')
                }}
                disabled={isCreatingField}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateField}
                disabled={!newFieldName.trim() || !newFieldCategory || isCreatingField}
              >
                {isCreatingField ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 mr-1" />
                    Create Field
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Field Confirmation Dialog */}
      {fieldToDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-[400px] mx-4 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Delete Custom Field?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm text-gray-600">
                Are you sure you want to delete <span className="font-medium text-gray-900">"{fieldToDelete.name}"</span>?
              </p>
              <p className="text-sm text-gray-500 mt-2">
                This will permanently remove the field from the Field Library. Any data stored in this field across all assets will also be deleted.
              </p>
              <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-xs text-red-700 font-medium">
                  This action cannot be undone.
                </p>
              </div>
            </div>
            <div className="px-5 py-3 bg-gray-50 flex items-center justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setFieldToDelete(null)}
                disabled={isDeletingField}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  try {
                    await deleteField.mutateAsync(fieldToDelete.id)
                    setFieldToDelete(null)
                  } catch (error) {
                    console.error('Failed to delete field:', error)
                  }
                }}
                disabled={isDeletingField}
              >
                {isDeletingField ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-1" />
                    Delete Field
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Section item interface for sortable
interface SectionItemProps {
  section: {
    section_id: string
    section_name: string
    section_is_hidden?: boolean
    section_is_added?: boolean
    section_has_override?: boolean
    section_original_name?: string
    fields: Array<FieldWithPreference & { isFromTemplate?: boolean; isAddedViaOverride?: boolean }>
  }
  isExpanded: boolean
  onToggle: () => void
  editingSectionId: string | null
  editingSectionName: string
  setEditingSectionName: (name: string) => void
  handleSaveEditSection: () => void
  setEditingSectionId: (id: string | null) => void
  sectionMenuOpen: string | null
  setSectionMenuOpen: (id: string | null) => void
  menuPosition: { top: number; left: number } | null
  setMenuPosition: (pos: { top: number; left: number } | null) => void
  handleStartEditSection: (id: string, name: string) => void
  handleToggleSectionVisibility: (id: string, hidden: boolean) => void
  handleDeleteSection: (id: string) => void
  handleResetSection: (id: string) => void
  handleRemoveFieldFromSection: (fieldId: string) => void
  handleToggleVisibility: (fieldId: string) => void
  isSaving: boolean
  isDraggingLibraryField?: boolean
  dragOverPositionId?: string | null
}

// Sortable section component
function SortableSection({
  section,
  isExpanded,
  onToggle,
  editingSectionId,
  editingSectionName,
  setEditingSectionName,
  handleSaveEditSection,
  setEditingSectionId,
  sectionMenuOpen,
  setSectionMenuOpen,
  menuPosition,
  setMenuPosition,
  handleStartEditSection,
  handleToggleSectionVisibility,
  handleDeleteSection,
  handleResetSection,
  handleRemoveFieldFromSection,
  handleToggleVisibility,
  isSaving,
  isDraggingLibraryField = false,
  dragOverPositionId = null
}: SectionItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: `section-${section.section_id}` })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 20 : undefined
  }

  const visibleInSection = section.fields.filter(f => f.is_visible).length
  const totalInSection = section.fields.length

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        "border border-gray-200 rounded-lg overflow-hidden bg-white",
        isDragging && "shadow-lg"
      )}
    >
      {/* Section Header */}
      <div className={clsx(
        "flex items-center gap-2 px-3 py-2 bg-gray-50 hover:bg-gray-100 transition-colors",
        section.section_is_hidden && "opacity-50"
      )}>
        {/* Drag Handle for Section */}
        <button
          {...attributes}
          {...listeners}
          className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing touch-none"
          title="Drag to reorder section"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        {editingSectionId === section.section_id ? (
          <div className="flex items-center gap-2 flex-1">
            <ChevronRight className="w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={editingSectionName}
              onChange={(e) => setEditingSectionName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSaveEditSection()
                }
                if (e.key === 'Escape') {
                  setEditingSectionId(null)
                  setEditingSectionName('')
                }
              }}
              className="font-medium text-gray-900 text-sm flex-1 text-left px-2 py-1 border border-primary-300 rounded focus:outline-none focus:ring-2 focus:ring-primary-500"
              autoFocus
            />
            <button
              onClick={handleSaveEditSection}
              className="p-1 text-green-600 hover:bg-green-50 rounded"
              title="Save"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setEditingSectionId(null)
                setEditingSectionName('')
              }}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Cancel"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onToggle}
            className="flex items-center gap-2 flex-1"
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400" />
            )}
            <span className="font-medium text-gray-900 text-sm flex-1 text-left truncate flex items-center gap-1.5">
              {section.section_name}
              {section.section_is_added && (
                <span className="px-1.5 py-0.5 text-[9px] bg-blue-100 text-blue-700 rounded font-medium shrink-0">
                  Override
                </span>
              )}
            </span>
          </button>
        )}
        <span className="text-xs text-gray-500 shrink-0">
          {visibleInSection}/{totalInSection}
        </span>
        {/* Section menu */}
        <div className="relative shrink-0" data-section-menu>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              const button = e.currentTarget
              const rect = button.getBoundingClientRect()
              setMenuPosition({
                top: rect.bottom + 4,
                left: rect.right - 192
              })
              setSectionMenuOpen(prev => prev === section.section_id ? null : section.section_id)
            }}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors cursor-pointer"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {sectionMenuOpen === section.section_id && menuPosition && createPortal(
            <div
              className="fixed w-48 bg-white rounded-lg border border-gray-200 shadow-lg z-[9999] py-1"
              style={{ top: menuPosition.top, left: menuPosition.left }}
              data-section-menu
            >
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleStartEditSection(section.section_id, section.section_name)
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Pencil className="w-4 h-4" />
                Rename Section
              </button>
              {/* Show Delete for sections without template fields, Hide for template sections */}
              {(() => {
                // Section can be deleted if it was added OR has no template fields
                const hasTemplateFields = section.fields.some((f: any) => f.isFromTemplate)
                const canDelete = section.section_is_added || !hasTemplateFields

                if (canDelete) {
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteSection(section.section_id)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove Section
                    </button>
                  )
                } else {
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleToggleSectionVisibility(section.section_id, section.section_is_hidden || false)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {section.section_is_hidden ? (
                        <>
                          <Eye className="w-4 h-4" />
                          Show Section
                        </>
                      ) : (
                        <>
                          <EyeOff className="w-4 h-4" />
                          Hide Section
                        </>
                      )}
                    </button>
                  )
                }
              })()}
              {/* Reset to Default only for template sections with overrides (not added sections) */}
              {section.section_has_override && !section.section_is_added && (
                <>
                  <div className="border-t border-gray-100 my-1" />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleResetSection(section.section_id)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-amber-50"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Reset to Default
                  </button>
                </>
              )}
            </div>,
            document.body
          )}
        </div>
      </div>

      {/* Section Fields */}
      {isExpanded && (
        <SortableContext
          items={section.fields.map(f => `field-${f.field_id}`)}
          strategy={verticalListSortingStrategy}
        >
          <div className="divide-y divide-gray-100">
            {section.fields.length === 0 ? (
              <div className={clsx(
                "px-3 py-3 text-sm text-gray-400 text-center",
                isDraggingLibraryField && "py-4"
              )}>
                {isDraggingLibraryField ? (
                  <EmptySectionDropZone
                    id={`field-position-${section.section_id}-0`}
                    isOver={dragOverPositionId === `field-position-${section.section_id}-0`}
                  />
                ) : (
                  "No fields in this section"
                )}
              </div>
            ) : (
              <>
                {/* Drop zone at the top */}
                {isDraggingLibraryField && (
                  <FieldPositionDropZone
                    id={`field-position-${section.section_id}-0`}
                    isOver={dragOverPositionId === `field-position-${section.section_id}-0`}
                  />
                )}
                {section.fields.map((field, index) => (
                  <div key={field.field_id}>
                    <SortableFieldRow
                      field={field}
                      onToggleVisibility={handleToggleVisibility}
                      onRemove={handleRemoveFieldFromSection}
                      isSaving={isSaving}
                      isFromTemplate={(field as any).isFromTemplate}
                      isAddedViaOverride={(field as any).isAddedViaOverride}
                    />
                    {/* Drop zone after each field */}
                    {isDraggingLibraryField && (
                      <FieldPositionDropZone
                        id={`field-position-${section.section_id}-${index + 1}`}
                        isOver={dragOverPositionId === `field-position-${section.section_id}-${index + 1}`}
                      />
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        </SortableContext>
      )}
    </div>
  )
}

// Drop zone for positioning library fields within a section
function FieldPositionDropZone({ id, isOver }: { id: string; isOver: boolean }) {
  const { setNodeRef, isOver: isDirectlyOver } = useDroppable({ id })
  const active = isOver || isDirectlyOver

  return (
    <div ref={setNodeRef} className="relative h-3 -my-1.5 z-10">
      {active && (
        <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-0.5 bg-primary-500 rounded-full">
          <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary-500 rounded-full" />
          <div className="absolute -right-1 top-1/2 -translate-y-1/2 w-2 h-2 bg-primary-500 rounded-full" />
        </div>
      )}
    </div>
  )
}

// Drop zone for empty sections
function EmptySectionDropZone({ id, isOver }: { id: string; isOver: boolean }) {
  const { setNodeRef, isOver: isDirectlyOver } = useDroppable({ id })
  const active = isOver || isDirectlyOver

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "rounded border-2 border-dashed py-2 px-3 text-xs transition-colors",
        active
          ? "border-primary-400 bg-primary-50 text-primary-600"
          : "border-gray-200 text-gray-400"
      )}
    >
      {active ? "Drop to add" : "Drop field here"}
    </div>
  )
}

// Sortable field row component
function SortableFieldRow({
  field,
  onToggleVisibility,
  onRemove,
  isSaving,
  isFromTemplate = true,
  isAddedViaOverride = false
}: {
  field: FieldWithPreference
  onToggleVisibility: (fieldId: string) => void
  onRemove?: (fieldId: string) => void
  isSaving: boolean
  isFromTemplate?: boolean
  isAddedViaOverride?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: `field-${field.field_id}` })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined
  }

  // Field type display names
  const fieldTypeDisplayNames: Record<string, string> = {
    'rich_text': 'Rich Text',
    'checklist': 'Checklist',
    'metric': 'Metric',
    'numeric': 'Numeric',
    'timeline': 'Timeline',
    'date': 'Date',
    'text': 'Text',
    'rating': 'Rating',
    'select': 'Select',
    'multi_select': 'Multi-Select',
    'url': 'Link',
    'file': 'File',
    'boolean': 'Yes/No',
    'currency': 'Currency',
    'price_targets': 'Price Targets',
    'documents': 'Documents'
  }

  const fieldTypeName = fieldTypeDisplayNames[field.field_type] || field.field_type

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        "group flex items-center gap-2 px-3 py-2 hover:bg-gray-50 bg-white",
        isAddedViaOverride && "bg-blue-50/50",
        isDragging && "shadow-lg"
      )}
    >
      {/* Drag Handle */}
      <button
        {...attributes}
        {...listeners}
        className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing touch-none"
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </button>

      {/* Visibility Toggle */}
      <button
        onClick={() => onToggleVisibility(field.field_id)}
        disabled={isSaving}
        className={clsx(
          "p-1.5 rounded transition-colors disabled:opacity-50",
          field.is_visible
            ? "text-primary-600 hover:bg-primary-50"
            : "text-gray-400 hover:bg-gray-100"
        )}
        title={field.is_visible ? "Hide field" : "Show field"}
      >
        {field.is_visible ? (
          <Eye className="w-4 h-4" />
        ) : (
          <EyeOff className="w-4 h-4" />
        )}
      </button>

      {/* Field info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx(
            "text-sm truncate",
            field.is_visible ? "text-gray-900" : "text-gray-500"
          )}>
            {field.field_name}
          </span>
          <span className="px-1.5 py-0.5 text-[9px] bg-gray-100 text-gray-500 rounded font-medium shrink-0">
            {fieldTypeName}
          </span>
          {isAddedViaOverride && (
            <span className="px-1.5 py-0.5 text-[9px] bg-blue-100 text-blue-700 rounded font-medium shrink-0">
              Override
            </span>
          )}
        </div>
      </div>

      {/* Remove button - only for override fields */}
      {isAddedViaOverride && onRemove && (
        <button
          onClick={() => onRemove(field.field_id)}
          disabled={isSaving}
          className="p-1 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 transition-all disabled:opacity-50"
          title="Remove from section"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}

// Draggable library field component
function DraggableLibraryField({
  field,
  isAlreadyVisible,
  onRemove,
  canDelete,
  onDelete,
  isDeleting
}: {
  field: FieldWithPreference
  isAlreadyVisible: boolean
  onRemove: () => void
  canDelete?: boolean
  onDelete?: () => void
  isDeleting?: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging
  } = useDraggable({
    id: `library-field-${field.field_id}`,
    disabled: isAlreadyVisible
  })

  // When dragging, hide the original element since DragOverlay shows the preview
  if (isDragging) {
    return (
      <div
        ref={setNodeRef}
        className="px-3 py-2 border-b border-gray-100 bg-primary-50 border-dashed border-primary-300"
      >
        <div className="flex items-center gap-2 opacity-40">
          <GripVertical className="w-4 h-4 text-primary-400" />
          <span className="text-sm text-primary-600">{field.field_name}</span>
        </div>
      </div>
    )
  }

  if (isAlreadyVisible) {
    return (
      <div className="px-3 py-2 border-b border-gray-100 bg-green-50/50">
        <div className="flex items-center gap-2">
          <button
            onClick={onRemove}
            className="p-1 rounded text-green-600 hover:bg-green-100 hover:text-red-600 shrink-0 transition-colors"
            title="Remove from layout"
          >
            <Check className="w-4 h-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-green-700 truncate">
                {field.field_name}
              </span>
              {field.is_custom && (
                <span className="px-1 py-0.5 text-[9px] bg-blue-100 text-blue-600 rounded font-medium shrink-0">
                  Custom
                </span>
              )}
              <span className="px-1 py-0.5 text-[9px] bg-green-100 text-green-600 rounded font-medium shrink-0">
                Added
              </span>
            </div>
            <p className="text-[10px] text-gray-400 truncate">
              {field.section_name}
              {field.is_custom && field.creator_name && (
                <span className="text-gray-400"> · by {field.creator_name}</span>
              )}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // Draggable field - entire row is draggable
  return (
    <div
      ref={setNodeRef}
      className="px-3 py-2 border-b border-gray-100 bg-white hover:bg-primary-50 transition-colors group"
    >
      <div className="flex items-center gap-2">
        <div
          {...attributes}
          {...listeners}
          className="flex items-center gap-2 flex-1 min-w-0 cursor-grab active:cursor-grabbing touch-none select-none"
        >
          <GripVertical className="w-4 h-4 text-gray-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-gray-900 truncate">
                {field.field_name}
              </span>
              {field.is_custom && (
                <span className="px-1 py-0.5 text-[9px] bg-blue-100 text-blue-600 rounded font-medium shrink-0">
                  Custom
                </span>
              )}
            </div>
            <p className="text-[10px] text-gray-400 truncate">
              {field.section_name}
              {field.is_custom && field.creator_name && (
                <span className="text-gray-400"> · by {field.creator_name}</span>
              )}
            </p>
          </div>
        </div>
        {canDelete && onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            disabled={isDeleting}
            className="p-1 rounded text-gray-400 hover:bg-red-100 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all shrink-0"
            title="Delete this custom field"
          >
            {isDeleting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  )
}

// Droppable section wrapper for receiving library fields
function DroppableSection({
  sectionId,
  isOver,
  isDraggingLibraryField,
  children
}: {
  sectionId: string
  isOver: boolean
  isDraggingLibraryField: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver: isDirectlyOver } = useDroppable({
    id: `droppable-section-${sectionId}`
  })

  const showDropHint = isDraggingLibraryField && (isOver || isDirectlyOver)

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "transition-all duration-150 rounded-lg",
        isDraggingLibraryField && !showDropHint && "ring-1 ring-gray-200 ring-offset-1",
        showDropHint && "ring-2 ring-primary-500 ring-offset-2 bg-primary-50/30 scale-[1.01]"
      )}
    >
      {children}
      {showDropHint && (
        <div className="px-3 py-2 text-xs text-primary-600 font-medium text-center bg-primary-50 border-t border-primary-200 rounded-b-lg">
          Drop here to add field
        </div>
      )}
    </div>
  )
}

// Droppable zone at the bottom to create a new section
function NewSectionDropZone({
  onDrop
}: {
  onDrop: (fieldId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: 'droppable-new-section'
  })

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "mt-2 border-2 border-dashed rounded-lg transition-all duration-150",
        isOver
          ? "border-primary-400 bg-primary-50 scale-[1.02]"
          : "border-gray-300 bg-gray-50/50 hover:border-gray-400"
      )}
    >
      <div className={clsx(
        "flex items-center justify-center gap-2 py-4 px-3",
        isOver ? "text-primary-600" : "text-gray-500"
      )}>
        <FolderPlus className="w-5 h-5" />
        <span className="text-sm font-medium">
          {isOver ? "Release to create new section" : "Drop here to create new section"}
        </span>
      </div>
    </div>
  )
}

// Export a button component to open the customizer
export function AssetPageCustomizeButton({
  onClick
}: {
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
      title="Customize asset page layout"
    >
      <Settings2 className="w-4 h-4" />
      Customize
    </button>
  )
}
