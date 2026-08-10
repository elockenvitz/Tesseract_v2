import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  FolderOpen, Search, Filter, Plus, Upload, Download, Trash2,
  File, FileText, FileSpreadsheet, FileImage, FileVideo, FileArchive,
  Grid, List, MoreHorizontal, Clock, User, Tag, Star, StarOff,
  ChevronRight, Folder, Eye, Edit2, Share2, Link2, HardDrive
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { formatDistanceToNow } from 'date-fns'

interface FilesPageProps {
  onItemSelect?: (item: any) => void
}

interface FileItem {
  id: string
  name: string
  file_type: 'document' | 'spreadsheet' | 'model' | 'presentation' | 'image' | 'video' | 'archive' | 'other'
  category: 'models' | 'documents' | 'templates' | 'reports' | 'presentations' | 'data' | 'other'
  description?: string
  file_size?: number
  file_url?: string
  mime_type?: string
  tags?: string[]
  is_starred?: boolean
  created_by: string
  created_at: string
  updated_at: string
  user?: {
    first_name: string
    last_name: string
  }
}

type ViewMode = 'grid' | 'list'
type CategoryFilter = 'all' | 'models' | 'documents' | 'templates' | 'reports' | 'presentations' | 'data' | 'other'

/**
 * Selected-chip styling per category, written as whole class names.
 *
 * Tailwind generates classes by scanning source text for literal matches, so
 * a name assembled at runtime (`bg-${color}-50`) is never emitted. Keep these
 * spelled out — the moment one is interpolated it silently renders as nothing.
 */
