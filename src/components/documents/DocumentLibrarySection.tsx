import React, { useState, useMemo } from 'react'
import {
  ChevronDown,
  ChevronUp,
  FileText,
  FileSpreadsheet,
  File,
  Image,
  Presentation,
  Link2,
  Plus,
  Upload,
  Edit3,
  RefreshCw,
  X,
  Download,
  ExternalLink,
  MoreHorizontal,
  Share2,
  FolderOpen,
  FileDown,
  ArrowRight
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ExternalLinkModal } from '../notes/ExternalLinkModal'
import { BulkExcelImporter } from '../outcomes/BulkExcelImporter'
import { useAssetModels, AssetModel } from '../../hooks/useAssetModels'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'

// Unified document type
export interface Document {
  id: string
  type: 'note' | 'model'
  title: string
  sourceType: 'platform' | 'written' | 'uploaded' | 'external_link'
  fileType?: string // mime type or extension
  fileName?: string
  fileSize?: number
  externalUrl?: string
  externalProvider?: string
  isShared: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  // Original data
  originalNote?: any
  originalModel?: AssetModel
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

// Note type from props (matches CompactNote)
interface NoteData {
  id: string
  title: string
  content: string
  source_type: 'platform' | 'written' | 'uploaded' | 'external_link'
  file_path?: string
  file_name?: string
  file_size?: number
  file_type?: string
  external_url?: string
  external_provider?: string
  is_shared: boolean
  created_by: string
  created_at: string
  updated_at: string
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

type DocumentFilter = 'all' | 'notes' | 'excel' | 'pdf' | 'powerpoint' | 'word' | 'images' | 'external'

interface DocumentLibrarySectionProps {
  assetId: string
  notes: NoteData[]
  researchViewFilter: string
  isExpanded: boolean
  onToggleExpanded: () => void
  onNoteClick?: (noteId: string) => void
  onCreateNote?: () => void
  onViewAllNotes?: () => void
  onViewAllFiles?: () => void
  /** When true, renders without Card wrapper and header (for embedding in other sections) */
  isEmbedded?: boolean
}

const FILTER_OPTIONS: { value: DocumentFilter; label: string; icon: React.ElementType }[] = [
  { value: 'all', label: 'All', icon: FolderOpen },
  { value: 'notes', label: 'Notes', icon: Edit3 },
  { value: 'excel', label: 'Excel', icon: FileSpreadsheet },
  { value: 'pdf', label: 'PDF', icon: File },
  { value: 'powerpoint', label: 'PPT', icon: Presentation },
  { value: 'word', label: 'Word', icon: FileText },
  { value: 'images', label: 'Images', icon: Image },
  { value: 'external', label: 'Links', icon: Link2 },
]

function getDocumentIcon(doc: Document) {
  if (doc.sourceType === 'external_link') return Link2
  if (doc.sourceType === 'platform' || doc.sourceType === 'written') return Edit3

  const fileType = doc.fileType?.toLowerCase() || ''
  const fileName = doc.fileName?.toLowerCase() || ''

  if (fileType.includes('spreadsheet') || fileType.includes('excel') ||
      fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
    return FileSpreadsheet
  }
  if (fileType.includes('pdf') || fileName.endsWith('.pdf')) {
    return File
  }
  if (fileType.includes('presentation') || fileType.includes('powerpoint') ||
      fileName.endsWith('.pptx') || fileName.endsWith('.ppt')) {
    return Presentation
  }
  if (fileType.includes('word') || fileType.includes('document') ||
      fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    return FileText
  }
  if (fileType.includes('image') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fileName)) {
    return Image
  }

  return File
}

function getDocumentCategory(doc: Document): DocumentFilter {
  if (doc.sourceType === 'external_link') return 'external'
  // Platform-created and written notes go to 'notes' category
  if (doc.sourceType === 'platform' || doc.sourceType === 'written') return 'notes'

  const fileType = doc.fileType?.toLowerCase() || ''
  const fileName = doc.fileName?.toLowerCase() || ''

  if (fileType.includes('spreadsheet') || fileType.includes('excel') ||
      fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
    return 'excel'
  }
  if (fileType.includes('pdf') || fileName.endsWith('.pdf')) {
    return 'pdf'
  }
  if (fileType.includes('presentation') || fileType.includes('powerpoint') ||
      fileName.endsWith('.pptx') || fileName.endsWith('.ppt')) {
    return 'powerpoint'
  }
  if (fileType.includes('word') || fileType.includes('document') ||
      fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
    return 'word'
  }
  if (fileType.includes('image') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fileName)) {
    return 'images'
  }

