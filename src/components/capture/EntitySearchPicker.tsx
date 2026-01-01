import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  Search, TrendingUp, Briefcase, Building2, FileText, ListChecks,
  GitBranch, FolderKanban, Target, CheckSquare, X, RefreshCw, Clock,
  ChevronRight
} from 'lucide-react'
import { clsx } from 'clsx'
import { useEntitySearch } from '../../hooks/useEntitySearch'
import type { CaptureEntityType, CaptureMode, EntityDisplayInfo } from '../../types/capture'

// Entity type configuration
const ENTITY_TYPES: Array<{
  type: CaptureEntityType
  icon: React.ComponentType<{ className?: string }>
  label: string
  color: string
}> = [
  { type: 'asset', icon: TrendingUp, label: 'Assets', color: 'text-blue-600 bg-blue-50' },
  { type: 'portfolio', icon: Briefcase, label: 'Portfolios', color: 'text-emerald-600 bg-emerald-50' },
  { type: 'theme', icon: Building2, label: 'Themes', color: 'text-purple-600 bg-purple-50' },
  { type: 'note', icon: FileText, label: 'Notes', color: 'text-amber-600 bg-amber-50' },
  { type: 'list', icon: ListChecks, label: 'Lists', color: 'text-cyan-600 bg-cyan-50' },
  { type: 'workflow', icon: GitBranch, label: 'Workflows', color: 'text-indigo-600 bg-indigo-50' },
  { type: 'project', icon: FolderKanban, label: 'Projects', color: 'text-pink-600 bg-pink-50' },
  { type: 'price_target', icon: Target, label: 'Price Targets', color: 'text-red-600 bg-red-50' }
]

interface EntitySearchPickerProps {
  isOpen: boolean
  position: { x: number; y: number }
  onSelect: (entity: EntityDisplayInfo, mode: CaptureMode) => void
  onClose: () => void
  initialQuery?: string
}

