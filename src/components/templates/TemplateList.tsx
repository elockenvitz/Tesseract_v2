import { useState, useMemo } from 'react'
import {
  Search,
  Star,
  Clock,
  User,
  Users,
  FileText,
  Copy,
  Edit2,
  Trash2,
  Share2,
  MoreHorizontal,
  X,
  Check,
  Loader2,
  Filter,
  ChevronDown,
  Eye
} from 'lucide-react'
import { clsx } from 'clsx'
import { Template } from '../../hooks/useTemplates'
import { useTemplateTags } from '../../hooks/useTemplateTags'
import { Button } from '../ui/Button'

interface TemplateListProps {
  templates: Template[]
  recentlyUsed: Template[]
  favorites: Template[]
  isLoading?: boolean
  onEdit: (template: Template) => void
  onDelete: (template: Template) => void
  onShare: (template: Template) => void
  onCopy: (template: Template) => void
  onToggleFavorite: (template: Template) => void
  onUse: (template: Template) => void
  onPreview: (template: Template) => void
  currentUserId?: string
}

interface FilterState {
  category: string
  tagIds: string[]
  showOnlyMine: boolean
  showOnlyShared: boolean
  showOnlyFavorites: boolean
}

const CATEGORIES = [
  { id: '', label: 'All Categories' },
  { id: 'general', label: 'General' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'meeting', label: 'Meeting Notes' },
  { id: 'report', label: 'Reports' },
  { id: 'email', label: 'Email' },
  { id: 'research', label: 'Research' },
]

