import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Search, Star, Plus, LayoutGrid, List, ChevronDown, Check, X, Layers } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import type { ListSortKey } from '../../hooks/lists/useListSurfaces'

export type ListTypeFilter = 'all' | 'mine' | 'collaborative' | 'shared'
export type ViewMode = 'grid' | 'list'
export type ListGroupKey = 'none' | 'access' | 'portfolio' | 'owner' | 'updatedBy'

interface PortfolioOption {
  id: string
  name: string
  team_id: string | null
  teams: { id: string; name: string } | null
}

interface ListSurfaceControlsProps {
  search: string
  onSearchChange: (value: string) => void
  typeFilter: ListTypeFilter
  onTypeFilterChange: (value: ListTypeFilter) => void
  portfolioFilterIds: string[]
  onPortfolioFilterChange: (ids: string[]) => void
  portfolios: PortfolioOption[]
  favoritesOnly: boolean
  onFavoritesOnlyChange: (value: boolean) => void
  sortBy: ListSortKey
  onSortByChange: (value: ListSortKey) => void
  groupBy: ListGroupKey
  onGroupByChange: (value: ListGroupKey) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  onNewList: () => void
}

const TYPE_OPTIONS: { value: ListTypeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'collaborative', label: 'Collaborative' },
  { value: 'shared', label: 'Shared' }
]

const SORT_OPTIONS: { value: ListSortKey; label: string }[] = [
  { value: 'recent', label: 'Recently updated' },
  { value: 'alpha', label: 'Name (A\u2192Z)' },
  { value: 'assets', label: 'Most assets' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'owner', label: 'Owner' },
  { value: 'access', label: 'Access' }
]

const GROUP_OPTIONS: { value: ListGroupKey; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'access', label: 'Access type' },
  { value: 'portfolio', label: 'Portfolio' },
  { value: 'owner', label: 'Owner' },
  { value: 'updatedBy', label: 'Updated by' }
]

// ── Portfolio tree grouping ──────────────────────────────────────────────

interface PortfolioGroup {
  teamId: string | null
  teamName: string
  portfolios: PortfolioOption[]
}

function buildPortfolioTree(portfolios: PortfolioOption[]): PortfolioGroup[] {
  const groups = new Map<string | null, PortfolioGroup>()
  for (const p of portfolios) {
    const teamId = p.team_id ?? null
    const teamName = p.teams?.name ?? 'Portfolios'
    if (!groups.has(teamId)) {
      groups.set(teamId, { teamId, teamName, portfolios: [] })
    }
    groups.get(teamId)!.portfolios.push(p)
  }
  const sorted = Array.from(groups.values()).sort((a, b) => {
    if (a.teamId === null && b.teamId !== null) return 1
    if (a.teamId !== null && b.teamId === null) return -1
    return a.teamName.localeCompare(b.teamName)
  })
  for (const g of sorted) {
    g.portfolios.sort((a, b) => a.name.localeCompare(b.name))
  }
  return sorted
}

// ── GroupByDropdown ───────────────────────────────────────────────────────

