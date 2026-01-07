import React, { useState } from 'react'
import { clsx } from 'clsx'
import { Zap, Target, Plus, Edit2, Trash2, Copy, Check, X, Loader2, TrendingUp, TrendingDown, Minus, Share2, FileSpreadsheet } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { TemplateManager } from '../templates/TemplateManager'
import { ExcelModelTemplateManager } from '../templates/ExcelModelTemplateManager'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// ============================================================================
// TYPES
// ============================================================================

interface CaseTemplate {
  id: string
  name: string
  description: string | null
  bull_template: string | null
  base_template: string | null
  bear_template: string | null
  is_shared: boolean
  created_by: string
  created_at: string
  updated_at: string
  usage_count: number
  user?: {
    full_name: string
  }
}

// ============================================================================
// HOOKS
// ============================================================================

function useCaseTemplates() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['case-templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('case_templates')
        .select(`
          *,
          user:users!case_templates_created_by_fkey(full_name)
        `)
        .or(`created_by.eq.${user?.id},is_shared.eq.true`)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as CaseTemplate[]
    },
    enabled: !!user?.id
  })

  const myTemplates = templates.filter(t => t.created_by === user?.id)
  const sharedTemplates = templates.filter(t => t.created_by !== user?.id && t.is_shared)

  const createMutation = useMutation({
    mutationFn: async (template: Omit<CaseTemplate, 'id' | 'created_at' | 'updated_at' | 'usage_count' | 'user'>) => {
      const { data, error } = await supabase
        .from('case_templates')
        .insert(template)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-templates'] })
    }
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, ...updates }: Partial<CaseTemplate> & { id: string }) => {
      const { data, error } = await supabase
        .from('case_templates')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-templates'] })
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('case_templates')
        .delete()
        .eq('id', id)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['case-templates'] })
    }
  })

  return {
    templates,
    myTemplates,
    sharedTemplates,
    isLoading,
    createTemplate: createMutation.mutateAsync,
    updateTemplate: updateMutation.mutateAsync,
    deleteTemplate: deleteMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isUpdating: updateMutation.isPending,
    isDeleting: deleteMutation.isPending
  }
}

// ============================================================================
// CASE TEMPLATES MANAGER
// ============================================================================

