import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  Search, TrendingUp, Briefcase, Tag, FileText, List, PieChart, Clock, User,
  GitBranch, FolderKanban, BookOpen, FileSpreadsheet, FileType, LineChart, Users,
  Calendar, Camera, LayoutDashboard
} from 'lucide-react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'

// Static pages/tabs that should be discoverable via search
const STATIC_PAGES = [
  { id: 'dashboard', title: 'Dashboard', type: 'page' as const, subtitle: 'Home dashboard overview', keywords: ['home', 'main', 'overview'] },
  { id: 'assets-list', title: 'Assets', type: 'page' as const, subtitle: 'Browse all assets', keywords: ['stocks', 'securities', 'holdings'] },
  { id: 'portfolios-list', title: 'Portfolios', type: 'page' as const, subtitle: 'Manage portfolios', keywords: ['funds', 'accounts'] },
  { id: 'themes-list', title: 'Themes', type: 'page' as const, subtitle: 'Investment themes', keywords: ['sectors', 'categories'] },
  { id: 'notes-list', title: 'Notes', type: 'page' as const, subtitle: 'Research notes', keywords: ['documents', 'memos', 'research'] },
  { id: 'lists', title: 'Lists', type: 'page' as const, subtitle: 'Asset lists and watchlists', keywords: ['watchlist', 'screening'] },
  { id: 'tdf-list', title: 'Target Date Funds', type: 'page' as const, subtitle: 'TDF management', keywords: ['tdf', 'retirement', 'glide path'] },
  { id: 'projects-list', title: 'Projects', type: 'page' as const, subtitle: 'All projects', keywords: ['tasks', 'work'] },
  { id: 'workflows', title: 'Workflows', type: 'page' as const, subtitle: 'Workflow management', keywords: ['automation', 'process'] },
  { id: 'calendar', title: 'Calendar', type: 'page' as const, subtitle: 'Events and schedule', keywords: ['events', 'schedule', 'meetings', 'earnings'] },
  { id: 'trade-lab', title: 'Trade Lab', type: 'page' as const, subtitle: 'Trade analysis and simulation', keywords: ['trading', 'backtest', 'simulation', 'orders'] },
  { id: 'trade-queue', title: 'Trade Queue', type: 'page' as const, subtitle: 'Pending trades', keywords: ['orders', 'execution', 'trading'] },
  { id: 'charting', title: 'Charting', type: 'page' as const, subtitle: 'Technical charts', keywords: ['charts', 'technical', 'graphs', 'price'] },
  { id: 'asset-allocation', title: 'Asset Allocation', type: 'page' as const, subtitle: 'Portfolio allocation analysis', keywords: ['allocation', 'weights', 'rebalance'] },
  { id: 'prioritizer', title: 'Prioritizer', type: 'page' as const, subtitle: 'Asset prioritization', keywords: ['ranking', 'priority', 'scoring'] },
  { id: 'idea-generator', title: 'Idea Generator', type: 'page' as const, subtitle: 'Investment ideas', keywords: ['ideas', 'opportunities', 'screening'] },
  { id: 'reasons', title: 'Reasons', type: 'page' as const, subtitle: 'Investment rationales', keywords: ['rationale', 'thesis', 'why'] },
  { id: 'files', title: 'Files', type: 'page' as const, subtitle: 'File management', keywords: ['documents', 'uploads', 'models'] },
  { id: 'templates', title: 'Templates', type: 'page' as const, subtitle: 'Model and text templates', keywords: ['models', 'spreadsheets'] },
  { id: 'organization', title: 'Organization', type: 'page' as const, subtitle: 'Team and settings', keywords: ['team', 'settings', 'users', 'members'] },
  { id: 'simulations', title: 'Simulations', type: 'page' as const, subtitle: 'Portfolio simulations', keywords: ['monte carlo', 'scenarios', 'backtest'] },
]

interface SearchResult {
  id: string
  title: string
  type: 'asset' | 'portfolio' | 'theme' | 'note' | 'list' | 'tdf' | 'allocation-period' | 'user' |
        'workflow' | 'workflow-template' | 'project' | 'notebook' | 'model-template' | 'model-file' |
        'text-template' | 'simulation' | 'team' | 'calendar-event' | 'capture' | 'page'
  subtitle?: string
  data: any
}

