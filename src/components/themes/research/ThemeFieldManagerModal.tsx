import React, { useMemo, useState } from 'react'
import { X, Plus, ChevronUp, ChevronDown, Archive, ArchiveRestore, Check, Edit3, FolderPlus } from 'lucide-react'
import { Button } from '../../ui/Button'
import {
  useThemeResearchLayout,
  useThemeResearchFieldMutations,
  type ThemeFieldType,
  type ThemeResearchField,
  type ThemeResearchSection,
} from '../../../hooks/useThemeResearch'

interface ThemeFieldManagerModalProps {
  onClose: () => void
}

const FIELD_TYPES: { value: ThemeFieldType; label: string }[] = [
  { value: 'rich_text', label: 'Rich Text' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'timeline',  label: 'Timeline' },
  { value: 'metric',    label: 'Metric' },
  { value: 'numeric',   label: 'Numeric' },
  { value: 'date',      label: 'Date' },
  { value: 'rating',    label: 'Rating' },
]

function toSlug(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

export function ThemeFieldManagerModal({ onClose }: ThemeFieldManagerModalProps) {
  const { layout, isLoading } = useThemeResearchLayout()
  const { createField, updateField, reorderFields, createSection } = useThemeResearchFieldMutations()

  const [newSectionName, setNewSectionName] = useState('')
  const [showNewSection, setShowNewSection] = useState(false)

  const [addingInSection, setAddingInSection] = useState<string | null>(null)
  const [newFieldName, setNewFieldName] = useState('')
  const [newFieldType, setNewFieldType] = useState<ThemeFieldType>('rich_text')
  const [newFieldPlaceholder, setNewFieldPlaceholder] = useState('')

  const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editPlaceholder, setEditPlaceholder] = useState('')

  const handleCreateSection = async () => {
    const name = newSectionName.trim()
    if (!name) return
    await createSection({ name, slug: toSlug(name), display_order: (layout.at(-1)?.display_order ?? 0) + 1 })
    setNewSectionName('')
    setShowNewSection(false)
  }

  const handleAddField = async (section: ThemeResearchSection) => {
    const name = newFieldName.trim()
    if (!name) return
    const existingSlugs = new Set(
      layout.flatMap(s => s.fields.map(f => f.slug))
    )
    let slug = toSlug(name)
    let counter = 2
    while (existingSlugs.has(slug)) {
      slug = `${toSlug(name)}_${counter++}`
    }
    const maxOrder = Math.max(-1, ...layout.find(s => s.id === section.id)!.fields.map(f => f.display_order))
    await createField({
      sectionId: section.id,
      name,
      slug,
      field_type: newFieldType,
      placeholder: newFieldPlaceholder.trim() || undefined,
      display_order: maxOrder + 1,
    })
    setAddingInSection(null)
    setNewFieldName('')
    setNewFieldPlaceholder('')
    setNewFieldType('rich_text')
  }

  const startEditField = (f: ThemeResearchField) => {
    setEditingFieldId(f.id)
    setEditName(f.name)
    setEditPlaceholder(f.placeholder || '')
  }

  const commitEditField = async (f: ThemeResearchField) => {
    if (!editName.trim()) return
    await updateField({
      id: f.id,
      name: editName.trim(),
      placeholder: editPlaceholder,
    })
    setEditingFieldId(null)
  }

  const moveField = async (fields: ThemeResearchField[], index: number, dir: -1 | 1) => {
    const next = [...fields]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    const a = next[index], b = next[target]
    next[index] = b
    next[target] = a
    await reorderFields(next.map((f, i) => ({ id: f.id, display_order: i })))
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-3xl w-full">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Manage Theme Research Fields</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Sections and fields apply to all themes in your organization.
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
            {isLoading ? (
              <div className="h-40 bg-gray-100 rounded animate-pulse" />
            ) : (
              <>
                {layout.map(section => (
                  <div key={section.id} className="border border-gray-200 rounded-lg overflow-hidden">
                    <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-gray-900">{section.name}</h3>
                      <span className="text-xs text-gray-500">
                        {section.fields.length} field{section.fields.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="divide-y divide-gray-100">
                      {section.fields.map((f, i) => (
                        <div key={f.id} className="px-4 py-2.5 flex items-center gap-2">
                          {/* Reorder */}
                          <div className="flex flex-col gap-0.5">
                            <button
                              onClick={() => moveField(section.fields, i, -1)}
                              disabled={i === 0}
                              className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => moveField(section.fields, i, 1)}
                              disabled={i === section.fields.length - 1}
                              className="text-gray-400 hover:text-gray-700 disabled:opacity-30"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                          </div>

                          {/* Field body */}
                          {editingFieldId === f.id ? (
                            <div className="flex-1 flex items-center gap-2">
                              <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="Field name"
                                className="text-sm px-2 py-1 border border-gray-200 rounded w-48"
                                autoFocus
                              />
                              <input
                                value={editPlaceholder}
                                onChange={(e) => setEditPlaceholder(e.target.value)}
                                placeholder="Placeholder (shown in empty state)"
                                className="text-sm px-2 py-1 border border-gray-200 rounded flex-1"
                              />
                              <Button size="sm" onClick={() => commitEditField(f)}>
                                <Check className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => setEditingFieldId(null)}>
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex-1 flex items-center gap-2 min-w-0">
                              <span className="text-sm font-medium text-gray-900 truncate">{f.name}</span>
                              <span className="text-xs text-gray-500 shrink-0">{FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}</span>
                              {f.is_system && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0">
                                  System
                                </span>
                              )}
                              <span className="text-xs text-gray-400 truncate italic">{f.placeholder || ''}</span>
                            </div>
                          )}

                          {/* Actions */}
                          {editingFieldId !== f.id && (
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => startEditField(f)}
                                className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
                                title="Edit"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => updateField({ id: f.id, is_archived: !f.is_archived })}
                                disabled={f.is_system}
                                title={f.is_system ? 'System fields cannot be archived' : (f.is_archived ? 'Restore' : 'Archive')}
                                className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                {f.is_archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Add field row */}
                      {addingInSection === section.id ? (
                        <div className="px-4 py-3 bg-primary-50/40 space-y-2">
                          <div className="flex items-center gap-2">
                            <input
                              value={newFieldName}
                              onChange={(e) => setNewFieldName(e.target.value)}
                              placeholder="Field name"
                              className="text-sm px-2 py-1 border border-gray-200 rounded w-48"
                              autoFocus
                            />
                            <select
                              value={newFieldType}
                              onChange={(e) => setNewFieldType(e.target.value as ThemeFieldType)}
                              className="text-sm px-2 py-1 border border-gray-200 rounded"
                            >
                              {FIELD_TYPES.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          </div>
                          <input
                            value={newFieldPlaceholder}
                            onChange={(e) => setNewFieldPlaceholder(e.target.value)}
                            placeholder="Placeholder prompt (optional, shown in empty state)"
                            className="text-sm px-2 py-1 border border-gray-200 rounded w-full"
                          />
                          <div className="flex items-center gap-2">
                            <Button size="sm" onClick={() => handleAddField(section)} disabled={!newFieldName.trim()}>
                              <Plus className="w-3.5 h-3.5 mr-1" />
                              Add field
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setAddingInSection(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={() => setAddingInSection(section.id)}
                          className="w-full px-4 py-2 text-left text-xs font-medium text-primary-700 hover:bg-primary-50 flex items-center gap-1.5"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add field to {section.name}
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {/* New section */}
                {showNewSection ? (
                  <div className="border border-primary-200 rounded-lg p-4 bg-primary-50/40 flex items-center gap-2">
                    <input
                      value={newSectionName}
                      onChange={(e) => setNewSectionName(e.target.value)}
                      placeholder="Section name"
                      className="text-sm px-2 py-1 border border-gray-200 rounded flex-1"
                      autoFocus
                    />
                    <Button size="sm" onClick={handleCreateSection} disabled={!newSectionName.trim()}>
                      <Check className="w-3.5 h-3.5 mr-1" /> Add
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => { setShowNewSection(false); setNewSectionName('') }}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setShowNewSection(true)}>
                    <FolderPlus className="w-4 h-4 mr-1" />
                    Add section
                  </Button>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end px-6 py-3 border-t border-gray-200">
            <Button variant="outline" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
