import { useState, useMemo, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, Search, X, Calendar, Share2, ArrowUp, ArrowDown, TrendingUp, Briefcase, Tag, Book, SlidersHorizontal, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { ListSkeleton } from '../components/common/LoadingSkeleton'
import { EmptyState } from '../components/common/EmptyState'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'
import { getContentPreview } from '../utils/stripHtml'

interface NotesListPageProps {
  onNoteSelect?: (note: any) => void
}

interface UserLite {
  id: string
  email: string
  first_name?: string | null
  last_name?: string | null
}

type SourceType = 'asset' | 'portfolio' | 'theme' | 'custom'

interface Note {
  id: string
  title: string
  content: string
  note_type: string | null
  is_shared: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  updated_by: string | null
  is_deleted: boolean
  source_type: SourceType
  source_name: string
  source_id: string
  created_by_user?: UserLite
  updated_by_user?: UserLite
}

// Note type options with labels
const NOTE_TYPE_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'research', label: 'Research' },
  { value: 'analysis', label: 'Analysis' },
  { value: 'idea', label: 'Idea' },
  { value: 'meeting', label: 'Meeting' },
  { value: 'call', label: 'Call' }
]

// Source type options
const SOURCE_TYPE_OPTIONS = [
  { value: 'asset', label: 'Asset', icon: TrendingUp },
  { value: 'portfolio', label: 'Portfolio', icon: Briefcase },
  { value: 'theme', label: 'Theme', icon: Tag },
  { value: 'custom', label: 'Custom', icon: Book }
]

