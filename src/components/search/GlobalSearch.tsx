import React, { useState, useRef, useEffect } from 'react'
import { Search, TrendingUp, Briefcase, Tag, FileText, List } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'

interface SearchResult {
  id: string
  title: string
  type: 'asset' | 'portfolio' | 'theme' | 'note' | 'list'
  subtitle?: string
  data: any
}

interface GlobalSearchProps {
  onSelectResult: (result: SearchResult) => void
  placeholder?: string
  onFocusSearch?: () => void
}

export function GlobalSearch({ onSelectResult, placeholder = "Search assets, portfolios, themes, notebooks...", onFocusSearch }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const searchRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: searchResults = [], isLoading } = useQuery({
    queryKey: ['global-search', query],
    queryFn: async () => {
      if (!query.trim()) return []
      
      const results: SearchResult[] = []
      
      // Search assets
      const { data: assets } = await supabase
        .from('assets')
        .select('*')
        .or(`symbol.ilike.%${query}%,company_name.ilike.%${query}%`)
        .limit(5)
      
      if (assets) {
        results.push(...assets.map(asset => ({
          id: asset.id,
          title: asset.symbol,
          subtitle: asset.company_name,
          type: 'asset' as const,
          data: asset
        })))
      }
      
      // Search notes (notebooks)
      // Search across all note types using junction tables
      const [assetNotes, portfolioNotes, themeNotes, customNotes] = await Promise.all([
        supabase
          .from('asset_notes')
          .select('*, assets(symbol)')
          .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
          .neq('is_deleted', true)
          .limit(2),
        supabase
          .from('portfolio_notes')
          .select('*, portfolios(name)')
          .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
          .neq('is_deleted', true)
          .limit(2),
        supabase
          .from('theme_notes')
          .select('*, themes(name)')
          .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
          .neq('is_deleted', true)
          .limit(2),
        supabase
          .from('custom_notebook_notes')
          .select('*, custom_notebooks(name)')
          .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
          .neq('is_deleted', true)
          .limit(2)
      ])
      
      // Add asset notes
      if (assetNotes.data) {
        results.push(...assetNotes.data.map(note => ({
          id: note.id,
          title: note.title,
          subtitle: `${note.assets.symbol} - ${note.content.substring(0, 50)}...`,
          type: 'note' as const,
          data: note
        })))
      }
      
      // Add other note types
      if (portfolioNotes.data) {
        results.push(...portfolioNotes.data.map(note => ({
          id: note.id,
          title: note.title,
          subtitle: `${note.portfolios.name} - ${note.content.substring(0, 50)}...`,
          type: 'note' as const,
          data: note
        })))
      }
      
      if (themeNotes.data) {
        results.push(...themeNotes.data.map(note => ({
          id: note.id,
          title: note.title,
          subtitle: `${note.themes.name} - ${note.content.substring(0, 50)}...`,
          type: 'note' as const,
          data: note
        })))
      }
      
      if (customNotes.data) {
        results.push(...customNotes.data.map(note => ({
          id: note.id,
          title: note.title,
          subtitle: `${note.custom_notebooks.name} - ${note.content.substring(0, 50)}...`,
          type: 'note' as const,
          data: note
        })))
      }
      
      // Search themes
      const { data: themes } = await supabase
        .from('themes')
        .select('*')
        .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
        .limit(5)
      
      if (themes) {
        results.push(...themes.map(theme => ({
          id: theme.id,
          title: theme.name,
          subtitle: theme.description || `${theme.theme_type || 'general'} theme`,
          type: 'theme' as const,
          data: theme
        })))
      }
      
      // Search portfolios
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('*')
        .or(`name.ilike.%${query}%,description.ilike.%${query}%,benchmark.ilike.%${query}%`)
        .limit(5)
      
      if (portfolios) {
        results.push(...portfolios.map(portfolio => ({
          id: portfolio.id,
          title: portfolio.name,
          subtitle: portfolio.description || `Portfolio${portfolio.benchmark ? ` • ${portfolio.benchmark}` : ''}`,
          type: 'portfolio' as const,
          data: portfolio
        })))
      }
      
      // Search asset lists
      const { data: assetLists } = await supabase
        .from('asset_lists')
        .select(`
          *,
          asset_list_items(id)
        `)
        .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
        .limit(5)
      
      if (assetLists) {
        results.push(...assetLists.map(list => ({
          id: list.id,
          title: list.name,
          subtitle: `${list.asset_list_items?.length || 0} assets • ${list.description || 'Asset list'}`,
          type: 'list' as const,
          data: list
        })))
      }
      
      return results
    },
    enabled: query.length > 1
  })

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    setSelectedIndex(0)
  }, [searchResults])

  // Expose focus function to parent
  React.useImperativeHandle(onFocusSearch, () => ({
    focus: () => {
      inputRef.current?.focus()
    }
  }), [])

  // Handle focus from parent
  useEffect(() => {
    if (onFocusSearch) {
      // Store the function reference for cleanup
      const currentOnFocusSearch = onFocusSearch as any
      if (typeof currentOnFocusSearch === 'function') {
        // If onFocusSearch is called, focus the input
        return
      }
    }
  }, [onFocusSearch])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || searchResults.length === 0) return

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(prev => Math.max(prev - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (searchResults[selectedIndex]) {
          handleSelectResult(searchResults[selectedIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        inputRef.current?.blur()
        break
    }
  }

  const handleSelectResult = (result: SearchResult) => {
    onSelectResult(result)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.blur()
  }

  const getResultIcon = (type: string) => {
    switch (type) {
      case 'asset': return <TrendingUp className="h-4 w-4 text-blue-600" />
      case 'portfolio': return <Briefcase className="h-4 w-4 text-emerald-600" />
      case 'theme': return <Tag className="h-4 w-4 text-indigo-600" />
      case 'note': return <FileText className="h-4 w-4 text-slate-600" />
      case 'list': return <List className="h-4 w-4 text-purple-600" />
      default: return <Search className="h-4 w-4 text-gray-400" />
    }
  }

  return (
    <div ref={searchRef} className="relative flex-1 max-w-2xl">
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="block w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 hover:bg-white transition-colors"
        />
      </div>

      {isOpen && query.length > 1 && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-lg border border-gray-200 py-2 z-50 max-h-96 overflow-y-auto custom-scrollbar">
          {isLoading ? (
            <div className="px-4 py-3 text-sm text-gray-500">Searching...</div>
          ) : searchResults.length > 0 ? (
            searchResults.map((result, index) => (
              <button
                key={result.id}
                onClick={() => handleSelectResult(result)}
                className={clsx(
                  'w-full px-4 py-3 text-left hover:bg-gray-50 flex items-center space-x-3 transition-colors',
                  index === selectedIndex && 'bg-primary-50'
                )}
              >
                {getResultIcon(result.type)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center space-x-2">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {result.title}
                    </p>
                    <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full capitalize">
                      {result.type}
                    </span>
                  </div>
                  {result.subtitle && (
                    <p className="text-xs text-gray-500 truncate mt-1">
                      {result.subtitle}
                    </p>
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-3 text-sm text-gray-500">
              No results found for "{query}"
            </div>
          )}
        </div>
      )}
    </div>
  )
}