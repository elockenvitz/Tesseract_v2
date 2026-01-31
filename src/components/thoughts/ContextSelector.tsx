/**
 * ContextSelector - Search and select context for Quick Ideas
 *
 * Allows users to manually attach context (asset, project, portfolio, theme, list)
 * to their thoughts or trade ideas.
 */

import { useState, useRef, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, X, BarChart3, FolderKanban, Briefcase, Palette, List, FileText, LinkIcon, Plus
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { clsx } from 'clsx'

export interface CapturedContext {
  type?: string
  id?: string
  title?: string
}

interface ContextSelectorProps {
  value: CapturedContext | null
  onChange: (context: CapturedContext | null) => void
  compact?: boolean
}

// Context type icons and colors
const CONTEXT_TYPE_CONFIG: Record<string, { icon: typeof BarChart3; label: string; color: string }> = {
  asset: { icon: BarChart3, label: 'Asset', color: 'bg-blue-100 text-blue-700 border-blue-200' },
  project: { icon: FolderKanban, label: 'Project', color: 'bg-purple-100 text-purple-700 border-purple-200' },
  portfolio: { icon: Briefcase, label: 'Portfolio', color: 'bg-amber-100 text-amber-700 border-amber-200' },
  theme: { icon: Palette, label: 'Theme', color: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  list: { icon: List, label: 'List', color: 'bg-slate-100 text-slate-700 border-slate-200' },
  note: { icon: FileText, label: 'Note', color: 'bg-orange-100 text-orange-700 border-orange-200' },
}

interface SearchResult {
  type: string
  id: string
  title: string
  subtitle?: string
}

export function ContextSelector({ value, onChange, compact = false }: ContextSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Focus input when opening
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setSearch('')
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Search across all context types
  const { data: searchResults, isLoading } = useQuery({
    queryKey: ['context-search', search],
    queryFn: async () => {
      if (!search || search.length < 2) return []

      const results: SearchResult[] = []

      // Search assets
      const { data: assets } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${search}%,company_name.ilike.%${search}%`)
        .limit(5)

      if (assets) {
        results.push(...assets.map(a => ({
          type: 'asset',
          id: a.id,
          title: a.symbol,
          subtitle: a.company_name
        })))
      }

      // Search projects
      const { data: projects } = await supabase
        .from('projects')
        .select('id, title')
        .ilike('title', `%${search}%`)
        .limit(5)

      if (projects) {
        results.push(...projects.map(p => ({
          type: 'project',
          id: p.id,
          title: p.title
        })))
      }

      // Search portfolios
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id, name')
        .ilike('name', `%${search}%`)
        .limit(5)

      if (portfolios) {
        results.push(...portfolios.map(p => ({
          type: 'portfolio',
          id: p.id,
          title: p.name
        })))
      }

      // Search themes
      const { data: themes } = await supabase
        .from('themes')
        .select('id, name')
        .ilike('name', `%${search}%`)
        .limit(5)

      if (themes) {
        results.push(...themes.map(t => ({
          type: 'theme',
          id: t.id,
          title: t.name
        })))
      }

      // Search lists
      const { data: lists } = await supabase
        .from('asset_lists')
        .select('id, name')
        .ilike('name', `%${search}%`)
        .limit(5)

      if (lists) {
        results.push(...lists.map(l => ({
          type: 'list',
          id: l.id,
          title: l.name
        })))
      }

      return results
    },
    enabled: search.length >= 2,
  })

  const handleSelect = (result: SearchResult) => {
    onChange({
      type: result.type,
      id: result.id,
      title: result.subtitle ? `${result.title} - ${result.subtitle}` : result.title
    })
    setIsOpen(false)
    setSearch('')
  }

  const handleRemove = () => {
    onChange(null)
  }

  const hasValue = value?.type && value.id

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2">
        <div
          className="relative group"
          title={"Links this idea to where you captured it (e.g., an asset, project, or portfolio).\nUsed for organization and relevance — not trade details."}
        >
          <LinkIcon className="h-3.5 w-3.5 text-gray-400 flex-shrink-0 cursor-help" />
        </div>

        {hasValue ? (
          // Show selected context
          (() => {
            const config = CONTEXT_TYPE_CONFIG[value.type!] || CONTEXT_TYPE_CONFIG.asset
            const ContextIcon = config.icon
            return (
              <div className={clsx(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border",
                config.color
              )}>
                <ContextIcon className="h-3 w-3" />
                <span className="truncate max-w-[180px]">{value.title || config.label}</span>
                <button
                  onClick={handleRemove}
                  className="ml-0.5 hover:bg-black/10 rounded-full p-0.5"
                  title="Remove context"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )
          })()
        ) : isOpen ? (
          // Show search input
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search assets, projects, portfolios..."
              className="w-full pl-7 pr-8 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setIsOpen(false)
                  setSearch('')
                }
              }}
            />
            <button
              onClick={() => {
                setIsOpen(false)
                setSearch('')
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 hover:bg-gray-100 rounded"
            >
              <X className="h-3.5 w-3.5 text-gray-400" />
            </button>
          </div>
        ) : (
          // Show "Add context" button
          <button
            onClick={() => setIsOpen(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 border border-dashed border-gray-300 transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>Add context</span>
          </button>
        )}
      </div>

      {/* Search results dropdown */}
      {isOpen && search.length >= 2 && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {isLoading ? (
            <div className="px-3 py-3 text-center text-xs text-gray-400">
              Searching...
            </div>
          ) : searchResults && searchResults.length > 0 ? (
            <div className="py-1">
              {searchResults.map(result => {
                const config = CONTEXT_TYPE_CONFIG[result.type] || CONTEXT_TYPE_CONFIG.asset
                const TypeIcon = config.icon
                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    onClick={() => handleSelect(result)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
                  >
                    <TypeIcon className={clsx("h-3.5 w-3.5 flex-shrink-0", config.color.split(' ')[1])} />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-900 truncate">
                        {result.title}
                      </span>
                      {result.subtitle && (
                        <span className="text-xs text-gray-400 ml-1.5">
                          {result.subtitle}
                        </span>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="px-3 py-3 text-center text-xs text-gray-400">
              No results
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default ContextSelector