export function NotesListPage({ onNoteSelect }: NotesListPageProps) {
  // Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedSourceTypes, setSelectedSourceTypes] = useState<string[]>([])
  const [selectedNoteTypes, setSelectedNoteTypes] = useState<string[]>([])
  const [sharedFilter, setSharedFilter] = useState<'all' | 'shared' | 'private'>('all')

  // Sort state
  const [sortBy, setSortBy] = useState('updated_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // UI state
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  // Fetch all notes
  const { data: notes, isLoading } = useQuery({
    queryKey: ['all-notes-with-users'],
    queryFn: async (): Promise<Note[]> => {
      const [assetNotesRes, portfolioNotesRes, themeNotesRes, customNotesRes] = await Promise.all([
        supabase
          .from('asset_notes')
          .select(`*, assets (id, symbol, company_name, sector, thesis, where_different, risks_to_thesis, priority, process_stage, created_at, updated_at)`)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('portfolio_notes')
          .select(`*, portfolios (id, name, description, portfolio_type, created_at, updated_at)`)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('theme_notes')
          .select(`*, themes (id, name, description, theme_type, color, thesis, where_different, risks_to_thesis, created_at, updated_at)`)
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('custom_notebook_notes')
          .select('*, custom_notebooks(name)')
          .neq('is_deleted', true)
          .order('updated_at', { ascending: false }),
      ])

      const allRaw: any[] = []
      if (assetNotesRes.data) {
        allRaw.push(
          ...assetNotesRes.data.map((n: any) => ({
            ...n,
            __source_type: 'asset' as SourceType,
            __source_name: n.assets?.symbol ?? 'Unknown Asset',
            __source_id: n.asset_id,
          })),
        )
      }
      if (portfolioNotesRes.data) {
        allRaw.push(
          ...portfolioNotesRes.data.map((n: any) => ({
            ...n,
            __source_type: 'portfolio' as SourceType,
            __source_name: n.portfolios?.name ?? 'Unknown Portfolio',
            __source_id: n.portfolio_id,
          })),
        )
      }
      if (themeNotesRes.data) {
        allRaw.push(
          ...themeNotesRes.data.map((n: any) => ({
            ...n,
            __source_type: 'theme' as SourceType,
            __source_name: n.themes?.name ?? 'Unknown Theme',
            __source_id: n.theme_id,
          })),
        )
      }
      if (customNotesRes.data) {
        allRaw.push(
          ...customNotesRes.data.map((n: any) => ({
            ...n,
            __source_type: 'custom' as SourceType,
            __source_name: n.custom_notebooks?.name ?? 'Unknown Notebook',
            __source_id: n.custom_notebook_id,
          })),
        )
      }

      // Collect unique user IDs to look up
      const userIds = Array.from(
        new Set(
          allRaw.flatMap((n) => [n.created_by, n.updated_by].filter(Boolean)) as string[],
        ),
      )

      // Batch fetch users
      const usersMap = new Map<string, UserLite>()
      if (userIds.length > 0) {
        const { data: usersData, error: usersErr } = await supabase
          .from('users')
          .select('id, email, first_name, last_name')
          .in('id', userIds)

        if (!usersErr && usersData) {
          usersData.forEach((u: any) => {
            usersMap.set(u.id, {
              id: u.id,
              email: u.email,
              first_name: u.first_name,
              last_name: u.last_name,
            })
          })
        }
      }

      // Build final typed notes
      const allNotes: Note[] = allRaw.map((n: any) => ({
        id: n.id,
        title: n.title ?? '',
        content: n.content ?? '',
        note_type: n.note_type ?? null,
        is_shared: !!n.is_shared,
        created_at: n.created_at,
        updated_at: n.updated_at,
        created_by: n.created_by ?? null,
        updated_by: n.updated_by ?? null,
        is_deleted: !!n.is_deleted,
        source_type: n.__source_type,
        source_name: n.__source_name,
        source_id: n.__source_id,
        created_by_user: n.created_by ? usersMap.get(n.created_by) : undefined,
        updated_by_user: n.updated_by ? usersMap.get(n.updated_by) : undefined,
        assets: n.assets,
        portfolios: n.portfolios,
        themes: n.themes,
      } as any))

      return allNotes
    },
  })

  // Helper functions
  const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return 'Unknown'
    try {
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) return 'Unknown'
      return formatDistanceToNow(date, { addSuffix: true })
    } catch {
      return 'Unknown'
    }
  }

  const capitalizeFirst = (str: string | null) => {
    if (!str) return ''
    return str.charAt(0).toUpperCase() + str.slice(1)
  }

  const getNoteTypeColor = (type: string | null) => {
    switch (type) {
      case 'meeting': return 'success'
      case 'call': return 'purple'
      case 'research': return 'warning'
      case 'idea': return 'error'
      case 'analysis': return 'primary'
      default: return 'default'
    }
  }

  const getSourceIcon = (sourceType: string) => {
    switch (sourceType) {
      case 'asset': return <TrendingUp className="h-4 w-4" />
      case 'portfolio': return <Briefcase className="h-4 w-4" />
      case 'theme': return <Tag className="h-4 w-4" />
      case 'custom': return <Book className="h-4 w-4" />
      default: return <FileText className="h-4 w-4" />
    }
  }

  const getSourceColor = (sourceType: string) => {
    switch (sourceType) {
      case 'asset': return 'text-blue-600 bg-blue-50'
      case 'portfolio': return 'text-green-600 bg-green-50'
      case 'theme': return 'text-amber-600 bg-amber-50'
      case 'custom': return 'text-gray-600 bg-gray-100'
      default: return 'text-gray-600 bg-gray-100'
    }
  }

  const getUserLabel = (user: UserLite | undefined, id: string | null | undefined) => {
    if (user?.first_name && user?.last_name) return `${user.first_name} ${user.last_name}`
    if (user?.email) return user.email.split('@')[0]
    if (id) return `User ${id.slice(0, 8)}`
    return 'Unknown'
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
    if (note.source_type === 'custom') return

    const entityId = note.source_id
    const entityName = note.source_name
    const entityType = note.source_type as 'asset' | 'portfolio' | 'theme'

    let entityData = null
    if (note.source_type === 'asset' && (note as any).assets) {
      entityData = (note as any).assets
    } else if (note.source_type === 'portfolio' && (note as any).portfolios) {
      entityData = (note as any).portfolios
    } else if (note.source_type === 'theme' && (note as any).themes) {
      entityData = (note as any).themes
    }

    if (entityId && entityData) {
      // Use entity-based tab ID so all notes for the same entity share a tab
      const tabId = `note-${entityType}-${entityId}`

      onNoteSelect?.({
        id: tabId,
        title: `Note - ${entityName}`,
        type: 'note',
        data: {
          id: note.id,  // The specific note to open
          entityType,
          entityId,
          entityName,
          ...(entityType === 'asset' && { assetId: entityId, assetSymbol: entityName, assets: entityData }),
          ...(entityType === 'portfolio' && { portfolioId: entityId, portfolioName: entityName, portfolios: entityData }),
          ...(entityType === 'theme' && { themeId: entityId, themeName: entityName, themes: entityData })
        }
      })
    }
  }

  // Filter toggle helpers
  const toggleSourceType = useCallback((type: string) => {
    setSelectedSourceTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
  }, [])

  const toggleNoteType = useCallback((type: string) => {
    setSelectedNoteTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
  }, [])

  // Build active filters array
  const activeFilters = useMemo(() => {
    const filters: { type: string; value: string; label: string }[] = []

    if (searchQuery) {
      filters.push({ type: 'search', value: searchQuery, label: `"${searchQuery}"` })
    }

    selectedSourceTypes.forEach(s => {
      const option = SOURCE_TYPE_OPTIONS.find(o => o.value === s)
      filters.push({ type: 'source', value: s, label: capitalizeFirst(option?.label || s) })
    })

    selectedNoteTypes.forEach(t => {
      const option = NOTE_TYPE_OPTIONS.find(o => o.value === t)
      filters.push({ type: 'noteType', value: t, label: capitalizeFirst(option?.label || t) })
    })

    if (sharedFilter !== 'all') {
      filters.push({ type: 'shared', value: sharedFilter, label: capitalizeFirst(sharedFilter) })
    }

    return filters
  }, [searchQuery, selectedSourceTypes, selectedNoteTypes, sharedFilter])

  const removeFilter = (type: string, value: string) => {
    switch (type) {
      case 'search':
        setSearchQuery('')
        break
      case 'source':
        setSelectedSourceTypes(prev => prev.filter(s => s !== value))
        break
      case 'noteType':
        setSelectedNoteTypes(prev => prev.filter(t => t !== value))
        break
      case 'shared':
        setSharedFilter('all')
        break
    }
  }

  const clearAllFilters = () => {
    setSearchQuery('')
    setSelectedSourceTypes([])
    setSelectedNoteTypes([])
    setSharedFilter('all')
  }

  // Filter and sort notes
  const filteredNotes = useMemo(() => {
    if (!notes) return []

    let filtered = notes.filter((note) => {
      const content = (note.content ?? '').toLowerCase()
      const title = (note.title ?? '').toLowerCase()
      const sourceName = (note.source_name ?? '').toLowerCase()

      const matchesSearch = !searchQuery ||
        title.includes(searchQuery.toLowerCase()) ||
        content.includes(searchQuery.toLowerCase()) ||
        sourceName.includes(searchQuery.toLowerCase())

      const matchesSource = selectedSourceTypes.length === 0 || selectedSourceTypes.includes(note.source_type)
      const matchesType = selectedNoteTypes.length === 0 || (note.note_type && selectedNoteTypes.includes(note.note_type))
      const matchesShared = sharedFilter === 'all' ||
        (sharedFilter === 'shared' && note.is_shared) ||
        (sharedFilter === 'private' && !note.is_shared)

      return matchesSearch && matchesSource && matchesType && matchesShared
    })

    filtered.sort((a, b) => {
      let aValue: string | number, bValue: string | number

      switch (sortBy) {
        case 'title':
          aValue = a.title || ''
          bValue = b.title || ''
          break
        case 'source_name':
          aValue = a.source_name || ''
          bValue = b.source_name || ''
          break
        case 'source_type':
          aValue = a.source_type
          bValue = b.source_type
          break
        case 'note_type':
          aValue = a.note_type || 'general'
          bValue = b.note_type || 'general'
          break
        case 'updated_at':
        default:
          aValue = new Date(a.updated_at || 0).getTime()
          bValue = new Date(b.updated_at || 0).getTime()
          break
      }

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortOrder === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue)
      }
      return sortOrder === 'asc' ? Number(aValue) - Number(bValue) : Number(bValue) - Number(aValue)
    })

    return filtered
  }, [notes, searchQuery, selectedSourceTypes, selectedNoteTypes, sharedFilter, sortBy, sortOrder])

  // Sort column header component
  const SortHeader = ({ field, children, className }: { field: string; children: React.ReactNode; className?: string }) => (
    <button
      onClick={() => handleSort(field)}
      className={clsx('flex items-center gap-1 hover:text-gray-700 transition-colors', className)}
    >
      {children}
      {sortBy === field ? (
        sortOrder === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
      ) : (
        <ArrowUp className="h-3.5 w-3.5 opacity-0 group-hover:opacity-30" />
      )}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">All Notes</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {filteredNotes.length} {filteredNotes.length === 1 ? 'note' : 'notes'}
            {activeFilters.length > 0 && ` (filtered)`}
          </p>
        </div>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Source Type Filter */}
        <div className="relative">
          <button
            onClick={() => setActiveFilter(activeFilter === 'source' ? null : 'source')}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors',
              selectedSourceTypes.length > 0
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-gray-300 hover:bg-gray-50'
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Source
            {selectedSourceTypes.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary-100 rounded-full">
                {selectedSourceTypes.length}
              </span>
            )}
          </button>

          {activeFilter === 'source' && (
            <div className="absolute top-full left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              {SOURCE_TYPE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => toggleSourceType(option.value)}
                  className="w-full px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-gray-50"
                >
                  <span className="flex items-center gap-2">
                    <option.icon className="h-4 w-4 text-gray-500" />
                    {option.label}
                  </span>
                  {selectedSourceTypes.includes(option.value) && (
                    <Check className="h-4 w-4 text-primary-600" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Note Type Filter */}
        <div className="relative">
          <button
            onClick={() => setActiveFilter(activeFilter === 'type' ? null : 'type')}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors',
              selectedNoteTypes.length > 0
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-gray-300 hover:bg-gray-50'
            )}
          >
            <FileText className="h-4 w-4" />
            Type
            {selectedNoteTypes.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary-100 rounded-full">
                {selectedNoteTypes.length}
              </span>
            )}
          </button>

          {activeFilter === 'type' && (
            <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              {NOTE_TYPE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  onClick={() => toggleNoteType(option.value)}
                  className="w-full px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-gray-50"
                >
                  {option.label}
                  {selectedNoteTypes.includes(option.value) && (
                    <Check className="h-4 w-4 text-primary-600" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sharing Filter */}
        <div className="relative">
          <button
            onClick={() => setActiveFilter(activeFilter === 'shared' ? null : 'shared')}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors',
              sharedFilter !== 'all'
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-gray-300 hover:bg-gray-50'
            )}
          >
            <Share2 className="h-4 w-4" />
            Sharing
          </button>

          {activeFilter === 'shared' && (
            <div className="absolute top-full left-0 mt-1 w-32 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
              {['all', 'shared', 'private'].map(option => (
                <button
                  key={option}
                  onClick={() => { setSharedFilter(option as any); setActiveFilter(null) }}
                  className="w-full px-3 py-2 text-sm text-left flex items-center justify-between hover:bg-gray-50"
                >
                  {capitalizeFirst(option)}
                  {sharedFilter === option && (
                    <Check className="h-4 w-4 text-primary-600" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Filters */}
      {activeFilters.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-gray-500">Active filters:</span>
          {activeFilters.map((filter, idx) => (
            <span
              key={`${filter.type}-${filter.value}-${idx}`}
              className="inline-flex items-center gap-1 px-2.5 py-1 bg-primary-50 text-primary-700 text-sm rounded-full"
            >
              {filter.label}
              <button
                onClick={() => removeFilter(filter.type, filter.value)}
                className="hover:text-primary-900"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <button
            onClick={clearAllFilters}
            className="text-sm text-gray-500 hover:text-gray-700 ml-2"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Notes Table */}
      <Card padding="none">
        {isLoading ? (
          <div className="p-6">
            <ListSkeleton count={8} />
          </div>
        ) : filteredNotes.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[35%]">
                    <SortHeader field="title">Note</SortHeader>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[12%]">
                    <SortHeader field="source_type">Source</SortHeader>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[15%]">
                    <SortHeader field="source_name">Name</SortHeader>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[10%]">
                    <SortHeader field="note_type">Type</SortHeader>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[8%]">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[20%]">
                    <SortHeader field="updated_at">Updated</SortHeader>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredNotes.map((note) => (
                  <tr
                    key={`${note.source_type}-${note.id}`}
                    onClick={() => handleNoteClick(note)}
                    className="group hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    {/* Note Title & Preview */}
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-primary-100 transition-colors">
                          <FileText className="h-4 w-4 text-gray-500 group-hover:text-primary-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 truncate group-hover:text-primary-700">
                            {note.title || 'Untitled'}
                          </p>
                          <p className="text-sm text-gray-500 line-clamp-1 mt-0.5">
                            {getContentPreview(note.content || '', 80)}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Source Type */}
                    <td className="px-4 py-3">
                      <span className={clsx(
                        'inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
                        getSourceColor(note.source_type)
                      )}>
                        {getSourceIcon(note.source_type)}
                        {capitalizeFirst(note.source_type)}
                      </span>
                    </td>

                    {/* Source Name */}
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-700 font-medium">
                        {note.source_name}
                      </span>
                    </td>

                    {/* Note Type */}
                    <td className="px-4 py-3">
                      {note.note_type && (
                        <Badge variant={getNoteTypeColor(note.note_type)} size="sm">
                          {capitalizeFirst(note.note_type)}
                        </Badge>
                      )}
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      {note.is_shared ? (
                        <span className="inline-flex items-center gap-1 text-xs text-primary-600">
                          <Share2 className="h-3 w-3" />
                          Shared
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Private</span>
                      )}
                    </td>

                    {/* Updated */}
                    <td className="px-4 py-3">
                      <div className="text-sm text-gray-500">
                        {formatDate(note.updated_at)}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        by {getUserLabel(note.updated_by_user, note.updated_by)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : notes?.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No notes yet"
            description="Start by creating your first note in an asset, portfolio, or theme."
          />
        ) : (
          <EmptyState
            icon={Search}
            title="No notes match your filters"
            description="Try adjusting your search criteria or clearing filters."
            action={{
              label: 'Clear Filters',
              onClick: clearAllFilters
            }}
          />
        )}
      </Card>

      {/* Close filter dropdown when clicking outside */}
      {activeFilter && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setActiveFilter(null)}
        />
      )}
    </div>
  )
}
