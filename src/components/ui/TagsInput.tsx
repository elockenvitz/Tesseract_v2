/**
 * TagsInput - Simple chip-style tag input component
 */

import { useState, useRef, KeyboardEvent } from 'react'
import { X, Plus } from 'lucide-react'
import { clsx } from 'clsx'

interface TagsInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
  maxTags?: number
  maxTagLength?: number
  className?: string
  compact?: boolean
}

export function TagsInput({
  value,
  onChange,
  placeholder = 'Add tag...',
  maxTags = 10,
  maxTagLength = 25,
  className,
  compact = false,
}: TagsInputProps) {
  const [inputValue, setInputValue] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase()
    if (
      trimmed &&
      trimmed.length <= maxTagLength &&
      value.length < maxTags &&
      !value.includes(trimmed)
    ) {
      onChange([...value, trimmed])
      setInputValue('')
    }
  }

  const removeTag = (tagToRemove: string) => {
    onChange(value.filter(t => t !== tagToRemove))
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(inputValue)
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1])
    } else if (e.key === 'Escape') {
      setIsExpanded(false)
      setInputValue('')
    }
  }

  const handleBlur = () => {
    if (inputValue) {
      addTag(inputValue)
    }
    // Keep expanded if there are tags
    if (value.length === 0) {
      setIsExpanded(false)
    }
  }

  // Collapsed state - just show button
  if (!isExpanded && value.length === 0) {
    return (
      <button
        type="button"
        onClick={() => {
          setIsExpanded(true)
          setTimeout(() => inputRef.current?.focus(), 0)
        }}
        className={clsx(
          "flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md px-2 py-1 transition-colors",
          className
        )}
      >
        <Plus className="h-3 w-3" />
        <span>Tags (optional)</span>
      </button>
    )
  }

  return (
    <div className={clsx("flex flex-wrap items-center gap-1.5", className)}>
      {/* Existing tags */}
      {value.map(tag => (
        <span
          key={tag}
          className={clsx(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
            "bg-gray-100 text-gray-700 border border-gray-200"
          )}
        >
          {tag}
          <button
            type="button"
            onClick={() => removeTag(tag)}
            className="hover:text-gray-900 -mr-0.5"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {/* Input for new tags */}
      {value.length < maxTags && (
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          placeholder={value.length === 0 ? placeholder : 'Add...'}
          className={clsx(
            "flex-1 min-w-[80px] text-xs bg-transparent border-none outline-none",
            "placeholder:text-gray-400 text-gray-700",
            compact ? "py-0.5" : "py-1"
          )}
          maxLength={maxTagLength}
        />
      )}

      {/* Max tags indicator */}
      {value.length >= maxTags && (
        <span className="text-[10px] text-gray-400">
          Max {maxTags} tags
        </span>
      )}
    </div>
  )
}
