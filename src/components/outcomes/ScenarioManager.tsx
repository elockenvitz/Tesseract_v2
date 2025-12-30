import React, { useState } from 'react'
import { clsx } from 'clsx'
import { Plus, X, Palette } from 'lucide-react'
import { SCENARIO_COLORS } from '../../hooks/useScenarios'

interface ScenarioManagerProps {
  onCreateScenario: (data: { name: string; description?: string; color?: string }) => Promise<void>
  existingNames?: string[]
  className?: string
}

const PRESET_COLORS = [
  '#22c55e', // green
  '#3b82f6', // blue
  '#ef4444', // red
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
]

export function ScenarioManager({
  onCreateScenario,
  existingNames = [],
  className
}: ScenarioManagerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(SCENARIO_COLORS.default)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Scenario name is required')
      return
    }

    if (existingNames.some(n => n.toLowerCase() === name.trim().toLowerCase())) {
      setError('A scenario with this name already exists')
      return
    }

    setIsSubmitting(true)
    try {
      await onCreateScenario({
        name: name.trim(),
        description: description.trim() || undefined,
        color
      })
      setName('')
      setDescription('')
      setColor(SCENARIO_COLORS.default)
      setIsOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create scenario')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={clsx(
          'flex items-center gap-2 px-3 py-2 text-sm',
          'text-gray-600 dark:text-gray-400',
          'hover:text-gray-800 dark:hover:text-gray-200',
          'border border-dashed border-gray-300 dark:border-gray-600',
          'hover:border-gray-400 dark:hover:border-gray-500',
          'rounded-lg transition-colors',
          className
        )}
      >
        <Plus className="w-4 h-4" />
        <span>Add Custom Scenario</span>
      </button>
    )
  }

  return (
    <div className={clsx(
      'rounded-lg border p-4',
      'bg-white dark:bg-gray-800',
      'border-gray-200 dark:border-gray-700',
      className
    )}>
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-sm font-medium text-gray-900 dark:text-white">
          New Custom Scenario
        </h4>
        <button
          onClick={() => {
            setIsOpen(false)
            setName('')
            setDescription('')
            setError(null)
          }}
          className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Scenario Name *
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            placeholder="e.g., Recession, AI Boom, M&A Target"
            autoFocus
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white resize-none"
            rows={2}
            placeholder="Describe what this scenario represents..."
          />
        </div>

        {/* Color picker */}
        <div>
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
            Color
          </label>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={clsx(
                  'w-6 h-6 rounded-full transition-transform',
                  color === c && 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-800 scale-110'
                )}
                style={{ backgroundColor: c }}
              />
            ))}
            <label className="relative cursor-pointer">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className={clsx(
                'w-6 h-6 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center',
                'hover:border-gray-400 dark:hover:border-gray-500'
              )}>
                <Palette className="w-3 h-3 text-gray-400" />
              </div>
            </label>
          </div>
        </div>

        {/* Error */}
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        {/* Submit */}
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setIsOpen(false)
              setName('')
              setDescription('')
              setError(null)
            }}
            className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || isSubmitting}
            className="px-3 py-1.5 text-xs bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Creating...' : 'Create Scenario'}
          </button>
        </div>
      </form>
    </div>
  )
}