export function EntitySearchPicker({
  isOpen,
  position,
  onSelect,
  onClose,
  initialQuery = ''
}: EntitySearchPickerProps) {
  const [query, setQuery] = useState(initialQuery)
  const [selectedType, setSelectedType] = useState<CaptureEntityType | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [pendingEntity, setPendingEntity] = useState<EntityDisplayInfo | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Use existing entity search hook
  const { results, isLoading } = useEntitySearch({
    query,
    types: selectedType ? [selectedType] : ['asset', 'portfolio', 'theme', 'note', 'list', 'workflow', 'project'],
    limit: 8,
    enabled: isOpen && query.length > 0
  })

  // Transform search results to EntityDisplayInfo
  const entities: EntityDisplayInfo[] = results.map(r => {
    const config = ENTITY_TYPES.find(t => t.type === r.type) || ENTITY_TYPES[0]
    return {
      type: r.type as CaptureEntityType,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle || null,
      icon: config.icon.name || 'FileText',
      color: config.color,
      href: null // Will be determined by entity type
    }
  })

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery(initialQuery)
      setSelectedIndex(0)
      setPendingEntity(null)
    }
  }, [isOpen, initialQuery])

  // Handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingEntity) {
          setPendingEntity(null)
        } else {
          onClose()
        }
        e.preventDefault()
      } else if (e.key === 'ArrowDown') {
        setSelectedIndex(i => Math.min(i + 1, entities.length - 1))
        e.preventDefault()
      } else if (e.key === 'ArrowUp') {
        setSelectedIndex(i => Math.max(i - 1, 0))
        e.preventDefault()
      } else if (e.key === 'Enter') {
        if (pendingEntity) {
          // Already selected entity, pick mode
          // Default to live mode on Enter
          onSelect(pendingEntity, 'live')
        } else if (entities[selectedIndex]) {
          // Select entity, show mode picker
          setPendingEntity(entities[selectedIndex])
        }
        e.preventDefault()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, entities, selectedIndex, pendingEntity, onSelect, onClose])

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  const handleEntityClick = (entity: EntityDisplayInfo) => {
    setPendingEntity(entity)
  }

  const handleModeSelect = (mode: CaptureMode) => {
    if (pendingEntity) {
      onSelect(pendingEntity, mode)
    }
  }

  if (!isOpen) return null

  return (
    <div
      ref={containerRef}
      className="fixed z-50 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
      style={{
        left: Math.min(position.x, window.innerWidth - 360),
        top: Math.min(position.y, window.innerHeight - 400),
        width: 340
      }}
    >
      {/* Mode Selection (when entity is pending) */}
      {pendingEntity ? (
        <div className="p-3">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => setPendingEntity(null)}
              className="p-1 hover:bg-gray-100 rounded-md text-gray-400"
            >
              <X className="h-4 w-4" />
            </button>
            <span className="text-sm font-medium text-gray-900">
              Capture "{pendingEntity.title}"
            </span>
          </div>

          <div className="space-y-2">
            <button
              onClick={() => handleModeSelect('live')}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-all group"
            >
              <div className="p-2 rounded-lg bg-green-100 text-green-600 group-hover:bg-green-200">
                <RefreshCw className="h-4 w-4" />
              </div>
              <div className="text-left flex-1">
                <div className="font-medium text-gray-900">Live</div>
                <div className="text-xs text-gray-500">Always shows current state</div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </button>

            <button
              onClick={() => handleModeSelect('static')}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 transition-all group"
            >
              <div className="p-2 rounded-lg bg-amber-100 text-amber-600 group-hover:bg-amber-200">
                <Clock className="h-4 w-4" />
              </div>
              <div className="text-left flex-1">
                <div className="font-medium text-gray-900">Snapshot</div>
                <div className="text-xs text-gray-500">Captures current state as citation</div>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* Search Header */}
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelectedIndex(0)
                }}
                placeholder="Search entities to capture..."
                className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500"
              />
            </div>

            {/* Type Filter Pills */}
            <div className="flex flex-wrap gap-1 mt-2">
              <button
                onClick={() => setSelectedType(null)}
                className={clsx(
                  'px-2 py-1 text-xs font-medium rounded-md transition-colors',
                  !selectedType
                    ? 'bg-primary-100 text-primary-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                All
              </button>
              {ENTITY_TYPES.slice(0, 5).map(t => (
                <button
                  key={t.type}
                  onClick={() => setSelectedType(selectedType === t.type ? null : t.type)}
                  className={clsx(
                    'px-2 py-1 text-xs font-medium rounded-md transition-colors',
                    selectedType === t.type
                      ? 'bg-primary-100 text-primary-700'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                Searching...
              </div>
            ) : query.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                Type to search for entities
              </div>
            ) : entities.length === 0 ? (
              <div className="p-4 text-center text-gray-500 text-sm">
                No results found
              </div>
            ) : (
              <div className="py-1">
                {entities.map((entity, index) => {
                  const config = ENTITY_TYPES.find(t => t.type === entity.type)
                  const Icon = config?.icon || FileText

                  return (
                    <button
                      key={`${entity.type}-${entity.id}`}
                      onClick={() => handleEntityClick(entity)}
                      className={clsx(
                        'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                        index === selectedIndex ? 'bg-primary-50' : 'hover:bg-gray-50'
                      )}
                    >
                      <div className={clsx('p-1.5 rounded-md', config?.color || 'bg-gray-100')}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-900 truncate">
                          {entity.title}
                        </div>
                        {entity.subtitle && (
                          <div className="text-xs text-gray-500 truncate">
                            {entity.subtitle}
                          </div>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-400 uppercase">
                        {entity.type.replace('_', ' ')}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-500">
            <kbd className="px-1 py-0.5 bg-white border rounded text-[10px]">↑↓</kbd> navigate
            <span className="mx-2">·</span>
            <kbd className="px-1 py-0.5 bg-white border rounded text-[10px]">Enter</kbd> select
            <span className="mx-2">·</span>
            <kbd className="px-1 py-0.5 bg-white border rounded text-[10px]">Esc</kbd> close
          </div>
        </>
      )}
    </div>
  )
}

export default EntitySearchPicker
