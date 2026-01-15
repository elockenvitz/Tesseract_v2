/**
 * ResearchFieldsManager Component
 *
 * Allows users to manage their research layout templates.
 * Users can create multiple layouts, reorder sections and fields,
 * create custom sections, and add fields from the library.
 */

import { useState, useEffect, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  MeasuringStrategy
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { restrictToVerticalAxis, restrictToParentElement } from '@dnd-kit/modifiers'
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Plus,
  Save,
  Trash2,
  Check,
  Loader2,
  Star,
  FileText,
  Hash,
  Calendar,
  CheckSquare,
  Clock,
  Gauge,
  Edit2,
  Copy,
  HelpCircle,
  GripVertical,
  FolderPlus,
  Library,
  X,
  Share2
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import {
  useUserAssetPagePreferences,
  useUserAssetPageLayouts,
  type FieldWithPreference,
  type FieldConfigItem,
  type SavedLayout,
  type LayoutWithSharing
} from '../../hooks/useUserAssetPagePreferences'
import { useResearchFieldPresets, useResearchSections, useResearchFields } from '../../hooks/useResearchFields'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { LayoutSharingModal } from './LayoutSharingModal'

// ============================================================================
// TYPES
// ============================================================================

interface SectionConfig {
  section_id: string
  section_name: string
  section_slug: string
  display_order: number
  is_system: boolean
  fields: FieldConfig[]
}

interface FieldConfig {
  field_id: string
  field_name: string
  field_slug: string
  field_type: string
  is_visible: boolean
  display_order: number
  is_system: boolean
}

// ============================================================================
// FIELD TYPE ICON
// ============================================================================

function FieldTypeIcon({ type, className }: { type: string; className?: string }) {
  const icons: Record<string, React.ReactNode> = {
    rich_text: <FileText className={className} />,
    numeric: <Hash className={className} />,
    date: <Calendar className={className} />,
    checklist: <CheckSquare className={className} />,
    timeline: <Clock className={className} />,
    metric: <Gauge className={className} />
  }
  return <>{icons[type] || <FileText className={className} />}</>
}

// ============================================================================
// SORTABLE FIELD COMPONENT
// ============================================================================

interface SortableFieldProps {
  field: FieldConfig
  sectionId: string
  isVisible: boolean
  onToggleVisibility: () => void
  onRemove: () => void
}

function SortableField({ field, sectionId, isVisible, onToggleVisibility, onRemove }: SortableFieldProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: field.field_id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'flex items-center gap-2 px-3 py-2 border rounded-lg group',
        isVisible
          ? 'border-green-200 bg-green-50/50'
          : 'border-gray-200 bg-gray-50 opacity-60'
      )}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className="p-1 text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing touch-none rounded hover:bg-gray-100 transition-colors"
        title="Drag to reorder"
      >
        <GripVertical className="w-4 h-4" />
      </div>

      {/* Checkbox */}
      <button
        onClick={onToggleVisibility}
        className={clsx(
          'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
          isVisible
            ? 'border-green-500 bg-green-500'
            : 'border-gray-300 bg-white'
        )}
      >
        {isVisible && <Check className="w-3 h-3 text-white" />}
      </button>

      {/* Field icon */}
      <FieldTypeIcon type={field.field_type} className="w-4 h-4 text-gray-400 flex-shrink-0" />

      {/* Field info */}
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-900">{field.field_name}</span>
      </div>

      {/* Badges */}
      {!field.is_system && (
        <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded flex-shrink-0">
          Custom
        </span>
      )}
      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded flex-shrink-0">
        {field.field_type.replace('_', ' ')}
      </span>

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        title="Remove field"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}

// ============================================================================
// FIELD DRAG OVERLAY (ghost preview while dragging)
// ============================================================================

function FieldDragOverlay({ field }: { field: FieldConfig }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-white shadow-xl ring-2 ring-primary-400 border-primary-300">
      <div className="p-1 text-primary-500">
        <GripVertical className="w-4 h-4" />
      </div>
      <div className="w-5 h-5 rounded border-2 border-green-500 bg-green-500 flex items-center justify-center flex-shrink-0">
        <Check className="w-3 h-3 text-white" />
      </div>
      <FieldTypeIcon type={field.field_type} className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-900">{field.field_name}</span>
      </div>
    </div>
  )
}

// ============================================================================
// SECTION DRAG OVERLAY (ghost preview while dragging)
// ============================================================================

function SectionDragOverlay({ section }: { section: SectionConfig }) {
  const visibleCount = section.fields.filter(f => f.is_visible).length
  return (
    <div className="border rounded-lg bg-white shadow-xl ring-2 ring-primary-400 border-primary-300 overflow-hidden">
      <div className="flex items-center bg-gray-50 px-3 py-3">
        <div className="p-1 text-primary-500 mr-2">
          <GripVertical className="w-5 h-5" />
        </div>
        <ChevronRight className="w-4 h-4 text-gray-400 mr-3" />
        <span className="font-medium text-gray-900">{section.section_name}</span>
        <span className="text-xs text-gray-500 ml-3">
          {visibleCount} / {section.fields.length}
        </span>
      </div>
    </div>
  )
}

// ============================================================================
// SORTABLE SECTION COMPONENT
// ============================================================================

interface SortableSectionProps {
  section: SectionConfig
  isExpanded: boolean
  onToggleExpand: () => void
  onToggleFieldVisibility: (fieldId: string) => void
  onRemoveField: (fieldId: string) => void
  onRemoveSection: () => void
  onRenameSection: (newName: string) => void
  onAddField: () => void
  onFieldDragEnd: (activeId: string, overId: string) => void
}