const CATEGORY_TONES: Record<string, { active: string; icon: string; badge: string }> = {
  purple: { active: 'bg-purple-50 border-purple-200 text-purple-700 dark:bg-purple-900/20 dark:border-purple-800 dark:text-purple-300', icon: 'text-purple-500', badge: 'bg-purple-100 dark:bg-purple-900/40' },
  blue:   { active: 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300',           icon: 'text-blue-500',   badge: 'bg-blue-100 dark:bg-blue-900/40' },
  green:  { active: 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300',     icon: 'text-green-500',  badge: 'bg-green-100 dark:bg-green-900/40' },
  orange: { active: 'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-900/20 dark:border-orange-800 dark:text-orange-300', icon: 'text-orange-500', badge: 'bg-orange-100 dark:bg-orange-900/40' },
  cyan:   { active: 'bg-cyan-50 border-cyan-200 text-cyan-700 dark:bg-cyan-900/20 dark:border-cyan-800 dark:text-cyan-300',           icon: 'text-cyan-500',   badge: 'bg-cyan-100 dark:bg-cyan-900/40' },
  gray:   { active: 'bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300',             icon: 'text-gray-500',   badge: 'bg-gray-200 dark:bg-gray-700' },
}

export function FilesPage({ onItemSelect }: FilesPageProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())

  // Query files from database (placeholder - table needs to be created)
  const { data: files = [], isLoading } = useQuery({
    queryKey: ['files', categoryFilter],
    queryFn: async () => {
      // TODO: Implement once files table is created
      // For now, return empty array
      return [] as FileItem[]
    }
  })

  const filteredFiles = files.filter(file => {
    if (categoryFilter !== 'all' && file.category !== categoryFilter) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        file.name.toLowerCase().includes(query) ||
        file.description?.toLowerCase().includes(query) ||
        file.tags?.some(tag => tag.toLowerCase().includes(query))
      )
    }
    return true
  })

  const getFileIcon = (fileType: string) => {
    switch (fileType) {
      case 'document':
        return <FileText className="w-5 h-5 text-blue-500" />
      case 'spreadsheet':
        return <FileSpreadsheet className="w-5 h-5 text-green-500" />
      case 'model':
        return <FileSpreadsheet className="w-5 h-5 text-purple-500" />
      case 'presentation':
        return <FileText className="w-5 h-5 text-orange-500" />
      case 'image':
        return <FileImage className="w-5 h-5 text-pink-500" />
      case 'video':
        return <FileVideo className="w-5 h-5 text-red-500" />
      case 'archive':
        return <FileArchive className="w-5 h-5 text-yellow-500" />
      default:
        return <File className="w-5 h-5 text-gray-500 dark:text-gray-400" />
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'models':
        return 'bg-purple-100 text-purple-700'
      case 'documents':
        return 'bg-blue-100 text-blue-700'
      case 'templates':
        return 'bg-green-100 text-green-700'
      case 'reports':
        return 'bg-orange-100 text-orange-700'
      case 'presentations':
        return 'bg-pink-100 text-pink-700'
      case 'data':
        return 'bg-cyan-100 text-cyan-700'
      default:
        return 'bg-gray-100 text-gray-700 dark:text-gray-300 dark:bg-gray-800'
    }
  }

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const categoryStats = [
    { id: 'models', label: 'Models', icon: FileSpreadsheet, color: 'purple', count: files.filter(f => f.category === 'models').length },
    { id: 'documents', label: 'Documents', icon: FileText, color: 'blue', count: files.filter(f => f.category === 'documents').length },
    { id: 'templates', label: 'Templates', icon: File, color: 'green', count: files.filter(f => f.category === 'templates').length },
    { id: 'reports', label: 'Reports', icon: FileText, color: 'orange', count: files.filter(f => f.category === 'reports').length },
    { id: 'data', label: 'Data Files', icon: FileSpreadsheet, color: 'cyan', count: files.filter(f => f.category === 'data').length },
  ]

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-3 sm:px-6 py-4 dark:border-gray-700 dark:bg-gray-800">
        {/* Identity and actions wrap; the standing description is desktop-only
            — it explains the page once and costs a line of every visit. */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3 sm:mb-4">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="p-2 bg-violet-100 rounded-lg shrink-0">
              <FolderOpen className="w-5 h-5 text-violet-600" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">Files</h1>
              <p className="hidden sm:block text-sm text-gray-500 dark:text-gray-400">Central repository for models, documents, and resources</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="outline" onClick={() => setShowUploadModal(true)}>
              <Upload className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">Upload</span>
            </Button>
            <Button onClick={() => setShowUploadModal(true)}>
              <Plus className="w-4 h-4 sm:mr-2" />
              <span className="hidden sm:inline">New Folder</span>
            </Button>
          </div>
        </div>

        {/* Category Quick Stats — the primary filter on a phone, where the
            select below is a second-class control.

            The selected state used to be built as `bg-${cat.color}-50`. Tailwind
            scans source text for complete class names, so an interpolated one
            is never generated and the selected chip rendered with no background
            at all — the row gave no indication of which category was active.
            The classes are looked up whole now. */}
        <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4 overflow-x-auto no-scrollbar pb-1.5">
          {categoryStats.map(cat => {
            const Icon = cat.icon
            const tone = CATEGORY_TONES[cat.color] ?? CATEGORY_TONES.gray
            const isActive = categoryFilter === cat.id
            return (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id as CategoryFilter)}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border transition-colors flex-shrink-0 whitespace-nowrap ${
                  isActive
                    ? tone.active
                    : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 dark:border-gray-700 dark:text-gray-400 dark:bg-gray-800'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${tone.icon}`} />
                <span className="text-sm font-medium">{cat.label}</span>
                <span className={`px-1.5 py-0.5 text-xs font-medium rounded-full ${
                  isActive ? tone.badge : 'bg-gray-100 dark:bg-gray-800'
                }`}>
                  {cat.count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Filters & Search. A category select, a view switch and a 256px
            search field come to ~470px, so search drops to its own full-width
            line on a phone. */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Category Filter */}
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
              className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700"
            >
              <option value="all">All Categories</option>
              <option value="models">Models</option>
              <option value="documents">Documents</option>
              <option value="templates">Templates</option>
              <option value="reports">Reports</option>
              <option value="presentations">Presentations</option>
              <option value="data">Data Files</option>
              <option value="other">Other</option>
            </select>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1 dark:bg-gray-800">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white shadow-sm dark:bg-gray-800' : 'hover:bg-gray-200'}`}
              >
                <Grid className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white shadow-sm dark:bg-gray-800' : 'hover:bg-gray-200'}`}
              >
                <List className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-1.5 text-sm border border-gray-200 rounded-lg w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:border-gray-700"
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 sm:p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <div className="p-4 bg-gray-100 rounded-full mb-4 dark:bg-gray-800">
              <HardDrive className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1 dark:text-white">No files yet</h3>
            <p className="text-sm text-gray-500 mb-4 dark:text-gray-400">
              Upload files or create folders to organize your resources
            </p>
            <div className="flex items-center space-x-3">
              <Button variant="outline" onClick={() => setShowUploadModal(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Files
              </Button>
              <Button onClick={() => setShowUploadModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                New Folder
              </Button>
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredFiles.map(file => (
              <Card
                key={file.id}
                className="p-4 cursor-pointer hover:shadow-md transition-shadow group"
                onClick={() => onItemSelect?.(file)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="p-3 bg-gray-100 rounded-lg dark:bg-gray-800">
                    {getFileIcon(file.file_type)}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      // Toggle star
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-100 rounded transition-opacity dark:hover:bg-gray-700"
                  >
                    {file.is_starred ? (
                      <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    ) : (
                      <StarOff className="w-4 h-4 text-gray-400" />
                    )}
                  </button>
                </div>

                <h3 className="font-medium text-gray-900 text-sm truncate mb-1 dark:text-white" title={file.name}>
                  {file.name}
                </h3>

                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>{formatFileSize(file.file_size)}</span>
                  <span className={`px-1.5 py-0.5 rounded ${getCategoryColor(file.category)}`}>
                    {file.category}
                  </span>
                </div>

                <div className="flex items-center mt-2 text-xs text-gray-400">
                  <Clock className="w-3 h-3 mr-1" />
                  {formatDistanceToNow(new Date(file.updated_at), { addSuffix: true })}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200 dark:border-gray-700 dark:bg-gray-900">
                <tr>
                  {/* Category, size and modified collapse below `sm` and
                      reappear under the file name instead — five columns of
                      metadata do not compress to 390px, and a filename is the
                      one thing you are actually scanning for. */}
                  <th className="px-3 sm:px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Name</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Category</th>
                  <th className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Size</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Modified</th>
                  <th className="px-3 sm:px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider dark:text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {filteredFiles.map(file => (
                  <tr
                    key={file.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => onItemSelect?.(file)}
                  >
                    <td className="px-3 sm:px-4 py-3">
                      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                        <span className="shrink-0">{getFileIcon(file.file_type)}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{file.name}</p>
                          {file.description && (
                            <p className="text-xs text-gray-500 truncate max-w-xs dark:text-gray-400">{file.description}</p>
                          )}
                          {/* The collapsed columns, folded under the name */}
                          <p className="sm:hidden mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-400">
                            <span className={`px-1.5 py-0.5 rounded font-medium ${getCategoryColor(file.category)}`}>
                              {file.category}
                            </span>
                            <span>{formatFileSize(file.file_size)}</span>
                            <span>·</span>
                            <span className="truncate">
                              {formatDistanceToNow(new Date(file.updated_at), { addSuffix: true })}
                            </span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3">
                      <span className={`px-2 py-0.5 text-xs font-medium rounded ${getCategoryColor(file.category)}`}>
                        {file.category}
                      </span>
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {formatFileSize(file.file_size)}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                      {formatDistanceToNow(new Date(file.updated_at), { addSuffix: true })}
                    </td>
                    <td className="px-3 sm:px-4 py-3 text-right align-top sm:align-middle">
                      <div className="flex items-center justify-end gap-1 sm:gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            // Download file
                          }}
                          className="p-1 hover:bg-gray-100 rounded dark:hover:bg-gray-700"
                        >
                          <Download className="w-4 h-4 text-gray-400" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            // Share file
                          }}
                          className="p-1 hover:bg-gray-100 rounded dark:hover:bg-gray-700"
                        >
                          <Share2 className="w-4 h-4 text-gray-400" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            // More options
                          }}
                          className="p-1 hover:bg-gray-100 rounded dark:hover:bg-gray-700"
                        >
                          <MoreHorizontal className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {/* Upload Modal - Placeholder */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowUploadModal(false)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-3 sm:p-6 dark:bg-gray-800">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 dark:text-white">Upload Files</h2>

              {/* Drop Zone */}
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 sm:p-8 text-center hover:border-violet-400 transition-colors cursor-pointer dark:border-gray-600">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-sm font-medium text-gray-700 mb-1 dark:text-gray-300">
                  Drag and drop files here, or click to browse
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Supports: Excel, PDF, Word, Images, and more
                </p>
              </div>

              <p className="text-sm text-gray-500 mt-4 dark:text-gray-400">
                This feature is coming soon. You'll be able to upload and manage files here.
              </p>

              <div className="flex justify-end mt-6">
                <Button variant="outline" onClick={() => setShowUploadModal(false)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
