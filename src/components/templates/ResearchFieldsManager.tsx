import { useState } from 'react'
import { clsx } from 'clsx'
import {
  Plus,
  FileText,
  Hash,
  Calendar,
  Star,
  CheckSquare,
  Table,
  BarChart2,
  Target,
  TrendingUp,
  Clock,
  Gauge,
  FileStack,
  ChevronDown,
  ChevronRight,
  Globe,
  Users,
  Loader2,
  Edit2,
  Trash2,
  GripVertical,
  Check,
  X,
  Building2
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import {
  useResearchFields,
  useResearchSections,
  useResearchFieldPresets,
  useTeamResearchFields,
  useUserTeamsForResearch,
  type ResearchField,
  type ResearchFieldPreset,
  type FieldType,
  FIELD_TYPE_LABELS
} from '../../hooks/useResearchFields'
import { useAuth } from '../../hooks/useAuth'

// ============================================================================
// FIELD TYPE ICON
// ============================================================================

function FieldTypeIcon({ type, className }: { type: FieldType; className?: string }) {
  const icons: Record<FieldType, React.ReactNode> = {
    rich_text: <FileText className={className} />,
    numeric: <Hash className={className} />,
    date: <Calendar className={className} />,
    rating: <Star className={className} />,
    checklist: <CheckSquare className={className} />,
    excel_table: <Table className={className} />,
    chart: <BarChart2 className={className} />,
    documents: <FileStack className={className} />,
    price_target: <Target className={className} />,
    estimates: <TrendingUp className={className} />,
    timeline: <Clock className={className} />,
    metric: <Gauge className={className} />
  }
  return <>{icons[type] || <FileText className={className} />}</>
}

// ============================================================================
// PRESET CATEGORIES
// ============================================================================

const PRESET_CATEGORIES: Record<string, string> = {
  analysis: 'Analysis',
  valuation: 'Valuation',
  industry: 'Industry',
  events: 'Events & Catalysts',
  specialized: 'Specialized',
  data: 'Data & Tracking'
}

// ============================================================================
// FIELD ITEM COMPONENT
// ============================================================================

interface FieldItemProps {
  field: ResearchField
  onEdit?: () => void
  onRemove?: () => void
  showDrag?: boolean
  isSystem?: boolean
}

function FieldItem({ field, onEdit, onRemove, showDrag, isSystem }: FieldItemProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-white border border-gray-200 rounded-lg group hover:border-gray-300 transition-colors">
      {showDrag && (
        <GripVertical className="w-4 h-4 text-gray-300 cursor-grab flex-shrink-0" />
      )}
      <FieldTypeIcon type={field.field_type} className="w-4 h-4 text-gray-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium text-gray-900">{field.name}</span>
        {field.description && (
          <p className="text-xs text-gray-500 truncate">{field.description}</p>
        )}
      </div>
      <span className="text-xs text-gray-400 flex-shrink-0">
        {FIELD_TYPE_LABELS[field.field_type]}
      </span>
      {!isSystem && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {onEdit && (
            <button
              onClick={onEdit}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              title="Edit"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
          {onRemove && (
            <button
              onClick={onRemove}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="Remove"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      {isSystem && (
        <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
          Core
        </span>
      )}
    </div>
  )
}

// ============================================================================
// ADD FIELD MODAL
// ============================================================================

interface AddFieldModalProps {
  presets: ResearchFieldPreset[]
  existingSlugs: Set<string>
  sectionId: string
  onAdd: (preset: ResearchFieldPreset) => void
  onAddCustom: (name: string, description: string, fieldType: FieldType) => void
  onClose: () => void
  isAdding: boolean
}

function AddFieldModal({
  presets,
  existingSlugs,
  sectionId,
  onAdd,
  onAddCustom,
  onClose,
  isAdding
}: AddFieldModalProps) {
  const [mode, setMode] = useState<'preset' | 'custom'>('preset')
  const [customName, setCustomName] = useState('')
  const [customDescription, setCustomDescription] = useState('')
  const [customType, setCustomType] = useState<FieldType>('rich_text')

  // Filter presets by section
  const sectionPresets = presets.filter(p => {
    // Map section IDs to preset categories/types
    return !existingSlugs.has(p.slug)
  })

  // Group by category
  const byCategory = sectionPresets.reduce((acc, preset) => {
    const cat = preset.category || 'other'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(preset)
    return acc
  }, {} as Record<string, ResearchFieldPreset[]>)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Add Field</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-1 p-2 bg-gray-50 border-b border-gray-200">
          <button
            onClick={() => setMode('preset')}
            className={clsx(
              'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              mode === 'preset'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            From Library
          </button>
          <button
            onClick={() => setMode('custom')}
            className={clsx(
              'flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
              mode === 'custom'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            )}
          >
            Custom Field
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {mode === 'preset' ? (
            <div className="space-y-4">
              {Object.entries(byCategory).length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-8">
                  All available presets have been added
                </p>
              ) : (
                Object.entries(byCategory).map(([category, categoryPresets]) => (
                  <div key={category}>
                    <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
                      {PRESET_CATEGORIES[category] || category}
                    </h4>
                    <div className="space-y-1">
                      {categoryPresets.map(preset => (
                        <button
                          key={preset.slug}
                          onClick={() => onAdd(preset)}
                          disabled={isAdding}
                          className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                        >
                          <FieldTypeIcon type={preset.field_type} className="w-4 h-4 text-gray-400" />
                          <div className="flex-1 min-w-0">
                            <span className="text-sm font-medium text-gray-900">{preset.name}</span>
                            {preset.description && (
                              <p className="text-xs text-gray-500 truncate">{preset.description}</p>
                            )}
                          </div>
                          <Plus className="w-4 h-4 text-gray-400" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Field Name *
                </label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="e.g., Management Quality Score"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  placeholder="Optional description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Field Type
                </label>
                <select
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value as FieldType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                >
                  <option value="rich_text">Rich Text</option>
                  <option value="numeric">Numeric</option>
                  <option value="checklist">Checklist</option>
                  <option value="metric">Metric</option>
                  <option value="date">Date</option>
                  <option value="rating">Rating</option>
                  <option value="timeline">Timeline</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {mode === 'custom' && (
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-200">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => onAddCustom(customName, customDescription, customType)}
              disabled={!customName.trim() || isAdding}
            >
              {isAdding && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
              Add Field
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

// ============================================================================
// EDIT FIELD MODAL
// ============================================================================

interface EditFieldModalProps {
  field: ResearchField
  onSave: (name: string, description: string) => void
  onClose: () => void
  isSaving: boolean
}

function EditFieldModal({ field, onSave, onClose, isSaving }: EditFieldModalProps) {
  const [name, setName] = useState(field.name)
  const [description, setDescription] = useState(field.description || '')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-900">Edit Field</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div className="text-xs text-gray-500">
            Type: {FIELD_TYPE_LABELS[field.field_type]}
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSave(name, description)}
            disabled={!name.trim() || isSaving}
          >
            {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// SECTION BLOCK COMPONENT
// ============================================================================

interface SectionBlockProps {
  title: string
  subtitle?: string
  icon: React.ReactNode
  fields: ResearchField[]
  isExpanded: boolean
  onToggle: () => void
  onAddField?: () => void
  onEditField?: (field: ResearchField) => void
  onRemoveField?: (field: ResearchField) => void
  canEdit?: boolean
  emptyMessage?: string
}

function SectionBlock({
  title,
  subtitle,
  icon,
  fields,
  isExpanded,
  onToggle,
  onAddField,
  onEditField,
  onRemoveField,
  canEdit,
  emptyMessage = 'No fields configured'
}: SectionBlockProps) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
        <span className="text-gray-500">{icon}</span>
        <div className="flex-1 text-left">
          <span className="font-medium text-gray-900">{title}</span>
          {subtitle && (
            <span className="text-xs text-gray-500 ml-2">{subtitle}</span>
          )}
        </div>
        <span className="text-xs text-gray-400 bg-gray-200 px-2 py-0.5 rounded-full">
          {fields.length} field{fields.length !== 1 ? 's' : ''}
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="p-3 space-y-2 bg-white">
          {fields.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">{emptyMessage}</p>
          ) : (
            fields.map(field => (
              <FieldItem
                key={field.id}
                field={field}
                isSystem={field.is_system}
                onEdit={canEdit && !field.is_system ? () => onEditField?.(field) : undefined}
                onRemove={canEdit && !field.is_system ? () => onRemoveField?.(field) : undefined}
              />
            ))
          )}
          {canEdit && onAddField && (
            <button
              onClick={onAddField}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 border border-dashed border-gray-300 rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Field
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ResearchFieldsManager() {
  const { user } = useAuth()
  const { sections } = useResearchSections()
  const { fields, fieldsBySection, archiveField, updateField, createField } = useResearchFields()
  const { presets } = useResearchFieldPresets()
  const { adminTeams } = useUserTeamsForResearch()

  // UI State
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['universal', ...adminTeams.map(t => t.id)])
  )
  const [addingTo, setAddingTo] = useState<{ type: 'universal' | 'team'; teamId?: string; sectionId?: string } | null>(null)
  const [editingField, setEditingField] = useState<ResearchField | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // Check if user is firm admin (simplified check)
  const isFirmAdmin = user?.is_org_admin || false

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Get universal fields (is_universal = true)
  const universalFields = fields.filter(f => f.is_universal)

  // Handle adding from preset
  const handleAddPreset = async (preset: ResearchFieldPreset, isUniversal: boolean, teamId?: string) => {
    setIsAdding(true)
    try {
      await createField.mutateAsync({
        name: preset.name,
        slug: preset.slug,
        description: preset.description,
        field_type: preset.field_type,
        section_id: preset.default_section_id,
        is_universal: isUniversal,
        config: preset.default_config || {}
      })
      setAddingTo(null)
    } catch (err) {
      console.error('Failed to add field:', err)
    } finally {
      setIsAdding(false)
    }
  }

  // Handle adding custom field
  const handleAddCustom = async (name: string, description: string, fieldType: FieldType, isUniversal: boolean) => {
    setIsAdding(true)
    try {
      const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      const defaultSection = sections.find(s => s.slug === 'thesis')
      await createField.mutateAsync({
        name,
        slug,
        description: description || null,
        field_type: fieldType,
        section_id: defaultSection?.id || sections[0]?.id,
        is_universal: isUniversal,
        config: {}
      })
      setAddingTo(null)
    } catch (err) {
      console.error('Failed to create field:', err)
    } finally {
      setIsAdding(false)
    }
  }

  // Handle edit save
  const handleSaveEdit = async (name: string, description: string) => {
    if (!editingField) return
    setIsSaving(true)
    try {
      await updateField.mutateAsync({
        id: editingField.id,
        name,
        description: description || null
      })
      setEditingField(null)
    } catch (err) {
      console.error('Failed to update field:', err)
    } finally {
      setIsSaving(false)
    }
  }

  // Handle archive/remove
  const handleRemoveField = async (field: ResearchField) => {
    if (confirm(`Remove "${field.name}" from the research layout?`)) {
      try {
        await archiveField.mutateAsync(field.id)
      } catch (err) {
        console.error('Failed to remove field:', err)
      }
    }
  }

  const existingSlugs = new Set(fields.map(f => f.slug))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Research Layout</h2>
        <p className="text-sm text-gray-500">
          Configure the fields that appear in the Research section of each asset page.
        </p>
      </div>

      {/* Universal Fields Section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-5 h-5 text-blue-500" />
          <h3 className="font-medium text-gray-900">Universal Fields</h3>
          <span className="text-xs text-gray-500">Visible to everyone on every asset</span>
        </div>
        <SectionBlock
          title="Core Research Fields"
          subtitle="Firm-wide standard fields"
          icon={<Globe className="w-4 h-4" />}
          fields={universalFields}
          isExpanded={expandedSections.has('universal')}
          onToggle={() => toggleSection('universal')}
          onAddField={isFirmAdmin ? () => setAddingTo({ type: 'universal' }) : undefined}
          onEditField={isFirmAdmin ? setEditingField : undefined}
          onRemoveField={isFirmAdmin ? handleRemoveField : undefined}
          canEdit={isFirmAdmin}
          emptyMessage="No universal fields configured"
        />
        {!isFirmAdmin && (
          <p className="text-xs text-gray-400 mt-2 ml-1">
            Contact a firm admin to modify universal fields
          </p>
        )}
      </div>

      {/* Team Fields Sections */}
      {adminTeams.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-amber-500" />
            <h3 className="font-medium text-gray-900">Team Fields</h3>
            <span className="text-xs text-gray-500">Additional fields for your teams</span>
          </div>
          <div className="space-y-3">
            {adminTeams.map(team => {
              // Get contextual fields for this team (would need team_research_fields)
              const teamFields = fields.filter(f => !f.is_universal && !f.is_system)

              return (
                <SectionBlock
                  key={team.id}
                  title={team.name}
                  subtitle="Team-specific fields"
                  icon={<Building2 className="w-4 h-4" />}
                  fields={teamFields}
                  isExpanded={expandedSections.has(team.id)}
                  onToggle={() => toggleSection(team.id)}
                  onAddField={() => setAddingTo({ type: 'team', teamId: team.id })}
                  onEditField={setEditingField}
                  onRemoveField={handleRemoveField}
                  canEdit={true}
                  emptyMessage="No team-specific fields yet"
                />
              )
            })}
          </div>
        </div>
      )}

      {adminTeams.length === 0 && !isFirmAdmin && (
        <Card>
          <div className="text-center py-8">
            <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <h4 className="font-medium text-gray-900 mb-1">View Only</h4>
            <p className="text-sm text-gray-500">
              You can view the research layout but need admin access to make changes.
            </p>
          </div>
        </Card>
      )}

      {/* Add Field Modal */}
      {addingTo && (
        <AddFieldModal
          presets={presets}
          existingSlugs={existingSlugs}
          sectionId=""
          onAdd={(preset) => handleAddPreset(preset, addingTo.type === 'universal', addingTo.teamId)}
          onAddCustom={(name, desc, type) => handleAddCustom(name, desc, type, addingTo.type === 'universal')}
          onClose={() => setAddingTo(null)}
          isAdding={isAdding}
        />
      )}

      {/* Edit Field Modal */}
      {editingField && (
        <EditFieldModal
          field={editingField}
          onSave={handleSaveEdit}
          onClose={() => setEditingField(null)}
          isSaving={isSaving}
        />
      )}
    </div>
  )
}
