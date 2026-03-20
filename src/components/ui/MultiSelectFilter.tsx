/**
 * MultiSelectFilter — Searchable multi-select dropdown for filter bars.
 *
 * Compact trigger button showing selected count or "All".
 * Dropdown with search input + checkboxes.
 */

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, Check, X } from 'lucide-react'
import { clsx } from 'clsx'

export interface FilterOption {
  value: string
  label: string
}

interface MultiSelectFilterProps {
  label: string
  options: FilterOption[]
  selected: string[]
  onChange: (selected: string[]) => void
  className?: string
}

export function MultiSelectFilter({ label, options, selected, onChange, className }: MultiSelectFilterProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return
    const handle = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [isOpen])

  // Focus search on open
  useEffect(() => {
    if (isOpen) inputRef.current?.focus()
  }, [isOpen])

  const filtered = useMemo(() => {
    if (!search) return options
    const q = search.toLowerCase()
    return options.filter(o => o.label.toLowerCase().includes(q))
  }, [options, search])

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const isAll = selected.length === 0
  const triggerLabel = isAll
    ? label
    : selected.length === 1
      ? options.find(o => o.value === selected[0])?.label || label
      : `${label} (${selected.length})`

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex items-center gap-1 h-8 px-2.5 text-xs font-medium rounded-md border transition-colors',
          isAll
            ? 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'
            : 'border-primary-300 dark:border-primary-700 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-400'
        )}
      >
        <span className="truncate max-w-[120px]">{triggerLabel}</span>
        <ChevronDown className={clsx('h-3 w-3 shrink-0 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[200px] overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gray-100 dark:border-gray-700">
            <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              className="flex-1 text-xs bg-transparent text-gray-900 dark:text-white placeholder-gray-400 border-none focus:ring-0 focus:outline-none p-0"
            />
          </div>

          {/* Options */}
          <div className="max-h-48 overflow-y-auto py-1">
            {/* All option */}
            <button
              onClick={() => { onChange([]); }}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                isAll ? 'bg-gray-50 dark:bg-gray-700 font-medium' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
              )}
            >
              <div className={clsx(
                'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                isAll ? 'border-primary-500 bg-primary-500' : 'border-gray-300 dark:border-gray-600'
              )}>
                {isAll && <Check className="h-2.5 w-2.5 text-white" />}
              </div>
              <span className="text-gray-700 dark:text-gray-300">All</span>
            </button>

            {filtered.map(opt => {
              const isChecked = selected.includes(opt.value)
              return (
                <button
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
                    isChecked ? 'bg-gray-50 dark:bg-gray-700' : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                  )}
                >
                  <div className={clsx(
                    'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                    isChecked ? 'border-primary-500 bg-primary-500' : 'border-gray-300 dark:border-gray-600'
                  )}>
                    {isChecked && <Check className="h-2.5 w-2.5 text-white" />}
                  </div>
                  <span className="text-gray-700 dark:text-gray-300 truncate">{opt.label}</span>
                </button>
              )
            })}

            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-400">No matches</p>
            )}
          </div>

          {/* Clear */}
          {selected.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-700 px-3 py-1.5">
              <button
                onClick={() => { onChange([]); }}
                className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 font-medium"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
