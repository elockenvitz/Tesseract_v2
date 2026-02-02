/**
 * ContextTagsInput - Entity-based tag input for linking to platform objects
 *
 * Searches across assets, portfolios, themes, lists, and trade labs
 * to create rich context tags that reference actual platform entities.
 */

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X, Plus, TrendingUp, Briefcase, Palette, List, FlaskConical,
  Loader2
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'

// Entity types that can be tagged
export type ContextTagEntityType = 'asset' | 'portfolio' | 'theme' | 'asset_list' | 'trade_lab'

export interface ContextTag {
  entity_type: ContextTagEntityType
  entity_id: string
  display_name: string
}

interface ContextTagsInputProps {
  value: ContextTag[]
  onChange: (tags: ContextTag[]) => void
  placeholder?: string
  maxTags?: number
  className?: string
  compact?: boolean
}

// Entity type configuration
const entityConfig: Record<ContextTagEntityType, {
  label: string
  icon: typeof TrendingUp
  color: string
  bgColor: string
  borderColor: string
}> = {
  asset: {
    label: 'Assets',
    icon: TrendingUp,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
  },
  portfolio: {
    label: 'Portfolios',
    icon: Briefcase,
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
  },
  theme: {
    label: 'Themes',
    icon: Palette,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
  },
  asset_list: {
    label: 'Lists',
    icon: List,
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
  },
  trade_lab: {
    label: 'Trade Labs',
    icon: FlaskConical,
    color: 'text-rose-600',
    bgColor: 'bg-rose-50',
    borderColor: 'border-rose-200',
  },
}

interface SearchResult {
  entity_type: ContextTagEntityType
  entity_id: string
  display_name: string
  secondary?: string
}

