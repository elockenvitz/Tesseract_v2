import { useState } from 'react'
import { Plus, Edit2, Trash2, Copy, Share2, FileText, X, Check, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useTemplates, Template, extractVariables } from '../../hooks/useTemplates'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'

interface TemplateFormData {
  name: string
  content: string
  category: string
  is_shared: boolean
}

const CATEGORIES = [
  { id: 'general', label: 'General' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'meeting', label: 'Meeting Notes' },
  { id: 'report', label: 'Reports' },
  { id: 'email', label: 'Email' },
]

export function TemplateManager() {
  const {
    templates,
    myTemplates,
    sharedTemplates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    isCreating,
    isUpdating,
    isDeleting
  } = useTemplates()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<TemplateFormData>({
    name: '',
    content: '',
    category: 'general',
    is_shared: false
  })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const resetForm = () => {
    setFormData({ name: '', content: '', category: 'general', is_shared: false })
    setShowForm(false)
    setEditingId(null)
  }

  const startEdit = (template: Template) => {
    setFormData({
      name: template.name,
      content: template.content,
      category: template.category,
      is_shared: template.is_shared
    })
    setEditingId(template.id)
    setShowForm(true)
  }

  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name.trim() || !formData.content.trim()) {
      setError('Name and content are required')
      return
    }

    try {
      const variables = extractVariables(formData.content)

      if (editingId) {
        await updateTemplate(editingId, { ...formData, variables })
      } else {
        await createTemplate({ ...formData, variables })
      }
      resetForm()
    } catch (err) {
      console.error('Error saving template:', err)
      const message = err instanceof Error ? err.message : 'Failed to save template'
      setError(message)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate(id)
      setDeleteConfirm(null)
    } catch (error) {
      console.error('Error deleting template:', error)
    }
  }

  const copyToClipboard = (content: string) => {
    navigator.clipboard.writeText(content)
  }

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      </Card>
    )
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Text Templates</h3>
          <p className="text-sm text-gray-500 mt-1">
            Create reusable text snippets. Use <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">.template</code> or <code className="px-1 py-0.5 bg-gray-100 rounded text-xs">.t</code> in any text input to insert them.
          </p>
        </div>
        {!showForm && (
          <Button
            onClick={() => setShowForm(true)}
            size="sm"
          >
            <Plus className="w-4 h-4 mr-1" />
            New Template
          </Button>
        )}
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Bull Case Summary"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Content
              </label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="Template content... Use {{variableName}} for variables"
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Tip: Use <code className="px-1 py-0.5 bg-gray-100 rounded">{'{{variableName}}'}</code> to create fill-in-the-blank variables
              </p>
            </div>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="is_shared"
                checked={formData.is_shared}
                onChange={(e) => setFormData({ ...formData, is_shared: e.target.checked })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="is_shared" className="ml-2 text-sm text-gray-700">
                Share with team members
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating || isUpdating}>
                {(isCreating || isUpdating) && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                {editingId ? 'Update' : 'Create'} Template
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* My Templates */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-gray-700">My Templates ({myTemplates.length})</h4>

        {myTemplates.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            No templates yet. Create one to get started!
          </p>
        ) : (
          <div className="space-y-2">
            {myTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onEdit={() => startEdit(template)}
                onDelete={() => setDeleteConfirm(template.id)}
                onCopy={() => copyToClipboard(template.content)}
                isDeleting={deleteConfirm === template.id}
                onConfirmDelete={() => handleDelete(template.id)}
                onCancelDelete={() => setDeleteConfirm(null)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Shared Templates */}
      {sharedTemplates.length > 0 && (
        <div className="mt-6 pt-6 border-t border-gray-200 space-y-3">
          <h4 className="text-sm font-medium text-gray-700">
            Shared Templates ({sharedTemplates.length})
          </h4>
          <div className="space-y-2">
            {sharedTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onCopy={() => copyToClipboard(template.content)}
                isShared
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

interface TemplateCardProps {
  template: Template
  onEdit?: () => void
  onDelete?: () => void
  onCopy: () => void
  isDeleting?: boolean
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
  isShared?: boolean
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onCopy,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  isShared
}: TemplateCardProps) {
  const variables = extractVariables(template.content)
  const categoryLabel = CATEGORIES.find(c => c.id === template.category)?.label || template.category

  return (
    <div className={clsx(
      'p-3 border rounded-lg',
      isDeleting ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-gray-300'
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="font-medium text-gray-900 truncate">{template.name}</span>
            <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
              {categoryLabel}
            </span>
            {template.is_shared && (
              <Share2 className="w-3 h-3 text-blue-500" title="Shared" />
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1 line-clamp-2">
            {template.content}
          </p>
          {variables.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {variables.map(v => (
                <span key={v.name} className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                  {`{{${v.name}}}`}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 ml-2">
          {isDeleting ? (
            <>
              <button
                onClick={onConfirmDelete}
                className="p-1.5 text-red-600 hover:bg-red-100 rounded"
                title="Confirm delete"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={onCancelDelete}
                className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onCopy}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                title="Copy content"
              >
                <Copy className="w-4 h-4" />
              </button>
              {!isShared && onEdit && (
                <button
                  onClick={onEdit}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                  title="Edit"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
              {!isShared && onDelete && (
                <button
                  onClick={onDelete}
                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {template.usage_count > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          Used {template.usage_count} time{template.usage_count !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}
