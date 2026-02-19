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
  Gauge,
  ClipboardCheck,
  SlidersHorizontal,
  Grid3X3,
  GitBranch,
  Undo2,
  ExternalLink,
} from 'lucide-react'
import { SCENARIO_PRESETS, METRIC_PRESETS } from './FieldTypeRenderers'
import {
  useUserAssetPagePreferences,
  useUserAssetPageLayouts,
  type FieldWithPreference,
  type LayoutWithSharing,
  type SectionOverride,
  type FieldOverride
} from '../../hooks/useUserAssetPagePreferences'
import { useResearchFields } from '../../hooks/useResearchFields'
import { fieldConfigMatchesField, SYSTEM_DEFAULT_FIELD_SLUGS } from '../../lib/research/layout-resolver'
import { useAuth } from '../../hooks/useAuth'

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

// ============================================================================
// DIFF COMPUTATION TYPES & UTILITY
// ============================================================================

type LayoutChangeType = 'field_visibility' | 'field_moved' | 'field_reordered' | 'field_added' | 'field_removed'
  | 'section_renamed' | 'section_hidden' | 'section_reordered' | 'section_added'

interface LayoutChange {
  type: LayoutChangeType
  entityId: string
  label: string
  /** Human-readable description of what changed */
  description: string
  /** For field changes — the section context */
  sectionName?: string
  /** Template value (for display in diff) */
  templateValue?: string
  /** Current/draft value (for display in diff) */
  currentValue?: string
}

/**
 * Compute a structured diff between the template baseline and the current draft state.
 * Pure function — no side effects, no DB calls.
 */
function computeLayoutDiff(
  draftFieldOverrides: Map<string, DraftFieldOverride>,
  draftSectionOverrides: Map<string, DraftSectionOverride>,
  draftNewSections: DraftNewSection[],
  templateFieldIds: Set<string>,
  fieldsWithPreferences: FieldWithPreference[],
  allSections: Array<{ id: string; name: string; display_order: number }> | undefined,
): LayoutChange[] {
  const changes: LayoutChange[] = []

  // Build lookup maps
  const fieldMap = new Map<string, FieldWithPreference>()
  fieldsWithPreferences.forEach(f => fieldMap.set(f.field_id, f))
  const sectionMap = new Map<string, { id: string; name: string; display_order: number }>()
  allSections?.forEach(s => sectionMap.set(s.id, s))

  // --- Section changes ---
  draftSectionOverrides.forEach((override, sectionId) => {
    const original = sectionMap.get(sectionId)

    if (override.is_added) {
      const newSec = draftNewSections.find(ns => ns.temp_id === sectionId)
      changes.push({
        type: 'section_added',
        entityId: sectionId,
        label: newSec?.name || 'New Section',
        description: `Added section "${newSec?.name || 'New Section'}"`,
      })
      return
    }

    if (override.name_override && original) {
      changes.push({
        type: 'section_renamed',
        entityId: sectionId,
        label: original.name,
        description: `Renamed "${original.name}" → "${override.name_override}"`,
        templateValue: original.name,
        currentValue: override.name_override,
      })
    }

    if (override.is_hidden === true && original) {
      changes.push({
        type: 'section_hidden',
        entityId: sectionId,
        label: override.name_override || original?.name || sectionId,
        description: `Hidden section "${override.name_override || original?.name}"`,
        templateValue: 'Visible',
        currentValue: 'Hidden',
      })
    }

    if (override.display_order !== undefined && original && override.display_order !== original.display_order) {
      changes.push({
        type: 'section_reordered',
        entityId: sectionId,
        label: override.name_override || original?.name || sectionId,
        description: `Reordered section "${override.name_override || original?.name}"`,
        templateValue: `Position ${original.display_order + 1}`,
        currentValue: `Position ${override.display_order + 1}`,
      })
    }
  })

  // --- Field changes ---
  draftFieldOverrides.forEach((override, fieldId) => {
    const field = fieldMap.get(fieldId)
    if (!field) return
    const fieldName = field.field_name

    const isInTemplate = templateFieldIds.has(fieldId)

    if (!isInTemplate && override.is_visible) {
      // Field added via override
      const targetSection = sectionMap.get(override.section_id || '')
      const newSec = draftNewSections.find(ns => ns.temp_id === override.section_id)
      const sectionName = targetSection?.name || newSec?.name || field.section_name
      changes.push({
        type: 'field_added',
        entityId: fieldId,
        label: fieldName,
        description: `Added "${fieldName}" to ${sectionName}`,
        sectionName,
      })
      return
    }

    if (isInTemplate && !override.is_visible) {
      changes.push({
        type: 'field_visibility',
        entityId: fieldId,
        label: fieldName,
        description: `Hidden "${fieldName}"`,
        sectionName: field.section_name,
        templateValue: 'Visible',
        currentValue: 'Hidden',
      })
      return
    }

    // Field moved to different section
    if (override.section_id && override.section_id !== field.section_id) {
      const newSection = sectionMap.get(override.section_id)
      const newSec = draftNewSections.find(ns => ns.temp_id === override.section_id)
      const newSectionName = newSection?.name || newSec?.name || 'Unknown'
      changes.push({
        type: 'field_moved',
        entityId: fieldId,
        label: fieldName,
        description: `Moved "${fieldName}" from ${field.section_name} → ${newSectionName}`,
        sectionName: field.section_name,
        templateValue: field.section_name,
        currentValue: newSectionName,
      })
    }

    // Field reordered within section
    if (override.display_order !== undefined && override.display_order !== field.display_order) {
      // Only add if not already captured by a move
      if (!override.section_id || override.section_id === field.section_id) {
        changes.push({
          type: 'field_reordered',
          entityId: fieldId,
          label: fieldName,
          description: `Reordered "${fieldName}" in ${field.section_name}`,
          sectionName: field.section_name,
        })
      }
    }
  })

  return changes
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
  /** Callback to navigate to the Templates tab (closes this modal and opens Templates) */
  onOpenTemplates?: () => void
}

