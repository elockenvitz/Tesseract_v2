import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Search, Filter, Plus, Calendar, Share2, ArrowUpDown, ChevronDown, TrendingUp, Briefcase, Tag, Book } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface NotesListPageProps {
  onNoteSelect?: (note: any) => void
}

interface Note {
  id: string
  title: string
  content: string
  note_type: string | null
  is_shared: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  is_deleted: boolean
  source_type: 'asset' | 'portfolio' | 'theme' | 'custom'
  source_name: string
  source_id: string
}

export function NotesListPage({ onNoteSelect }: NotesListPageProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sharedFilter, setSharedFilter] = useState('all')
  const [sortBy, setSortBy] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [showFilters, setShowFilters] = useState(false)

  // Fetch all notes from different sources
  const { data: notes, isLoading } = useQuery({
    queryKey: ['all-notes'],
    queryFn: async () => {
      // Fetch notes from all sources in parallel
      const [assetNotes, portfolioNotes, themeNotes, customNotes] = await Promise.all([
        supabase
          .from('asset_notes')
          .select('*, assets(symbol, company_name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('portfolio_notes')
          .select('*, portfolios(name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('theme_notes')
          .select('*, themes(name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('custom_notebook_notes')
          .select('*, custom_notebooks(name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false })
      ])

      const allNotes: Note[] = []

      // Process asset notes
      if (assetNotes.data) {
        allNotes.push(...assetNotes.data.map(note => ({
          ...note,
          source_type: 'asset' as const,
          source_name: note.assets?.symbol || 'Unknown Asset',
          source_id: note.asset_id
        })))
      }

      // Process portfolio notes
      if (portfolioNotes.data) {
        allNotes.push(...portfolioNotes.data.map(note => ({
          ...note,
          source_type: 'portfolio' as const,
          source_name: note.portfolios?.name || 'Unknown Portfolio',
          source_id: note.portfolio_id
        })))
      }

      // Process theme notes
      if (themeNotes.data) {
        allNotes.push(...themeNotes.data.map(note => ({
          ...note,
          source_type: 'theme' as const,
          source_name: note.themes?.name || 'Unknown Theme',
          source_id: note.theme_id
        })))
      }

      // Process custom notebook notes
      if (customNotes.data) {
        allNotes.push(...customNotes.data.map(note => ({
          ...note,
          source_type: 'custom' as const,
          source_name: note.custom_notebooks?.name || 'Unknown Notebook',
          source_id: note.custom_notebook_id
        })))
      }

      return allNotes
    },
  })

  // Filter and sort notes
  const filteredNotes = useMemo(() => {
    if (!notes) return []

    let filtered = notes.filter(note => {
      // Search filter
      const matchesSearch = !searchQuery || 
        note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        note.source_name.toLowerCase().includes(searchQuery.toLowerCase())

      // Source filter
      const matchesSource = sourceFilter === 'all' || note.source_type === sourceFilter

      // Type filter
      const matchesType = typeFilter === 'all' || note.note_type === typeFilter

      // Shared filter
      const matchesShared = sharedFilter === 'all' || 
        (sharedFilter === 'shared' && note.is_shared) ||
        (sharedFilter === 'private' && !note.is_shared)

      return matchesSearch && matchesSource && matchesType && matchesShared
    })

    // Sort notes
    filtered.sort((a, b) => {
      let aValue, bValue

      switch (sortBy) {
        case 'title':
          aValue = a.title
          bValue = b.title
          break
        case 'source_name':
          aValue = a.source_name
          bValue = b.source_name
          break
        case 'source_type':
          aValue = a.source_type
          bValue = b.source_type
          break
        case 'note_type':
          aValue = a.note_type || 'general'
          bValue = b.note_type || 'general'
          break
        case 'created_at':
          aValue = new Date(a.created_at || 0).getTime()
          bValue = new Date(b.created_at || 0).getTime()
          break
        case 'updated_at':
        default:
          aValue = new Date(a.updated_at || '').getTime()
          bValue = new Date(b.updated_at || '').getTime()
          break
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue)
      }

      return sortOrder === 'asc' ? Number(aValue) - Number(bValue) : Number(bValue) - Number(aValue)
    })

    return filtered
  }, [notes, searchQuery, sourceFilter, typeFilter, sharedFilter, sortBy, sortOrder])

  const getNoteTypeColor = (type: string | null) => {
    switch (type) {
      case 'meeting': return 'success'
      case 'call': return 'purple'
      case 'research': return 'warning'
      case 'idea': return 'error'
      case 'analysis': return 'primary'
      case 'general': return 'default'
      default: return 'default'
    }
  }

  const getSourceIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'asset': return <TrendingUp className="h-3 w-3" />
      case 'portfolio': return <Briefcase className="h-3 w-3" />
      case 'theme': return <Tag className="h-3 w-3" />
      case 'custom': return <Book className="h-3 w-3" />
      default: return <FileText className="h-3 w-3" />
    }
  }

  const getSourceColor = (sourceType: string) => {
    switch (sourceType) {
      case 'asset': return 'primary'
      case 'portfolio': return 'success'
      case 'theme': return 'warning'
      case 'custom': return 'default'
      default: return 'default'
    }
  }

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortOrder('desc')
    }
  }

  const handleNoteClick = (note: Note) => {
    if (onNoteSelect) {
      onNoteSelect({
        id: note.id,
        title: note.title,
        type: 'note',
        data: note
      })
    }
  }

  const clearFilters = () => {
    setSearchQuery('')
    setSourceFilter('all')
    setTypeFilter('all')
    setSharedFilter('all')
    setSortBy('updated_at')
    setSortOrder('desc')
  }

  const activeFiltersCount = [
    searchQuery,
    sourceFilter !== 'all' ? sourceFilter : null,
    typeFilter !== 'all' ? typeFilter : null,
    sharedFilter !== 'all' ? sharedFilter : null
  ].filter(Boolean).length

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Notes</h1>
          <p className="text-gray-600">
            {filteredNotes.length} of {notes?.length || 0} notes
          </p>
        </div>
      </div>

      {/* Search and Filters */}
      <Card>
        <div className="space-y-4">
          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search by title, content, or source..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Filter Toggle */}
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              <Filter className="h-4 w-4" />
              <span>Filters</span>
              {activeFiltersCount > 0 && (
                <Badge variant="primary" size="sm">
                  {activeFiltersCount}
                </Badge>
              )}
              <ChevronDown className={clsx(
                'h-4 w-4 transition-transform',
                showFilters && 'rotate-180'
              )} />
            </button>

            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-primary-600 hover:text-primary-700 transition-colors"
              >
                Clear all filters
              </button>
            )}
          </div>

          {/* Filter Controls */}
          {showFilters && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4 border-t border-gray-200">
              <Select
                label="Source"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Sources' },
                  { value: 'asset', label: 'Assets' },
                  { value: 'portfolio', label: 'Portfolios' },
                  { value: 'theme', label: 'Themes' },
                  { value: 'custom', label: 'Custom Notebooks' }
                ]}
              />

              <Select
                label="Note Type"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Types' },
                  { value: 'general', label: 'General' },
                  { value: 'research', label: 'Research' },
                  { value: 'analysis', label: 'Analysis' },
                  { value: 'idea', label: 'Idea' },
                  { value: 'meeting', label: 'Meeting' },
                  { value: 'call', label: 'Call' }
                ]}
              />

              <Select
                label="Sharing"
                value={sharedFilter}
                onChange={(e) => setSharedFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'All Notes' },
                  { value: 'private', label: 'Private' },
                  { value: 'shared', label: 'Shared' }
                ]}
              />

              <Select
                label="Sort by"
                value={sortBy}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortBy(e.target.value)}
                options={[
                  { value: 'updated_at', label: 'Last Updated' },
                  { value: 'created_at', label: 'Date Created' },
                  { value: 'title', label: 'Title' },
                  { value: 'source_name', label: 'Source Name' },
                  { value: 'source_type', label: 'Source Type' },
                  { value: 'note_type', label: 'Note Type' }
                ]}
              />
            </div>
          )}
        </div>
      </Card>

      {/* Notes List */}
      <Card padding="none">
        {isLoading ? (
          <div className="p-6">
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="flex items-center space-x-4">
                    <div className="w-8 h-8 bg-gray-200 rounded-lg"></div>
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                      <div className="h-3 bg-gray-200 rounded w-2/3"></div>
                    </div>
                    <div className="space-y-2">
                      <div className="h-4 bg-gray-200 rounded w-16"></div>
                      <div className="h-3 bg-gray-200 rounded w-12"></div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : filteredNotes.length > 0 ? (
          <div className="divide-y divide-gray-200">
            {/* Table Header */}
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wider">
                <div className="col-span-4">
                  <button
                    onClick={() => handleSort('title')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Note</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('source_name')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Source</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('note_type')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Type</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
                <div className="col-span-2">
                  <span>Status</span>
                </div>
                <div className="col-span-2">
                  <button
                    onClick={() => handleSort('updated_at')}
                    className="flex items-center space-x-1 hover:text-gray-700 transition-colors"
                  >
                    <span>Last Updated</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Notes Rows */}
            {filteredNotes.map((note) => (
              <div
                key={`${note.source_type}-${note.id}`}
                onClick={() => handleNoteClick(note)}
                className="px-6 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
              >
                <div className="grid grid-cols-12 gap-4 items-center">
                  {/* Note Info */}
                  <div className="col-span-4">
                    <div className="flex items-start space-x-3">
                      <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center mt-0.5">
                        <FileText className="h-4 w-4 text-gray-600" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center space-x-2 mb-1">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {note.title}
                          </p>
                          {note.note_type && (
                            <Badge variant={getNoteTypeColor(note.note_type)} size="sm">
                              {note.note_type}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-gray-600 line-clamp-2 mb-1">
                          {note.content.substring(0, 100)}...
                        </p>
                        <div className="flex items-center space-x-2 text-xs text-gray-500">
                          <span>{note.content.split(' ').length} words</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Source */}
                  <div className="col-span-2">
                    <div className="flex items-center space-x-2">
                      <Badge variant={getSourceColor(note.source_type)} size="sm">
                        <span className="flex items-center space-x-1">
                          {getSourceIcon(note.source_type)}
                          <span className="capitalize">{note.source_type}</span>
                        </span>
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600 truncate mt-1">
                      {note.source_name}
                    </p>
                  </div>

                  {/* Note Type */}
                  <div className="col-span-2">
                    {note.note_type && (
                      <Badge variant={getNoteTypeColor(note.note_type)} size="sm">
                        {note.note_type}
                      </Badge>
                    )}
                  </div>

                  {/* Status */}
                  <div className="col-span-2">
                    <div className="flex items-center space-x-2">
                      {note.is_shared && (
                        <Badge variant="primary" size="sm">
                          <Share2 className="h-3 w-3 mr-1" />
                          Shared
                        </Badge>
                      )}
                      {!note.is_shared && (
                        <span className="text-xs text-gray-500">Private</span>
                      )}
                    </div>
                  </div>

                  {/* Last Updated */}
                  <div className="col-span-2">
                    <div className="flex items-center text-sm text-gray-500">
                      <Calendar className="h-3 w-3 mr-1" />
                      {formatDistanceToNow(new Date(note.updated_at || 0), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <FileText className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {notes?.length === 0 ? 'No notes yet' : 'No notes match your filters'}
            </h3>
            <p className="text-gray-500 mb-4">
              {notes?.length === 0 
                ? 'Start by creating your first note in an asset, portfolio, or theme.'
                : 'Try adjusting your search criteria or clearing filters.'
              }
            </p>
            {notes?.length === 0 && (
              <Button size="sm">
                <Plus className="h-4 w-4 mr-2" />
                Create First Note
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}