export function TemplateList({
  templates,
  recentlyUsed,
  favorites,
  isLoading,
  onEdit,
  onDelete,
  onShare,
  onCopy,
  onToggleFavorite,
  onUse,
  onPreview,
  currentUserId
}: TemplateListProps) {
  const { tags } = useTemplateTags()
  const [searchQuery, setSearchQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<FilterState>({
    category: '',
    tagIds: [],
    showOnlyMine: false,
    showOnlyShared: false,
    showOnlyFavorites: false
  })
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Filter and search templates
  const filteredTemplates = useMemo(() => {
    let results = templates

    // Text search
    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase()
      results = results.filter(t =>
        t.name.toLowerCase().includes(lowerQuery) ||
        t.content.toLowerCase().includes(lowerQuery) ||
        t.description?.toLowerCase().includes(lowerQuery) ||
        t.shortcut?.toLowerCase().includes(lowerQuery)
      )
    }

    // Category filter
    if (filters.category) {
      results = results.filter(t => t.category === filters.category)
    }

    // Tag filter
    if (filters.tagIds.length > 0) {
      results = results.filter(t =>
        filters.tagIds.some(tagId => t.tags?.some(tag => tag.id === tagId))
      )
    }

    // Ownership filters
    if (filters.showOnlyMine) {
      results = results.filter(t => t.user_id === currentUserId)
    }
    if (filters.showOnlyShared) {
      results = results.filter(t => t.user_id !== currentUserId)
    }
    if (filters.showOnlyFavorites) {
      results = results.filter(t => t.is_favorite)
    }

    return results
  }, [templates, searchQuery, filters, currentUserId])

  const hasActiveFilters = filters.category ||
    filters.tagIds.length > 0 ||
    filters.showOnlyMine ||
    filters.showOnlyShared ||
    filters.showOnlyFavorites

  const clearFilters = () => {
    setFilters({
      category: '',
      tagIds: [],
      showOnlyMine: false,
      showOnlyShared: false,
      showOnlyFavorites: false
    })
  }

  const toggleTagFilter = (tagId: string) => {
    setFilters(prev => ({
      ...prev,
      tagIds: prev.tagIds.includes(tagId)
        ? prev.tagIds.filter(id => id !== tagId)
        : [...prev.tagIds, tagId]
    }))
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Search and Filters */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          onClick={() => setShowFilters(!showFilters)}
          className={clsx(
            'flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors',
            showFilters || hasActiveFilters
              ? 'border-primary-300 bg-primary-50 text-primary-700'
              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
          )}
        >
          <Filter className="w-4 h-4" />
          Filters
          {hasActiveFilters && (
            <span className="w-5 h-5 bg-primary-600 text-white text-xs rounded-full flex items-center justify-center">
              {(filters.category ? 1 : 0) +
                filters.tagIds.length +
                (filters.showOnlyMine ? 1 : 0) +
                (filters.showOnlyShared ? 1 : 0) +
                (filters.showOnlyFavorites ? 1 : 0)}
            </span>
          )}
          <ChevronDown className={clsx('w-4 h-4 transition-transform', showFilters && 'rotate-180')} />
        </button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium text-gray-700">Filter Templates</h4>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="text-sm text-primary-600 hover:text-primary-700"
              >
                Clear all
              </button>
            )}
          </div>

          <div className="grid grid-cols-4 gap-4">
            {/* Category */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
              <select
                value={filters.category}
                onChange={(e) => setFilters(prev => ({ ...prev, category: e.target.value }))}
                className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded"
              >
                {CATEGORIES.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.label}</option>
                ))}
              </select>
            </div>

            {/* Quick Filters */}
            <div className="col-span-3 flex items-end gap-2 flex-wrap">
              <button
                onClick={() => setFilters(prev => ({ ...prev, showOnlyMine: !prev.showOnlyMine, showOnlyShared: false }))}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-lg border transition-colors flex items-center gap-1.5',
                  filters.showOnlyMine
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-gray-300 hover:bg-gray-50'
                )}
              >
                <User className="w-3.5 h-3.5" />
                My Templates
              </button>
              <button
                onClick={() => setFilters(prev => ({ ...prev, showOnlyShared: !prev.showOnlyShared, showOnlyMine: false }))}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-lg border transition-colors flex items-center gap-1.5',
                  filters.showOnlyShared
                    ? 'border-primary-300 bg-primary-50 text-primary-700'
                    : 'border-gray-300 hover:bg-gray-50'
                )}
              >
                <Users className="w-3.5 h-3.5" />
                Shared
              </button>
              <button
                onClick={() => setFilters(prev => ({ ...prev, showOnlyFavorites: !prev.showOnlyFavorites }))}
                className={clsx(
                  'px-3 py-1.5 text-sm rounded-lg border transition-colors flex items-center gap-1.5',
                  filters.showOnlyFavorites
                    ? 'border-yellow-300 bg-yellow-50 text-yellow-700'
                    : 'border-gray-300 hover:bg-gray-50'
                )}
              >
                <Star className="w-3.5 h-3.5" />
                Favorites
              </button>
            </div>
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Tags</label>
              <div className="flex flex-wrap gap-1.5">
                {tags.map(tag => (
                  <button
                    key={tag.id}
                    onClick={() => toggleTagFilter(tag.id)}
                    className={clsx(
                      'px-2 py-1 text-xs rounded-full transition-colors',
                      filters.tagIds.includes(tag.id)
                        ? 'text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    )}
                    style={filters.tagIds.includes(tag.id) ? { backgroundColor: tag.color } : undefined}
                  >
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Recently Used */}
      {!searchQuery && !hasActiveFilters && recentlyUsed.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Recently Used
          </h4>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {recentlyUsed.slice(0, 5).map(template => (
              <button
                key={template.id}
                onClick={() => onUse(template)}
                className="flex-shrink-0 px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg text-left transition-colors"
              >
                <p className="text-sm font-medium text-gray-900 truncate max-w-[150px]">
                  {template.name}
                </p>
                {template.shortcut && (
                  <p className="text-xs text-gray-500 font-mono">.t.{template.shortcut}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Favorites */}
      {!searchQuery && !hasActiveFilters && favorites.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Star className="w-4 h-4 text-yellow-500" />
            Favorites
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {favorites.slice(0, 4).map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                isOwner={template.user_id === currentUserId}
                onEdit={() => onEdit(template)}
                onDelete={() => setDeleteConfirm(template.id)}
                onShare={() => onShare(template)}
                onCopy={() => onCopy(template)}
                onToggleFavorite={() => onToggleFavorite(template)}
                onUse={() => onUse(template)}
                onPreview={() => onPreview(template)}
                isDeleting={deleteConfirm === template.id}
                onConfirmDelete={() => {
                  onDelete(template)
                  setDeleteConfirm(null)
                }}
                onCancelDelete={() => setDeleteConfirm(null)}
                compact
              />
            ))}
          </div>
        </div>
      )}

      {/* All Templates */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-gray-700">
          {searchQuery || hasActiveFilters ? 'Results' : 'All Templates'} ({filteredTemplates.length})
        </h4>

        {filteredTemplates.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {searchQuery || hasActiveFilters ? (
              <p>No templates match your search or filters</p>
            ) : (
              <p>No templates yet. Create one to get started!</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                isOwner={template.user_id === currentUserId}
                onEdit={() => onEdit(template)}
                onDelete={() => setDeleteConfirm(template.id)}
                onShare={() => onShare(template)}
                onCopy={() => onCopy(template)}
                onToggleFavorite={() => onToggleFavorite(template)}
                onUse={() => onUse(template)}
                onPreview={() => onPreview(template)}
                isDeleting={deleteConfirm === template.id}
                onConfirmDelete={() => {
                  onDelete(template)
                  setDeleteConfirm(null)
                }}
                onCancelDelete={() => setDeleteConfirm(null)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface TemplateCardProps {
  template: Template
  isOwner: boolean
  onEdit: () => void
  onDelete: () => void
  onShare: () => void
  onCopy: () => void
  onToggleFavorite: () => void
  onUse: () => void
  onPreview: () => void
  isDeleting: boolean
  onConfirmDelete: () => void
  onCancelDelete: () => void
  compact?: boolean
}

function TemplateCard({
  template,
  isOwner,
  onEdit,
  onDelete,
  onShare,
  onCopy,
  onToggleFavorite,
  onUse,
  onPreview,
  isDeleting,
  onConfirmDelete,
  onCancelDelete,
  compact
}: TemplateCardProps) {
  const [showMenu, setShowMenu] = useState(false)
  const categoryLabel = CATEGORIES.find(c => c.id === template.category)?.label || template.category

  if (compact) {
    return (
      <div
        className={clsx(
          'p-3 border rounded-lg cursor-pointer transition-colors',
          isDeleting ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        )}
        onClick={onUse}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-900 truncate text-sm">{template.name}</span>
              {template.is_favorite && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500 flex-shrink-0" />}
            </div>
            {template.shortcut && (
              <span className="text-xs text-gray-500 font-mono">.t.{template.shortcut}</span>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={clsx(
      'p-3 border rounded-lg',
      isDeleting ? 'border-red-300 bg-red-50' : 'border-gray-200 hover:border-gray-300'
    )}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="font-medium text-gray-900">{template.name}</span>
            <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
              {categoryLabel}
            </span>
            {template.shortcut && (
              <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded font-mono">
                .t.{template.shortcut}
              </span>
            )}
            {!isOwner && (
              <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded flex items-center gap-1">
                <Share2 className="w-3 h-3" />
                Shared
              </span>
            )}
          </div>

          {/* Tags */}
          {template.tags && template.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {template.tags.map(tag => (
                <span
                  key={tag.id}
                  className="px-2 py-0.5 text-xs rounded-full text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 ml-2">
          {isDeleting ? (
            <>
              <button
                onClick={onConfirmDelete}
                className="p-1.5 text-red-600 hover:bg-red-100 rounded"
                title="Confirm delete"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={onCancelDelete}
                className="p-1.5 text-gray-600 hover:bg-gray-100 rounded"
                title="Cancel"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onPreview}
                className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-gray-100 rounded"
                title="Preview template"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                onClick={onToggleFavorite}
                className={clsx(
                  'p-1.5 rounded transition-colors',
                  template.is_favorite
                    ? 'text-yellow-500 hover:bg-yellow-50'
                    : 'text-gray-400 hover:text-yellow-500 hover:bg-gray-100'
                )}
                title={template.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <Star className={clsx('w-4 h-4', template.is_favorite && 'fill-yellow-500')} />
              </button>
              <button
                onClick={onCopy}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                title="Copy content"
              >
                <Copy className="w-4 h-4" />
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {showMenu && (
                  <>
                    <div className="fixed inset-0" onClick={() => setShowMenu(false)} />
                    <div className="absolute right-0 mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
                      <button
                        onClick={() => {
                          onUse()
                          setShowMenu(false)
                        }}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <FileText className="w-4 h-4" />
                        Use Template
                      </button>
                      {isOwner && (
                        <>
                          <button
                            onClick={() => {
                              onEdit()
                              setShowMenu(false)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Edit2 className="w-4 h-4" />
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              onShare()
                              setShowMenu(false)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Share2 className="w-4 h-4" />
                            Share
                          </button>
                          <hr className="my-1" />
                          <button
                            onClick={() => {
                              onDelete()
                              setShowMenu(false)
                            }}
                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {template.usage_count > 0 && (
        <p className="text-xs text-gray-400 mt-2">
          Used {template.usage_count} time{template.usage_count !== 1 ? 's' : ''}
          {template.last_used_at && (
            <> - Last used {new Date(template.last_used_at).toLocaleDateString()}</>
          )}
        </p>
      )}
    </div>
  )
}
