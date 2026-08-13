import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import {
  Search, TrendingUp, Briefcase, Tag, FileText, List, PieChart, Clock, User,
  GitBranch, FolderKanban, BookOpen, FileSpreadsheet, FileType, Beaker, Users,
  Calendar, Camera, LayoutDashboard
} from 'lucide-react'
import { clsx } from 'clsx'
import { useObjectSearch, type SearchResult } from '../../hooks/useObjectSearch'


interface GlobalSearchProps {
  /**
   * Debounced query text, reported to the parent. The mobile overlay renders a
   * keyword-explore feed beside these object results and needs the same term
   * without owning a second input.
   */
  onQueryChange?: (query: string) => void
  onSelectResult: (result: SearchResult) => void
  placeholder?: string
  onFocusSearch?: () => void
}

// Memoized result item for performance
const ResultItem = React.memo(({
  result,
  isSelected,
  onSelect
}: {
  result: SearchResult
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
      case 'trade-lab': return <Beaker className={`${iconClass} text-pink-600`} />
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
      case 'user': return 'bg-gray-100 text-gray-600 dark:text-gray-400 dark:bg-gray-800'
      default: return 'bg-gray-100 text-gray-500 dark:text-gray-400 dark:bg-gray-800'
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
        isSelected ? 'bg-primary-100 scale-105' : 'bg-gray-50 dark:bg-gray-900'
      )}>
        {getResultIcon(result.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={clsx(
            'text-sm font-medium truncate transition-colors duration-100',
            isSelected ? 'text-primary-900' : 'text-gray-900 dark:text-white'
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
        <kbd className="hidden sm:flex text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded dark:bg-gray-800">
          ↵
        </kbd>
      </div>
    </button>
  )
})

ResultItem.displayName = 'ResultItem'

export function GlobalSearch({ onSelectResult, placeholder = "Search everything...", onFocusSearch, onQueryChange }: GlobalSearchProps) {
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

  useEffect(() => { onQueryChange?.(debouncedQuery) }, [debouncedQuery, onQueryChange])

  const { results: searchResults, isFetching } = useObjectSearch(debouncedQuery)

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

  // Also expose focus via a window event so any surface (e.g. the
  // PilotWelcomeBanner's "Explore an asset page" tile) can pop the
  // search bar open without needing a ref drilled through. Opening the
  // dropdown with an empty query surfaces the "no matches yet" state,
  // which is fine — the user types and results populate immediately.
  useEffect(() => {
    const handler = () => {
      inputRef.current?.focus()
      setIsOpen(true)
    }
    window.addEventListener('focus-global-search', handler)
    return () => window.removeEventListener('focus-global-search', handler)
  }, [])

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
          className="block w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 hover:bg-white transition-all duration-200 cursor-text dark:border-gray-600 dark:hover:bg-gray-800 dark:bg-gray-900"
        />
      </div>

      {/* Always mounted dropdown with CSS transitions */}
      <div
        className={clsx(
          "absolute top-full left-0 right-0 mt-1.5 bg-white rounded-xl shadow-xl border border-gray-200/80 z-50 overflow-hidden dark:bg-gray-800",
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
            <p className="text-sm text-gray-500 dark:text-gray-400">No results for "<span className="font-medium text-gray-700">{query}</span>"</p>
            <p className="text-xs text-gray-400 mt-1">Try a different search term</p>
          </div>
        </div>
      </div>
    </div>
  )
}