interface GlobalSearchProps {
  onSelectResult: (result: SearchResult) => void
  placeholder?: string
  onFocusSearch?: () => void
}

// Memoized result item for performance
const ResultItem = React.memo(({
  result,
  index,
  isSelected,
  onSelect
}: {
  result: SearchResult
  index: number
  isSelected: boolean
  onSelect: () => void
}) => {
  const getResultIcon = (type: string) => {
    const iconClass = "h-4 w-4"
    switch (type) {
      case 'asset': return <TrendingUp className={`${iconClass} text-blue-600`} />
      case 'portfolio': return <Briefcase className={`${iconClass} text-emerald-600`} />
      case 'theme': return <Tag className={`${iconClass} text-indigo-600`} />
      case 'note': return <FileText className={`${iconClass} text-slate-600`} />
      case 'list': return <List className={`${iconClass} text-purple-600`} />
      case 'tdf': return <Clock className={`${iconClass} text-cyan-600`} />
      case 'allocation-period': return <PieChart className={`${iconClass} text-rose-600`} />
      case 'user': return <User className={`${iconClass} text-gray-600`} />
      case 'workflow': return <GitBranch className={`${iconClass} text-orange-600`} />
      case 'workflow-template': return <GitBranch className={`${iconClass} text-orange-400`} />
      case 'project': return <FolderKanban className={`${iconClass} text-violet-600`} />
      case 'notebook': return <BookOpen className={`${iconClass} text-amber-600`} />
      case 'model-template': return <FileSpreadsheet className={`${iconClass} text-green-600`} />
      case 'model-file': return <FileSpreadsheet className={`${iconClass} text-green-500`} />
      case 'text-template': return <FileType className={`${iconClass} text-sky-600`} />
      case 'simulation': return <LineChart className={`${iconClass} text-pink-600`} />
      case 'team': return <Users className={`${iconClass} text-teal-600`} />
      case 'calendar-event': return <Calendar className={`${iconClass} text-red-500`} />
      case 'capture': return <Camera className={`${iconClass} text-fuchsia-600`} />
      case 'page': return <LayoutDashboard className={`${iconClass} text-slate-600`} />
      default: return <Search className={`${iconClass} text-gray-400`} />
    }
  }

  const getBadgeColor = (type: string) => {
    switch (type) {
      case 'page': return 'bg-slate-100 text-slate-500'
      case 'asset': return 'bg-blue-50 text-blue-600'
      case 'portfolio': return 'bg-emerald-50 text-emerald-600'
      case 'workflow': return 'bg-orange-50 text-orange-600'
      case 'project': return 'bg-violet-50 text-violet-600'
      case 'theme': return 'bg-indigo-50 text-indigo-600'
      case 'notebook': return 'bg-amber-50 text-amber-600'
      case 'user': return 'bg-gray-100 text-gray-600'
      default: return 'bg-gray-100 text-gray-500'
    }
  }

  return (
    <button
      onClick={onSelect}
      className={clsx(
        'w-full px-3 py-2.5 text-left flex items-center gap-3 rounded-lg mx-1 transition-all duration-100 ease-out',
        isSelected
          ? 'bg-primary-50 shadow-sm scale-[1.01]'
          : 'hover:bg-gray-50/80'
      )}
      style={{ width: 'calc(100% - 8px)' }}
    >
      <div className={clsx(
        'flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-100',
        isSelected ? 'bg-primary-100 scale-105' : 'bg-gray-50'
      )}>
        {getResultIcon(result.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx(
            'text-sm font-medium truncate transition-colors duration-100',
            isSelected ? 'text-primary-900' : 'text-gray-900'
          )}>
            {result.title}
          </span>
          <span className={clsx(
            'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide flex-shrink-0 transition-colors duration-100',
            getBadgeColor(result.type)
          )}>
            {result.type === 'page' ? 'page' : result.type.replace('-', ' ')}
          </span>
        </div>
        {result.subtitle && (
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {result.subtitle}
          </p>
        )}
      </div>
      <div className={clsx(
        'flex-shrink-0 transition-all duration-100',
        isSelected ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'
      )}>
        <kbd className="hidden sm:flex text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
          ↵
        </kbd>
      </div>
    </button>
  )
})

ResultItem.displayName = 'ResultItem'

export function GlobalSearch({ onSelectResult, placeholder = "Search everything...", onFocusSearch }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stableResultsRef = useRef<SearchResult[]>([])

  // Debounce with 250ms for smoother experience
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query)
    }, 250)
    return () => clearTimeout(timer)
  }, [query])

  const { data: searchResults = [], isFetching } = useQuery({
    queryKey: ['global-search', debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return []

      const q = debouncedQuery.trim().toLowerCase()

      // Filter static pages that match the search query
      const matchingPages = STATIC_PAGES.filter(page =>
        page.title.toLowerCase().includes(q) ||
        page.subtitle.toLowerCase().includes(q) ||
        page.keywords.some(kw => kw.includes(q))
      ).map(page => ({
        id: page.id,
        title: page.title,
        subtitle: page.subtitle,
        type: page.type,
        data: { pageType: page.id }
      }))

      // Single RPC call to search all tables at once
      const { data, error } = await supabase.rpc('global_search', {
        search_query: debouncedQuery.trim(),
        result_limit: 5
      })

      if (error) {
        console.error('Search error:', error)
        return matchingPages
      }

      const results: SearchResult[] = [...matchingPages]

      // Process all result types
      if (data?.assets) {
        results.push(...data.assets.map((asset: any) => ({
          id: asset.id, title: asset.symbol, subtitle: asset.company_name,
          type: 'asset' as const, data: asset
        })))
      }
      if (data?.themes) {
        results.push(...data.themes.map((theme: any) => ({
          id: theme.id, title: theme.name,
          subtitle: theme.description || `${theme.theme_type || 'general'} theme`,
          type: 'theme' as const, data: theme
        })))
      }
      if (data?.portfolios) {
        results.push(...data.portfolios.map((p: any) => ({
          id: p.id, title: p.name,
          subtitle: p.description || `Portfolio${p.benchmark ? ` • ${p.benchmark}` : ''}`,
          type: 'portfolio' as const, data: p
        })))
      }
      if (data?.asset_lists) {
        results.push(...data.asset_lists.map((list: any) => ({
          id: list.id, title: list.name,
          subtitle: list.description || 'Asset list',
          type: 'list' as const, data: list
        })))
      }
      if (data?.workflows) {
        results.push(...data.workflows.map((w: any) => ({
          id: w.id, title: w.name, subtitle: w.description || `${w.status || 'active'} workflow`,
          type: 'workflow' as const, data: w
        })))
      }
      if (data?.projects) {
        results.push(...data.projects.map((p: any) => ({
          id: p.id, title: p.title,
          subtitle: `${p.status || 'active'}${p.priority ? ` • ${p.priority}` : ''}`,
          type: 'project' as const, data: p
        })))
      }
      if (data?.users) {
        results.push(...data.users.map((user: any) => {
          const fullName = user.first_name && user.last_name
            ? `${user.first_name} ${user.last_name}`
            : user.email?.split('@')[0] || 'Unknown'
          return {
            id: user.id, title: fullName, subtitle: user.email || '',
            type: 'user' as const, data: { id: user.id, full_name: fullName, email: user.email }
          }
        }))
      }
      if (data?.tdfs) {
        results.push(...data.tdfs.map((tdf: any) => ({
          id: tdf.id, title: tdf.name,
          subtitle: `Target Year: ${tdf.target_year}${tdf.fund_code ? ` • ${tdf.fund_code}` : ''}`,
          type: 'tdf' as const, data: tdf
        })))
      }
      if (data?.notebooks) {
        results.push(...data.notebooks.map((n: any) => ({
          id: n.id, title: n.name, subtitle: n.description || 'Custom notebook',
          type: 'notebook' as const, data: n
        })))
      }
      if (data?.teams) {
        results.push(...data.teams.map((t: any) => ({
          id: t.id, title: t.name, subtitle: t.description || 'Team',
          type: 'team' as const, data: t
        })))
      }
      if (data?.simulations) {
        results.push(...data.simulations.map((s: any) => ({
          id: s.id, title: s.name, subtitle: s.description || `${s.status || 'active'} simulation`,
          type: 'simulation' as const, data: s
        })))
      }
      if (data?.model_files) {
        results.push(...data.model_files.map((f: any) => ({
          id: f.id, title: f.filename,
          subtitle: f.symbol ? `${f.symbol} - ${f.company_name}` : 'Model file',
          type: 'model-file' as const, data: { ...f, assetId: f.asset_id }
        })))
      }

      return results
    },
    enabled: debouncedQuery.length > 1,
    staleTime: 60000,
    placeholderData: keepPreviousData
  })

  // Keep stable results - only update when we have actual new results
  useEffect(() => {
    if (searchResults.length > 0) {
      stableResultsRef.current = searchResults
    }
  }, [searchResults])

  // Use stable results during transitions
  const displayResults = useMemo(() => {
    if (searchResults.length > 0) return searchResults
    if (query.length > 1 && stableResultsRef.current.length > 0) return stableResultsRef.current
    return []
  }, [searchResults, query])

  // Dropdown visibility state
  const showDropdown = isOpen && query.length > 1

  // Determine content state
  const contentState = useMemo(() => {
    if (displayResults.length > 0) return 'results'
    if (isFetching || query !== debouncedQuery) return 'loading'
    if (debouncedQuery.length > 1) return 'empty'
    return 'loading'
  }, [displayResults.length, isFetching, query, debouncedQuery])

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0)
  }, [displayResults])

  // Expose focus function to parent
  React.useImperativeHandle(onFocusSearch, () => ({
    focus: () => inputRef.current?.focus()
  }), [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!isOpen || displayResults.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, displayResults.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (displayResults[selectedIndex]) {
          handleSelectResult(displayResults[selectedIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        inputRef.current?.blur()
        break
    }
  }, [isOpen, displayResults, selectedIndex])

  const handleSelectResult = useCallback((result: SearchResult) => {
    onSelectResult(result)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.blur()
  }, [onSelectResult])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setIsOpen(true)
  }, [])

  return (
    <div ref={searchRef} className="relative flex-1 max-w-2xl">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className={clsx(
            "h-5 w-5 transition-colors duration-200",
            isFetching ? "text-primary-500" : "text-gray-400"
          )} />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="block w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 hover:bg-white transition-all duration-200 cursor-text"
        />
      </div>

      {/* Always mounted dropdown with CSS transitions */}
      <div
        className={clsx(
          "absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl shadow-xl border border-gray-200/80 z-50 overflow-hidden",
          "transition-all duration-200 ease-out origin-top",
          showDropdown
            ? "opacity-100 scale-100 translate-y-0 pointer-events-auto"
            : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
        )}
      >
        {/* Subtle loading bar */}
        <div className={clsx(
          "absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-400 via-primary-500 to-primary-400 transition-opacity duration-300",
          isFetching && displayResults.length > 0 ? "opacity-100" : "opacity-0"
        )} style={{ backgroundSize: '200% 100%', animation: isFetching ? 'shimmer 1.5s ease-in-out infinite' : 'none' }} />

        <div className="max-h-[420px] overflow-hidden">
          {/* Results list */}
          <div className={clsx(
            "overflow-y-auto max-h-[420px] custom-scrollbar transition-all duration-200",
            contentState === 'results' ? "opacity-100" : "opacity-0 absolute inset-0"
          )}>
            <div className="py-1.5">
              {displayResults.map((result, index) => (
                <ResultItem
                  key={`${result.type}-${result.id}`}
                  result={result}
                  index={index}
                  isSelected={index === selectedIndex}
                  onSelect={() => handleSelectResult(result)}
                />
              ))}
            </div>
          </div>

          {/* Loading state */}
          <div className={clsx(
            "flex items-center justify-center py-12 transition-all duration-200",
            contentState === 'loading' && displayResults.length === 0 ? "opacity-100" : "opacity-0 absolute inset-0 pointer-events-none"
          )}>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 bg-primary-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>

          {/* Empty state */}
          <div className={clsx(
            "py-10 text-center transition-all duration-200",
            contentState === 'empty' ? "opacity-100" : "opacity-0 absolute inset-0 pointer-events-none"
          )}>
            <Search className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500">No results for "<span className="font-medium text-gray-700">{query}</span>"</p>
            <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
          </div>
        </div>
      </div>
    </div>
  )
}
