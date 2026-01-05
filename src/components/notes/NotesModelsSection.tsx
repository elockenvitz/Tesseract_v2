import React, { useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, FileText, FileSpreadsheet, ExternalLink, X } from 'lucide-react'
import { Card } from '../ui/Card'
import { CompactNoteCard, CompactNote } from './CompactNoteCard'
import { CompactModelCard } from './CompactModelCard'
import { AddNoteDropdown } from './AddNoteDropdown'
import { AddModelDropdown } from './AddModelDropdown'
import { ExternalLinkModal } from './ExternalLinkModal'
import { BulkExcelImporter } from '../outcomes/BulkExcelImporter'
import { useAssetModels, AssetModel } from '../../hooks/useAssetModels'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { useQueryClient } from '@tanstack/react-query'
import clsx from 'clsx'

interface NotesModelsSectionProps {
  assetId: string
  notes: CompactNote[]
  researchViewFilter: string // 'aggregated' | user_id
  isExpanded: boolean
  onToggleExpanded: () => void
  onNoteClick: (noteId: string) => void
  onCreateNote: () => void
  onViewAllNotes: () => void
}

export function NotesModelsSection({
  assetId,
  notes,
  researchViewFilter,
  isExpanded,
  onToggleExpanded,
  onNoteClick,
  onCreateNote,
  onViewAllNotes
}: NotesModelsSectionProps) {
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
  const [notesDisplayCount, setNotesDisplayCount] = useState(4)
  const [modelsDisplayCount, setModelsDisplayCount] = useState(4)
  const [showNoteExternalModal, setShowNoteExternalModal] = useState(false)
  const [showModelExternalModal, setShowModelExternalModal] = useState(false)
  const [showExcelSyncModal, setShowExcelSyncModal] = useState(false)
  const [isCreatingExternalNote, setIsCreatingExternalNote] = useState(false)
  const [isCreatingExternalModel, setIsCreatingExternalModel] = useState(false)
  const [isUploadingNote, setIsUploadingNote] = useState(false)

  // Filter notes based on view filter
  const filteredNotes = useMemo(() => {
    if (!notes || !user) return []

    if (researchViewFilter === 'aggregated') {
      // Show user's notes + others' shared notes
      return notes.filter(note =>
        note.created_by === user.id ||
        (note.created_by !== user.id && note.is_shared === true)
      )
    }

    if (researchViewFilter === user.id) {
      // Show all of user's own notes
      return notes.filter(note => note.created_by === user.id)
    }

    // Viewing another user - only show their shared notes
    return notes.filter(note =>
      note.created_by === researchViewFilter && note.is_shared === true
    )
  }, [notes, researchViewFilter, user])

  // Filter models based on view filter
  const filteredModels = useMemo(() => {
    if (!models || !user) return []

    if (researchViewFilter === 'aggregated') {
      return models.filter(model =>
        model.created_by === user.id ||
        (model.created_by !== user.id && model.is_shared === true)
      )
    }

    if (researchViewFilter === user.id) {
      return models.filter(model => model.created_by === user.id)
    }

    return models.filter(model =>
      model.created_by === researchViewFilter && model.is_shared === true
    )
  }, [models, researchViewFilter, user])

  // Pagination
  const paginatedNotes = filteredNotes.slice(0, notesDisplayCount)
  const hasMoreNotes = filteredNotes.length > notesDisplayCount

  const paginatedModels = filteredModels.slice(0, modelsDisplayCount)
  const hasMoreModels = filteredModels.length > modelsDisplayCount

  // Can add items?
  const canAddItems = researchViewFilter === 'aggregated' || researchViewFilter === user?.id

  // Handle note document upload
  const handleUploadNoteDocument = async (file: File) => {
    if (!user || !assetId) return

    setIsUploadingNote(true)
    try {
      // Generate unique file path
      const randomId = Math.random().toString(36).substring(2, 10)
      const extension = file.name.split('.').pop() || 'bin'
      const filePath = `notes/${assetId}/${Date.now()}_${randomId}.${extension}`

      // Upload file to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('assets')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // Create note record
      const { error } = await supabase
        .from('asset_notes')
        .insert({
          asset_id: assetId,
          title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension for title
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
        // Clean up uploaded file if db insert fails
        await supabase.storage.from('assets').remove([filePath])
        throw error
      }

      // Refresh notes
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
    } catch (error) {
      console.error('Error uploading document:', error)
    } finally {
      setIsUploadingNote(false)
    }
  }

  // Handle external note link
  const handleCreateExternalNote = async (data: {
    name: string
    url: string
    provider: string
    description?: string
  }) => {
    if (!user || !assetId) return

    setIsCreatingExternalNote(true)
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
      setShowNoteExternalModal(false)
    } catch (error) {
      console.error('Error creating external note:', error)
    } finally {
      setIsCreatingExternalNote(false)
    }
  }

  // Handle model upload
  const handleUploadModel = async (file: File) => {
    if (!user || !assetId) return

    try {
      await uploadModel({
        file,
        name: file.name.replace(/\.[^/.]+$/, ''), // Remove extension for name
        is_shared: false
      })
    } catch (error) {
      console.error('Error uploading model:', error)
    }
  }

  // Handle external model link
  const handleCreateExternalModel = async (data: {
    name: string
    url: string
    provider: string
    description?: string
  }) => {
    if (!user || !assetId) return

    setIsCreatingExternalModel(true)
    try {
      await createModel({
        asset_id: assetId,
        name: data.name,
        description: data.description,
        source_type: 'external_link',
        external_url: data.url,
        external_provider: data.provider as any,
        is_shared: false
      })

      setShowModelExternalModal(false)
    } catch (error) {
      console.error('Error creating external model:', error)
    } finally {
      setIsCreatingExternalModel(false)
    }
  }

  // Handle model download
  const handleModelDownload = async (model: AssetModel) => {
    const url = await getDownloadUrl(model)
    if (url) {
      window.open(url, '_blank')
    }
  }

  const totalCount = filteredNotes.length + filteredModels.length

  return (
    <>
      <Card padding="none">
        {/* Section Header - matches Outcomes section styling */}
        <button
          onClick={onToggleExpanded}
          className="w-full px-6 py-4 flex items-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <span className="font-medium text-gray-900">Notes & Models</span>
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </button>

        {/* Content */}
        {isExpanded && (
          <div className="border-t border-gray-100 px-6 py-6">
            {/* Two Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Notes Column */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                      Notes
                    </span>
                    <span className="text-xs text-gray-400">
                      ({filteredNotes.length})
                    </span>
                  </div>
                  {canAddItems && (
                    <AddNoteDropdown
                      onCreateNote={onCreateNote}
                      onUploadDocument={handleUploadNoteDocument}
                      onLinkExternal={() => setShowNoteExternalModal(true)}
                      disabled={isUploadingNote}
                    />
                  )}
                </div>

                {filteredNotes.length > 0 ? (
                  <div className="space-y-2">
                    {paginatedNotes.map((note) => (
                      <CompactNoteCard
                        key={note.id}
                        note={note}
                        currentUserId={user?.id}
                        showAuthor={researchViewFilter === 'aggregated'}
                        onClick={() => {
                          if (note.source_type !== 'external_link') {
                            onNoteClick(note.id)
                          }
                        }}
                      />
                    ))}

                    {hasMoreNotes && (
                      <button
                        onClick={() => setNotesDisplayCount(prev => prev + 4)}
                        className="w-full py-2 text-sm text-primary-600 hover:text-primary-700 font-medium hover:bg-primary-50 rounded-lg transition-colors"
                      >
                        Show More ({filteredNotes.length - notesDisplayCount})
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                    <FileText className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No notes yet</p>
                    {canAddItems && (
                      <p className="text-xs text-gray-400 mt-1">Add your first note</p>
                    )}
                  </div>
                )}
              </div>

              {/* Models Column */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700 uppercase tracking-wide">
                      Models
                    </span>
                    <span className="text-xs text-gray-400">
                      ({filteredModels.length})
                    </span>
                  </div>
                  {canAddItems && (
                    <AddModelDropdown
                      onUploadModel={handleUploadModel}
                      onLinkExternal={() => setShowModelExternalModal(true)}
                      onSyncExcel={() => setShowExcelSyncModal(true)}
                      disabled={isUploading}
                    />
                  )}
                </div>

                {filteredModels.length > 0 ? (
                  <div className="space-y-2">
                    {paginatedModels.map((model) => (
                      <CompactModelCard
                        key={model.id}
                        model={model}
                        currentUserId={user?.id}
                        showAuthor={researchViewFilter === 'aggregated'}
                        onDownload={() => handleModelDownload(model)}
                      />
                    ))}

                    {hasMoreModels && (
                      <button
                        onClick={() => setModelsDisplayCount(prev => prev + 4)}
                        className="w-full py-2 text-sm text-primary-600 hover:text-primary-700 font-medium hover:bg-primary-50 rounded-lg transition-colors"
                      >
                        Show More ({filteredModels.length - modelsDisplayCount})
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-6 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                    <FileSpreadsheet className="h-6 w-6 text-gray-400 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">No models yet</p>
                    {canAddItems && (
                      <p className="text-xs text-gray-400 mt-1">Upload your first model</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* External Link Modals */}
      <ExternalLinkModal
        isOpen={showNoteExternalModal}
        onClose={() => setShowNoteExternalModal(false)}
        onSubmit={handleCreateExternalNote}
        type="note"
        isLoading={isCreatingExternalNote}
      />

      <ExternalLinkModal
        isOpen={showModelExternalModal}
        onClose={() => setShowModelExternalModal(false)}
        onSubmit={handleCreateExternalModel}
        type="model"
        isLoading={isCreatingExternalModel}
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