function GroupByDropdown({ value, onChange }: {
  value: ListGroupKey
  onChange: (value: ListGroupKey) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const activeLabel = GROUP_OPTIONS.find(o => o.value === value)?.label ?? 'No grouping'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex items-center gap-1.5 text-xs font-medium rounded-md pl-2 pr-1.5 py-1 transition-colors cursor-pointer border',
          value !== 'none'
            ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800/40 text-primary-700 dark:text-primary-300'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600',
          open && 'ring-1 ring-primary-400/40 border-primary-400'
        )}
      >
        <Layers className="h-3 w-3 shrink-0" />
        <span className="truncate">{activeLabel}</span>
        <ChevronDown className={clsx(
          'w-3 h-3 shrink-0 text-gray-400 transition-transform',
          open && 'rotate-180'
        )} />
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 w-44 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1">
          {GROUP_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              className={clsx(
                'w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                value === opt.value
                  ? 'text-primary-700 dark:text-primary-300 bg-primary-50/60 dark:bg-primary-900/20'
                  : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/40'
              )}
            >
              <div className={clsx(
                'w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0',
                value === opt.value
                  ? 'bg-primary-500 border-primary-500 text-white'
                  : 'border-gray-300 dark:border-gray-600'
              )}>
                {value === opt.value && <Check className="w-2 h-2" />}
              </div>
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── PortfolioTreeSelect ──────────────────────────────────────────────────

function PortfolioTreeSelect({ portfolios, selectedIds, onChange }: {
  portfolios: PortfolioOption[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const tree = useMemo(() => buildPortfolioTree(portfolios), [portfolios])
  const hasMultipleGroups = tree.length > 1 || (tree.length === 1 && tree[0].teamId !== null)

  const togglePortfolio = useCallback((id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter(x => x !== id))
    } else {
      onChange([...selectedIds, id])
    }
  }, [selectedIds, selectedSet, onChange])

  const toggleGroup = useCallback((group: PortfolioGroup) => {
    const groupIds = group.portfolios.map(p => p.id)
    const allSelected = groupIds.every(id => selectedSet.has(id))
    if (allSelected) {
      onChange(selectedIds.filter(id => !groupIds.includes(id)))
    } else {
      const newIds = new Set([...selectedIds, ...groupIds])
      onChange(Array.from(newIds))
    }
  }, [selectedIds, selectedSet, onChange])

  const clearAll = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }, [onChange])

  let displayLabel: string
  if (selectedIds.length === 0) {
    displayLabel = 'All portfolios'
  } else if (selectedIds.length === 1) {
    displayLabel = portfolios.find(p => p.id === selectedIds[0])?.name ?? '1 selected'
  } else {
    displayLabel = `${selectedIds.length} portfolios`
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex items-center gap-1.5 text-xs font-medium rounded-md pl-2 pr-1.5 py-1 transition-colors cursor-pointer border',
          selectedIds.length > 0
            ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800/40 text-primary-700 dark:text-primary-300'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600',
          open && 'ring-1 ring-primary-400/40 border-primary-400'
        )}
      >
        <span className="truncate max-w-[140px]">{displayLabel}</span>
        {selectedIds.length > 0 ? (
          <X
            className="w-3 h-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 shrink-0"
            onClick={clearAll}
          />
        ) : (
          <ChevronDown className={clsx(
            'w-3 h-3 text-gray-400 shrink-0 transition-transform',
            open && 'rotate-180'
          )} />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 min-w-[220px] max-h-[320px] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-gray-700">
            <button
              onClick={() => onChange(portfolios.map(p => p.id))}
              className="text-[10px] font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700"
            >
              Select all
            </button>
            {selectedIds.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="text-[10px] font-medium text-gray-400 dark:text-gray-500 hover:text-gray-600"
              >
                Clear
              </button>
            )}
          </div>

          {tree.map((group) => (
            <div key={group.teamId ?? '__ungrouped'}>
              {hasMultipleGroups && (
                <button
                  onClick={() => toggleGroup(group)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 border-b border-gray-50 dark:border-gray-700/50"
                >
                  <div className={clsx(
                    'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                    group.portfolios.every(p => selectedSet.has(p.id))
                      ? 'bg-primary-500 border-primary-500 text-white'
                      : group.portfolios.some(p => selectedSet.has(p.id))
                        ? 'bg-primary-100 border-primary-300 dark:bg-primary-900/30 dark:border-primary-700'
                        : 'border-gray-300 dark:border-gray-600',
                  )}>
                    {group.portfolios.every(p => selectedSet.has(p.id)) && (
                      <Check className="w-2.5 h-2.5" />
                    )}
                  </div>
                  <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    {group.teamName}
                  </span>
                </button>
              )}

              {group.portfolios.map((p) => (
                <button
                  key={p.id}
                  onClick={() => togglePortfolio(p.id)}
                  className={clsx(
                    'w-full flex items-center gap-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors',
                    hasMultipleGroups ? 'px-5 py-1.5' : 'px-3 py-1.5',
                  )}
                >
                  <div className={clsx(
                    'w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0',
                    selectedSet.has(p.id)
                      ? 'bg-primary-500 border-primary-500 text-white'
                      : 'border-gray-300 dark:border-gray-600',
                  )}>
                    {selectedSet.has(p.id) && <Check className="w-2.5 h-2.5" />}
                  </div>
                  <span className="text-xs text-gray-700 dark:text-gray-200">
                    {p.name}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Controls ────────────────────────────────────────────────────────

export function ListSurfaceControls({
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  portfolioFilterIds,
  onPortfolioFilterChange,
  portfolios,
  favoritesOnly,
  onFavoritesOnlyChange,
  sortBy,
  onSortByChange,
  groupBy,
  onGroupByChange,
  viewMode,
  onViewModeChange,
  onNewList
}: ListSurfaceControlsProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      {/* Search */}
      <div className="relative flex-1 min-w-0 max-w-xs">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
        <input
          type="text"
          placeholder="Search lists..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>

      {/* Type filter pills */}
      <div className="flex items-center gap-1">
        {TYPE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => onTypeFilterChange(opt.value)}
            className={clsx(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
              typeFilter === opt.value
                ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Portfolio tree multi-select */}
      {portfolios.length > 0 && (
        <PortfolioTreeSelect
          portfolios={portfolios}
          selectedIds={portfolioFilterIds}
          onChange={onPortfolioFilterChange}
        />
      )}

      {/* Favorites toggle */}
      <button
        onClick={() => onFavoritesOnlyChange(!favoritesOnly)}
        className={clsx(
          'flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors',
          favoritesOnly
            ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300'
            : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
        )}
      >
        <Star className={clsx('h-3 w-3', favoritesOnly && 'fill-yellow-500')} />
        Favs
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Group (list view) / Sort (grid view) */}
      {viewMode === 'list' ? (
        <GroupByDropdown value={groupBy} onChange={onGroupByChange} />
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as ListSortKey)}
            className="text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}

      {/* View toggle */}
      <div className="flex items-center border border-gray-200 dark:border-gray-700 rounded-md overflow-hidden">
        <button
          onClick={() => onViewModeChange('grid')}
          className={clsx(
            'p-1.5 transition-colors',
            viewMode === 'grid'
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
              : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
          title="Grid view"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onViewModeChange('list')}
          className={clsx(
            'p-1.5 transition-colors',
            viewMode === 'list'
              ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
              : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
          title="List view"
        >
          <List className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* New list */}
      <Button size="sm" onClick={onNewList}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        New List
      </Button>
    </div>
  )
}