  return 'all'
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays} days ago`

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function DocumentLibrarySection({
  assetId,
  notes,
  researchViewFilter,
  isExpanded,
  onToggleExpanded,
  onNoteClick,
  onCreateNote,
  onViewAllNotes,
  onViewAllFiles,
  isEmbedded = false
}: DocumentLibrarySectionProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Models hook
  const {
    models,
    isLoading: modelsLoading,
    uploadModel,
    createModel,
    getDownloadUrl,
    isUploading
  } = useAssetModels(assetId)

  // UI State
  const [filter, setFilter] = useState<DocumentFilter>('all')
  const [displayCount, setDisplayCount] = useState(6)
  const [showAddDropdown, setShowAddDropdown] = useState(false)
  const [showExternalModal, setShowExternalModal] = useState(false)
  const [showExcelSyncModal, setShowExcelSyncModal] = useState(false)
  const [isUploading_, setIsUploading] = useState(false)
  const [isCreatingExternal, setIsCreatingExternal] = useState(false)
  const [exportDropdownId, setExportDropdownId] = useState<string | null>(null)

  // Unify notes and models into documents
  const allDocuments = useMemo(() => {
    const docs: Document[] = []

    // Add notes
    if (notes) {
      notes.forEach(note => {
        docs.push({
          id: note.id,
          type: 'note',
          title: note.title,
          sourceType: note.source_type,
          fileType: note.file_type,
          fileName: note.file_name,
          fileSize: note.file_size,
          externalUrl: note.external_url,
          externalProvider: note.external_provider,
          isShared: note.is_shared,
          createdBy: note.created_by,
          createdAt: note.created_at,
          updatedAt: note.updated_at,
          originalNote: note,
          user: note.user
        })
      })
    }

    // Add models
    if (models) {
      models.forEach(model => {
        docs.push({
          id: model.id,
          type: 'model',
          title: model.name,
          sourceType: model.source_type === 'external_link' ? 'external_link' : 'uploaded',
          fileType: model.file_type || undefined,
          fileName: model.file_name || undefined,
          fileSize: model.file_size || undefined,
          externalUrl: model.external_url || undefined,
          externalProvider: model.external_provider || undefined,
          isShared: model.is_shared,
          createdBy: model.created_by,
          createdAt: model.created_at,
          updatedAt: model.updated_at,
          originalModel: model,
          user: model.user
        })
      })
    }

    // Sort by updated date
    docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

    return docs
  }, [notes, models])

  // Filter documents based on view filter (user permissions)
  const filteredByPermission = useMemo(() => {
    if (!user) return []

    if (researchViewFilter === 'aggregated') {
      return allDocuments.filter(doc =>
        doc.createdBy === user.id ||
        (doc.createdBy !== user.id && doc.isShared === true)
      )
    }

    if (researchViewFilter === user.id) {
      return allDocuments.filter(doc => doc.createdBy === user.id)
    }

    return allDocuments.filter(doc =>
      doc.createdBy === researchViewFilter && doc.isShared === true
    )
  }, [allDocuments, researchViewFilter, user])

  // Filter by document type
  const filteredDocuments = useMemo(() => {
    if (filter === 'all') return filteredByPermission

    return filteredByPermission.filter(doc => {
      const category = getDocumentCategory(doc)
      return category === filter
    })
  }, [filteredByPermission, filter])

  // Get counts per filter
  const filterCounts = useMemo(() => {
    const counts: Record<DocumentFilter, number> = {
      all: filteredByPermission.length,
      notes: 0,
      excel: 0,
      pdf: 0,
      powerpoint: 0,
      word: 0,
      images: 0,
      external: 0
    }

    filteredByPermission.forEach(doc => {
      const category = getDocumentCategory(doc)
      if (category !== 'all') {
        counts[category]++
      }
    })

    return counts
  }, [filteredByPermission])

  const paginatedDocuments = filteredDocuments.slice(0, displayCount)
  const hasMore = filteredDocuments.length > displayCount
  const canAddItems = researchViewFilter === 'aggregated' || researchViewFilter === user?.id

  // Handle file upload (any document type)
  const handleUploadDocument = async (file: File) => {
    if (!user || !assetId) return

    setIsUploading(true)
    try {
      const randomId = Math.random().toString(36).substring(2, 10)
      const extension = file.name.split('.').pop() || 'bin'
      const filePath = `documents/${assetId}/${Date.now()}_${randomId}.${extension}`

      const { error: uploadError } = await supabase.storage
        .from('assets')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // Determine if it's a spreadsheet (model) or other document (note)
      const isSpreadsheet = /\.(xlsx?|csv|numbers)$/i.test(file.name) ||
        file.type.includes('spreadsheet') || file.type.includes('excel')

      if (isSpreadsheet) {
        // Create as model
        await uploadModel({
          file,
          name: file.name.replace(/\.[^/.]+$/, ''),
          is_shared: false
        })
      } else {
        // Create as note/document
        const { error } = await supabase
          .from('asset_notes')
          .insert({
            asset_id: assetId,
            title: file.name.replace(/\.[^/.]+$/, ''),
            content: '',
            source_type: 'uploaded',
            file_path: filePath,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type,
            is_shared: false,
            created_by: user.id
          })

        if (error) {
          await supabase.storage.from('assets').remove([filePath])
          throw error
        }
      }

      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
    } catch (error) {
      console.error('Error uploading document:', error)
    } finally {
      setIsUploading(false)
      setShowAddDropdown(false)
    }
  }

  // Handle external link
  const handleCreateExternal = async (data: {
    name: string
    url: string
    provider: string
    description?: string
  }) => {
    if (!user || !assetId) return

    setIsCreatingExternal(true)
    try {
      const { error } = await supabase
        .from('asset_notes')
        .insert({
          asset_id: assetId,
          title: data.name,
          content: data.description || '',
          source_type: 'external_link',
          external_url: data.url,
          external_provider: data.provider,
          is_shared: false,
          created_by: user.id
        })

      if (error) throw error

      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      setShowExternalModal(false)
    } catch (error) {
      console.error('Error creating external link:', error)
    } finally {
      setIsCreatingExternal(false)
    }
  }

  // Handle document click
  const handleDocumentClick = async (doc: Document) => {
    if (doc.sourceType === 'external_link' && doc.externalUrl) {
      window.open(doc.externalUrl, '_blank')
      return
    }

    if (doc.type === 'note') {
      if (doc.sourceType === 'platform' || doc.sourceType === 'written') {
        onNoteClick(doc.id)
      } else if (doc.originalNote?.file_path) {
        // Download uploaded note document
        const { data } = await supabase.storage
          .from('assets')
          .createSignedUrl(doc.originalNote.file_path, 3600)
        if (data?.signedUrl) {
          window.open(data.signedUrl, '_blank')
        }
      }
    } else if (doc.type === 'model' && doc.originalModel) {
      const url = await getDownloadUrl(doc.originalModel)
      if (url) {
        window.open(url, '_blank')
      }
    }
  }

  // Content rendering (used in both embedded and non-embedded modes)
  const renderContent = () => (
    <div className={isEmbedded ? "" : "border-t border-gray-100 px-6 py-4"}>
            {/* Toolbar: Filters + Add Button */}
            <div className="flex items-center justify-between gap-4 mb-4">
              {/* Filter Pills */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1">
                {FILTER_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setFilter(opt.value)}
                    className={clsx(
                      'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-colors',
                      filter === opt.value
                        ? 'bg-primary-100 text-primary-700 font-medium'
                        : 'text-gray-600 hover:bg-gray-100'
                    )}
                  >
                    <opt.icon className="w-3.5 h-3.5" />
                    {opt.label}
                    {filterCounts[opt.value] > 0 && (
                      <span className={clsx(
                        'text-xs',
                        filter === opt.value ? 'text-primary-600' : 'text-gray-400'
                      )}>
                        {filterCounts[opt.value]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Add Button */}
              {canAddItems && (
                <div className="relative flex-shrink-0">
                  <Button
                    size="sm"
                    onClick={() => setShowAddDropdown(!showAddDropdown)}
                    disabled={isUploading_ || isUploading}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add
                    <ChevronDown className={clsx(
                      'w-3 h-3 ml-1 transition-transform',
                      showAddDropdown && 'rotate-180'
                    )} />
                  </Button>

                  {showAddDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowAddDropdown(false)}
                      />
                      <div className="absolute right-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                        <button
                          onClick={() => {
                            onCreateNote()
                            setShowAddDropdown(false)
                          }}
                          className="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 text-left"
                        >
                          <Edit3 className="w-5 h-5 text-gray-500 mt-0.5" />
                          <div>
                            <div className="font-medium text-sm text-gray-900">Write Note</div>
                            <div className="text-xs text-gray-500">Create a new note</div>
                          </div>
                        </button>

                        <label className="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 text-left cursor-pointer">
                          <Upload className="w-5 h-5 text-gray-500 mt-0.5" />
                          <div>
                            <div className="font-medium text-sm text-gray-900">Upload Document</div>
                            <div className="text-xs text-gray-500">PDF, Word, Excel, PPT, etc.</div>
                          </div>
                          <input
                            type="file"
                            className="hidden"
                            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                            onChange={(e) => {
                              const file = e.target.files?.[0]
                              if (file) handleUploadDocument(file)
                              e.target.value = ''
                            }}
                          />
                        </label>

                        <button
                          onClick={() => {
                            setShowExcelSyncModal(true)
                            setShowAddDropdown(false)
                          }}
                          className="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 text-left"
                        >
                          <RefreshCw className="w-5 h-5 text-gray-500 mt-0.5" />
                          <div>
                            <div className="font-medium text-sm text-gray-900">Sync Excel Model</div>
                            <div className="text-xs text-gray-500">Extract data to Outcomes</div>
                          </div>
                        </button>

                        <button
                          onClick={() => {
                            setShowExternalModal(true)
                            setShowAddDropdown(false)
                          }}
                          className="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 text-left"
                        >
                          <Link2 className="w-5 h-5 text-gray-500 mt-0.5" />
                          <div>
                            <div className="font-medium text-sm text-gray-900">Link External</div>
                            <div className="text-xs text-gray-500">Google Docs, Sheets, etc.</div>
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Document List - max height with scroll */}
            {filteredDocuments.length > 0 ? (
              <div className="max-h-[320px] overflow-y-auto -mx-2 px-2">
                <div className="space-y-0.5">
                  {paginatedDocuments.map(doc => {
                    const Icon = getDocumentIcon(doc)
                    const isOwner = doc.createdBy === user?.id
                    const isNote = doc.sourceType === 'platform' || doc.sourceType === 'written'
                    const authorName = doc.user
                      ? `${doc.user.first_name || ''} ${doc.user.last_name || ''}`.trim() || 'Unknown'
                      : 'Unknown'

                    return (
                      <div
                        key={`${doc.type}-${doc.id}`}
                        onClick={() => handleDocumentClick(doc)}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer transition-colors"
                      >
                        {/* Icon - smaller */}
                        <div className={clsx(
                          'w-7 h-7 rounded flex items-center justify-center flex-shrink-0',
                          doc.sourceType === 'external_link' ? 'bg-blue-50' :
                          isNote ? 'bg-amber-50' :
                          'bg-gray-100'
                        )}>
                          <Icon className={clsx(
                            'w-4 h-4',
                            doc.sourceType === 'external_link' ? 'text-blue-500' :
                            isNote ? 'text-amber-600' :
                            'text-gray-500'
                          )} />
                        </div>

                        {/* Content - single line */}
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-sm text-gray-900 truncate">
                            {doc.title}
                          </span>
                          {doc.isShared && !isOwner && (
                            <Share2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          )}
                          {doc.sourceType === 'external_link' && (
                            <ExternalLink className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          )}
                        </div>

                        {/* Metadata - compact */}
                        <div className="flex items-center gap-1.5 text-xs text-gray-400 flex-shrink-0">
                          {researchViewFilter === 'aggregated' && !isOwner && (
                            <span className="truncate max-w-[60px]">{authorName}</span>
                          )}
                          <span>{formatDate(doc.updatedAt)}</span>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          {isNote ? (
                            // Export dropdown for notes
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setExportDropdownId(exportDropdownId === doc.id ? null : doc.id)
                                }}
                                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                                title="Export"
                              >
                                <FileDown className="w-3.5 h-3.5" />
                              </button>
                              {exportDropdownId === doc.id && (
                                <>
                                  <div
                                    className="fixed inset-0 z-10"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setExportDropdownId(null)
                                    }}
                                  />
                                  <div className="absolute right-0 top-full mt-1 w-32 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        // TODO: Implement PDF export
                                        setExportDropdownId(null)
                                      }}
                                      className="w-full px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 text-left flex items-center gap-2"
                                    >
                                      <File className="w-3.5 h-3.5" />
                                      PDF
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        // TODO: Implement Word export
                                        setExportDropdownId(null)
                                      }}
                                      className="w-full px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 text-left flex items-center gap-2"
                                    >
                                      <FileText className="w-3.5 h-3.5" />
                                      Word
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          ) : doc.sourceType !== 'external_link' ? (
                            // Download button for files
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDocumentClick(doc)
                              }}
                              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>

                {hasMore && (
                  <button
                    onClick={() => setDisplayCount(prev => prev + 6)}
                    className="w-full py-1.5 mt-1 text-xs text-primary-600 hover:text-primary-700 font-medium hover:bg-primary-50 rounded transition-colors"
                  >
                    Show More ({filteredDocuments.length - displayCount} more)
                  </button>
                )}
              </div>
            ) : (
              <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                <FolderOpen className="h-6 w-6 text-gray-400 mx-auto mb-1" />
                <p className="text-sm text-gray-500">
                  {filter === 'all' ? 'No documents yet' : `No ${filter} documents`}
                </p>
              </div>
            )}

            {/* View All link - navigates based on current filter */}
            {filteredByPermission.length > 0 && !isEmbedded && (
              <button
                onClick={() => {
                  if (filter === 'notes' && onViewAllNotes) {
                    onViewAllNotes()
                  } else if (onViewAllFiles) {
                    onViewAllFiles()
                  } else if (onViewAllNotes) {
                    onViewAllNotes()
                  }
                }}
                className="w-full mt-3 py-2 text-sm text-gray-600 hover:text-gray-900 font-medium hover:bg-gray-50 rounded-lg transition-colors flex items-center justify-center gap-1"
              >
                {filter === 'notes' ? 'View All Notes' : 'View All Files'}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
    </div>
  )

  // For embedded mode, render content directly without Card wrapper
  if (isEmbedded) {
    return (
      <>
        {renderContent()}

        {/* External Link Modal */}
        <ExternalLinkModal
          isOpen={showExternalModal}
          onClose={() => setShowExternalModal(false)}
          onSubmit={handleCreateExternal}
          type="document"
          isLoading={isCreatingExternal}
        />

        {/* Excel Sync Modal */}
        {showExcelSyncModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setShowExcelSyncModal(false)}
            />
            <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-auto m-4">
              <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Sync Excel Model</h3>
                <button
                  onClick={() => setShowExcelSyncModal(false)}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-4">
                <BulkExcelImporter
                  assetId={assetId}
                  onComplete={() => setShowExcelSyncModal(false)}
                />
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // Non-embedded mode: render with Card wrapper and header
  return (
    <>
      <Card padding="none">
        {/* Section Header */}
        <button
          onClick={onToggleExpanded}
          className="w-full px-6 py-4 flex items-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <span className="font-medium text-gray-900">Document Library</span>
          <span className="text-sm text-gray-500">({filteredByPermission.length})</span>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </button>

        {/* Content */}
        {isExpanded && renderContent()}
      </Card>

      {/* External Link Modal */}
      <ExternalLinkModal
        isOpen={showExternalModal}
        onClose={() => setShowExternalModal(false)}
        onSubmit={handleCreateExternal}
        type="document"
        isLoading={isCreatingExternal}
      />

      {/* Excel Sync Modal */}
      {showExcelSyncModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setShowExcelSyncModal(false)}
          />
          <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] overflow-auto m-4">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Sync Excel Model</h3>
              <button
                onClick={() => setShowExcelSyncModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <BulkExcelImporter
                assetId={assetId}
                onComplete={() => setShowExcelSyncModal(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
