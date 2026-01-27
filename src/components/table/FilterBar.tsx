/**
 * FilterBar - Unified filter dropdown bar for table
 *
 * Cleaner filter UI extracted from inline header filters.
 */

import React, { useState, useRef, useEffect } from 'react'
import { Filter, ChevronDown, X, Check, Search } from 'lucide-react'
import { clsx } from 'clsx'

interface FilterOption {
  value: string
  label: string
  color?: string
}

interface FilterDropdownProps {
  label: string
  options: FilterOption[]
  selected: string[]
  onChange: (values: string[]) => void
}

function FilterDropdown({ label, options, selected, onChange }: FilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  const filteredOptions = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options

  const toggleOption = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(v => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors',
          selected.length > 0
            ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
            : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
        )}
      >
        <Filter className="w-3 h-3" />
        <span>{label}</span>
        {selected.length > 0 && (
          <span className="px-1.5 py-0.5 text-[10px] bg-blue-600 text-white rounded-full">
            {selected.length}
          </span>
        )}
        <ChevronDown className={clsx('w-3 h-3 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          {/* Search */}
          {options.length > 6 && (
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Options */}
          <div className="p-1.5 max-h-64 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-gray-500 text-center">No options found</div>
            ) : (
              filteredOptions.map(option => (
                <button
                  key={option.value}
                  onClick={() => toggleOption(option.value)}
                  className={clsx(
                    'w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md transition-colors',
                    selected.includes(option.value)
                      ? 'bg-blue-50 text-blue-700'
                      : 'hover:bg-gray-50 text-gray-700'
                  )}
                >
                  <div className={clsx(
                    'w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors',
                    selected.includes(option.value)
                      ? 'bg-blue-600 border-blue-600'
                      : 'border-gray-300'
                  )}>
                    {selected.includes(option.value) && (
                      <Check className="w-2.5 h-2.5 text-white" />
                    )}
                  </div>
                  {option.color && (
                    <span className={clsx('px-1.5 py-0.5 text-xs font-medium rounded', option.color)}>
                      {option.label}
                    </span>
                  )}
                  {!option.color && (
                    <span className="truncate">{option.label}</span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Clear */}
          {selected.length > 0 && (
            <div className="p-2 border-t border-gray-100">
              <button
                onClick={() => { onChange([]); setIsOpen(false); }}
                className="w-full px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 rounded-md transition-colors"
              >
                Clear filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

interface FilterBarProps {
  priorities: { value: string; label: string; color: string }[]
  sectors: string[]
  stages: { key: string; label: string; color: string }[]
  selectedPriorities: string[]
  selectedSectors: string[]
  selectedStages: string[]
  onPrioritiesChange: (values: string[]) => void
  onSectorsChange: (values: string[]) => void
  onStagesChange: (values: string[]) => void
  onClearAll: () => void
}

export function FilterBar({
  priorities,
  sectors,
  stages,
  selectedPriorities,
  selectedSectors,
  selectedStages,
  onPrioritiesChange,
  onSectorsChange,
  onStagesChange,
  onClearAll,
}: FilterBarProps) {
  const hasFilters = selectedPriorities.length > 0 || selectedSectors.length > 0 || selectedStages.length > 0

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs font-medium text-gray-400 uppercase">Filters:</span>

      <FilterDropdown
        label="Priority"
        options={priorities.map(p => ({ value: p.value, label: p.label, color: p.color }))}
        selected={selectedPriorities}
        onChange={onPrioritiesChange}
      />

      {sectors.length > 0 && (
        <FilterDropdown
          label="Sector"
          options={sectors.map(s => ({ value: s, label: s }))}
          selected={selectedSectors}
          onChange={onSectorsChange}
        />
      )}

      {stages.length > 0 && (
        <FilterDropdown
          label="Stage"
          options={stages.map(s => ({ value: s.key, label: s.label, color: s.color }))}
          selected={selectedStages}
          onChange={onStagesChange}
        />
      )}

      {hasFilters && (
        <button
          onClick={onClearAll}
          className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
        >
          <X className="w-3 h-3" />
          Clear all
        </button>
      )}
    </div>
  )
}

export default FilterBar
