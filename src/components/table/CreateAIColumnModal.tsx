/**
 * CreateAIColumnModal - Modal for creating/editing AI columns
 */

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Sparkles, Info, Loader2, CheckCircle2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useAIColumns, AIColumnDefinition, CreateAIColumnParams, AIColumnContextConfig } from '../../hooks/useAIColumns'
import { Button } from '../ui/Button'

interface CreateAIColumnModalProps {
  isOpen: boolean
  onClose: () => void
  editColumn?: AIColumnDefinition // If provided, we're editing
  listId?: string | null
  onSuccess?: (column: AIColumnDefinition) => void
}

const PROMPT_HINTS = [
  'Summarize the investment thesis in 2-3 sentences.',
  'What are the key risks and mitigants?',
  'List the bull and bear case points.',
  'Identify upcoming catalysts that could move the stock.',
  'Where does this view differ from market consensus?',
]

const ICON_OPTIONS = [
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'file-text', label: 'Document' },
  { value: 'scale', label: 'Scale' },
  { value: 'git-branch', label: 'Branch' },
  { value: 'zap', label: 'Lightning' },
]

export function CreateAIColumnModal({
  isOpen,
  onClose,
  editColumn,
  listId,
  onSuccess,
}: CreateAIColumnModalProps) {
  const { createColumn, updateColumn, isCreating, isUpdating } = useAIColumns(listId)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [icon, setIcon] = useState('sparkles')
  const [contextConfig, setContextConfig] = useState<AIColumnContextConfig>({
    includeThesis: true,
    includeContributions: true,
    includeNotes: false,
    includePriceTargets: false,
  })
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Load edit values
  useEffect(() => {
    if (editColumn) {
      setName(editColumn.name)
      setDescription(editColumn.description || '')
      setPrompt(editColumn.prompt)
      setIcon(editColumn.icon)
      setContextConfig(editColumn.context_config)
    } else {
      // Reset form
      setName('')
      setDescription('')
      setPrompt('')
      setIcon('sparkles')
      setContextConfig({
        includeThesis: true,
        includeContributions: true,
        includeNotes: false,
        includePriceTargets: false,
      })
    }
    setError(null)
    setSuccess(false)
  }, [editColumn, isOpen])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!prompt.trim()) {
      setError('Prompt is required')
      return
    }

    try {
      if (editColumn) {
        updateColumn({
          id: editColumn.id,
          name: name.trim(),
          description: description.trim() || undefined,
          prompt: prompt.trim(),
          icon,
          contextConfig,
        })
        setSuccess(true)
        setTimeout(() => {
          onClose()
        }, 1000)
      } else {
        const newColumn = await createColumn({
          name: name.trim(),
          description: description.trim() || undefined,
          prompt: prompt.trim(),
          icon,
          contextConfig,
        })
        setSuccess(true)
        onSuccess?.(newColumn)
        setTimeout(() => {
          onClose()
        }, 1000)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save column')
    }
  }

  const handleUseHint = (hint: string) => {
    setPrompt(hint)
  }

  const toggleContextOption = (key: keyof AIColumnContextConfig) => {
    setContextConfig(prev => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  if (!isOpen) return null

  const isLoading = isCreating || isUpdating

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                {editColumn ? 'Edit AI Column' : 'Create AI Column'}
              </h2>
              <p className="text-sm text-gray-500">Define a custom AI-powered column</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
          {/* Name */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Column Name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Key Risks"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              disabled={isLoading}
            />
          </div>

          {/* Description */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Brief description of what this column shows"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
              disabled={isLoading}
            />
          </div>

          {/* Prompt */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              AI Prompt
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="What should the AI analyze? e.g., 'Summarize the key investment risks in 2-3 bullet points.'"
              rows={4}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 resize-none"
              disabled={isLoading}
            />

            {/* Prompt hints */}
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1.5">Try one of these:</p>
              <div className="flex flex-wrap gap-1.5">
                {PROMPT_HINTS.slice(0, 3).map((hint, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleUseHint(hint)}
                    className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-md transition-colors"
                    disabled={isLoading}
                  >
                    {hint.length > 40 ? hint.slice(0, 40) + '...' : hint}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Context Options */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Context to Include
            </label>
            <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
              <Info className="h-4 w-4 text-gray-400 flex-shrink-0" />
              <p className="text-xs text-gray-500">
                Select what data the AI should consider when generating content
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {[
                { key: 'includeThesis' as const, label: 'Thesis' },
                { key: 'includeContributions' as const, label: 'Contributions' },
                { key: 'includeNotes' as const, label: 'Notes' },
                { key: 'includePriceTargets' as const, label: 'Price Targets' },
              ].map(option => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggleContextOption(option.key)}
                  className={clsx(
                    'px-3 py-2 text-sm rounded-lg border transition-colors',
                    contextConfig[option.key]
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  )}
                  disabled={isLoading}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {/* Icon */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Icon
            </label>
            <div className="flex gap-2">
              {ICON_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setIcon(option.value)}
                  className={clsx(
                    'w-10 h-10 rounded-lg border flex items-center justify-center transition-colors',
                    icon === option.value
                      ? 'bg-purple-100 border-purple-300'
                      : 'bg-white border-gray-200 hover:bg-gray-50'
                  )}
                  title={option.label}
                  disabled={isLoading}
                >
                  <Sparkles className={clsx(
                    'h-4 w-4',
                    icon === option.value ? 'text-purple-600' : 'text-gray-400'
                  )} />
                </button>
              ))}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="mb-4 p-3 bg-green-50 border border-green-100 rounded-lg text-sm text-green-600 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              {editColumn ? 'Column updated successfully!' : 'Column created successfully!'}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-3">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isLoading || success}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {editColumn ? 'Saving...' : 'Creating...'}
                </>
              ) : (
                editColumn ? 'Save Changes' : 'Create Column'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}

export default CreateAIColumnModal
