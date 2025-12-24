/**
 * EditableCell - Enhanced inline cell editor with type-aware inputs
 *
 * Features:
 * - Multiple field types: text, number, select, date, currency
 * - Inline validation
 * - Keyboard shortcuts (Enter to confirm, Escape to cancel)
 * - Visual focus indicators
 * - Auto-size input to content
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import clsx from 'clsx'
import { Check, X, ChevronDown } from 'lucide-react'
import { useTableContext, CellPosition } from '../../contexts/TableContext'

export type CellType = 'text' | 'number' | 'currency' | 'percent' | 'select' | 'date' | 'priority' | 'stage'

export interface SelectOption {
  value: string
  label: string
  color?: string
  icon?: React.ReactNode
}

export interface EditableCellProps {
  value: string | number | null | undefined
  rowIndex: number
  columnId: string
  type?: CellType
  options?: SelectOption[]
  placeholder?: string
  min?: number
  max?: number
  step?: number
  pattern?: string
  required?: boolean
  disabled?: boolean
  className?: string
  onSave?: (value: string | number) => void | Promise<void>
  onCancel?: () => void
  renderDisplay?: (value: any) => React.ReactNode
  validate?: (value: string) => string | null // Returns error message or null if valid
}

export function EditableCell({
  value,
  rowIndex,
  columnId,
  type = 'text',
  options = [],
  placeholder = '',
  min,
  max,
  step,
  required = false,
  disabled = false,
  className = '',
  onSave,
  onCancel,
  renderDisplay,
  validate
}: EditableCellProps) {
  const { state, dispatch, focusCell } = useTableContext()
  const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null)
  const [localValue, setLocalValue] = useState<string>(String(value ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [selectOpen, setSelectOpen] = useState(false)

  // Check if this cell is focused or being edited
  const isFocused = state.focusedCell?.rowIndex === rowIndex &&
                    state.focusedCell?.columnId === columnId
  const isEditing = state.editingCell?.rowIndex === rowIndex &&
                    state.editingCell?.columnId === columnId

  // Sync local value with edit value when editing starts
  useEffect(() => {
    if (isEditing) {
      setLocalValue(state.editValue)
      setError(null)
      // Auto-focus and select the input
      setTimeout(() => {
        inputRef.current?.focus()
        if (inputRef.current instanceof HTMLInputElement) {
          inputRef.current.select()
        }
      }, 0)
    }
  }, [isEditing, state.editValue])

  // Update context with local value changes
  useEffect(() => {
    if (isEditing) {
      dispatch({ type: 'UPDATE_EDIT_VALUE', value: localValue })
    }
  }, [localValue, isEditing, dispatch])

  // Handle click on cell to focus
  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!disabled) {
      focusCell({ rowIndex, columnId })
    }
  }, [rowIndex, columnId, disabled, focusCell])

  // Handle double click to start editing
  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!disabled) {
      dispatch({
        type: 'START_EDITING',
        cell: { rowIndex, columnId },
        initialValue: String(value ?? '')
      })
    }
  }, [rowIndex, columnId, value, disabled, dispatch])

  // Handle value change
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const newValue = e.target.value
    setLocalValue(newValue)

    // Validate if validator provided
    if (validate) {
      const validationError = validate(newValue)
      setError(validationError)
    } else {
      setError(null)
    }
  }, [validate])

  // Save the value
  const handleSave = useCallback(async () => {
    // Validate
    if (required && !localValue.trim()) {
      setError('This field is required')
      return
    }

    if (validate) {
      const validationError = validate(localValue)
      if (validationError) {
        setError(validationError)
        return
      }
    }

    // Convert value based on type
    let finalValue: string | number = localValue

    if (type === 'number' || type === 'currency' || type === 'percent') {
      const numValue = parseFloat(localValue)
      if (isNaN(numValue)) {
        setError('Invalid number')
        return
      }
      if (min !== undefined && numValue < min) {
        setError(`Minimum value is ${min}`)
        return
      }
      if (max !== undefined && numValue > max) {
        setError(`Maximum value is ${max}`)
        return
      }
      finalValue = numValue
    }

    // Commit edit in context
    dispatch({ type: 'COMMIT_EDIT' })

    // Call onSave callback
    try {
      await onSave?.(finalValue)
    } catch (err) {
      setError('Failed to save')
    }
  }, [localValue, type, required, min, max, validate, onSave, dispatch])

  // Cancel editing
  const handleCancel = useCallback(() => {
    setLocalValue(String(value ?? ''))
    setError(null)
    dispatch({ type: 'CANCEL_EDITING' })
    onCancel?.()
  }, [value, onCancel, dispatch])

  // Handle keyboard shortcuts
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleCancel()
    }
  }, [handleSave, handleCancel])

  // Handle select option click
  const handleSelectOption = useCallback((optionValue: string) => {
    setLocalValue(optionValue)
    setSelectOpen(false)

    // Auto-save for select type
    setTimeout(() => {
      dispatch({ type: 'UPDATE_EDIT_VALUE', value: optionValue })
      handleSave()
    }, 0)
  }, [dispatch, handleSave])

  // Render display mode
  if (!isEditing) {
    const displayValue = renderDisplay
      ? renderDisplay(value)
      : formatDisplayValue(value, type, options)

    return (
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={clsx(
          'relative w-full h-full flex items-center rounded-md transition-all cursor-default',
          isFocused && 'ring-2 ring-blue-500 ring-offset-1',
          isHovered && !disabled && 'bg-gray-50 dark:bg-gray-800/50',
          disabled && 'cursor-not-allowed opacity-60',
          className
        )}
      >
        {displayValue || (
          <span className="text-gray-400 italic text-sm">{placeholder || '—'}</span>
        )}
      </div>
    )
  }

  // Render edit mode based on type
  if (type === 'select' || type === 'priority' || type === 'stage') {
    return (
      <div className="relative">
        <button
          onClick={() => setSelectOpen(!selectOpen)}
          className={clsx(
            'w-full flex items-center justify-between px-2 py-1 rounded-md border transition-all',
            error
              ? 'border-red-500 ring-2 ring-red-200'
              : 'border-blue-500 ring-2 ring-blue-200'
          )}
        >
          <span className="truncate">
            {options.find(o => o.value === localValue)?.label || localValue || placeholder}
          </span>
          <ChevronDown className={clsx('w-4 h-4 transition-transform', selectOpen && 'rotate-180')} />
        </button>

        {selectOpen && (
          <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-white dark:bg-dark-card border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-48 overflow-auto animate-in fade-in slide-in-from-top-2 duration-150">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => handleSelectOption(option.value)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors',
                  option.value === localValue
                    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                )}
              >
                {option.icon}
                {option.color && (
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: option.color }}
                  />
                )}
                <span>{option.label}</span>
                {option.value === localValue && <Check className="w-4 h-4 ml-auto" />}
              </button>
            ))}
          </div>
        )}

        {error && (
          <p className="absolute -bottom-5 left-0 text-xs text-red-500">{error}</p>
        )}
      </div>
    )
  }

  // Render input for other types
  return (
    <div className="relative flex items-center gap-1">
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={getInputType(type)}
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleSave}
        placeholder={placeholder}
        min={min}
        max={max}
        step={step}
        className={clsx(
          'w-full px-2 py-1 text-sm rounded-md border transition-all outline-none',
          error
            ? 'border-red-500 ring-2 ring-red-200 focus:ring-red-300'
            : 'border-blue-500 ring-2 ring-blue-200 focus:ring-blue-300',
          type === 'currency' && 'pl-5',
          type === 'percent' && 'pr-6'
        )}
      />

      {/* Currency symbol */}
      {type === 'currency' && (
        <span className="absolute left-2 text-gray-400 text-sm">$</span>
      )}

      {/* Percent symbol */}
      {type === 'percent' && (
        <span className="absolute right-6 text-gray-400 text-sm">%</span>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={handleSave}
          disabled={!!error}
          className={clsx(
            'p-1 rounded transition-colors',
            error
              ? 'text-gray-300 cursor-not-allowed'
              : 'text-green-600 hover:bg-green-50'
          )}
          title="Save (Enter)"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={handleCancel}
          className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          title="Cancel (Escape)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Error message */}
      {error && (
        <p className="absolute -bottom-5 left-0 text-xs text-red-500 whitespace-nowrap">{error}</p>
      )}
    </div>
  )
}

// Helper: Get HTML input type
function getInputType(type: CellType): string {
  switch (type) {
    case 'number':
    case 'currency':
    case 'percent':
      return 'number'
    case 'date':
      return 'date'
    default:
      return 'text'
  }
}

// Helper: Format display value
function formatDisplayValue(
  value: string | number | null | undefined,
  type: CellType,
  options: SelectOption[]
): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return null
  }

  switch (type) {
    case 'currency':
      return `$${Number(value).toFixed(2)}`

    case 'percent':
      return `${Number(value).toFixed(2)}%`

    case 'number':
      return String(value)

    case 'date':
      try {
        return new Date(value as string).toLocaleDateString()
      } catch {
        return String(value)
      }

    case 'select':
    case 'priority':
    case 'stage':
      const option = options.find(o => o.value === value)
      if (option) {
        return (
          <span className="flex items-center gap-1.5">
            {option.icon}
            {option.color && (
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: option.color }}
              />
            )}
            <span>{option.label}</span>
          </span>
        )
      }
      return String(value)

    default:
      return String(value)
  }
}

export default EditableCell