function CaseTemplatesManager() {
  const { user } = useAuth()
  const {
    myTemplates,
    sharedTemplates,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    isCreating,
    isUpdating
  } = useCaseTemplates()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    bull_template: '',
    base_template: '',
    bear_template: '',
    is_shared: false
  })

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      bull_template: '',
      base_template: '',
      bear_template: '',
      is_shared: false
    })
    setShowForm(false)
    setEditingId(null)
    setError(null)
  }

  const startEdit = (template: CaseTemplate) => {
    setFormData({
      name: template.name,
      description: template.description || '',
      bull_template: template.bull_template || '',
      base_template: template.base_template || '',
      bear_template: template.bear_template || '',
      is_shared: template.is_shared
    })
    setEditingId(template.id)
    setShowForm(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!formData.name.trim()) {
      setError('Template name is required')
      return
    }

    try {
      if (editingId) {
        await updateTemplate({
          id: editingId,
          ...formData,
          description: formData.description || null,
          bull_template: formData.bull_template || null,
          base_template: formData.base_template || null,
          bear_template: formData.bear_template || null
        })
      } else {
        await createTemplate({
          ...formData,
          description: formData.description || null,
          bull_template: formData.bull_template || null,
          base_template: formData.base_template || null,
          bear_template: formData.bear_template || null,
          created_by: user!.id
        })
      }
      resetForm()
    } catch (err) {
      console.error('Error saving case template:', err)
      setError(err instanceof Error ? err.message : 'Failed to save template')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteTemplate(id)
      setDeleteConfirm(null)
    } catch (err) {
      console.error('Error deleting case template:', err)
    }
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
    <Card padding="sm">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Investment Case Templates</h3>
          <p className="text-sm text-gray-500 mt-1">
            Create templates for bull, base, and bear case reasoning to quickly populate price targets.
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="w-4 h-4 mr-1" />
            New Case Template
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
                  placeholder="e.g., Tech Growth Stock"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of when to use this template"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>
            </div>

            {/* Case Templates */}
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-green-700 mb-1 flex items-center gap-1">
                  <TrendingUp className="w-4 h-4" />
                  Bull Case Template
                </label>
                <textarea
                  value={formData.bull_template}
                  onChange={(e) => setFormData({ ...formData, bull_template: e.target.value })}
                  placeholder="Template for bull case reasoning..."
                  rows={4}
                  className="w-full px-3 py-2 border border-green-200 bg-green-50/50 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-amber-700 mb-1 flex items-center gap-1">
                  <Minus className="w-4 h-4" />
                  Base Case Template
                </label>
                <textarea
                  value={formData.base_template}
                  onChange={(e) => setFormData({ ...formData, base_template: e.target.value })}
                  placeholder="Template for base case reasoning..."
                  rows={4}
                  className="w-full px-3 py-2 border border-amber-200 bg-amber-50/50 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-red-700 mb-1 flex items-center gap-1">
                  <TrendingDown className="w-4 h-4" />
                  Bear Case Template
                </label>
                <textarea
                  value={formData.bear_template}
                  onChange={(e) => setFormData({ ...formData, bear_template: e.target.value })}
                  placeholder="Template for bear case reasoning..."
                  rows={4}
                  className="w-full px-3 py-2 border border-red-200 bg-red-50/50 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none text-sm"
                />
              </div>
            </div>

            <p className="text-xs text-gray-500">
              Tip: Use <code className="px-1 py-0.5 bg-gray-100 rounded">{'{{variableName}}'}</code> for variables like {'{{company}}'}, {'{{sector}}'}, {'{{catalyst}}'}
            </p>

            <div className="flex items-center">
              <input
                type="checkbox"
                id="case_is_shared"
                checked={formData.is_shared}
                onChange={(e) => setFormData({ ...formData, is_shared: e.target.checked })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="case_is_shared" className="ml-2 text-sm text-gray-700">
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
        <h4 className="text-sm font-medium text-gray-700">My Case Templates ({myTemplates.length})</h4>

        {myTemplates.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 text-center">
            No case templates yet. Create one to quickly populate bull/base/bear reasoning.
          </p>
        ) : (
          <div className="space-y-2">
            {myTemplates.map(template => (
              <CaseTemplateCard
                key={template.id}
                template={template}
                onEdit={() => startEdit(template)}
                onDelete={() => setDeleteConfirm(template.id)}
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
            Shared Case Templates ({sharedTemplates.length})
          </h4>
          <div className="space-y-2">
            {sharedTemplates.map(template => (
              <CaseTemplateCard
                key={template.id}
                template={template}
                isShared
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

// ============================================================================
// CASE TEMPLATE CARD
// ============================================================================

interface CaseTemplateCardProps {
  template: CaseTemplate
  onEdit?: () => void
  onDelete?: () => void
  isDeleting?: boolean
  onConfirmDelete?: () => void
  onCancelDelete?: () => void
  isShared?: boolean
}

function CaseTemplateCard({
  template,
  onEdit,
  onDelete,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  isShared
}: CaseTemplateCardProps) {
  const hasBull = !!template.bull_template
  const hasBase = !!template.base_template
  const hasBear = !!template.bear_template

  return (
    <div className={clsx(
      'p-3 border rounded-lg',
      isDeleting ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-gray-300'
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Target className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="font-medium text-gray-900 truncate">{template.name}</span>
            {template.is_shared && (
              <Share2 className="w-3 h-3 text-blue-500" title="Shared" />
            )}
          </div>
          {template.description && (
            <p className="text-sm text-gray-500 mt-1">{template.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2">
            {hasBull && (
              <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                Bull
              </span>
            )}
            {hasBase && (
              <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded flex items-center gap-1">
                <Minus className="w-3 h-3" />
                Base
              </span>
            )}
            {hasBear && (
              <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded flex items-center gap-1">
                <TrendingDown className="w-3 h-3" />
                Bear
              </span>
            )}
          </div>
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

// ============================================================================
// MAIN COMPONENT
// ============================================================================

type TabSection = 'text' | 'cases' | 'excel'

export function TemplatesTab() {
  const [activeSection, setActiveSection] = useState<TabSection>('text')

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-gray-200 bg-white">
        <h1 className="text-xl font-bold text-gray-900">Templates</h1>
        <p className="text-sm text-gray-500">
          Manage quick text snippets, investment cases, and Excel extraction templates
        </p>
      </div>

      {/* Tab Navigation */}
      <div className="flex-shrink-0 px-6 bg-white border-b border-gray-200">
        <nav className="flex space-x-4" aria-label="Tabs">
          <button
            onClick={() => setActiveSection('text')}
            className={clsx(
              'py-3 px-1 border-b-2 text-sm font-medium transition-colors flex items-center gap-2',
              activeSection === 'text'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            )}
          >
            <Zap className="w-4 h-4" />
            Quick Text
          </button>
          <button
            onClick={() => setActiveSection('cases')}
            className={clsx(
              'py-3 px-1 border-b-2 text-sm font-medium transition-colors flex items-center gap-2',
              activeSection === 'cases'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            )}
          >
            <Target className="w-4 h-4" />
            Investment Cases
          </button>
          <button
            onClick={() => setActiveSection('excel')}
            className={clsx(
              'py-3 px-1 border-b-2 text-sm font-medium transition-colors flex items-center gap-2',
              activeSection === 'excel'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            )}
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel Extraction
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 pt-2 pb-4 bg-gray-50">
        {activeSection === 'text' && <TemplateManager />}
        {activeSection === 'cases' && <CaseTemplatesManager />}
        {activeSection === 'excel' && <ExcelModelTemplateManager />}
      </div>
    </div>
  )
}