export function ContextTagsInput({
  value,
  onChange,
  placeholder = 'Search...',
  maxTags = 10,
  className,
  compact = false,
}: ContextTagsInputProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Combined search across all entity types
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['context-tag-search', searchQuery],
    queryFn: async (): Promise<SearchResult[]> => {
      if (!searchQuery || searchQuery.length < 1) return []

      const results: SearchResult[] = []

      // Search assets
      const { data: assets } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${searchQuery}%,company_name.ilike.%${searchQuery}%`)
        .limit(5)

      assets?.forEach(a => {
        results.push({
          entity_type: 'asset',
          entity_id: a.id,
          display_name: a.symbol,
          secondary: a.company_name,
        })
      })

      // Search portfolios
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id, name')
        .ilike('name', `%${searchQuery}%`)
        .limit(5)

      portfolios?.forEach(p => {
        results.push({
          entity_type: 'portfolio',
          entity_id: p.id,
          display_name: p.name,
        })
      })

      // Search themes
      const { data: themes } = await supabase
        .from('themes')
        .select('id, name')
        .ilike('name', `%${searchQuery}%`)
        .limit(5)

      themes?.forEach(t => {
        results.push({
          entity_type: 'theme',
          entity_id: t.id,
          display_name: t.name,
        })
      })

      // Search asset lists
      const { data: lists } = await supabase
        .from('asset_lists')
        .select('id, name')
        .ilike('name', `%${searchQuery}%`)
        .limit(5)

      lists?.forEach(l => {
        results.push({
          entity_type: 'asset_list',
          entity_id: l.id,
          display_name: l.name,
        })
      })

      // Search trade labs
      const { data: tradeLabs } = await supabase
        .from('trade_labs')
        .select('id, name')
        .ilike('name', `%${searchQuery}%`)
        .limit(5)

      tradeLabs?.forEach(tl => {
        results.push({
          entity_type: 'trade_lab',
          entity_id: tl.id,
          display_name: tl.name,
        })
      })

      return results
    },
    enabled: searchQuery.length >= 1 && isDropdownOpen,
  })

  // Filter out already selected tags
  const filteredResults = searchResults?.filter(
    result => !value.some(
      tag => tag.entity_type === result.entity_type && tag.entity_id === result.entity_id
    )
  ) || []

  // Group results by entity type
  const groupedResults = filteredResults.reduce((acc, result) => {
    if (!acc[result.entity_type]) {
      acc[result.entity_type] = []
    }
    acc[result.entity_type].push(result)
    return acc
  }, {} as Record<ContextTagEntityType, SearchResult[]>)

  const addTag = (result: SearchResult) => {
    if (value.length >= maxTags) return

    const newTag: ContextTag = {
      entity_type: result.entity_type,
      entity_id: result.entity_id,
      display_name: result.display_name,
    }

    onChange([...value, newTag])
    setSearchQuery('')
    setIsDropdownOpen(false)
    inputRef.current?.focus()
  }

  const removeTag = (tagToRemove: ContextTag) => {
    onChange(value.filter(
      t => !(t.entity_type === tagToRemove.entity_type && t.entity_id === tagToRemove.entity_id)
    ))
  }

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsDropdownOpen(false)
      setSearchQuery('')
      if (value.length === 0) {
        setIsExpanded(false)
      }
    }
    if (e.key === 'Backspace' && !searchQuery && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  const handleBlur = () => {
    // Delay to allow click on dropdown
    setTimeout(() => {
      if (value.length === 0 && !searchQuery) {
        setIsExpanded(false)
      }
    }, 200)
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
        <span>Context tags (optional)</span>
      </button>
    )
  }

  return (
    <div className={clsx("relative", className)} ref={dropdownRef}>
      {/* Selected tags + input - no container */}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* Selected tags as pills */}
        {value.map((tag, idx) => {
          const config = entityConfig[tag.entity_type]
          const Icon = config.icon
          return (
            <span
              key={`${tag.entity_type}-${tag.entity_id}-${idx}`}
              className={clsx(
                "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border",
                config.bgColor,
                config.color,
                config.borderColor
              )}
            >
              <Icon className="h-3 w-3" />
              <span>{tag.display_name}</span>
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="hover:opacity-70 -mr-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )
        })}

        {/* Search input - inline with pills */}
        {value.length < maxTags && (
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setIsDropdownOpen(true)
            }}
            onFocus={() => setIsDropdownOpen(true)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder={value.length === 0 ? placeholder : 'Add...'}
            className={clsx(
              "flex-1 min-w-[80px] text-xs bg-transparent border-none outline-none",
              "placeholder:text-gray-400 text-gray-700",
              compact ? "py-0.5" : "py-1"
            )}
          />
        )}

        {/* Max tags indicator */}
        {value.length >= maxTags && (
          <span className="text-[10px] text-gray-400">
            Max {maxTags}
          </span>
        )}
      </div>

      {/* Search results dropdown */}
      {isDropdownOpen && searchQuery.length >= 1 && (
        <div className="absolute z-30 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-4 text-gray-400">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm">Searching...</span>
            </div>
          ) : filteredResults.length === 0 ? (
            <div className="p-3 text-sm text-gray-500 text-center">
              No matches found
            </div>
          ) : (
            Object.entries(groupedResults).map(([entityType, results]) => {
              const config = entityConfig[entityType as ContextTagEntityType]
              const Icon = config.icon
              return (
                <div key={entityType}>
                  {/* Group header */}
                  <div className={clsx(
                    "px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide border-b border-gray-100",
                    config.color,
                    config.bgColor
                  )}>
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3 w-3" />
                      <span>{config.label}</span>
                    </div>
                  </div>
                  {/* Results */}
                  {results.map((result) => (
                    <button
                      key={`${result.entity_type}-${result.entity_id}`}
                      type="button"
                      onClick={() => addTag(result)}
                      className="w-full text-left px-3 py-2 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <span className="font-medium text-gray-900 text-sm">
                        {result.display_name}
                      </span>
                      {result.secondary && (
                        <span className="text-xs text-gray-500 truncate">
                          {result.secondary}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
