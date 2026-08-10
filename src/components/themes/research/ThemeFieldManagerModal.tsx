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
    /* Full-screen on a phone, centred card above it. As a centred card the
       dialog was ~358px wide at 390px, and every form inside it laid two
       fixed-width inputs side by side, so the editor ran off its own edge.
       Full-bleed plus stacked fields is the only way these forms fit. */
    <div className="fixed inset-0 z-50 flex flex-col sm:overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative flex-1 min-h-0 flex flex-col sm:block sm:min-h-full sm:items-center sm:justify-center sm:p-4">
        <div className="relative flex flex-col min-h-0 flex-1 bg-white shadow-xl w-full sm:mx-auto sm:max-w-3xl sm:rounded-xl sm:flex-none dark:bg-gray-800">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 shrink-0 dark:border-gray-700 pt-safe">
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">Manage Research Fields</h2>
              <p className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">
                Sections and fields apply to all themes in your organization.
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 flex items-center justify-center h-9 w-9 -mr-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-300 dark:hover:bg-gray-700"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 p-4 sm:p-6 space-y-5 sm:space-y-6 overflow-y-auto overscroll-contain sm:max-h-[70vh]">
            {isLoading ? (
              <div className="h-40 bg-gray-100 rounded animate-pulse dark:bg-gray-800" />
            ) : (
              <>
                {layout.map(section => (
                  <div key={section.id} className="border border-gray-200 rounded-lg overflow-hidden dark:border-gray-700">
                    <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-200 flex items-center justify-between dark:border-gray-700 dark:bg-gray-900">
                      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{section.name}</h3>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {section.fields.length} field{section.fields.length === 1 ? '' : 's'}
                      </span>
                    </div>

                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {section.fields.map((f, i) => (
                        <div key={f.id} className="px-3 sm:px-4 py-2.5 flex items-start gap-2">
                          {/* Reorder */}
                          <div className="flex flex-col shrink-0">
                            <button
                              onClick={() => moveField(section.fields, i, -1)}
                              disabled={i === 0}
                              aria-label="Move up"
                              className="no-touch-target flex items-center justify-center h-6 w-7 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 dark:hover:text-gray-200 dark:hover:bg-gray-700"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => moveField(section.fields, i, 1)}
                              disabled={i === section.fields.length - 1}
                              aria-label="Move down"
                              className="no-touch-target flex items-center justify-center h-6 w-7 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30 dark:hover:text-gray-200 dark:hover:bg-gray-700"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Field body */}
                          {editingFieldId === f.id ? (
                            <div className="flex-1 min-w-0 space-y-2">
                              <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                placeholder="Field name"
                                className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded dark:border-gray-700 dark:bg-gray-900"
                                autoFocus
                              />
                              <input
                                value={editPlaceholder}
                                onChange={(e) => setEditPlaceholder(e.target.value)}
                                placeholder="Placeholder (shown in empty state)"
                                className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded dark:border-gray-700 dark:bg-gray-900"
                              />
                              <div className="flex items-center gap-2">
                                <Button size="sm" onClick={() => commitEditField(f)}>
                                  <Check className="w-3.5 h-3.5 mr-1" /> Save
                                </Button>
                                <Button size="sm" variant="outline" onClick={() => setEditingFieldId(null)}>
                                  Cancel
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium text-gray-900 truncate dark:text-white">{f.name}</span>
                                {f.is_system && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 shrink-0 dark:text-gray-400 dark:bg-gray-800">
                                    System
                                  </span>
                                )}
                              </div>
                              {/* Type and placeholder drop to their own line
                                  rather than competing with the name for a
                                  single 390px row. */}
                              <div className="flex items-center gap-2 min-w-0 mt-0.5">
                                <span className="text-xs text-gray-500 shrink-0 dark:text-gray-400">
                                  {FIELD_TYPES.find(t => t.value === f.field_type)?.label || f.field_type}
                                </span>
                                {f.placeholder && (
                                  <span className="text-xs text-gray-400 truncate italic">{f.placeholder}</span>
                                )}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          {editingFieldId !== f.id && (
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                onClick={() => startEditField(f)}
                                aria-label={`Edit ${f.name}`}
                                className="no-touch-target flex items-center justify-center h-8 w-8 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded dark:hover:text-gray-200 dark:hover:bg-gray-700"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => updateField({ id: f.id, is_archived: !f.is_archived })}
                                disabled={f.is_system}
                                aria-label={f.is_system ? 'System fields cannot be archived' : (f.is_archived ? 'Restore' : 'Archive')}
                                title={f.is_system ? 'System fields cannot be archived' : (f.is_archived ? 'Restore' : 'Archive')}
                                className="no-touch-target flex items-center justify-center h-8 w-8 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded disabled:opacity-30 disabled:cursor-not-allowed dark:hover:text-gray-200 dark:hover:bg-gray-700"
                              >
                                {f.is_archived ? <ArchiveRestore className="w-4 h-4" /> : <Archive className="w-4 h-4" />}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Add field row */}
                      {addingInSection === section.id ? (
                        <div className="px-3 sm:px-4 py-3 bg-primary-50/40 space-y-2 dark:bg-primary-900/10">
                          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                            <input
                              value={newFieldName}
                              onChange={(e) => setNewFieldName(e.target.value)}
                              placeholder="Field name"
                              className="text-sm px-2 py-1.5 border border-gray-200 rounded w-full sm:w-48 dark:border-gray-700 dark:bg-gray-900"
                              autoFocus
                            />
                            <select
                              value={newFieldType}
                              onChange={(e) => setNewFieldType(e.target.value as ThemeFieldType)}
                              className="text-sm px-2 py-1.5 border border-gray-200 rounded w-full sm:w-auto dark:border-gray-700 dark:bg-gray-900"
                            >
                              {FIELD_TYPES.map(t => (
                                <option key={t.value} value={t.value}>{t.label}</option>
                              ))}
                            </select>
                          </div>
                          <input
                            value={newFieldPlaceholder}
                            onChange={(e) => setNewFieldPlaceholder(e.target.value)}
                            placeholder="Placeholder prompt (optional)"
                            className="text-sm px-2 py-1.5 border border-gray-200 rounded w-full dark:border-gray-700 dark:bg-gray-900"
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
                  <div className="border border-primary-200 rounded-lg p-3 sm:p-4 bg-primary-50/40 flex flex-col sm:flex-row sm:items-center gap-2 dark:border-primary-800 dark:bg-primary-900/10">
                    <input
                      value={newSectionName}
                      onChange={(e) => setNewSectionName(e.target.value)}
                      placeholder="Section name"
                      className="text-sm px-2 py-1.5 border border-gray-200 rounded w-full sm:flex-1 dark:border-gray-700 dark:bg-gray-900"
                      autoFocus
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" onClick={handleCreateSection} disabled={!newSectionName.trim()}>
                        <Check className="w-3.5 h-3.5 mr-1" /> Add
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setShowNewSection(false); setNewSectionName('') }}>
                        Cancel
                      </Button>
                    </div>
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
          <div className="flex justify-end px-4 sm:px-6 py-3 border-t border-gray-200 shrink-0 pb-safe dark:border-gray-700">
            <Button variant="outline" onClick={onClose} className="max-sm:w-full">Done</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
