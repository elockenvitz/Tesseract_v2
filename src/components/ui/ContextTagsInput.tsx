/**
 * ContextTagsInput - Entity-based tag input for linking to platform objects
 *
 * Searches across assets, portfolios, themes, lists, trade labs, and topics
 * to create rich context tags that reference actual platform entities.
 *
 * Supports inline creation of custom topics when no exact match exists.
 */

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Plus, TrendingUp, Briefcase, Palette, List, FlaskConical,
  Loader2, Lightbulb, Hash
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { useToast } from '../common/Toast'

// Entity types that can be tagged
export type ContextTagEntityType = 'asset' | 'portfolio' | 'theme' | 'asset_list' | 'trade_lab' | 'quick_thought' | 'topic'

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
  autoFocus?: boolean
  allowCreate?: boolean // Enable inline topic creation
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
  quick_thought: {
    label: 'Quick Thoughts',
    icon: Lightbulb,
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
  },
  topic: {
    label: 'Topics',
    icon: Hash,
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-200',
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
  placeholder = 'Search or create...',
  maxTags = 10,
  className,
  compact = false,
  autoFocus = false,
  allowCreate = true,
}: ContextTagsInputProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [isExpanded, setIsExpanded] = useState(autoFocus)
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { error: showError } = useToast()

  // Auto-focus on mount if autoFocus is true
  useEffect(() => {
    if (autoFocus) {
      setIsExpanded(true)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [autoFocus])

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

      // Search topics (custom user-created tags)
      // Wrapped in try-catch to handle case where topics table doesn't exist yet
      try {
        const { data: topics, error: topicsError } = await supabase
          .from('topics')
          .select('id, name')
          .ilike('name', `%${searchQuery}%`)
          .limit(5)

        if (!topicsError && topics) {
          topics.forEach(topic => {
            results.push({
              entity_type: 'topic',
              entity_id: topic.id,
              display_name: topic.name,
            })
          })
        }
      } catch (e) {
        // Topics table may not exist yet - continue without topics search
        console.warn('Topics search skipped:', e)
      }

      return results
    },
    enabled: searchQuery.length >= 1 && isDropdownOpen,
  })

  // Create topic mutation
  const createTopicMutation = useMutation({
    mutationFn: async (name: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('topics')
        .insert({
          name: name.trim(),
          created_by: user.id,
          visibility: 'private',
        })
        .select('id, name')
        .single()

      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      // Add the new topic as a tag
      const newTag: ContextTag = {
        entity_type: 'topic',
        entity_id: data.id,
        display_name: data.name,
      }
      onChange([...value, newTag])
      setSearchQuery('')
      setIsDropdownOpen(false)
      inputRef.current?.focus()

      // Invalidate search cache
      queryClient.invalidateQueries({ queryKey: ['context-tag-search'] })
    },
    onError: (error: Error) => {
      if (error.message.includes('duplicate') || error.message.includes('unique')) {
        showError("Topic already exists", "Try searching for it instead")
      } else {
        showError("Couldn't create topic", error.message)
      }
    },
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

  // Check if query exactly matches an existing topic (case-insensitive)
  const normalizedQuery = searchQuery.trim().toLowerCase()
  const exactTopicMatch = searchResults?.some(
    result => result.entity_type === 'topic' &&
              result.display_name.toLowerCase() === normalizedQuery
  )

  // Show create option if:
  // - allowCreate is true
  // - query has content
  // - no exact topic match exists
  // - not already creating
  const showCreateOption = allowCreate &&
                           searchQuery.trim().length >= 1 &&
                           !exactTopicMatch &&
                           !isCreating &&
                           value.length < maxTags

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

  const handleCreateTopic = async () => {
    if (!searchQuery.trim() || isCreating) return
    setIsCreating(true)
    try {
      await createTopicMutation.mutateAsync(searchQuery.trim())
    } finally {
      setIsCreating(false)
    }
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
    // Enter key creates topic if no results and create is allowed
    if (e.key === 'Enter' && showCreateOption && filteredResults.length === 0) {
      e.preventDefault()
      handleCreateTopic()
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
          if (!config) {
            // Fallback for unknown entity types
            return (
              <span
                key={`${tag.entity_type}-${tag.entity_id}-${idx}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border bg-gray-50 text-gray-600 border-gray-200"
              >
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
          }
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
          ) : (
            <>
              {/* Grouped results */}
              {Object.entries(groupedResults).map(([entityType, results]) => {
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
              })}

              {/* No results message (only if not showing create option) */}
              {filteredResults.length === 0 && !showCreateOption && (
                <div className="p-3 text-sm text-gray-500 text-center">
                  No matches found
                </div>
              )}

              {/* Create topic option - shown at BOTTOM */}
              {showCreateOption && (
                <button
                  type="button"
                  onClick={handleCreateTopic}
                  disabled={isCreating}
                  className={clsx(
                    "w-full text-left px-3 py-2.5 hover:bg-cyan-50 flex items-center gap-2 border-t border-gray-100",
                    isCreating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isCreating ? (
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-600" />
                  ) : (
                    <Plus className="h-4 w-4 text-cyan-600" />
                  )}
                  <span className="text-sm">
                    <span className="text-gray-600">Create topic </span>
                    <span className="font-medium text-cyan-700">"{searchQuery.trim()}"</span>
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