function SortableSection({
  section,
  isExpanded,
  onToggleExpand,
  onToggleFieldVisibility,
  onRemoveField,
  onRemoveSection,
  onRenameSection,
  onAddField,
  onFieldDragEnd
}: SortableSectionProps) {
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(section.section_name)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: section.section_id })

  const fieldSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1
  }

  const sectionVisibleCount = section.fields.filter(f => f.is_visible).length

  const handleFieldDragStart = (event: DragStartEvent) => {
    setActiveFieldId(event.active.id as string)
  }

  const handleFieldDragEnd = (event: DragEndEvent) => {
    setActiveFieldId(null)
    const { active, over } = event
    if (over && active.id !== over.id) {
      onFieldDragEnd(active.id as string, over.id as string)
    }
  }

  const activeField = activeFieldId ? section.fields.find(f => f.field_id === activeFieldId) : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="border border-gray-200 rounded-lg overflow-hidden"
    >
      {/* Section Header */}
      <div className="flex items-center bg-gray-50 group">
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          className="p-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-grab active:cursor-grabbing border-r border-gray-200 touch-none transition-colors"
          title="Drag to reorder"
        >
          <GripVertical className="w-5 h-5" />
        </div>

        <div
          onClick={isRenaming ? undefined : onToggleExpand}
          className={clsx(
            "flex-1 flex items-center gap-3 px-4 py-3 transition-colors",
            !isRenaming && "hover:bg-gray-100 cursor-pointer"
          )}
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
          {isRenaming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (renameValue.trim() && renameValue.trim() !== section.section_name) {
                  onRenameSection(renameValue.trim())
                }
                setIsRenaming(false)
              }}
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                className="px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
                onBlur={() => {
                  if (renameValue.trim() && renameValue.trim() !== section.section_name) {
                    onRenameSection(renameValue.trim())
                  }
                  setIsRenaming(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setRenameValue(section.section_name)
                    setIsRenaming(false)
                  }
                }}
              />
            </form>
          ) : (
            <span className="font-medium text-gray-900">{section.section_name}</span>
          )}
          <span className="text-xs text-gray-500">
            {sectionVisibleCount} / {section.fields.length}
          </span>
          <button
            onClick={(e) => { e.stopPropagation(); onAddField() }}
            className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded"
            title="Add field"
          >
            <Plus className="w-4 h-4" />
          </button>
          {!section.is_system && (
            <span className="text-xs bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded">Custom</span>
          )}
        </div>

        {/* Section actions */}
        <div className="flex items-center gap-1 pr-3">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setRenameValue(section.section_name)
              setIsRenaming(true)
            }}
            className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            title="Rename section"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={onRemoveSection}
            className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded opacity-0 group-hover:opacity-100 transition-opacity"
            title="Remove section"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Section Fields */}
      {isExpanded && (
        <div className="p-3 space-y-1 bg-white">
          <DndContext
            sensors={fieldSensors}
            collisionDetection={closestCenter}
            onDragStart={handleFieldDragStart}
            onDragEnd={handleFieldDragEnd}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          >
            <SortableContext
              items={section.fields.map(f => f.field_id)}
              strategy={verticalListSortingStrategy}
            >
              {section.fields.map(field => (
                <SortableField
                  key={field.field_id}
                  field={field}
                  sectionId={section.section_id}
                  isVisible={field.is_visible}
                  onToggleVisibility={() => onToggleFieldVisibility(field.field_id)}
                  onRemove={() => onRemoveField(field.field_id)}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeField ? <FieldDragOverlay field={activeField} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// LAYOUT CARD COMPONENT
// ============================================================================

interface LayoutCardProps {
  layout: LayoutWithSharing | SavedLayout
  isDefault: boolean
  onEdit: () => void
  onDelete?: () => void
  onSetDefault?: () => void
  onDuplicate?: () => void
  canShare?: boolean
}

function LayoutCard({ layout, isDefault, onEdit, onDelete, onSetDefault, onDuplicate, canShare = true }: LayoutCardProps) {
  const [showShareModal, setShowShareModal] = useState(false)
  const fieldCount = layout.field_config?.length || 0
  const visibleCount = layout.field_config?.filter(f => f.is_visible).length || 0

  // Check if this is a shared layout
  const layoutWithSharing = layout as LayoutWithSharing
  const isSharedWithMe = layoutWithSharing.is_shared_with_me
  const sharedBy = layoutWithSharing.shared_by
  const myPermission = layoutWithSharing.my_permission

  // Can only share layouts that have an actual ID (not the system default) and that user owns
  const isShareable = canShare && layout.id && layout.id !== 'system-default' && !isSharedWithMe

  // Can edit if: not a shared layout, OR has owner/edit/admin permission on shared layout
  const canEdit = !isSharedWithMe || myPermission === 'owner' || myPermission === 'edit' || myPermission === 'admin'

  // Format shared by name
  const sharedByName = sharedBy
    ? sharedBy.first_name && sharedBy.last_name
      ? `${sharedBy.first_name} ${sharedBy.last_name}`
      : sharedBy.email || 'Someone'
    : ''

  return (
    <>
      <div
        className={clsx(
          'group relative p-4 border rounded-lg transition-all cursor-pointer hover:shadow-md',
          isDefault
            ? 'border-primary-300 bg-primary-50/50 ring-1 ring-primary-200'
            : isSharedWithMe
            ? 'border-blue-200 bg-blue-50/30 hover:border-blue-300'
            : 'border-gray-200 hover:border-gray-300 bg-white'
        )}
        onClick={canEdit ? onEdit : undefined}
      >
        {/* Default badge */}
        {isDefault && (
          <div className="absolute -top-2 left-3 p-1.5 bg-primary-600 text-white rounded-full" title="Default layout">
            <Star className="w-3 h-3 fill-current" />
          </div>
        )}

        {/* Shared badge */}
        {isSharedWithMe && (
          <div className="absolute -top-2 right-3 flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
            <Share2 className="w-3 h-3" />
            Shared
          </div>
        )}

        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0 pt-1">
            <h3 className="font-medium text-gray-900 truncate">{layout.name}</h3>
            {layout.description && (
              <p className="text-sm text-gray-500 mt-0.5 truncate">{layout.description}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <p className="text-xs text-gray-400">
                {visibleCount} of {fieldCount} fields visible
              </p>
              {isSharedWithMe && sharedByName && (
                <span className="text-xs text-blue-600">
                  by {sharedByName}
                </span>
              )}
              {isSharedWithMe && myPermission && myPermission !== 'owner' && (
                <span className={clsx(
                  'text-xs px-1.5 py-0.5 rounded',
                  myPermission === 'view' ? 'bg-gray-100 text-gray-600' :
                  myPermission === 'edit' ? 'bg-green-100 text-green-700' :
                  'bg-purple-100 text-purple-700'
                )}>
                  {myPermission}
                </span>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
            {isShareable && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowShareModal(true)
                }}
                className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                title="Share layout"
              >
                <Share2 className="w-4 h-4" />
              </button>
            )}
            {!isDefault && onSetDefault && !isSharedWithMe && (
              <button
                onClick={onSetDefault}
                className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded"
                title="Set as default"
              >
                <Star className="w-4 h-4" />
              </button>
            )}
            {onDuplicate && (
              <button
                onClick={onDuplicate}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                title="Duplicate"
              >
                <Copy className="w-4 h-4" />
              </button>
            )}
            {canEdit && (
              <button
                onClick={onEdit}
                className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded"
                title="Edit"
              >
                <Edit2 className="w-4 h-4" />
              </button>
            )}
            {onDelete && !isDefault && !isSharedWithMe && (
              <button
                onClick={onDelete}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                title="Delete"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Share Modal */}
      {showShareModal && isShareable && (
        <LayoutSharingModal
          layout={layout}
          onClose={() => setShowShareModal(false)}
        />
      )}
    </>
  )
}

// ============================================================================
// ADD SECTION MODAL
// ============================================================================

interface SystemSection {
  section_id: string
  section_name: string
  section_slug: string
  fields: { field_id: string; field_name: string; field_slug: string; field_type: string; is_system: boolean }[]
}

interface AddSectionModalProps {
  isOpen: boolean
  onClose: () => void
  onAddCustom: (name: string) => void
  onAddFromLibrary: (section: SystemSection) => void
  existingSectionIds: string[]
  availableSections: SystemSection[]
}

function AddSectionModal({ isOpen, onClose, onAddCustom, onAddFromLibrary, existingSectionIds, availableSections }: AddSectionModalProps) {
  const [mode, setMode] = useState<'library' | 'custom'>('library')
  const [name, setName] = useState('')
  const [error, setError] = useState('')

  // Filter out sections already in the layout
  const sectionsNotInLayout = availableSections.filter(s => !existingSectionIds.includes(s.section_id))

  const handleSubmitCustom = () => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Section name is required')
      return
    }
    onAddCustom(trimmedName)
    setName('')
    setError('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Add Section</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('library')}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors',
              mode === 'library'
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            <Library className="w-4 h-4 inline mr-1" />
            From Library
          </button>
          <button
            onClick={() => setMode('custom')}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors',
              mode === 'custom'
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            <Plus className="w-4 h-4 inline mr-1" />
            Custom Section
          </button>
        </div>

        {mode === 'library' ? (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sectionsNotInLayout.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">All available sections are already in your layout</p>
            ) : (
              sectionsNotInLayout.map(section => (
                <button
                  key={section.section_id}
                  onClick={() => {
                    onAddFromLibrary(section)
                    onClose()
                  }}
                  className="w-full p-3 border border-gray-200 rounded-lg text-left hover:border-primary-300 hover:bg-primary-50/50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900">{section.section_name}</span>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {section.fields.length} field{section.fields.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <Plus className="w-4 h-4 text-gray-400" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value); setError('') }}
                placeholder="e.g., Valuation Analysis"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitCustom()}
              />
              {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={handleSubmitCustom}>Add Section</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// FIELD TYPE PREVIEW COMPONENT
// ============================================================================

function FieldTypePreview({ type }: { type: string }) {
  switch (type) {
    case 'rich_text':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-2 border border-gray-200 shadow-sm">
          <div className="h-2.5 bg-gray-400 rounded w-3/4" />
          <div className="h-2 bg-gray-300 rounded w-full" />
          <div className="h-2 bg-gray-300 rounded w-5/6" />
          <div className="h-2 bg-gray-200 rounded w-2/3" />
        </div>
      )
    case 'checklist':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-2 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-green-500 bg-green-500 rounded flex items-center justify-center">
              <Check className="w-3 h-3 text-white" />
            </div>
            <span className="text-gray-700">Completed item</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-gray-300 rounded" />
            <span className="text-gray-500">Pending item</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-gray-300 rounded" />
            <span className="text-gray-500">Another task</span>
          </div>
        </div>
      )
    case 'timeline':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div className="w-3 h-3 bg-primary-500 rounded-full" />
              <div className="w-0.5 h-6 bg-gray-300" />
              <div className="w-3 h-3 bg-gray-300 rounded-full" />
              <div className="w-0.5 h-6 bg-gray-300" />
              <div className="w-3 h-3 bg-gray-300 rounded-full" />
            </div>
            <div className="flex-1 space-y-4 pt-0.5">
              <div className="text-gray-700">Q1 Earnings</div>
              <div className="text-gray-500">Product Launch</div>
              <div className="text-gray-500">Investor Day</div>
            </div>
          </div>
        </div>
      )
    case 'metric':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex items-end gap-1.5 h-12">
            <div className="w-6 bg-primary-300 rounded-t" style={{ height: '40%' }} />
            <div className="w-6 bg-primary-400 rounded-t" style={{ height: '60%' }} />
            <div className="w-6 bg-primary-500 rounded-t" style={{ height: '80%' }} />
            <div className="w-6 bg-primary-600 rounded-t" style={{ height: '100%' }} />
            <div className="w-6 bg-primary-400 rounded-t" style={{ height: '70%' }} />
          </div>
          <div className="text-gray-500 mt-2">Monthly trend</div>
        </div>
      )
    case 'numeric':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="text-2xl font-bold text-gray-800">42.5</div>
          <div className="text-gray-500">Current value</div>
        </div>
      )
    case 'date':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-primary-500" />
            <div>
              <div className="text-gray-800 font-medium">January 15, 2025</div>
              <div className="text-gray-500">Target date</div>
            </div>
          </div>
        </div>
      )
    case 'rating':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-3 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">BUY</span>
            <div className="flex gap-1">
              {[1,2,3,4,5].map(i => (
                <Star key={i} className={clsx('w-5 h-5', i <= 4 ? 'text-amber-400 fill-amber-400' : 'text-gray-300')} />
              ))}
            </div>
          </div>
          <div className="text-gray-600">High conviction · 4/5 stars</div>
        </div>
      )
    case 'price_target':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-3 border border-gray-200 shadow-sm">
          <div className="flex justify-between items-center text-sm">
            <span className="text-red-600 font-semibold">Bear: $80</span>
            <span className="text-gray-700 font-semibold">Base: $120</span>
            <span className="text-green-600 font-semibold">Bull: $160</span>
          </div>
          <div className="h-3 bg-gradient-to-r from-red-300 via-gray-300 to-green-300 rounded-full relative">
            <div className="absolute left-1/2 -translate-x-1/2 -top-0.5 w-4 h-4 bg-primary-500 rounded-full border-2 border-white shadow" />
          </div>
          <div className="text-gray-500 text-center">Current: $115</div>
        </div>
      )
    case 'estimates':
      return (
        <div className="bg-white rounded-lg p-4 text-xs border border-gray-200 shadow-sm">
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-gray-500 mb-1">Revenue</div>
              <div className="text-lg font-semibold text-gray-800">$4.2B</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">EPS</div>
              <div className="text-lg font-semibold text-gray-800">$2.45</div>
            </div>
            <div>
              <div className="text-gray-500 mb-1">Growth</div>
              <div className="text-lg font-semibold text-green-600">+12%</div>
            </div>
          </div>
        </div>
      )
    case 'documents':
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-2 border border-gray-200 shadow-sm">
          <div className="flex items-center gap-3 p-2 bg-blue-50 rounded">
            <FileText className="w-4 h-4 text-blue-500" />
            <span className="text-gray-700">Q3 Earnings Report.pdf</span>
          </div>
          <div className="flex items-center gap-3 p-2 bg-green-50 rounded">
            <FileText className="w-4 h-4 text-green-500" />
            <span className="text-gray-700">Financial Model.xlsx</span>
          </div>
        </div>
      )
    default:
      // Fallback preview for any unhandled field type
      return (
        <div className="bg-white rounded-lg p-4 text-xs space-y-2 border border-gray-200 shadow-sm">
          <div className="h-2.5 bg-gray-400 rounded w-3/4" />
          <div className="h-2 bg-gray-300 rounded w-full" />
          <div className="h-2 bg-gray-300 rounded w-5/6" />
        </div>
      )
  }
}

// ============================================================================
// ADD FIELD MODAL
// ============================================================================

interface SystemField {
  id: string
  name: string
  slug: string
  type: string
  description?: string
}

interface CustomFieldWithAuthor {
  id: string
  name: string
  slug: string
  field_type: string
  description: string | null
  created_by: string | null
  author_name: string | null
}

interface PresetFieldData {
  name: string
  slug: string
  field_type: string
}

interface AddFieldModalProps {
  isOpen: boolean
  onClose: () => void
  onAddFromLibrary: (preset: PresetFieldData) => void
  onAddCustom: (name: string, fieldType: string) => void
  onAddSystemField: (field: SystemField) => void
  onAddExistingCustomField: (field: CustomFieldWithAuthor) => void
  existingFieldSlugs: string[]
  systemFields: SystemField[]
}

type SelectedField = {
  type: 'system' | 'preset' | 'custom'
  id: string
  name: string
  fieldType: string
  description?: string
  slug?: string
}

function AddFieldModal({ isOpen, onClose, onAddFromLibrary, onAddCustom, onAddSystemField, onAddExistingCustomField, existingFieldSlugs, systemFields }: AddFieldModalProps) {
  const { presets, presetsByCategory, isLoading } = useResearchFieldPresets()
  const [mode, setMode] = useState<'library' | 'custom'>('library')
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'system' | 'custom'>('all')
  const [customName, setCustomName] = useState('')
  const [customType, setCustomType] = useState('rich_text')
  const [error, setError] = useState('')
  const [selectedType, setSelectedType] = useState<string | null>(null)
  const [previewField, setPreviewField] = useState<{ name: string; type: string; description?: string } | null>(null)
  const [selectedFields, setSelectedFields] = useState<Map<string, SelectedField>>(new Map())

  const toggleFieldSelection = (field: SelectedField) => {
    setSelectedFields(prev => {
      const next = new Map(prev)
      if (next.has(field.id)) {
        next.delete(field.id)
        // Clear preview if deselecting the previewed field
        if (previewField?.name === field.name) {
          setPreviewField(null)
        }
      } else {
        next.set(field.id, field)
        // Show preview for newly selected field
        setPreviewField({ name: field.name, type: field.fieldType, description: field.description })
      }
      return next
    })
  }

  const handleAddSelected = (customFieldsList: CustomFieldWithAuthor[]) => {
    selectedFields.forEach(field => {
      if (field.type === 'system') {
        const systemField = systemFields.find(f => f.id === field.id)
        if (systemField) onAddSystemField(systemField)
      } else if (field.type === 'preset' && field.slug) {
        onAddFromLibrary({
          name: field.name,
          slug: field.slug,
          field_type: field.fieldType
        })
      } else if (field.type === 'custom') {
        const customField = customFieldsList.find(f => f.id === field.id)
        if (customField) onAddExistingCustomField(customField)
      }
    })
    setSelectedFields(new Map())
    onClose()
  }

  const clearSelection = () => {
    setSelectedFields(new Map())
    setPreviewField(null)
  }

  // Fetch custom fields created by users in the organization
  const { data: customFields = [], isLoading: customFieldsLoading } = useQuery({
    queryKey: ['custom-research-fields'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('research_fields')
        .select(`
          id,
          name,
          slug,
          field_type,
          description,
          created_by
        `)
        .eq('is_system', false)
        .eq('is_archived', false)
        .order('name')

      if (error) throw error

      // Fetch creator info separately from public.users (FK points to auth.users)
      const creatorIds = [...new Set((data || []).map(f => f.created_by).filter(Boolean))]
      let creatorsMap = new Map<string, { first_name?: string; last_name?: string }>()

      if (creatorIds.length > 0) {
        const { data: creators } = await supabase
          .from('users')
          .select('id, first_name, last_name')
          .in('id', creatorIds)

        for (const creator of creators || []) {
          creatorsMap.set(creator.id, creator)
        }
      }

      return (data || []).map(f => {
        const creator = f.created_by ? creatorsMap.get(f.created_by) : null
        return {
          id: f.id,
          name: f.name,
          slug: f.slug,
          field_type: f.field_type,
          description: f.description,
          created_by: f.created_by,
          author_name: creator
            ? `${creator.first_name || ''} ${creator.last_name || ''}`.trim() || 'Unknown'
            : null
        }
      }) as CustomFieldWithAuthor[]
    },
    enabled: isOpen
  })

  const fieldTypes = [
    { value: 'rich_text', label: 'Rich Text', description: 'Formatted text with headings, lists, and links' },
    { value: 'checklist', label: 'Checklist', description: 'Track items with checkboxes' },
    { value: 'timeline', label: 'Timeline', description: 'Events and milestones over time' },
    { value: 'metric', label: 'Metric', description: 'Track numerical KPIs with charts' },
    { value: 'numeric', label: 'Numeric', description: 'Single number value' },
    { value: 'date', label: 'Date', description: 'Date picker field' }
  ]

  const handleAddCustom = () => {
    const trimmedName = customName.trim()
    if (!trimmedName) {
      setError('Field name is required')
      return
    }
    onAddCustom(trimmedName, customType)
    setCustomName('')
    setError('')
    onClose()
  }

  if (!isOpen) return null

  // Filter out fields that are already added
  const availableSystemFields = systemFields.filter(f => !existingFieldSlugs.includes(f.slug))
  const availableCustomFields = customFields.filter(f => !existingFieldSlugs.includes(f.slug))

  // Filter based on selected filter
  const filteredSystemFields = libraryFilter === 'custom' ? [] : availableSystemFields
  const filteredCustomFields = libraryFilter === 'system' ? [] : availableCustomFields

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 p-6 max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Add Field</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setMode('library')}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors',
              mode === 'library'
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            <Library className="w-4 h-4 inline mr-1" />
            Field Library
          </button>
          <button
            onClick={() => setMode('custom')}
            className={clsx(
              'flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors',
              mode === 'custom'
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            )}
          >
            <Plus className="w-4 h-4 inline mr-1" />
            Create Custom
          </button>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto">
          {mode === 'library' ? (
            <div className="space-y-6">
              {/* Filter Toggle */}
              <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
                <span className="text-xs text-gray-500">Show:</span>
                <button
                  onClick={() => setLibraryFilter('all')}
                  className={clsx(
                    'px-2.5 py-1 text-xs font-medium rounded-full transition-colors',
                    libraryFilter === 'all'
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  All
                </button>
                <button
                  onClick={() => setLibraryFilter('system')}
                  className={clsx(
                    'px-2.5 py-1 text-xs font-medium rounded-full transition-colors',
                    libraryFilter === 'system'
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  Standard
                </button>
                <button
                  onClick={() => setLibraryFilter('custom')}
                  className={clsx(
                    'px-2.5 py-1 text-xs font-medium rounded-full transition-colors',
                    libraryFilter === 'custom'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  Custom
                </button>
              </div>

              {/* Field Library - merged system fields and presets by category */}
              {libraryFilter !== 'custom' && (
                isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
                  </div>
                ) : (() => {
                  // Map system fields to categories based on their name/type
                  const getSystemFieldCategory = (field: SystemField): string => {
                    const name = field.name.toLowerCase()
                    const type = field.type

                    // Analysis fields
                    if (name.includes('thesis') || name.includes('business model') ||
                        name.includes('differ') || name.includes('risks')) {
                      return 'analysis'
                    }
                    // Events/Catalysts
                    if (name.includes('catalyst') || name.includes('event')) {
                      return 'events'
                    }
                    // Data fields (ratings, targets, estimates)
                    if (type === 'rating' || type === 'price_target' || type === 'estimates' ||
                        name.includes('rating') || name.includes('target') || name.includes('estimate')) {
                      return 'data'
                    }
                    // Documents
                    if (type === 'documents' || name.includes('document')) {
                      return 'specialized'
                    }
                    // Default to analysis for rich text fields
                    return 'analysis'
                  }

                  // Build merged categories with both system fields and presets
                  const mergedCategories = new Map<string, { systemFields: SystemField[], presets: typeof presetsByCategory[string] }>()

                  // Add system fields to categories
                  filteredSystemFields.forEach(field => {
                    const category = getSystemFieldCategory(field)
                    if (!mergedCategories.has(category)) {
                      mergedCategories.set(category, { systemFields: [], presets: [] })
                    }
                    mergedCategories.get(category)!.systemFields.push(field)
                  })

                  // Add presets to categories
                  Object.entries(presetsByCategory).forEach(([category, categoryPresets]) => {
                    if (!mergedCategories.has(category)) {
                      mergedCategories.set(category, { systemFields: [], presets: [] })
                    }
                    mergedCategories.get(category)!.presets = categoryPresets
                  })

                  // Sort categories alphabetically
                  const sortedCategories = Array.from(mergedCategories.entries()).sort((a, b) =>
                    a[0].localeCompare(b[0])
                  )

                  if (sortedCategories.length === 0) return null

                  return sortedCategories.map(([category, { systemFields: catSystemFields, presets: catPresets }]) => (
                    <div key={category}>
                      <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                        {category}
                      </h4>
                      <div className="grid grid-cols-2 gap-2">
                        {/* System fields in this category */}
                        {catSystemFields.map(field => {
                          const isSelected = selectedFields.has(field.id)
                          return (
                            <div
                              key={field.id}
                              onClick={() => toggleFieldSelection({
                                type: 'system',
                                id: field.id,
                                name: field.name,
                                fieldType: field.type,
                                description: field.description
                              })}
                              className={clsx(
                                'flex items-start gap-3 p-3 rounded-lg border transition-all text-left cursor-pointer group',
                                isSelected
                                  ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-200'
                                  : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50/50'
                              )}
                            >
                              <div className={clsx(
                                'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                                isSelected
                                  ? 'border-primary-500 bg-primary-500'
                                  : 'border-gray-300 group-hover:border-primary-400'
                              )}>
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                              </div>
                              <div className={clsx(
                                'p-1.5 rounded-lg transition-colors',
                                isSelected ? 'bg-primary-200' : 'bg-primary-100 group-hover:bg-primary-200'
                              )}>
                                <FieldTypeIcon type={field.type} className="w-4 h-4 text-primary-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-900 block">{field.name}</span>
                                {field.description && (
                                  <span className="text-xs text-gray-500 line-clamp-1">{field.description}</span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                        {/* Presets in this category */}
                        {catPresets.map(preset => {
                          const isAdded = existingFieldSlugs.includes(preset.slug)
                          const isSelected = selectedFields.has(preset.slug)
                          return (
                            <div
                              key={preset.slug}
                              onClick={() => !isAdded && toggleFieldSelection({
                                type: 'preset',
                                id: preset.slug,
                                name: preset.name,
                                fieldType: preset.field_type,
                                description: preset.description || undefined,
                                slug: preset.slug
                              })}
                              className={clsx(
                                'flex items-start gap-3 p-3 rounded-lg border transition-all text-left group',
                                isAdded
                                  ? 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                                  : isSelected
                                    ? 'border-primary-400 bg-primary-50 ring-1 ring-primary-200 cursor-pointer'
                                    : 'border-gray-200 hover:border-primary-300 hover:bg-primary-50/50 cursor-pointer'
                              )}
                            >
                              {!isAdded && (
                                <div className={clsx(
                                  'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                                  isSelected
                                    ? 'border-primary-500 bg-primary-500'
                                    : 'border-gray-300 group-hover:border-primary-400'
                                )}>
                                  {isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                              )}
                              <div className={clsx(
                                'p-1.5 rounded-lg',
                                isAdded ? 'bg-gray-100' : isSelected ? 'bg-primary-100' : 'bg-gray-100 group-hover:bg-primary-100'
                              )}>
                                <FieldTypeIcon type={preset.field_type} className={clsx('w-4 h-4', isAdded ? 'text-gray-400' : 'text-gray-500')} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-gray-900 block">{preset.name}</span>
                                {preset.description && (
                                  <span className="text-xs text-gray-500 line-clamp-1">{preset.description}</span>
                                )}
                                {isAdded && (
                                  <span className="text-xs text-green-600 flex items-center gap-1 mt-1">
                                    <Check className="w-3 h-3" /> Added
                                  </span>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))
                })()
              )}

              {/* Custom Fields Section - show for 'all' or 'custom' filter */}
              {libraryFilter !== 'system' && (
                customFieldsLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  </div>
                ) : filteredCustomFields.length > 0 && (
                  <div>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-3">
                      Custom Fields
                    </h4>
                    <div className="grid grid-cols-2 gap-2">
                      {filteredCustomFields.map(field => {
                        const isSelected = selectedFields.has(field.id)
                        return (
                          <div
                            key={field.id}
                            onClick={() => toggleFieldSelection({
                              type: 'custom',
                              id: field.id,
                              name: field.name,
                              fieldType: field.field_type,
                              description: field.description || undefined
                            })}
                            className={clsx(
                              'flex items-start gap-3 p-3 rounded-lg border transition-all text-left cursor-pointer group',
                              isSelected
                                ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-200'
                                : 'border-blue-200 bg-blue-50/30 hover:border-blue-400 hover:bg-blue-50'
                            )}
                          >
                            <div className={clsx(
                              'w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors',
                              isSelected
                                ? 'border-blue-500 bg-blue-500'
                                : 'border-blue-300 group-hover:border-blue-400'
                            )}>
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <div className={clsx(
                              'p-1.5 rounded-lg transition-colors',
                              isSelected ? 'bg-blue-200' : 'bg-blue-100 group-hover:bg-blue-200'
                            )}>
                              <FieldTypeIcon type={field.field_type} className="w-4 h-4 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium text-gray-900 block">{field.name}</span>
                              {field.author_name && (
                                <span className="text-xs text-blue-600">by {field.author_name}</span>
                              )}
                              {field.description && (
                                <span className="text-xs text-gray-500 block line-clamp-1 mt-0.5">{field.description}</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              )}

              {/* Empty state for custom filter when no custom fields exist */}
              {libraryFilter === 'custom' && filteredCustomFields.length === 0 && !customFieldsLoading && (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-500 mb-3">No custom fields have been created yet.</p>
                  <p className="text-xs text-gray-400">
                    Switch to the "Create Custom" tab to add your own fields.
                  </p>
                </div>
              )}

              {/* Empty state for all/system when everything is added */}
              {libraryFilter === 'system' && filteredSystemFields.length === 0 && Object.keys(presetsByCategory).length === 0 && !isLoading && (
                <p className="text-sm text-gray-500 text-center py-8">All standard fields have been added</p>
              )}

              {libraryFilter === 'all' && filteredSystemFields.length === 0 && Object.keys(presetsByCategory).length === 0 && filteredCustomFields.length === 0 && !isLoading && !customFieldsLoading && (
                <p className="text-sm text-gray-500 text-center py-8">All fields have been added to this section</p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {/* Field Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Field Name</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => { setCustomName(e.target.value); setError('') }}
                  placeholder="e.g., Management Quality"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  autoFocus
                />
                {error && <p className="text-sm text-red-500 mt-1">{error}</p>}
              </div>

              {/* Field Type Selection with Previews */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Field Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {fieldTypes.map(ft => (
                    <button
                      key={ft.value}
                      onClick={() => { setCustomType(ft.value); setSelectedType(ft.value) }}
                      className={clsx(
                        'p-3 rounded-lg border-2 text-left transition-all',
                        customType === ft.value
                          ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      )}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <FieldTypeIcon type={ft.value} className={clsx(
                          'w-4 h-4',
                          customType === ft.value ? 'text-primary-600' : 'text-gray-400'
                        )} />
                        <span className={clsx(
                          'text-sm font-medium',
                          customType === ft.value ? 'text-primary-700' : 'text-gray-700'
                        )}>{ft.label}</span>
                      </div>
                      <FieldTypePreview type={ft.value} />
                      <p className="text-xs text-gray-500 mt-2">{ft.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Add Button */}
              <div className="flex justify-end pt-2">
                <Button onClick={handleAddCustom} disabled={!customName.trim()}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add Field
                </Button>
              </div>
            </div>
          )}
          </div>

          {/* Selection Bar - shown when fields are selected */}
          {mode === 'library' && selectedFields.size > 0 && (
            <div className="flex-shrink-0 mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-gray-700">
                    {selectedFields.size} field{selectedFields.size !== 1 ? 's' : ''} selected
                  </span>
                  <button
                    onClick={clearSelection}
                    className="text-sm text-gray-500 hover:text-gray-700 underline"
                  >
                    Clear
                  </button>
                </div>
                <Button onClick={() => handleAddSelected(customFields)}>
                  <Plus className="w-4 h-4 mr-1" />
                  Add {selectedFields.size} Field{selectedFields.size !== 1 ? 's' : ''}
                </Button>
              </div>

              {/* Preview of last selected field */}
              {previewField && (
                <div className="mt-4 bg-gray-50 rounded-xl p-5 border border-gray-200">
                  <div className="flex gap-8">
                    <div className="flex-1">
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Field Details</div>
                      <h4 className="text-base font-semibold text-gray-900 mb-2">{previewField.name}</h4>
                      {previewField.description && (
                        <p className="text-sm text-gray-600 leading-relaxed">{previewField.description}</p>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="text-xs text-gray-400 uppercase tracking-wider mb-2">Preview</div>
                      <FieldTypePreview type={previewField.type} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// NEW LAYOUT MODAL
// ============================================================================

interface NewLayoutModalProps {
  isOpen: boolean
  onClose: () => void
  onStartBlank: () => void
  onCopyFrom: (layout: SavedLayout) => void
  existingLayouts: SavedLayout[]
  systemDefaultLayout: SavedLayout
}

function NewLayoutModal({ isOpen, onClose, onStartBlank, onCopyFrom, existingLayouts, systemDefaultLayout }: NewLayoutModalProps) {
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null)

  if (!isOpen) return null

  const allLayouts = [systemDefaultLayout, ...existingLayouts]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Create New Layout</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Option 1: Start Blank */}
          <button
            onClick={onStartBlank}
            className="w-full p-4 border-2 border-dashed border-gray-300 rounded-lg hover:border-primary-400 hover:bg-primary-50/50 transition-colors text-left group"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gray-100 group-hover:bg-primary-100 flex items-center justify-center">
                <Plus className="w-5 h-5 text-gray-500 group-hover:text-primary-600" />
              </div>
              <div>
                <h4 className="font-medium text-gray-900">Start from scratch</h4>
                <p className="text-sm text-gray-500">Begin with a blank canvas and add sections and fields</p>
              </div>
            </div>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400 uppercase">or copy from</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {/* Option 2: Copy from existing */}
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {allLayouts.map(layout => {
              const isSelected = selectedLayoutId === layout.id
              const fieldCount = layout.field_config?.length || 0
              const visibleCount = layout.field_config?.filter(f => f.is_visible).length || 0

              return (
                <button
                  key={layout.id}
                  onClick={() => setSelectedLayoutId(layout.id)}
                  className={clsx(
                    'w-full p-3 border rounded-lg text-left transition-colors',
                    isSelected
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-200'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={clsx(
                        'w-8 h-8 rounded-lg flex items-center justify-center',
                        isSelected ? 'bg-primary-100' : 'bg-gray-100'
                      )}>
                        <Copy className={clsx('w-4 h-4', isSelected ? 'text-primary-600' : 'text-gray-500')} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">{layout.name}</span>
                          {layout.id === 'system-default' && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">System</span>
                          )}
                          {layout.is_default && layout.id !== 'system-default' && (
                            <Star className="w-3 h-3 text-amber-500 fill-current" />
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {visibleCount} of {fieldCount} fields visible
                        </p>
                      </div>
                    </div>
                    {isSelected && (
                      <Check className="w-5 h-5 text-primary-600" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => {
                const layout = allLayouts.find(l => l.id === selectedLayoutId)
                if (layout) onCopyFrom(layout)
              }}
              disabled={!selectedLayoutId}
            >
              <Copy className="w-4 h-4 mr-1" />
              Copy Layout
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// LAYOUT EDITOR (ENHANCED)
// ============================================================================

type InitialMode = 'blank' | 'copy' | 'edit'

interface LayoutEditorProps {
  layout: SavedLayout | null
  isEditingSystemDefault?: boolean
  initialMode?: InitialMode
  availableFields: FieldWithPreference[]
  fieldsBySection: { section_id: string; section_name: string; section_slug: string; section_display_order: number; fields: FieldWithPreference[] }[]
  onSave: (name: string, description: string, fieldConfig: FieldConfigItem[], sectionOrder: string[]) => Promise<void>
  onCancel: () => void
  isSaving: boolean
}

function LayoutEditor({
  layout,
  isEditingSystemDefault = false,
  initialMode = 'edit',
  availableFields,
  fieldsBySection,
  onSave,
  onCancel,
  isSaving
}: LayoutEditorProps) {
  const { user } = useAuth()
  const { createField } = useResearchFields()

  // Layout metadata
  const [name, setName] = useState(() => {
    if (layout) return layout.name
    if (isEditingSystemDefault) return 'My Default'
    return ''
  })
  const [description, setDescription] = useState(layout?.description || '')
  const [isDefault, setIsDefault] = useState(() => {
    if (layout) return layout.is_default
    if (isEditingSystemDefault) return true
    return false
  })

  // Section and field configuration
  const [sections, setSections] = useState<SectionConfig[]>(() => {
    // Blank mode: start with empty sections
    if (initialMode === 'blank') {
      return []
    }

    // If we have a saved layout with field_config, reconstruct from that
    if (layout?.field_config && layout.field_config.length > 0) {
      // Build a map of field details from availableFields
      const fieldDetailsMap = new Map(
        availableFields.map(f => [f.field_id, f])
      )

      // Also create a map by slug for matching preset fields with timestamps
      // e.g., "preset-competitive_landscape-1768168549905" should match field with slug "competitive_landscape"
      const fieldBySlugMap = new Map(
        availableFields.map(f => [f.field_slug, f])
      )

      // Helper to find a field by ID, with fallback to slug matching for preset IDs
      const findFieldDetails = (fieldId: string) => {
        // First try direct ID match
        const directMatch = fieldDetailsMap.get(fieldId)
        if (directMatch) return directMatch

        // If it's a preset ID with timestamp (e.g., "preset-some_slug-123456789")
        // try to match by extracting the slug
        if (fieldId.startsWith('preset-')) {
          const parts = fieldId.split('-')
          if (parts.length >= 3) {
            // Remove 'preset' prefix and timestamp suffix, join the middle parts
            const slug = parts.slice(1, -1).join('-')
            const slugMatch = fieldBySlugMap.get(slug)
            if (slugMatch) return slugMatch

            // Also try matching preset ID without timestamp
            const presetIdWithoutTimestamp = `preset-${slug}`
            const presetMatch = fieldDetailsMap.get(presetIdWithoutTimestamp)
            if (presetMatch) return presetMatch
          }
        }

        return undefined
      }

      // Build a map of section details from fieldsBySection
      const sectionDetailsMap = new Map(
        fieldsBySection.map(s => [s.section_id, { name: s.section_name, slug: s.section_slug }])
      )

      // Group saved fields by section_id
      const fieldsBySection_saved = new Map<string, typeof layout.field_config>()

      // Sort by display_order first to maintain order
      const sortedConfig = [...layout.field_config].sort((a, b) =>
        (a.display_order ?? 0) - (b.display_order ?? 0)
      )

      for (const fc of sortedConfig) {
        // Use section_id from config - fields are independent of sections
        const sectionId = (fc as any).section_id
        if (!sectionId) continue

        if (!fieldsBySection_saved.has(sectionId)) {
          fieldsBySection_saved.set(sectionId, [])
        }
        fieldsBySection_saved.get(sectionId)!.push(fc)
      }

      // Build sections array preserving order
      const sectionsArray: SectionConfig[] = []
      const seenSections = new Set<string>()

      for (const fc of sortedConfig) {
        const sectionId = (fc as any).section_id
        if (!sectionId || seenSections.has(sectionId)) continue
        seenSections.add(sectionId)

        const sectionDetails = sectionDetailsMap.get(sectionId)
        const fieldConfigs = fieldsBySection_saved.get(sectionId) || []

        sectionsArray.push({
          section_id: sectionId,
          section_name: sectionDetails?.name || 'Unknown Section',
          section_slug: sectionDetails?.slug || 'unknown',
          display_order: sectionsArray.length,
          is_system: true,
          fields: fieldConfigs.map((fc, idx) => {
            const fieldDetail = findFieldDetails(fc.field_id)
            return {
              field_id: fc.field_id,
              field_name: fieldDetail?.field_name || 'Unknown Field',
              field_slug: fieldDetail?.field_slug || 'unknown',
              field_type: fieldDetail?.field_type || 'rich_text',
              is_visible: fc.is_visible,
              display_order: idx,
              is_system: fieldDetail?.is_system ?? true
            }
          })
        })
      }

      return sectionsArray
    }

    // Default/copy mode: Initialize from fieldsBySection (all available fields)
    return fieldsBySection.map((s, idx) => ({
      section_id: s.section_id,
      section_name: s.section_name,
      section_slug: s.section_slug,
      display_order: s.section_display_order ?? idx,
      is_system: true,
      fields: s.fields.map((f, fidx) => ({
        field_id: f.field_id,
        field_name: f.field_name,
        field_slug: f.field_slug,
        field_type: f.field_type,
        is_visible: true,
        display_order: f.default_display_order ?? fidx,
        is_system: f.is_system
      }))
    })).sort((a, b) => a.display_order - b.display_order)
  })

  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(sections.map(s => s.section_id))
  )

  // Modals
  const [showAddSection, setShowAddSection] = useState(false)
  const [showAddField, setShowAddField] = useState<string | null>(null) // section_id or null

  // Toggle section expanded state
  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  // Toggle field visibility
  const toggleFieldVisibility = (sectionId: string, fieldId: string) => {
    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return {
        ...s,
        fields: s.fields.map(f => {
          if (f.field_id !== fieldId) return f
          return { ...f, is_visible: !f.is_visible }
        })
      }
    }))
  }

  // Add new custom section
  const handleAddCustomSection = async (sectionName: string) => {
    // Create section in database
    const slug = sectionName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

    // For now, add locally - we'll create it on save
    const newSection: SectionConfig = {
      section_id: `new-${Date.now()}`,
      section_name: sectionName,
      section_slug: slug,
      display_order: sections.length,
      is_system: false,
      fields: []
    }

    setSections(prev => [...prev, newSection])
    setExpandedSections(prev => new Set([...prev, newSection.section_id]))
  }

  // Add section from library (with its fields)
  const handleAddSectionFromLibrary = (section: SystemSection) => {
    const newSection: SectionConfig = {
      section_id: section.section_id,
      section_name: section.section_name,
      section_slug: section.section_slug,
      display_order: sections.length,
      is_system: true,
      fields: section.fields.map((f, idx) => ({
        field_id: f.field_id,
        field_name: f.field_name,
        field_slug: f.field_slug,
        field_type: f.field_type,
        is_visible: true,
        display_order: idx,
        is_system: f.is_system
      }))
    }

    setSections(prev => [...prev, newSection])
    setExpandedSections(prev => new Set([...prev, newSection.section_id]))
  }

  // Build available sections from fieldsBySection for the library
  const availableSectionsForLibrary: SystemSection[] = fieldsBySection.map(s => ({
    section_id: s.section_id,
    section_name: s.section_name,
    section_slug: s.section_slug,
    fields: s.fields.map(f => ({
      field_id: f.field_id,
      field_name: f.field_name,
      field_slug: f.field_slug,
      field_type: f.field_type,
      is_system: f.is_system
    }))
  }))

  // Build list of all system fields from fieldsBySection for the Add Field modal
  const allSystemFields: SystemField[] = fieldsBySection.flatMap(s =>
    s.fields
      .filter(f => f.is_system)
      .map(f => ({
        id: f.field_id,
        name: f.field_name,
        slug: f.field_slug,
        type: f.field_type,
        description: f.field_description || undefined
      }))
  )

  // Add system field to section (does not close modal - caller handles that)
  const handleAddSystemField = (field: SystemField) => {
    if (!showAddField) return
    const sectionId = showAddField
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return

    // Check if field is already in section
    if (section.fields.some(f => f.field_id === field.id)) return

    const newField: FieldConfig = {
      field_id: field.id,
      field_name: field.name,
      field_slug: field.slug,
      field_type: field.type,
      is_visible: true,
      display_order: section.fields.length,
      is_system: true
    }

    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return { ...s, fields: [...s.fields, newField] }
    }))
  }

  // Add existing custom field to section (does not close modal - caller handles that)
  const handleAddExistingCustomField = (field: CustomFieldWithAuthor) => {
    if (!showAddField) return
    const sectionId = showAddField
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return

    // Check if field is already in section
    if (section.fields.some(f => f.field_id === field.id)) return

    const newField: FieldConfig = {
      field_id: field.id,
      field_name: field.name,
      field_slug: field.slug,
      field_type: field.field_type,
      is_visible: true,
      display_order: section.fields.length,
      is_system: false // Custom field
    }

    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return { ...s, fields: [...s.fields, newField] }
    }))
  }

  // Add field to section from preset library (does not close modal - caller handles that)
  const handleAddFieldFromLibrary = (preset: PresetFieldData) => {
    if (!showAddField) return
    const sectionId = showAddField
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return

    // Check if field is already in section
    if (section.fields.some(f => f.field_slug === preset.slug)) return

    // Generate a unique ID for this preset field in the template
    const fieldId = `preset-${preset.slug}-${Date.now()}`

    const newField: FieldConfig = {
      field_id: fieldId,
      field_name: preset.name,
      field_slug: preset.slug,
      field_type: preset.field_type,
      is_visible: true,
      display_order: section.fields.length,
      is_system: true // Preset fields are standard system fields available to all users
    }

    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return { ...s, fields: [...s.fields, newField] }
    }))
  }

  const handleAddCustomField = async (fieldName: string, fieldType: string) => {
    if (!showAddField || !user?.id) return

    let sectionId = showAddField
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return

    try {
      // If this is a new section, create it in the database first
      if (sectionId.startsWith('new-')) {
        // Get user's organization
        const { data: orgMembership } = await supabase
          .from('organization_memberships')
          .select('organization_id')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .single()

        if (!orgMembership) {
          console.error('No organization found for user')
          return
        }

        // Create the section in the database
        const { data: newSection, error: sectionError } = await supabase
          .from('research_sections')
          .insert({
            organization_id: orgMembership.organization_id,
            name: section.section_name,
            slug: section.section_slug,
            display_order: section.display_order,
            is_system: false
          })
          .select()
          .single()

        if (sectionError) {
          console.error('Failed to create section:', sectionError)
          return
        }

        // Update local state to use the real section ID
        const oldSectionId = sectionId
        sectionId = newSection.id

        setSections(prev => prev.map(s => {
          if (s.section_id !== oldSectionId) return s
          return { ...s, section_id: newSection.id }
        }))

        // Update expanded sections set
        setExpandedSections(prev => {
          const next = new Set(prev)
          next.delete(oldSectionId)
          next.add(newSection.id)
          return next
        })
      }

      // Create field in database
      const slug = fieldName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

      const result = await createField.mutateAsync({
        name: fieldName,
        slug,
        section_id: sectionId,
        field_type: fieldType as any,
        is_universal: false
      })

      // Add to local state
      const newField: FieldConfig = {
        field_id: result.id,
        field_name: fieldName,
        field_slug: slug,
        field_type: fieldType,
        is_visible: true,
        display_order: section.fields.length,
        is_system: false
      }

      setSections(prev => prev.map(s => {
        if (s.section_id !== sectionId) return s
        return { ...s, fields: [...s.fields, newField] }
      }))
    } catch (error) {
      console.error('Failed to create field:', error)
    }

    setShowAddField(null)
  }

  // Remove section from layout (works for all sections)
  const removeSection = (sectionId: string) => {
    const section = sections.find(s => s.section_id === sectionId)
    if (!section) return
    if (!confirm(`Remove "${section.section_name}" from this layout?`)) return
    setSections(prev => prev.filter(s => s.section_id !== sectionId))
  }

  // Rename section
  const renameSection = (sectionId: string, newName: string) => {
    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      const newSlug = newName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      return {
        ...s,
        section_name: newName,
        section_slug: newSlug
      }
    }))
  }

  // Remove field from section
  const removeField = (sectionId: string, fieldId: string) => {
    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      return {
        ...s,
        fields: s.fields.filter(f => f.field_id !== fieldId)
      }
    }))
  }

  // Track active section being dragged
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

  // Drag-and-drop sensors - reduced distance for quicker response
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 3 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Handle section drag start
  const handleSectionDragStart = (event: DragStartEvent) => {
    setActiveSectionId(event.active.id as string)
  }

  // Handle section drag end
  const handleSectionDragEnd = (event: DragEndEvent) => {
    setActiveSectionId(null)
    const { active, over } = event
    if (over && active.id !== over.id) {
      setSections(prev => {
        const oldIndex = prev.findIndex(s => s.section_id === active.id)
        const newIndex = prev.findIndex(s => s.section_id === over.id)
        return arrayMove(prev, oldIndex, newIndex).map((s, i) => ({ ...s, display_order: i }))
      })
    }
  }

  // Get active section for drag overlay
  const activeSection = activeSectionId ? sections.find(s => s.section_id === activeSectionId) : null

  // Handle field drag end within a section
  const handleFieldDragEnd = (sectionId: string, activeId: string, overId: string) => {
    setSections(prev => prev.map(s => {
      if (s.section_id !== sectionId) return s
      const oldIndex = s.fields.findIndex(f => f.field_id === activeId)
      const newIndex = s.fields.findIndex(f => f.field_id === overId)
      return {
        ...s,
        fields: arrayMove(s.fields, oldIndex, newIndex).map((f, i) => ({ ...f, display_order: i }))
      }
    }))
  }

  // Save layout
  const handleSave = async () => {
    if (!name.trim()) return

    // Map to track temp section IDs -> real database IDs
    const sectionIdMap = new Map<string, string>()

    // First, create any new sections in the database
    for (const section of sections) {
      if (section.section_id.startsWith('new-')) {
        try {
          // Get user's organization
          const { data: userData } = await supabase.auth.getUser()
          if (!userData.user) continue

          const { data: orgMembership } = await supabase
            .from('organization_memberships')
            .select('organization_id')
            .eq('user_id', userData.user.id)
            .eq('status', 'active')
            .single()

          if (!orgMembership) continue

          // Create the section in the database
          const { data: newSection, error } = await supabase
            .from('research_sections')
            .insert({
              name: section.section_name,
              slug: section.section_slug,
              display_order: section.display_order,
              is_system: false,
              organization_id: orgMembership.organization_id
            })
            .select('id')
            .single()

          if (!error && newSection) {
            sectionIdMap.set(section.section_id, newSection.id)
          }
        } catch (err) {
          console.error('Error creating section:', err)
        }
      }
    }

    // Helper to normalize field IDs - strip timestamp from preset IDs
    const normalizeFieldId = (fieldId: string): string => {
      if (fieldId.startsWith('preset-')) {
        // "preset-competitive_landscape-1768168549905" -> "preset-competitive_landscape"
        const parts = fieldId.split('-')
        if (parts.length >= 3) {
          // Check if last part is a timestamp (all digits)
          const lastPart = parts[parts.length - 1]
          if (/^\d+$/.test(lastPart)) {
            return parts.slice(0, -1).join('-')
          }
        }
      }
      return fieldId
    }

    // Build field config with normalized IDs
    const fieldConfig: FieldConfigItem[] = sections.flatMap((s, sectionIndex) =>
      s.fields.map((f, fieldIndex) => ({
        field_id: normalizeFieldId(f.field_id),
        section_id: sectionIdMap.get(s.section_id) || s.section_id, // Use real ID if we created it
        is_visible: f.is_visible,
        display_order: sectionIndex * 1000 + fieldIndex, // Preserve section and field order
        is_collapsed: false
      }))
    )

    // Get section order with normalized IDs
    const sectionOrder = sections.map(s => sectionIdMap.get(s.section_id) || s.section_id)

    // Update local state with new section IDs
    if (sectionIdMap.size > 0) {
      setSections(prev => prev.map(s => {
        const newId = sectionIdMap.get(s.section_id)
        return newId ? { ...s, section_id: newId } : s
      }))
    }

    await onSave(name.trim(), description.trim(), fieldConfig, sectionOrder)
  }

  // Stats
  const totalFields = sections.reduce((sum, s) => sum + s.fields.length, 0)
  const visibleFields = sections.reduce((sum, s) => sum + s.fields.filter(f => f.is_visible).length, 0)

  // Track unsaved changes
  const [showDiscardModal, setShowDiscardModal] = useState(false)
  const [initialState] = useState(() => JSON.stringify({ name, description, isDefault, sections }))

  const hasUnsavedChanges = () => {
    const currentState = JSON.stringify({ name, description, isDefault, sections })
    return currentState !== initialState
  }

  const handleBackClick = () => {
    if (hasUnsavedChanges()) {
      setShowDiscardModal(true)
    } else {
      onCancel()
    }
  }

  return (
    <div className="space-y-6">
      {/* Discard Changes Modal */}
      {showDiscardModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-100 rounded-full">
                <Trash2 className="w-5 h-5 text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">Discard changes?</h3>
            </div>
            <p className="text-gray-600 mb-6">
              You have unsaved changes to this layout. Are you sure you want to discard them?
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDiscardModal(false)}>
                Keep Editing
              </Button>
              <Button
                onClick={() => {
                  setShowDiscardModal(false)
                  onCancel()
                }}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Discard Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBackClick}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">
            {layout ? 'Edit Layout' : 'Create New Layout'}
          </h2>
          <p className="text-sm text-gray-500">
            {visibleFields} of {totalFields} fields selected
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!name.trim() || isSaving}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin mr-1" />
          ) : (
            <Save className="w-4 h-4 mr-1" />
          )}
          Save Layout
        </Button>
      </div>

      {/* Layout Details */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        {/* Name and Default toggle row */}
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Layout name"
              className="w-full text-lg font-medium text-gray-900 bg-transparent border-0 border-b-2 border-gray-200 focus:border-primary-500 focus:ring-0 px-0 py-1 placeholder:text-gray-400"
            />
          </div>
          <button
            onClick={() => setIsDefault(!isDefault)}
            className={clsx(
              'flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all',
              isDefault
                ? 'bg-amber-100 text-amber-700 ring-1 ring-amber-300'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            )}
          >
            <Star className={clsx('w-4 h-4', isDefault && 'fill-current')} />
            {isDefault ? 'Default' : 'Set as default'}
          </button>
        </div>

        {/* Description */}
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add a description (optional)"
          className="w-full text-sm text-gray-600 bg-transparent border-0 focus:ring-0 px-0 py-0 placeholder:text-gray-400"
        />
      </div>

      {/* Sections and Fields */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-gray-700">Sections & Fields</h3>
          <Button variant="outline" size="sm" onClick={() => setShowAddSection(true)}>
            <FolderPlus className="w-4 h-4 mr-1" />
            Add Section
          </Button>
        </div>

        {/* Empty state for blank layouts */}
        {sections.length === 0 && (
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <FolderPlus className="w-10 h-10 text-gray-400 mx-auto mb-3" />
            <h4 className="font-medium text-gray-900 mb-1">No sections yet</h4>
            <p className="text-sm text-gray-500 mb-4">
              Add sections from the library or create custom ones to build your layout
            </p>
            <Button onClick={() => setShowAddSection(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add Your First Section
            </Button>
          </div>
        )}

        {/* Drag-and-drop sections */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleSectionDragStart}
          onDragEnd={handleSectionDragEnd}
          modifiers={[restrictToVerticalAxis]}
        >
          <SortableContext
            items={sections.map(s => s.section_id)}
            strategy={verticalListSortingStrategy}
          >
            {sections.map(section => (
              <SortableSection
                key={section.section_id}
                section={section}
                isExpanded={expandedSections.has(section.section_id)}
                onToggleExpand={() => toggleSection(section.section_id)}
                onToggleFieldVisibility={(fieldId) => toggleFieldVisibility(section.section_id, fieldId)}
                onRemoveField={(fieldId) => removeField(section.section_id, fieldId)}
                onRemoveSection={() => removeSection(section.section_id)}
                onRenameSection={(newName) => renameSection(section.section_id, newName)}
                onAddField={() => setShowAddField(section.section_id)}
                onFieldDragEnd={(activeId, overId) => handleFieldDragEnd(section.section_id, activeId, overId)}
              />
            ))}
          </SortableContext>
          <DragOverlay dropAnimation={null}>
            {activeSection ? <SectionDragOverlay section={activeSection} /> : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Add Section Modal */}
      <AddSectionModal
        isOpen={showAddSection}
        onClose={() => setShowAddSection(false)}
        onAddCustom={handleAddCustomSection}
        onAddFromLibrary={handleAddSectionFromLibrary}
        existingSectionIds={sections.map(s => s.section_id)}
        availableSections={availableSectionsForLibrary}
      />

      {/* Add Field Modal */}
      <AddFieldModal
        isOpen={!!showAddField}
        onClose={() => setShowAddField(null)}
        onAddFromLibrary={handleAddFieldFromLibrary}
        onAddCustom={handleAddCustomField}
        onAddSystemField={handleAddSystemField}
        onAddExistingCustomField={handleAddExistingCustomField}
        existingFieldSlugs={sections.flatMap(s => s.fields.map(f => f.field_slug))}
        systemFields={allSystemFields}
      />
    </div>
  )
}

// ============================================================================
// VIRTUAL DEFAULT LAYOUT
// ============================================================================

function createVirtualDefaultLayout(fields: FieldWithPreference[]): SavedLayout {
  // Only include system fields in the default layout
  const systemFields = fields.filter(f => f.is_system)

  return {
    id: 'system-default',
    user_id: '',
    name: 'Default',
    description: 'System default - shows all standard fields',
    is_default: true,
    field_config: systemFields.map((f, idx) => ({
      field_id: f.field_id,
      section_id: f.section_id,
      is_visible: true,
      display_order: idx,
      is_collapsed: false
    })),
    created_at: '',
    updated_at: ''
  }
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ResearchFieldsManager() {
  const {
    fieldsWithPreferences,
    fieldsBySection,
    isLoading: fieldsLoading
  } = useUserAssetPagePreferences()

  const {
    layouts,
    defaultLayout,
    saveLayout,
    updateLayout,
    deleteLayout,
    isLoading: layoutsLoading,
    isSaving
  } = useUserAssetPageLayouts()

  const [editingLayout, setEditingLayout] = useState<SavedLayout | null>(null)
  const [isEditingSystemDefault, setIsEditingSystemDefault] = useState(false)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [showNewLayoutModal, setShowNewLayoutModal] = useState(false)
  const [newLayoutMode, setNewLayoutMode] = useState<'blank' | 'copy' | 'edit'>('edit')
  const [showHelp, setShowHelp] = useState(false)
  const [layoutToDelete, setLayoutToDelete] = useState<SavedLayout | null>(null)

  // Check if user has their own default layout
  const userDefaultLayout = layouts?.find(l => l.is_default)

  // Create a virtual system default if user doesn't have their own default
  const systemDefaultLayout = createVirtualDefaultLayout(fieldsWithPreferences)

  const handleSaveLayout = async (
    name: string,
    description: string,
    fieldConfig: FieldConfigItem[],
    sectionOrder: string[]
  ) => {
    if (editingLayout && editingLayout.id !== 'system-default') {
      // Update existing user layout
      await updateLayout.mutateAsync({
        layoutId: editingLayout.id,
        name,
        description: description || undefined,
        fieldConfig,
        isDefault: editingLayout.is_default
      })
    } else {
      // Create new layout (either from system default edit or new)
      await saveLayout.mutateAsync({
        name,
        description: description || undefined,
        fieldConfig,
        isDefault: isEditingSystemDefault
      })
    }
    setEditingLayout(null)
    setIsEditingSystemDefault(false)
    setIsCreatingNew(false)
    setNewLayoutMode('edit')
  }

  // Handle starting a new blank layout
  const handleStartBlank = () => {
    setShowNewLayoutModal(false)
    setNewLayoutMode('blank')
    setEditingLayout(null)
    setIsCreatingNew(true)
  }

  // Handle copying from an existing layout
  const handleCopyFrom = (sourceLayout: SavedLayout) => {
    setShowNewLayoutModal(false)
    setNewLayoutMode('copy')
    // Create a copy with a new name
    const copiedLayout: SavedLayout = {
      ...sourceLayout,
      id: '', // New layout
      name: `${sourceLayout.name} (Copy)`,
      is_default: false
    }
    setEditingLayout(copiedLayout)
    setIsCreatingNew(true)
  }

  const handleDeleteLayout = (layout: SavedLayout) => {
    if (layout.id === 'system-default') return
    setLayoutToDelete(layout)
  }

  const confirmDeleteLayout = async () => {
    if (!layoutToDelete) return
    await deleteLayout.mutateAsync(layoutToDelete.id)
    setLayoutToDelete(null)
  }

  const handleDuplicateLayout = async (layout: SavedLayout) => {
    const fieldConfig = layout.id === 'system-default'
      ? fieldsWithPreferences.map((f, idx) => ({
          field_id: f.field_id,
          section_id: f.section_id,
          is_visible: true,
          display_order: idx,
          is_collapsed: false
        }))
      : layout.field_config

    await saveLayout.mutateAsync({
      name: `${layout.name} (Copy)`,
      description: layout.description || undefined,
      fieldConfig,
      isDefault: false
    })
  }

  const handleSetDefault = async (layoutId: string) => {
    if (layoutId === 'system-default') return
    await updateLayout.mutateAsync({
      layoutId,
      isDefault: true
    })
  }

  const handleEditLayout = (layout: SavedLayout) => {
    if (layout.id === 'system-default') {
      setIsEditingSystemDefault(true)
      setEditingLayout(layout)
    } else {
      setEditingLayout(layout)
    }
  }

  const isLoading = fieldsLoading || layoutsLoading

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </Card>
    )
  }

  // Show editor if editing or creating
  if (editingLayout || isCreatingNew) {
    return (
      <LayoutEditor
        layout={isEditingSystemDefault ? systemDefaultLayout : editingLayout}
        isEditingSystemDefault={isEditingSystemDefault}
        initialMode={newLayoutMode}
        availableFields={fieldsWithPreferences}
        fieldsBySection={fieldsBySection}
        onSave={handleSaveLayout}
        onCancel={() => {
          setEditingLayout(null)
          setIsEditingSystemDefault(false)
          setIsCreatingNew(false)
          setNewLayoutMode('edit')
        }}
        isSaving={isSaving}
      />
    )
  }

  // Build the layouts list
  const allLayouts = (layouts || []) as LayoutWithSharing[]

  // Separate own layouts from shared layouts
  const ownLayouts = allLayouts.filter(l => !l.is_shared_with_me)
  const sharedLayouts = allLayouts.filter(l => l.is_shared_with_me)

  // Get non-default own layouts
  const nonDefaultOwnLayouts = ownLayouts.filter(l => !l.is_default)

  // Determine what to show as "Default"
  const userDefaultFromOwn = ownLayouts.find(l => l.is_default)
  const effectiveDefaultLayout = userDefaultFromOwn || systemDefaultLayout
  const isUsingSystemDefault = !userDefaultFromOwn

  // Sort non-default layouts by name
  const sortedNonDefaultLayouts = [...nonDefaultOwnLayouts].sort((a, b) =>
    a.name.localeCompare(b.name)
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">My Research Layouts</h2>
          <button
            onClick={() => setShowHelp(!showHelp)}
            className={clsx(
              'p-1 rounded-full transition-colors',
              showHelp
                ? 'text-blue-600 bg-blue-100'
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
            )}
            title="How layouts work"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>
        <Button onClick={() => setShowNewLayoutModal(true)}>
          <Plus className="w-4 h-4 mr-1" />
          New Layout
        </Button>
      </div>

      {/* New Layout Modal */}
      <NewLayoutModal
        isOpen={showNewLayoutModal}
        onClose={() => setShowNewLayoutModal(false)}
        onStartBlank={handleStartBlank}
        onCopyFrom={handleCopyFrom}
        existingLayouts={ownLayouts}
        systemDefaultLayout={systemDefaultLayout}
      />

      {/* Help text */}
      {showHelp && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="text-sm font-medium text-blue-900 mb-1">How layouts work</h4>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• Your <strong>default layout</strong> is automatically applied to all research pages</li>
            <li>• Edit the default to customize which fields you see and their order</li>
            <li>• Use the arrows to reorder sections and fields</li>
            <li>• Add custom sections and fields to track additional information</li>
            <li>• Create multiple layouts for different analysis workflows</li>
          </ul>
        </div>
      )}

      {/* Default Layout */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">Default Layout</h3>
        <div className="max-w-md">
          <LayoutCard
            layout={effectiveDefaultLayout}
            isDefault={true}
            onEdit={() => handleEditLayout(effectiveDefaultLayout)}
            onDuplicate={() => handleDuplicateLayout(effectiveDefaultLayout)}
          />
          {isUsingSystemDefault && (
            <p className="text-xs text-gray-500 mt-2 ml-1">
              Using system default (all fields visible). Click to customize.
            </p>
          )}
        </div>
      </div>

      {/* Other Layouts */}
      {sortedNonDefaultLayouts.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3">My Other Layouts</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedNonDefaultLayouts.map(layout => (
              <LayoutCard
                key={layout.id}
                layout={layout}
                isDefault={false}
                onEdit={() => handleEditLayout(layout)}
                onDelete={() => handleDeleteLayout(layout)}
                onSetDefault={() => handleSetDefault(layout.id)}
                onDuplicate={() => handleDuplicateLayout(layout)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Shared Layouts */}
      {sharedLayouts.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700 mb-3 flex items-center gap-2">
            <Share2 className="w-4 h-4 text-blue-500" />
            Shared with Me
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sharedLayouts.map(layout => {
              const canEdit = layout.my_permission === 'edit' || layout.my_permission === 'admin'
              return (
                <LayoutCard
                  key={layout.id}
                  layout={layout}
                  isDefault={false}
                  onEdit={canEdit ? () => handleEditLayout(layout) : () => {}}
                  onDuplicate={() => handleDuplicateLayout(layout)}
                  canShare={false}
                />
              )
            })}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {layoutToDelete && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
            <div className="p-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <Trash2 className="w-6 h-6 text-red-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Delete Layout Template</h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Are you sure you want to delete <span className="font-medium text-gray-900">"{layoutToDelete.name}"</span>? This action cannot be undone.
                  </p>
                  {layoutToDelete.is_default && (
                    <p className="mt-2 text-sm text-amber-600 bg-amber-50 px-3 py-2 rounded-lg">
                      This is your default layout. Deleting it will revert to the system default.
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setLayoutToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={confirmDeleteLayout}
                className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700"
              >
                Delete Layout
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