export function AssetPageFieldCustomizer({
  isOpen,
  onClose,
  assetId,
  assetName,
  viewFilter = 'aggregated',
  currentUserId,
  onOpenTemplates
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

  // Header Modules visibility — Action Loop auto-hides when no actionable cards

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

  // Field configuration state (for configurable field types)
  const [fieldConfig, setFieldConfig] = useState<Record<string, unknown>>({})
  // Slider config
  const [sliderMin, setSliderMin] = useState(0)
  const [sliderMax, setSliderMax] = useState(100)
  const [sliderStyle, setSliderStyle] = useState<'slider' | 'gauge' | 'progress'>('slider')
  const [sliderLabels, setSliderLabels] = useState({ min: '', mid: '', max: '' })
  // Scenario config
  const [scenarioPreset, setScenarioPreset] = useState<keyof typeof SCENARIO_PRESETS>('bull-base-bear')
  const [metricPreset, setMetricPreset] = useState<keyof typeof METRIC_PRESETS>('valuation')
  // Scorecard config
  const [scorecardMaxScore, setScorecardMaxScore] = useState(5)
  const [scorecardCriteria, setScorecardCriteria] = useState<Array<{ name: string; weight: number }>>([
    { name: 'Quality', weight: 25 },
    { name: 'Value', weight: 25 },
    { name: 'Growth', weight: 25 },
    { name: 'Risk', weight: 25 }
  ])
  // Spreadsheet config
  const [spreadsheetColumns, setSpreadsheetColumns] = useState<Array<{ name: string; type: 'text' | 'number' | 'currency' | 'percent' }>>([
    { name: 'Label', type: 'text' },
    { name: 'Value', type: 'number' }
  ])

  // Reset field config when type changes
  useEffect(() => {
    setFieldConfig({})
    // Reset to defaults
    setSliderMin(0)
    setSliderMax(100)
    setSliderStyle('slider')
    setSliderLabels({ min: '', mid: '', max: '' })
    setScenarioPreset('bull-base-bear')
    setMetricPreset('valuation')
    setScorecardMaxScore(5)
    setScorecardCriteria([
      { name: 'Quality', weight: 25 },
      { name: 'Value', weight: 25 },
      { name: 'Growth', weight: 25 },
      { name: 'Risk', weight: 25 }
    ])
    setSpreadsheetColumns([
      { name: 'Label', type: 'text' },
      { name: 'Value', type: 'number' }
    ])
  }, [newFieldType])

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

  // Inline review band state (replaces docked diff panel)
  const [reviewBandOpen, setReviewBandOpen] = useState(false)
  // Template "More" overflow menu
  const [templateMoreMenu, setTemplateMoreMenu] = useState(false)

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
      return new Set(fieldsWithPreferences.filter(f => SYSTEM_DEFAULT_FIELD_SLUGS.has(f.field_slug)).map(f => f.field_id))
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
    // Uses the centralized fieldConfigMatchesField for consistent matching.
    const findField = (fieldId: string): FieldWithPreference | undefined => {
      // First try direct ID match
      const directMatch = fieldMap.get(fieldId)
      if (directMatch) return directMatch

      // Use centralized matching to find by slug (handles preset-slug-timestamp)
      for (const [, field] of fieldMap) {
        if (fieldConfigMatchesField({ field_id: fieldId }, { id: field.field_id, slug: field.field_slug })) {
          return field
        }
      }

      // Fallback: try slug map directly
      const slug = fieldId.startsWith('preset-')
        ? fieldId.split('-').slice(1, /^\d+$/.test(fieldId.split('-').at(-1) || '') ? -1 : undefined).join('-')
        : null
      if (slug) return fieldBySlugMap.get(slug)

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
        return SYSTEM_DEFAULT_FIELD_SLUGS.has(field.field_slug)
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
          const isInTemplate = SYSTEM_DEFAULT_FIELD_SLUGS.has(field.field_slug)
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
          templateDefaultVisibility = SYSTEM_DEFAULT_FIELD_SLUGS.has(f.field_slug)
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

  // Scoped "Available fields" — only template-relevant fields not currently visible
  const availableFields = useMemo(() => {
    return allLibraryFields.filter(f => !f.is_visible)
  }, [allLibraryFields])

  // Count visible and total fields - use displayedFieldsBySection to respect template filtering
  const allDisplayedFields = displayedFieldsBySection.flatMap(s => s.fields)
  const visibleCount = allDisplayedFields.filter(f => f.is_visible).length
  const totalCount = allDisplayedFields.length

  // Compute layout diff for the status bar and diff panel
  const layoutChanges = useMemo(() =>
    computeLayoutDiff(
      draftFieldOverrides,
      draftSectionOverrides,
      draftNewSections,
      templateFieldIds,
      fieldsWithPreferences,
      allSections,
    ),
    [draftFieldOverrides, draftSectionOverrides, draftNewSections, templateFieldIds, fieldsWithPreferences, allSections]
  )

  const fieldChangeCount = layoutChanges.filter(c => c.type.startsWith('field_')).length
  const sectionChangeCount = layoutChanges.filter(c => c.type.startsWith('section_')).length
  const totalChangeCount = layoutChanges.length

  // Sets/maps for field-level override indicators
  const overriddenFieldIds = useMemo(() => {
    const ids = new Set<string>()
    draftFieldOverrides.forEach((_, fieldId) => ids.add(fieldId))
    return ids
  }, [draftFieldOverrides])

  const fieldTemplateSectionMap = useMemo(() => {
    const map = new Map<string, string>()
    fieldsWithPreferences.forEach(f => map.set(f.field_id, f.section_name))
    return map
  }, [fieldsWithPreferences])

  const fieldTemplateVisibilityMap = useMemo(() => {
    const map = new Map<string, boolean>()
    fieldsWithPreferences.forEach(f => {
      if (isDraftUsingDefault) {
        map.set(f.field_id, SYSTEM_DEFAULT_FIELD_SLUGS.has(f.field_slug))
      } else if (draftActiveLayout?.field_config) {
        const fc = draftActiveLayout.field_config.find(c => c.field_id === f.field_id)
        map.set(f.field_id, fc?.is_visible ?? false)
      } else {
        map.set(f.field_id, f.is_visible)
      }
    })
    return map
  }, [fieldsWithPreferences, isDraftUsingDefault, draftActiveLayout])

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

  // Revert a specific section property
  const handleRevertSectionName = (sectionId: string) => {
    setDraftSectionOverrides(prev => {
      const newMap = new Map(prev)
      const existing = newMap.get(sectionId)
      if (!existing) return prev
      const { name_override, ...rest } = existing
      // If only name_override was set, remove the override entirely
      const hasOther = rest.is_hidden !== undefined || rest.display_order !== undefined
      if (hasOther) {
        newMap.set(sectionId, rest)
      } else {
        newMap.delete(sectionId)
      }
      return newMap
    })
    setHasUnsavedChanges(true)
  }

  // Revert a single field override
  const handleRevertField = (fieldId: string) => {
    setDraftFieldOverrides(prev => {
      const newMap = new Map(prev)
      newMap.delete(fieldId)
      return newMap
    })
    setHasUnsavedChanges(true)
  }

  // Revert a single layout change
  const handleRevertChange = (change: LayoutChange) => {
    switch (change.type) {
      case 'section_renamed':
        handleRevertSectionName(change.entityId)
        break
      case 'section_hidden':
        setDraftSectionOverrides(prev => {
          const newMap = new Map(prev)
          const existing = newMap.get(change.entityId)
          if (!existing) return prev
          const { is_hidden, ...rest } = existing
          const hasOther = rest.name_override !== undefined || rest.display_order !== undefined
          if (hasOther) {
            newMap.set(change.entityId, rest)
          } else {
            newMap.delete(change.entityId)
          }
          return newMap
        })
        setHasUnsavedChanges(true)
        break
      case 'section_reordered':
        setDraftSectionOverrides(prev => {
          const newMap = new Map(prev)
          const existing = newMap.get(change.entityId)
          if (!existing) return prev
          const { display_order, ...rest } = existing
          const hasOther = rest.name_override !== undefined || rest.is_hidden !== undefined
          if (hasOther) {
            newMap.set(change.entityId, rest)
          } else {
            newMap.delete(change.entityId)
          }
          return newMap
        })
        setHasUnsavedChanges(true)
        break
      case 'section_added':
        handleDeleteSection(change.entityId)
        break
      case 'field_visibility':
      case 'field_moved':
      case 'field_reordered':
      case 'field_added':
      case 'field_removed':
        handleRevertField(change.entityId)
        break
    }
  }

  // ============================================
  // SAVE FUNCTION - Atomic RPC call
  // ============================================
  const handleSaveChanges = async () => {
    if (!assetId || !hasUnsavedChanges) {
      setSectionMenuOpen(null)
      onClose()
      return
    }

    setIsSaving(true)
    try {
      // Check if user clicked Reset (all draft overrides are empty and no layout change)
      const hasNoOverrides = draftFieldOverrides.size === 0 &&
                             draftSectionOverrides.size === 0 &&
                             draftNewSections.length === 0
      const clearAll = hasNoOverrides && draftLayoutId === undefined

      // Build field overrides (excluding _removeFromDatabase entries)
      const fieldOverrides: FieldOverride[] = []
      draftFieldOverrides.forEach((override, fieldId) => {
        if ((override as DraftFieldOverride & { _removeFromDatabase?: boolean })._removeFromDatabase) return
        fieldOverrides.push({
          field_id: fieldId,
          is_visible: override.is_visible,
          section_id: override.section_id,
          display_order: override.display_order
        })
      })

      // Build section overrides (include temp- IDs — RPC handles mapping)
      const sectionOverrides: SectionOverride[] = []
      draftSectionOverrides.forEach((override, sectionId) => {
        sectionOverrides.push({
          section_id: sectionId,
          name_override: override.name_override,
          is_hidden: override.is_hidden,
          display_order: override.display_order,
          is_added: override.is_added
        })
      })

      // Build new sections array
      const newSections = draftNewSections.map(s => ({
        temp_id: s.temp_id,
        name: s.name
      }))

      // Single atomic RPC call
      await saveCustomization.mutateAsync({
        layoutId: draftLayoutId,
        fieldOverrides,
        sectionOverrides,
        newSections,
        clearAll
      })

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

    // Build field config from DRAFT state (not server state) so the saved
    // template reflects what the user is currently seeing in the customizer.
    const fieldConfig = displayedFieldsBySection.flatMap((section, sIdx) =>
      section.fields.map((f, fIdx) => ({
        field_id: f.field_id,
        section_id: f.section_id || section.section_id,
        is_visible: f.is_visible,
        display_order: sIdx * 1000 + fIdx,
        is_collapsed: f.is_collapsed ?? false
      }))
    )

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
    { value: 'date', label: 'Date', description: 'Date picker field' },
    { value: 'scorecard', label: 'Scorecard', description: 'Multi-criteria weighted scoring matrix' },
    { value: 'slider', label: 'Slider / Gauge', description: 'Visual scale for ratings and confidence' },
    { value: 'spreadsheet', label: 'Spreadsheet', description: 'Mini Excel grid with formulas' },
    { value: 'scenario', label: 'Scenario Analysis', description: 'Bull/Base/Bear case comparison' }
  ]

  // Field type icon helper
  const getFieldTypeIcon = (type: string) => {
    const icons: Record<string, React.ReactNode> = {
      rich_text: <FileText className="w-4 h-4" />,
      numeric: <Hash className="w-4 h-4" />,
      date: <Calendar className="w-4 h-4" />,
      checklist: <CheckSquare className="w-4 h-4" />,
      timeline: <Clock className="w-4 h-4" />,
      metric: <Gauge className="w-4 h-4" />,
      scorecard: <ClipboardCheck className="w-4 h-4" />,
      slider: <SlidersHorizontal className="w-4 h-4" />,
      spreadsheet: <Grid3X3 className="w-4 h-4" />,
      scenario: <GitBranch className="w-4 h-4" />
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

  // Build configuration object based on field type
  const buildFieldConfig = (): Record<string, unknown> | undefined => {
    switch (newFieldType) {
      case 'slider':
        return {
          min: sliderMin,
          max: sliderMax,
          displayStyle: sliderStyle,
          showLabels: !!(sliderLabels.min || sliderLabels.mid || sliderLabels.max),
          labels: sliderLabels,
          showValue: true,
          colorMode: 'gradient' as const
        }
      case 'scenario': {
        const preset = SCENARIO_PRESETS[scenarioPreset]
        const metrics = METRIC_PRESETS[metricPreset]
        return {
          scenarios: preset.scenarios,
          metrics: metrics,
          showProbabilityWeighted: true,
          defaultScenarios: scenarioPreset
        }
      }
      case 'scorecard':
        return {
          criteria: scorecardCriteria.map((c, i) => ({
            id: `criterion_${i}`,
            name: c.name,
            weight: c.weight
          })),
          maxScore: scorecardMaxScore,
          showWeightedTotal: true
        }
      case 'spreadsheet':
        return {
          columns: spreadsheetColumns.map((c, i) => ({
            id: `col_${i}`,
            name: c.name,
            type: c.type
          })),
          defaultRows: 5,
          maxRows: 20,
          showRowNumbers: true,
          allowAddRows: true,
          allowAddColumns: true
        }
      default:
        return undefined
    }
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
      const config = buildFieldConfig()

      await createField.mutateAsync({
        name: newFieldName.trim(),
        slug,
        section_id: sectionId,
        field_type: newFieldType as any,
        is_universal: false,
        ...(config && { config })
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
            <p className="text-xs text-gray-400 mt-0.5">
              {assetName ? <span className="text-gray-500">{assetName}</span> : null}
              {assetName ? ' · ' : ''}Changes here apply to this asset only.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Override status bar */}
            {totalChangeCount > 0 ? (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 rounded-lg border border-amber-200">
                <div className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <div className="flex flex-col">
                  <span className="text-xs text-amber-800 font-semibold leading-tight">Overrides Active</span>
                  <span className="text-[10px] text-amber-600 leading-tight">
                    {fieldChangeCount > 0 && <span>{fieldChangeCount} field{fieldChangeCount !== 1 ? 's' : ''}</span>}
                    {fieldChangeCount > 0 && sectionChangeCount > 0 && ' · '}
                    {sectionChangeCount > 0 && <span>{sectionChangeCount} section{sectionChangeCount !== 1 ? 's' : ''}</span>}
                  </span>
                </div>
                <div className="h-4 w-px bg-amber-200 mx-1" />
                <button
                  onClick={handleClearOverrides}
                  disabled={isUpdating}
                  className="flex items-center gap-1 text-[11px] text-amber-700 hover:text-amber-900 font-medium hover:bg-amber-100 rounded px-1.5 py-0.5 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset all
                </button>
              </div>
            ) : (
              <span className="text-xs text-gray-400 italic">Using template layout</span>
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
                  <div className="flex items-center gap-2">
                    {canChangeLayout && (
                      <button
                        onClick={() => setShowTemplateSelector(!showTemplateSelector)}
                        className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                      >
                        {showTemplateSelector ? 'Cancel' : 'Change'}
                      </button>
                    )}
                    {/* More menu — power-user template actions */}
                    <div className="relative" data-section-menu>
                      <button
                        onClick={() => setTemplateMoreMenu(prev => !prev)}
                        className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                        title="More options"
                      >
                        <MoreVertical className="w-3.5 h-3.5" />
                      </button>
                      {templateMoreMenu && (
                        <div className="absolute right-0 top-full mt-1 w-56 bg-white rounded-lg border border-gray-200 shadow-lg z-50 py-1">
                          {onOpenTemplates && (
                            <button
                              onClick={() => {
                                setTemplateMoreMenu(false)
                                onClose()
                                onOpenTemplates()
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <ExternalLink className="w-4 h-4" />
                              Edit template in Templates
                            </button>
                          )}
                          {canChangeLayout && isUsingDefault && (
                            <button
                              onClick={() => {
                                setTemplateMoreMenu(false)
                                setShowCopyDialog(true)
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                            >
                              <Copy className="w-4 h-4" />
                              Copy template…
                            </button>
                          )}
                          {!onOpenTemplates && !(canChangeLayout && isUsingDefault) && (
                            <div className="px-3 py-2 text-xs text-gray-400">No actions available</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
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

                {/* Copy Dialog — hidden behind More menu */}
                {canChangeLayout && showCopyDialog && (
                  <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-700 mb-2">
                      This will create a new template. You can edit it in Templates.
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

              {/* Header Modules — outside tile customization */}
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
                                  handleRevertSectionName={handleRevertSectionName}
                                  handleRemoveFieldFromSection={handleRemoveFieldFromSection}
                                  handleToggleVisibility={handleToggleVisibility}
                                  handleRevertField={handleRevertField}
                                  isSaving={isSaving}
                                  isDraggingLibraryField={activeDragType === 'library-field'}
                                  dragOverPositionId={dragOverPositionId}
                                  overriddenFieldIds={overriddenFieldIds}
                                  fieldTemplateSectionMap={fieldTemplateSectionMap}
                                  fieldTemplateVisibilityMap={fieldTemplateVisibilityMap}
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

                {/* Right Column: Available Fields (scoped to template) */}
                <div className="w-[300px] flex flex-col shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-sm font-medium text-gray-700">Available Fields</h3>
                      <p className="text-[10px] text-gray-400">From template · drag to add</p>
                    </div>
                    {activeDragType === 'library-field' && (
                      <span className="text-xs text-primary-600 font-medium animate-pulse">
                        Drop on a section ←
                      </span>
                    )}
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
                          placeholder="Search available fields..."
                          className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                      </div>
                    </div>
                    {/* Field List — flat, no category grouping */}
                    <div className="flex-1 overflow-y-auto">
                      {availableFields.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-400 px-4 py-6">
                          <Check className="w-6 h-6 mb-1.5 text-green-400" />
                          <p className="text-xs font-medium text-gray-500">All fields are in layout</p>
                          <p className="text-[10px] text-gray-400 text-center mt-1">
                            {addFieldSearch.trim() ? 'No hidden fields match your search.' : 'Hide a field from the layout to see it here.'}
                          </p>
                        </div>
                      ) : (
                        availableFields.map(field => (
                          <DraggableLibraryField
                            key={field.field_id}
                            field={field}
                            isAlreadyVisible={false}
                            onRemove={() => handleRemoveFieldFromSection(field.field_id)}
                            isOverridden={overriddenFieldIds.has(field.field_id)}
                            isHiddenOverride={
                              overriddenFieldIds.has(field.field_id) &&
                              (fieldTemplateVisibilityMap.get(field.field_id) ?? false)
                            }
                            isAddedOverride={false}
                          />
                        ))
                      )}
                    </div>
                    {/* Link to full library */}
                    {onOpenTemplates && (
                      <div className="p-2 border-t border-gray-200 bg-white">
                        <button
                          onClick={() => {
                            onClose()
                            onOpenTemplates()
                          }}
                          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                        >
                          Browse full library in Templates
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    )}
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

        {/* Footer area — review band + action bar */}
        <div className="border-t border-gray-200 bg-gray-50 rounded-b-xl">
          {/* Inline collapsible review band */}
          {totalChangeCount > 0 && (
            <div className="border-b border-gray-200">
              <button
                onClick={() => setReviewBandOpen(prev => !prev)}
                className="w-full flex items-center gap-2 px-5 py-2 hover:bg-gray-100 transition-colors"
              >
                {reviewBandOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-gray-500" />
                )}
                <span className="text-xs font-semibold text-gray-700">
                  Review changes ({totalChangeCount})
                </span>
              </button>

              {reviewBandOpen && (
                <div className="px-5 pb-3 max-h-[200px] overflow-y-auto">
                  {/* Section changes */}
                  {sectionChangeCount > 0 && (
                    <div className="mb-2">
                      <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                        Section changes
                      </h4>
                      <div className="space-y-0.5">
                        {layoutChanges.filter(c => c.type.startsWith('section_')).map(change => (
                          <div
                            key={`${change.type}-${change.entityId}`}
                            className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white transition-colors"
                          >
                            <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                            <span className="text-xs text-gray-700 flex-1 min-w-0 truncate">{change.description}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRevertChange(change) }}
                              className="text-[10px] text-amber-600 hover:text-amber-800 font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            >
                              Revert
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Field changes */}
                  {fieldChangeCount > 0 && (
                    <div className="mb-2">
                      <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
                        Field changes
                      </h4>
                      <div className="space-y-0.5">
                        {layoutChanges.filter(c => c.type.startsWith('field_')).map(change => (
                          <div
                            key={`${change.type}-${change.entityId}`}
                            className="group flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white transition-colors"
                          >
                            <div className={clsx(
                              "w-1.5 h-1.5 rounded-full shrink-0",
                              change.type === 'field_added' ? 'bg-blue-400'
                                : change.type === 'field_visibility' ? 'bg-red-400'
                                : 'bg-amber-400'
                            )} />
                            <span className="text-xs text-gray-700 flex-1 min-w-0 truncate">{change.description}</span>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRevertChange(change) }}
                              className="text-[10px] text-amber-600 hover:text-amber-800 font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            >
                              Revert
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* Reset all at bottom of band */}
                  <div className="pt-1.5 border-t border-gray-200 mt-1">
                    <button
                      onClick={handleClearOverrides}
                      className="flex items-center gap-1 text-[11px] text-red-600 hover:text-red-700 font-medium"
                    >
                      <RotateCcw className="w-3 h-3" />
                      Reset all overrides
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action bar */}
          <div className="flex items-center gap-3 px-5 py-3">
            {hasUnsavedChanges && (
              <div className="flex items-center gap-1.5 mr-auto">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>
              </div>
            )}
            <Button
              variant="secondary"
              onClick={handleCancel}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveChanges}
              disabled={isSaving || !hasUnsavedChanges}
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Saving...
                </>
              ) : totalChangeCount > 0 ? (
                'Save Overrides'
              ) : hasUnsavedChanges ? (
                'Save Changes'
              ) : (
                'Done'
              )}
            </Button>
          </div>
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

              {/* Field Configuration - shown for configurable types */}
              {newFieldType === 'slider' && (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                  <h4 className="text-sm font-medium text-gray-700">Slider Configuration</h4>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Style</label>
                      <select
                        value={sliderStyle}
                        onChange={(e) => setSliderStyle(e.target.value as 'slider' | 'gauge' | 'progress')}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      >
                        <option value="slider">Slider</option>
                        <option value="gauge">Gauge</option>
                        <option value="progress">Progress Bar</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Min</label>
                      <input
                        type="number"
                        value={sliderMin}
                        onChange={(e) => setSliderMin(Number(e.target.value))}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Max</label>
                      <input
                        type="number"
                        value={sliderMax}
                        onChange={(e) => setSliderMax(Number(e.target.value))}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Min Label</label>
                      <input
                        type="text"
                        value={sliderLabels.min}
                        onChange={(e) => setSliderLabels({ ...sliderLabels, min: e.target.value })}
                        placeholder="e.g., Bearish"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Mid Label</label>
                      <input
                        type="text"
                        value={sliderLabels.mid}
                        onChange={(e) => setSliderLabels({ ...sliderLabels, mid: e.target.value })}
                        placeholder="e.g., Neutral"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Max Label</label>
                      <input
                        type="text"
                        value={sliderLabels.max}
                        onChange={(e) => setSliderLabels({ ...sliderLabels, max: e.target.value })}
                        placeholder="e.g., Bullish"
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      />
                    </div>
                  </div>
                </div>
              )}

              {newFieldType === 'scenario' && (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                  <h4 className="text-sm font-medium text-gray-700">Scenario Analysis Configuration</h4>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Scenario Preset</label>
                      <select
                        value={scenarioPreset}
                        onChange={(e) => setScenarioPreset(e.target.value as keyof typeof SCENARIO_PRESETS)}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      >
                        {Object.entries(SCENARIO_PRESETS).map(([key, preset]) => (
                          <option key={key} value={key}>{preset.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Metric Preset</label>
                      <select
                        value={metricPreset}
                        onChange={(e) => setMetricPreset(e.target.value as keyof typeof METRIC_PRESETS)}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      >
                        {Object.entries(METRIC_PRESETS).map(([key]) => (
                          <option key={key} value={key}>{key.charAt(0).toUpperCase() + key.slice(1)}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500">
                    You can add, remove, or modify scenarios and metrics after creating the field.
                  </p>
                </div>
              )}

              {newFieldType === 'scorecard' && (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                  <h4 className="text-sm font-medium text-gray-700">Scorecard Configuration</h4>

                  <div className="flex items-center gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Max Score</label>
                      <select
                        value={scorecardMaxScore}
                        onChange={(e) => setScorecardMaxScore(Number(e.target.value))}
                        className="px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                      >
                        <option value={5}>5 (1-5 scale)</option>
                        <option value={10}>10 (1-10 scale)</option>
                        <option value={100}>100 (percentage)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Criteria (weights should total 100%)</label>
                    <div className="space-y-2">
                      {scorecardCriteria.map((criterion, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={criterion.name}
                            onChange={(e) => {
                              const updated = [...scorecardCriteria]
                              updated[index].name = e.target.value
                              setScorecardCriteria(updated)
                            }}
                            placeholder="Criterion name"
                            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                          />
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={criterion.weight}
                              onChange={(e) => {
                                const updated = [...scorecardCriteria]
                                updated[index].weight = Number(e.target.value)
                                setScorecardCriteria(updated)
                              }}
                              min={0}
                              max={100}
                              className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                            />
                            <span className="text-xs text-gray-500">%</span>
                          </div>
                          {scorecardCriteria.length > 1 && (
                            <button
                              onClick={() => setScorecardCriteria(scorecardCriteria.filter((_, i) => i !== index))}
                              className="p-1 text-gray-400 hover:text-red-500"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setScorecardCriteria([...scorecardCriteria, { name: '', weight: 0 }])}
                      className="mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      + Add Criterion
                    </button>
                  </div>
                </div>
              )}

              {newFieldType === 'spreadsheet' && (
                <div className="border border-gray-200 rounded-lg p-4 space-y-3 bg-gray-50">
                  <h4 className="text-sm font-medium text-gray-700">Spreadsheet Configuration</h4>

                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-2">Columns</label>
                    <div className="space-y-2">
                      {spreadsheetColumns.map((column, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={column.name}
                            onChange={(e) => {
                              const updated = [...spreadsheetColumns]
                              updated[index].name = e.target.value
                              setSpreadsheetColumns(updated)
                            }}
                            placeholder="Column name"
                            className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                          />
                          <select
                            value={column.type}
                            onChange={(e) => {
                              const updated = [...spreadsheetColumns]
                              updated[index].type = e.target.value as 'text' | 'number' | 'currency' | 'percent'
                              setSpreadsheetColumns(updated)
                            }}
                            className="px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                          >
                            <option value="text">Text</option>
                            <option value="number">Number</option>
                            <option value="currency">Currency</option>
                            <option value="percent">Percent</option>
                          </select>
                          {spreadsheetColumns.length > 1 && (
                            <button
                              onClick={() => setSpreadsheetColumns(spreadsheetColumns.filter((_, i) => i !== index))}
                              className="p-1 text-gray-400 hover:text-red-500"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => setSpreadsheetColumns([...spreadsheetColumns, { name: '', type: 'text' }])}
                      className="mt-2 text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      + Add Column
                    </button>
                  </div>

                  <p className="text-xs text-gray-500">
                    Users can add more rows and columns after creation. Formulas like =SUM(A1:A5) are supported.
                  </p>
                </div>
              )}

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
  handleRevertSectionName?: (id: string) => void
  handleRemoveFieldFromSection: (fieldId: string) => void
  handleToggleVisibility: (fieldId: string) => void
  handleRevertField?: (fieldId: string) => void
  isSaving: boolean
  isDraggingLibraryField?: boolean
  dragOverPositionId?: string | null
  /** Set of field IDs that have draft overrides */
  overriddenFieldIds?: Set<string>
  /** Map of field_id -> template section name for tooltip */
  fieldTemplateSectionMap?: Map<string, string>
  /** Map of field_id -> template visibility */
  fieldTemplateVisibilityMap?: Map<string, boolean>
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
  handleRevertSectionName,
  handleRemoveFieldFromSection,
  handleToggleVisibility,
  handleRevertField,
  isSaving,
  isDraggingLibraryField = false,
  dragOverPositionId = null,
  overriddenFieldIds,
  fieldTemplateSectionMap,
  fieldTemplateVisibilityMap,
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
                  Added
                </span>
              )}
              {!section.section_is_added && section.section_has_override && section.section_name !== section.section_original_name && (
                <span
                  className="px-1.5 py-0.5 text-[9px] bg-amber-100 text-amber-700 rounded font-medium shrink-0"
                  title={`Template name: ${section.section_original_name}`}
                >
                  Renamed
                </span>
              )}
            </span>
          </button>
        )}
        {/* Modified indicator */}
        {!section.section_is_added && section.section_has_override && (
          <span
            className="flex items-center gap-1 shrink-0"
            title="This section differs from the template"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-[10px] text-amber-600 font-medium">Modified</span>
          </span>
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
              {/* Per-section revert controls */}
              {section.section_has_override && !section.section_is_added && (
                <>
                  <div className="border-t border-gray-100 my-1" />
                  {section.section_name !== section.section_original_name && handleRevertSectionName && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRevertSectionName(section.section_id)
                        setSectionMenuOpen(null)
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-amber-50"
                    >
                      <Undo2 className="w-4 h-4" />
                      Revert section name
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleResetSection(section.section_id)
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-amber-600 hover:bg-amber-50"
                  >
                    <RotateCcw className="w-4 h-4" />
                    Revert all changes in section
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
                      onRevertField={handleRevertField}
                      isSaving={isSaving}
                      isFromTemplate={(field as any).isFromTemplate}
                      isAddedViaOverride={(field as any).isAddedViaOverride}
                      isOverridden={overriddenFieldIds?.has(field.field_id)}
                      templateSectionName={fieldTemplateSectionMap?.get(field.field_id)}
                      templateVisible={fieldTemplateVisibilityMap?.get(field.field_id)}
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
  onRevertField,
  isSaving,
  isFromTemplate = true,
  isAddedViaOverride = false,
  isOverridden = false,
  templateSectionName,
  templateVisible,
}: {
  field: FieldWithPreference
  onToggleVisibility: (fieldId: string) => void
  onRemove?: (fieldId: string) => void
  onRevertField?: (fieldId: string) => void
  isSaving: boolean
  isFromTemplate?: boolean
  isAddedViaOverride?: boolean
  isOverridden?: boolean
  templateSectionName?: string
  templateVisible?: boolean
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
    'documents': 'Documents',
    'scorecard': 'Scorecard',
    'slider': 'Slider / Gauge',
    'spreadsheet': 'Spreadsheet',
    'scenario': 'Scenario Analysis'
  }

  const fieldTypeName = fieldTypeDisplayNames[field.field_type] || field.field_type

  // Build diff tooltip for overridden fields
  const diffTooltipParts: string[] = []
  if (isOverridden && !isAddedViaOverride) {
    if (templateVisible !== undefined && templateVisible !== field.is_visible) {
      diffTooltipParts.push(`Template: ${templateVisible ? 'Visible' : 'Hidden'} · Current: ${field.is_visible ? 'Visible' : 'Hidden'}`)
    }
    if (templateSectionName && templateSectionName !== field.section_name) {
      diffTooltipParts.push(`Template section: ${templateSectionName} · Current: ${field.section_name}`)
    }
  }
  const diffTooltip = diffTooltipParts.length > 0 ? diffTooltipParts.join('\n') : undefined

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        "group flex items-center gap-2 px-3 py-2 hover:bg-gray-50 bg-white",
        isAddedViaOverride && "bg-blue-50/50",
        isOverridden && !isAddedViaOverride && "bg-amber-50/30",
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
      <div className="flex-1 min-w-0" title={diffTooltip}>
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
              Added
            </span>
          )}
          {isOverridden && !isAddedViaOverride && (
            <span className="flex items-center gap-0.5 shrink-0" title={diffTooltip}>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            </span>
          )}
        </div>
      </div>

      {/* Revert button - for overridden fields (shown on hover) */}
      {isOverridden && onRevertField && (
        <button
          onClick={() => onRevertField(field.field_id)}
          disabled={isSaving}
          className="p-1 rounded text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-amber-50 hover:text-amber-700 transition-all disabled:opacity-50"
          title="Revert to template default"
        >
          <Undo2 className="w-3.5 h-3.5" />
        </button>
      )}

      {/* Remove button - only for override-added fields */}
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
  isDeleting,
  isOverridden,
  isHiddenOverride,
  isAddedOverride,
}: {
  field: FieldWithPreference
  isAlreadyVisible: boolean
  onRemove: () => void
  canDelete?: boolean
  onDelete?: () => void
  isDeleting?: boolean
  /** Field has a draft override */
  isOverridden?: boolean
  /** Field is hidden via override (was visible in template) */
  isHiddenOverride?: boolean
  /** Field was added via override (not in template) */
  isAddedOverride?: boolean
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
                In layout
              </span>
              {isAddedOverride && (
                <span className="px-1 py-0.5 text-[9px] bg-amber-100 text-amber-600 rounded font-medium shrink-0">
                  Added
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
              {isHiddenOverride && (
                <span className="px-1 py-0.5 text-[9px] bg-red-100 text-red-600 rounded font-medium shrink-0">
                  Hidden
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
