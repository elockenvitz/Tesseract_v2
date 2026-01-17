import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  X,
  FileText,
  FileSpreadsheet,
  Upload,
  Link2,
  Search,
  Check,
  AlertTriangle,
  Star,
  Loader2,
  ExternalLink
} from 'lucide-react'
import { Button } from '../ui/Button'
import { useKeyReferences, type ReferenceCategory, type ReferenceImportance } from '../../hooks/useKeyReferences'
import { useAssetModels, type AssetModel } from '../../hooks/useAssetModels'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { useQuery } from '@tanstack/react-query'

interface AddReferenceModalProps {
  isOpen: boolean
  onClose: () => void
  assetId: string
}

type TabType = 'notes' | 'models' | 'upload' | 'external'

interface AssetNote {
  id: string
  title: string
  source_type: string
  created_by: string
  created_at: string
  updated_at: string
  is_shared: boolean
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

const CATEGORY_OPTIONS: { value: ReferenceCategory; label: string }[] = [
  { value: 'research', label: 'Research' },
  { value: 'model', label: 'Model' },
  { value: 'filings', label: 'Filings' },
  { value: 'presentations', label: 'Presentations' },
  { value: 'other', label: 'Other' }
]

const IMPORTANCE_OPTIONS: { value: ReferenceImportance; label: string; icon?: React.ElementType; color: string }[] = [
  { value: 'critical', label: 'Critical', icon: AlertTriangle, color: 'text-red-600' },
  { value: 'high', label: 'High', icon: Star, color: 'text-amber-600' },
  { value: 'normal', label: 'Normal', color: 'text-gray-600' },
  { value: 'low', label: 'Low', color: 'text-gray-400' }
]

const EXTERNAL_PROVIDERS = [
  { value: 'sec', label: 'SEC EDGAR' },
  { value: 'investor_relations', label: 'Investor Relations' },
  { value: 'google_docs', label: 'Google Docs' },
  { value: 'google_sheets', label: 'Google Sheets' },
  { value: 'notion', label: 'Notion' },
  { value: 'confluence', label: 'Confluence' },
  { value: 'other', label: 'Other' }
]

export function AddReferenceModal({ isOpen, onClose, assetId }: AddReferenceModalProps) {
  const { user } = useAuth()
  const { createReference, isReferenced, isCreating } = useKeyReferences(assetId)
  const { models } = useAssetModels(assetId)

  // Tab state
  const [activeTab, setActiveTab] = useState<TabType>('notes')
  const [searchQuery, setSearchQuery] = useState('')

  // Selection state
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set())
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())

  // Form state
  const [importance, setImportance] = useState<ReferenceImportance>('normal')
  const [category, setCategory] = useState<ReferenceCategory>('research')
  const [annotation, setAnnotation] = useState('')

  // External link state
  const [externalUrl, setExternalUrl] = useState('')
  const [externalTitle, setExternalTitle] = useState('')
  const [externalProvider, setExternalProvider] = useState('other')

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [uploadTitle, setUploadTitle] = useState('')
  const [isUploading, setIsUploading] = useState(false)

  // Fetch notes for the asset
  const { data: notes = [], isLoading: notesLoading } = useQuery({
    queryKey: ['asset-notes-for-references', assetId],
    queryFn: async (): Promise<AssetNote[]> => {
      if (!assetId || !user) return []

      const { data, error } = await supabase
        .from('asset_notes')
        .select(`
          id, title, source_type, created_by, created_at, updated_at, is_shared,
          user:users!asset_notes_created_by_fkey(id, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })

      if (error) throw error

      // Filter: user's own notes OR shared notes from others
      return (data || []).filter(
        n => n.created_by === user.id || n.is_shared
      ) as AssetNote[]
    },
    enabled: isOpen && !!assetId && !!user
  })

  // Filter notes and models by search
  const filteredNotes = useMemo(() => {
    if (!searchQuery) return notes
    const q = searchQuery.toLowerCase()
    return notes.filter(n => n.title.toLowerCase().includes(q))
  }, [notes, searchQuery])

  const filteredModels = useMemo(() => {
    const available = models.filter(m =>
      m.created_by === user?.id || m.is_shared
    )
    if (!searchQuery) return available
    const q = searchQuery.toLowerCase()
    return available.filter(m => m.name.toLowerCase().includes(q))
  }, [models, searchQuery, user])

  // Toggle selection
  const toggleNoteSelection = (noteId: string) => {
    setSelectedNotes(prev => {
      const next = new Set(prev)
      if (next.has(noteId)) {
        next.delete(noteId)
      } else {
        next.add(noteId)
      }
      return next
    })
  }

  const toggleModelSelection = (modelId: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev)
      if (next.has(modelId)) {
        next.delete(modelId)
      } else {
        next.add(modelId)
      }
      return next
    })
  }

  // Handle add selected references
  const handleAddSelected = async () => {
    // Add selected notes
    for (const noteId of selectedNotes) {
      const note = notes.find(n => n.id === noteId)
      if (note && !isReferenced(noteId)) {
        await createReference({
          asset_id: assetId,
          reference_type: 'note',
          target_id: noteId,
          target_table: 'asset_notes',
          title: note.title,
          description: annotation || undefined,
          category,
          importance
        })
      }
    }

    // Add selected models
    for (const modelId of selectedModels) {
      const model = models.find(m => m.id === modelId)
      if (model && !isReferenced(modelId)) {
        await createReference({
          asset_id: assetId,
          reference_type: 'model',
          target_id: modelId,
          target_table: 'asset_models',
          title: model.name,
          description: annotation || undefined,
          category: 'model',
          importance
        })
      }
    }

    handleClose()
  }

  // Handle add external link
  const handleAddExternal = async () => {
    if (!externalUrl || !externalTitle) return

    await createReference({
      asset_id: assetId,
      reference_type: 'external_link',
      external_url: externalUrl,
      external_provider: externalProvider,
      title: externalTitle,
      description: annotation || undefined,
      category,
      importance
    })

    handleClose()
  }

  // Handle file upload
  const handleUpload = async () => {
    if (!uploadedFile || !user) return

    setIsUploading(true)
    try {
      // Upload file
      const randomId = Math.random().toString(36).substring(2, 10)
      const extension = uploadedFile.name.split('.').pop() || 'bin'
      const filePath = `references/${assetId}/${Date.now()}_${randomId}.${extension}`

      const { error: uploadError } = await supabase.storage
        .from('assets')
        .upload(filePath, uploadedFile)

      if (uploadError) throw uploadError

      // Create note record for the file
      const { data: note, error: noteError } = await supabase
        .from('asset_notes')
        .insert({
          asset_id: assetId,
          title: uploadTitle || uploadedFile.name.replace(/\.[^/.]+$/, ''),
          content: '',
          source_type: 'uploaded',
          file_path: filePath,
          file_name: uploadedFile.name,
          file_size: uploadedFile.size,
          file_type: uploadedFile.type,
          is_shared: false,
          created_by: user.id
        })
        .select()
        .single()

      if (noteError) {
        await supabase.storage.from('assets').remove([filePath])
        throw noteError
      }

      // Create reference to the uploaded file
      await createReference({
        asset_id: assetId,
        reference_type: 'file',
        target_id: note.id,
        target_table: 'asset_notes',
        title: uploadTitle || uploadedFile.name.replace(/\.[^/.]+$/, ''),
        description: annotation || undefined,
        category,
        importance
      })

      handleClose()
    } catch (error) {
      console.error('Upload failed:', error)
    } finally {
      setIsUploading(false)
    }
  }

  const handleClose = () => {
    setSelectedNotes(new Set())
    setSelectedModels(new Set())
    setSearchQuery('')
    setAnnotation('')
    setImportance('normal')
    setCategory('research')
    setExternalUrl('')
    setExternalTitle('')
    setExternalProvider('other')
    setUploadedFile(null)
    setUploadTitle('')
    onClose()
  }

  const canAdd = activeTab === 'notes' || activeTab === 'models'
    ? selectedNotes.size > 0 || selectedModels.size > 0
    : activeTab === 'external'
      ? !!externalUrl && !!externalTitle
      : !!uploadedFile

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Add Key Reference</h2>
          <button
            onClick={handleClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          {[
            { id: 'notes', label: 'Notes', icon: FileText },
            { id: 'models', label: 'Models', icon: FileSpreadsheet },
            { id: 'upload', label: 'Upload', icon: Upload },
            { id: 'external', label: 'External Link', icon: Link2 }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={clsx(
                'flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Notes Tab */}
          {activeTab === 'notes' && (
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Notes list */}
              {notesLoading ? (
                <div className="py-8 text-center text-gray-500">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                  Loading notes...
                </div>
              ) : filteredNotes.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  No notes found
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {filteredNotes.map(note => {
                    const isSelected = selectedNotes.has(note.id)
                    const alreadyAdded = isReferenced(note.id)
                    const isOwner = note.created_by === user?.id

                    return (
                      <div
                        key={note.id}
                        onClick={() => !alreadyAdded && toggleNoteSelection(note.id)}
                        className={clsx(
                          'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          alreadyAdded
                            ? 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
                            : isSelected
                              ? 'bg-primary-50 border-primary-300'
                              : 'bg-white border-gray-200 hover:border-gray-300'
                        )}
                      >
                        {/* Checkbox */}
                        <div className={clsx(
                          'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0',
                          alreadyAdded
                            ? 'bg-gray-200 border-gray-300'
                            : isSelected
                              ? 'bg-primary-600 border-primary-600'
                              : 'border-gray-300'
                        )}>
                          {(isSelected || alreadyAdded) && (
                            <Check className="w-3 h-3 text-white" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {note.title}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                            {!isOwner && note.user && (
                              <span>
                                {note.user.first_name} {note.user.last_name}
                              </span>
                            )}
                            {!isOwner && <span>·</span>}
                            <span>
                              {new Date(note.updated_at).toLocaleDateString()}
                            </span>
                            {alreadyAdded && (
                              <span className="text-primary-600">(Already added)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Models Tab */}
          {activeTab === 'models' && (
            <div className="space-y-4">
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search models..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              {/* Models list */}
              {filteredModels.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  No models found
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {filteredModels.map(model => {
                    const isSelected = selectedModels.has(model.id)
                    const alreadyAdded = isReferenced(model.id)
                    const isOwner = model.created_by === user?.id

                    return (
                      <div
                        key={model.id}
                        onClick={() => !alreadyAdded && toggleModelSelection(model.id)}
                        className={clsx(
                          'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          alreadyAdded
                            ? 'bg-gray-50 border-gray-200 opacity-50 cursor-not-allowed'
                            : isSelected
                              ? 'bg-primary-50 border-primary-300'
                              : 'bg-white border-gray-200 hover:border-gray-300'
                        )}
                      >
                        {/* Checkbox */}
                        <div className={clsx(
                          'w-5 h-5 rounded border flex items-center justify-center flex-shrink-0',
                          alreadyAdded
                            ? 'bg-gray-200 border-gray-300'
                            : isSelected
                              ? 'bg-primary-600 border-primary-600'
                              : 'border-gray-300'
                        )}>
                          {(isSelected || alreadyAdded) && (
                            <Check className="w-3 h-3 text-white" />
                          )}
                        </div>

                        {/* Icon */}
                        <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                          <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900 truncate">
                            {model.name}
                          </div>
                          <div className="text-xs text-gray-500 flex items-center gap-2">
                            <span>v{model.version}</span>
                            <span>·</span>
                            {!isOwner && model.user && (
                              <>
                                <span>
                                  {model.user.first_name} {model.user.last_name}
                                </span>
                                <span>·</span>
                              </>
                            )}
                            <span>
                              {new Date(model.updated_at).toLocaleDateString()}
                            </span>
                            {alreadyAdded && (
                              <span className="text-primary-600">(Already added)</span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Upload Tab */}
          {activeTab === 'upload' && (
            <div className="space-y-4">
              {/* File dropzone */}
              <label className={clsx(
                'flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-lg cursor-pointer transition-colors',
                uploadedFile
                  ? 'border-primary-300 bg-primary-50'
                  : 'border-gray-300 hover:border-gray-400 bg-gray-50'
              )}>
                {uploadedFile ? (
                  <>
                    <FileText className="w-10 h-10 text-primary-500 mb-2" />
                    <span className="text-sm font-medium text-gray-900">{uploadedFile.name}</span>
                    <span className="text-xs text-gray-500">
                      {(uploadedFile.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </>
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-gray-400 mb-2" />
                    <span className="text-sm font-medium text-gray-700">Click to upload</span>
                    <span className="text-xs text-gray-500">or drag and drop</span>
                    <span className="text-xs text-gray-400 mt-1">
                      PDF, Word, Excel, PowerPoint, Images
                    </span>
                  </>
                )}
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setUploadedFile(file)
                      setUploadTitle(file.name.replace(/\.[^/.]+$/, ''))
                    }
                  }}
                />
              </label>

              {/* Title for upload */}
              {uploadedFile && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reference Title
                  </label>
                  <input
                    type="text"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder="Enter a title for this document"
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  />
                </div>
              )}
            </div>
          )}

          {/* External Link Tab */}
          {activeTab === 'external' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  URL
                </label>
                <input
                  type="url"
                  value={externalUrl}
                  onChange={(e) => setExternalUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={externalTitle}
                  onChange={(e) => setExternalTitle(e.target.value)}
                  placeholder="Enter a title for this link"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Source
                </label>
                <select
                  value={externalProvider}
                  onChange={(e) => setExternalProvider(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  {EXTERNAL_PROVIDERS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Common options (show for all tabs) */}
          <div className="mt-6 pt-6 border-t border-gray-200 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Importance */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Importance
                </label>
                <select
                  value={importance}
                  onChange={(e) => setImportance(e.target.value as ReferenceImportance)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                >
                  {IMPORTANCE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Category (not shown for models tab) */}
              {activeTab !== 'models' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ReferenceCategory)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                  >
                    {CATEGORY_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Annotation */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Annotation <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={annotation}
                onChange={(e) => setAnnotation(e.target.value)}
                placeholder="Why is this important to your investment case?"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="text-sm text-gray-500">
            {activeTab === 'notes' && selectedNotes.size > 0 && (
              <span>{selectedNotes.size} note{selectedNotes.size > 1 ? 's' : ''} selected</span>
            )}
            {activeTab === 'models' && selectedModels.size > 0 && (
              <span>{selectedModels.size} model{selectedModels.size > 1 ? 's' : ''} selected</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={
                activeTab === 'notes' || activeTab === 'models'
                  ? handleAddSelected
                  : activeTab === 'external'
                    ? handleAddExternal
                    : handleUpload
              }
              disabled={!canAdd || isCreating || isUploading}
            >
              {(isCreating || isUploading) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Add Reference{(selectedNotes.size + selectedModels.size) > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
