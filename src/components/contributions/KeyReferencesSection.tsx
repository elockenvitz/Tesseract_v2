import React, { useState, useMemo, useRef, useCallback } from 'react'
import { clsx } from 'clsx'
import {
  Plus,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  File,
  Link2,
  Presentation,
  Image,
  Search,
  AlertTriangle,
  FolderOpen,
  Upload,
  Edit3,
  ExternalLink,
  Download,
  Pin,
  Share2,
  Zap,
  GripVertical,
  Calendar,
  User,
  Layers,
  Trash2,
  Filter,
  Library
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { useKeyReferences, type ReferenceCategory, type ReferenceImportance, type KeyReference } from '../../hooks/useKeyReferences'
import { useAssetModels, type AssetModel } from '../../hooks/useAssetModels'
import { ExternalLinkModal } from '../notes/ExternalLinkModal'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { useQueryClient } from '@tanstack/react-query'

// ============================================================================
// TYPES
// ============================================================================

/** Export metadata stored in asset_notes.metadata JSONB */
export interface ExportMetadata {
  is_export: true
  template_id?: string
  template_name?: string
  as_of_date?: string
  sections_count?: number
  fields_count?: number
  generated_by_name?: string
  generated_by_id?: string
  included_artifact_ids?: string[]
}

interface NoteData {
  id: string
  title: string
  content?: string
  source_type: string
  file_path?: string
  file_type?: string
  file_name?: string
  file_size?: number
  external_url?: string
  external_provider?: string
  is_shared: boolean
  created_by: string
  created_at: string
  updated_at: string
  metadata?: ExportMetadata | null
  user?: {
    id: string
    first_name: string | null
    last_name: string | null
  }
}

/** Artifact type badge categories */
type ArtifactType = 'note' | 'pdf' | 'excel' | 'link' | 'export'

/** Unified document combining notes, models, and external links */
interface UnifiedDoc {
  id: string
  type: 'note' | 'model'
  title: string
  sourceType: 'platform' | 'written' | 'uploaded' | 'external_link' | 'generated_export'
  fileType?: string
  fileName?: string
  externalUrl?: string
  isShared: boolean
  createdBy: string
  createdAt: string
  updatedAt: string
  user?: { id: string; first_name: string | null; last_name: string | null }
  /** If this doc is a curated key reference, the reference data */
  reference?: KeyReference
  originalNote?: NoteData
  originalModel?: AssetModel
  /** Export metadata (only for generated exports) */
  exportMeta?: ExportMetadata
  /** Whether this artifact is an export */
  isExport: boolean
  /** Whether this artifact was included in the latest export */
  includedInLatestExport: boolean
}

type DocFilter = 'all' | 'notes' | 'documents' | 'exports' | 'pinned' | 'added_by_me' | 'pdf' | 'excel' | 'ppt' | 'word' | 'links'

interface KeyReferencesSectionProps {
  assetId: string
  isExpanded: boolean
  onToggleExpanded: () => void
  onViewModelHistory?: (modelId: string) => void
  /** When true, renders without Card wrapper and header (for embedding in other sections) */
  isEmbedded?: boolean
  /** Callback to open note editor */
  onCreateNote?: () => void
  /** Callback when a note is clicked */
  onNoteClick?: (noteId: string) => void
  /** Notes data for the section */
  notes?: NoteData[]
}

// ============================================================================
// HELPERS
// ============================================================================

const FILTER_OPTIONS: { value: DocFilter; label: string; group: 'main' | 'type' }[] = [
  // Organizational filters
  { value: 'all', label: 'Library', group: 'main' },
  { value: 'notes', label: 'Notes', group: 'main' },
  { value: 'exports', label: 'Exports', group: 'main' },
  { value: 'pinned', label: 'Key Artifacts', group: 'main' },
  { value: 'added_by_me', label: 'Added by Me', group: 'main' },
  // File-type filters
  { value: 'pdf', label: 'PDF', group: 'type' },
  { value: 'excel', label: 'Excel', group: 'type' },
  { value: 'ppt', label: 'PPT', group: 'type' },
  { value: 'word', label: 'Word', group: 'type' },
  { value: 'links', label: 'Links', group: 'type' },
]

/** Badge config for each artifact type */
const ARTIFACT_BADGE: Record<ArtifactType, { label: string; color: string; bgColor: string }> = {
  note:   { label: 'Note',   color: 'text-amber-700',   bgColor: 'bg-amber-50 border-amber-200' },
  pdf:    { label: 'PDF',    color: 'text-red-700',     bgColor: 'bg-red-50 border-red-200' },
  excel:  { label: 'Excel',  color: 'text-green-700',   bgColor: 'bg-green-50 border-green-200' },
  link:   { label: 'Link',   color: 'text-blue-700',    bgColor: 'bg-blue-50 border-blue-200' },
  export: { label: 'Export', color: 'text-violet-700',  bgColor: 'bg-violet-50 border-violet-200' },
}

function getArtifactType(doc: UnifiedDoc): ArtifactType {
  if (doc.isExport) return 'export'
  if (doc.sourceType === 'external_link') return 'link'
  if (doc.sourceType === 'platform' || doc.sourceType === 'written') return 'note'

  const ft = (doc.fileType || '').toLowerCase()
  const fn = (doc.fileName || '').toLowerCase()

  if (ft.includes('pdf') || fn.endsWith('.pdf')) return 'pdf'
  if (ft.includes('spreadsheet') || ft.includes('excel') ||
      fn.endsWith('.xlsx') || fn.endsWith('.xls') || fn.endsWith('.csv')) return 'excel'

  if (doc.type === 'model') return 'excel'
  return 'note'
}

function getDocFileType(doc: UnifiedDoc): 'pdf' | 'excel' | 'ppt' | 'word' | 'image' | 'other' {
  const ft = (doc.fileType || '').toLowerCase()
  const fn = (doc.fileName || '').toLowerCase()

  if (ft.includes('pdf') || fn.endsWith('.pdf')) return 'pdf'
  if (ft.includes('spreadsheet') || ft.includes('excel') ||
      fn.endsWith('.xlsx') || fn.endsWith('.xls') || fn.endsWith('.csv')) return 'excel'
  if (ft.includes('presentation') || ft.includes('powerpoint') ||
      fn.endsWith('.pptx') || fn.endsWith('.ppt')) return 'ppt'
  if (ft.includes('word') || ft.includes('document') ||
      fn.endsWith('.docx') || fn.endsWith('.doc')) return 'word'
  if (ft.includes('image') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fn)) return 'image'
  if (doc.type === 'model') return 'excel'
  return 'other'
}

function getDocIcon(doc: UnifiedDoc) {
  if (doc.isExport) return Zap
  if (doc.sourceType === 'external_link') return Link2
  if (doc.sourceType === 'platform' || doc.sourceType === 'written') return Edit3

  const ft = (doc.fileType || '').toLowerCase()
  const fn = (doc.fileName || '').toLowerCase()

  if (ft.includes('spreadsheet') || ft.includes('excel') ||
      fn.endsWith('.xlsx') || fn.endsWith('.xls') || fn.endsWith('.csv')) return FileSpreadsheet
  if (ft.includes('pdf') || fn.endsWith('.pdf')) return File
  if (ft.includes('presentation') || ft.includes('powerpoint') ||
      fn.endsWith('.pptx') || fn.endsWith('.ppt')) return Presentation
  if (ft.includes('word') || ft.includes('document') ||
      fn.endsWith('.docx') || fn.endsWith('.doc')) return FileText
  if (ft.includes('image') || /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(fn)) return Image

  if (doc.type === 'model') return FileSpreadsheet
  return File
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  // Compare by local calendar date to avoid timezone drift
  const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const nowLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffDays = Math.round((nowLocal.getTime() - dateLocal.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getUserName(doc: UnifiedDoc): string | null {
  if (doc.user) {
    const { first_name, last_name } = doc.user
    if (first_name && last_name) return `${first_name} ${last_name}`
    if (first_name) return first_name
  }
  if (doc.isExport && doc.exportMeta?.generated_by_name) {
    return doc.exportMeta.generated_by_name
  }
  return null
}

// ============================================================================
// SORTABLE PINNED ITEM
// ============================================================================

function SortablePinnedItem({
  doc,
  onDocClick,
  onUnpin,
}: {
  doc: UnifiedDoc
  onDocClick: (doc: UnifiedDoc) => void
  onUnpin: (refId: string) => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: doc.reference!.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const artifactType = getArtifactType(doc)
  const badge = ARTIFACT_BADGE[artifactType]
  const Icon = getDocIcon(doc)

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={clsx(
        'group flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors',
        isDragging ? 'opacity-50 bg-primary-50' : 'hover:bg-blue-50/60',
        'cursor-pointer'
      )}
      onClick={() => onDocClick(doc)}
    >
      <button
        className="p-0.5 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing flex-shrink-0"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="w-3.5 h-3.5" />
      </button>

      <div className={clsx(
        'w-6 h-6 rounded flex items-center justify-center flex-shrink-0',
        doc.isExport ? 'bg-violet-50' :
        doc.sourceType === 'external_link' ? 'bg-blue-50' :
        doc.type === 'model' ? 'bg-green-50' :
        'bg-amber-50'
      )}>
        <Icon className={clsx(
          'w-3.5 h-3.5',
          doc.isExport ? 'text-violet-500' :
          doc.sourceType === 'external_link' ? 'text-blue-500' :
          doc.type === 'model' ? 'text-green-600' :
          'text-amber-600'
        )} />
      </div>

      <div className="flex-1 min-w-0">
        <span className="text-sm text-gray-900 truncate block">{doc.title}</span>
      </div>

      <span className={clsx(
        'text-[10px] px-1.5 py-0.5 rounded border font-medium flex-shrink-0',
        badge.bgColor, badge.color
      )}>
        {badge.label}
      </span>

      <button
        onClick={(e) => { e.stopPropagation(); onUnpin(doc.reference!.id) }}
        className="p-0.5 text-blue-400 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        title="Unpin"
      >
        <Pin className="w-3 h-3 fill-current" />
      </button>
    </div>
  )
}

// ============================================================================
// COMPONENT
// ============================================================================

export function KeyReferencesSection({
  assetId,
  isExpanded,
  onToggleExpanded,
  onViewModelHistory,
  isEmbedded = false,
  onCreateNote,
  onNoteClick,
  notes = []
}: KeyReferencesSectionProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  const {
    references,
    isLoading,
    createReference,
    deleteReference,
    togglePinned,
    setImportance,
    setAnnotation,
    reorderReferences,
    isDeleting
  } = useKeyReferences(assetId)
  const { models, getDownloadUrl } = useAssetModels(assetId)

  const [filter, setFilter] = useState<DocFilter>('all')
  const [showFilterDropdown, setShowFilterDropdown] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showAddDropdown, setShowAddDropdown] = useState(false)
  const [displayCount, setDisplayCount] = useState(8)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [showExternalModal, setShowExternalModal] = useState(false)
  const [isCreatingExternal, setIsCreatingExternal] = useState(false)
  const [expandedExport, setExpandedExport] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<UnifiedDoc | null>(null)
  const [isDeletingDoc, setIsDeletingDoc] = useState(false)

  // DnD sensors for pinned section
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  // Build reference lookup
  const referenceByTargetId = useMemo(() => {
    const map = new Map<string, KeyReference>()
    for (const ref of references) {
      if (ref.target_id) map.set(ref.target_id, ref)
    }
    return map
  }, [references])

  // Find the latest export to mark "Included in Latest Export"
  const latestExport = useMemo(() => {
    const exports = notes.filter(n =>
      (n.metadata as ExportMetadata | null)?.is_export === true
    )
    if (exports.length === 0) return null
    return exports.sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0]
  }, [notes])

  const latestExportArtifactIds = useMemo(() => {
    if (!latestExport) return new Set<string>()
    const meta = latestExport.metadata as ExportMetadata | null
    return new Set(meta?.included_artifact_ids || [])
  }, [latestExport])

  // Build unified document list
  const allDocs = useMemo(() => {
    const docs: UnifiedDoc[] = []

    for (const note of notes) {
      const meta = note.metadata as ExportMetadata | null
      const isExport = meta?.is_export === true
      docs.push({
        id: note.id,
        type: 'note',
        title: note.title || note.file_name || 'Untitled Note',
        sourceType: isExport ? 'generated_export' : note.source_type as UnifiedDoc['sourceType'],
        fileType: note.file_type,
        fileName: note.file_name,
        externalUrl: note.external_url,
        isShared: note.is_shared,
        createdBy: note.created_by,
        createdAt: note.created_at,
        updatedAt: note.updated_at,
        user: note.user,
        reference: referenceByTargetId.get(note.id),
        originalNote: note,
        exportMeta: isExport ? meta! : undefined,
        isExport,
        includedInLatestExport:
          latestExport?.id === note.id ||
          latestExportArtifactIds.has(note.id)
      })
    }

    for (const model of models) {
      docs.push({
        id: model.id,
        type: 'model',
        title: model.name || model.file_name || 'Untitled Model',
        sourceType: model.source_type === 'external_link' ? 'external_link' : 'uploaded',
        fileType: model.file_type || undefined,
        fileName: model.file_name || undefined,
        externalUrl: model.external_url || undefined,
        isShared: model.is_shared,
        createdBy: model.created_by,
        createdAt: model.created_at,
        updatedAt: model.updated_at,
        user: model.user,
        reference: referenceByTargetId.get(model.id),
        originalModel: model,
        isExport: false,
        includedInLatestExport: latestExportArtifactIds.has(model.id)
      })
    }

    for (const ref of references) {
      if (ref.reference_type === 'external_link' && !ref.target_id) {
        docs.push({
          id: `ref-${ref.id}`,
          type: 'note',
          title: ref.title,
          sourceType: 'external_link',
          externalUrl: ref.external_url || undefined,
          isShared: false,
          createdBy: ref.user_id,
          createdAt: ref.created_at,
          updatedAt: ref.updated_at,
          reference: ref,
          isExport: false,
          includedInLatestExport: false
        })
      }
    }

    // Sort: pinned first, then by date
    docs.sort((a, b) => {
      const aPin = a.reference?.is_pinned ? 1 : 0
      const bPin = b.reference?.is_pinned ? 1 : 0
      if (aPin !== bPin) return bPin - aPin
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

    return docs
  }, [notes, models, references, referenceByTargetId, latestExport, latestExportArtifactIds])

  // Pinned docs for Key Artifacts section
  const pinnedDocs = useMemo(() =>
    allDocs.filter(d => d.reference?.is_pinned),
  [allDocs])

  // Filter
  const filteredDocs = useMemo(() => {
    let docs = allDocs

    switch (filter) {
      case 'notes':
        docs = docs.filter(d =>
          d.sourceType === 'platform' || d.sourceType === 'written'
        )
        break
      case 'exports':
        docs = docs.filter(d => d.isExport)
        break
      case 'pinned':
        docs = docs.filter(d => d.reference?.is_pinned)
        break
      case 'added_by_me':
        docs = docs.filter(d => d.createdBy === user?.id)
        break
      case 'pdf':
        docs = docs.filter(d => !d.isExport && getDocFileType(d) === 'pdf')
        break
      case 'excel':
        docs = docs.filter(d => getDocFileType(d) === 'excel')
        break
      case 'ppt':
        docs = docs.filter(d => getDocFileType(d) === 'ppt')
        break
      case 'word':
        docs = docs.filter(d => getDocFileType(d) === 'word')
        break
      case 'links':
        docs = docs.filter(d => d.sourceType === 'external_link')
        break
      default:
        break
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      docs = docs.filter(d => d.title.toLowerCase().includes(q))
    }
    return docs
  }, [allDocs, filter, searchQuery, user?.id])

  // Filter counts
  const filterCounts = useMemo(() => {
    const counts: Record<DocFilter, number> = {
      all: allDocs.length,
      notes: 0,
      documents: 0,
      exports: 0,
      pinned: pinnedDocs.length,
      added_by_me: 0,
      pdf: 0,
      excel: 0,
      ppt: 0,
      word: 0,
      links: 0
    }
    for (const doc of allDocs) {
      if (doc.sourceType === 'platform' || doc.sourceType === 'written') counts.notes++
      if (doc.isExport) counts.exports++
      if (doc.createdBy === user?.id) counts.added_by_me++
      if (doc.sourceType === 'external_link') counts.links++
      // File-type counts
      if (!doc.isExport && (doc.sourceType === 'uploaded' || doc.type === 'model')) {
        const ft = getDocFileType(doc)
        if (ft === 'pdf') counts.pdf++
        else if (ft === 'excel') counts.excel++
        else if (ft === 'ppt') counts.ppt++
        else if (ft === 'word') counts.word++
      }
    }
    return counts
  }, [allDocs, pinnedDocs, user?.id])

  const paginatedDocs = filteredDocs.slice(0, displayCount)
  const hasMore = filteredDocs.length > displayCount

  const totalCount = allDocs.length
  const keyCount = pinnedDocs.length

  // Active filter label
  const activeFilterLabel = FILTER_OPTIONS.find(o => o.value === filter)?.label || 'Library'

  // ── Upload handler ──────────────────────────────────────────────

  const handleUploadFiles = useCallback(async (files: FileList | File[]) => {
    if (!user) return
    setIsUploading(true)
    try {
      for (const file of Array.from(files)) {
        const randomId = Math.random().toString(36).substring(2, 10)
        const extension = file.name.split('.').pop() || 'bin'
        const filePath = `documents/${assetId}/${Date.now()}_${randomId}.${extension}`

        const { error: uploadError } = await supabase.storage
          .from('assets')
          .upload(filePath, file)
        if (uploadError) throw uploadError

        const isSpreadsheet = /\.(xlsx?|csv|numbers)$/i.test(file.name) ||
          file.type.includes('spreadsheet') || file.type.includes('excel')

        if (isSpreadsheet) {
          await supabase.from('asset_models').insert({
            asset_id: assetId,
            name: file.name.replace(/\.[^/.]+$/, ''),
            source_type: 'uploaded',
            file_path: filePath,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type || extension,
            is_shared: false,
            created_by: user.id
          })
        } else {
          await supabase.from('asset_notes').insert({
            asset_id: assetId,
            title: file.name.replace(/\.[^/.]+$/, ''),
            content: '',
            source_type: 'uploaded',
            file_path: filePath,
            file_name: file.name,
            file_size: file.size,
            file_type: file.type || extension,
            is_shared: false,
            created_by: user.id
          })
        }
      }
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      queryClient.invalidateQueries({ queryKey: ['asset-models', assetId] })
    } catch (err) {
      console.error('Upload failed:', err)
    } finally {
      setIsUploading(false)
    }
  }, [assetId, user, queryClient])

  // ── External link creation ────────────────────────────────────────

  const handleCreateExternal = async (data: {
    name: string
    url: string
    provider: string
    description?: string
  }) => {
    if (!user) return
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
    } catch (err) {
      console.error('Error creating external link:', err)
    } finally {
      setIsCreatingExternal(false)
    }
  }

  // ── Drag & drop (file upload) ─────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (dropZoneRef.current && !dropZoneRef.current.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (e.dataTransfer.files?.length) {
      handleUploadFiles(e.dataTransfer.files)
    }
  }, [handleUploadFiles])

  // ── Pin toggle ────────────────────────────────────────────────────

  const handleTogglePin = async (doc: UnifiedDoc) => {
    if (doc.reference) {
      await togglePinned(doc.reference.id)
    } else {
      // Create reference and pin it
      const category: ReferenceCategory =
        doc.type === 'model' ? 'model'
        : doc.sourceType === 'external_link' ? 'other'
        : 'research'

      const ref = await createReference({
        asset_id: assetId,
        reference_type: doc.type === 'model' ? 'model'
          : doc.sourceType === 'external_link' ? 'external_link'
          : 'note',
        target_id: doc.id.startsWith('ref-') ? undefined : doc.id,
        target_table: doc.type === 'model' ? 'asset_models' : 'asset_notes',
        title: doc.title,
        category,
        importance: 'normal'
      })
      if (ref) await togglePinned(ref.id)
    }
  }

  // ── Delete ────────────────────────────────────────────────────────

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    setIsDeletingDoc(true)
    try {
      const doc = pendingDelete
      // If it has a reference, delete the reference
      if (doc.reference) {
        await deleteReference(doc.reference.id)
      }
      // Delete the underlying artifact
      if (doc.type === 'model' && doc.originalModel) {
        await supabase.from('asset_models')
          .update({ is_deleted: true })
          .eq('id', doc.originalModel.id)
        queryClient.invalidateQueries({ queryKey: ['asset-models', assetId] })
      } else if (doc.type === 'note' && doc.originalNote && !doc.id.startsWith('ref-')) {
        await supabase.from('asset_notes')
          .update({ is_deleted: true })
          .eq('id', doc.originalNote.id)
        queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      }
    } finally {
      setIsDeletingDoc(false)
      setPendingDelete(null)
    }
  }

  // ── Document click ──────────────────────────────────────────────

  const handleDocClick = async (doc: UnifiedDoc) => {
    if (doc.sourceType === 'external_link' && doc.externalUrl) {
      window.open(doc.externalUrl, '_blank')
      return
    }

    if (doc.type === 'note') {
      if (doc.sourceType === 'platform' || doc.sourceType === 'written') {
        onNoteClick?.(doc.id)
      } else if (doc.originalNote?.file_path) {
        const { data } = await supabase.storage
          .from('assets')
          .createSignedUrl(doc.originalNote.file_path, 3600)
        if (data?.signedUrl) window.open(data.signedUrl, '_blank')
      }
    } else if (doc.type === 'model' && doc.originalModel) {
      const url = await getDownloadUrl(doc.originalModel)
      if (url) window.open(url, '_blank')
    }
  }

  // ── Pinned section reorder ────────────────────────────────────────

  const handlePinnedDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const pinnedRefs = pinnedDocs.map(d => d.reference!).filter(Boolean)
    const oldIndex = pinnedRefs.findIndex(r => r.id === active.id)
    const newIndex = pinnedRefs.findIndex(r => r.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(pinnedRefs, oldIndex, newIndex)
    await reorderReferences(reordered.map(r => r.id))
  }

  // ── Render export detail ──────────────────────────────────────────

  const renderExportDetail = (doc: UnifiedDoc) => {
    if (!doc.isExport || !doc.exportMeta) return null
    const meta = doc.exportMeta
    const isOpen = expandedExport === doc.id

    return (
      <div className={clsx(
        'ml-9 transition-all overflow-hidden',
        isOpen ? 'max-h-96 mt-1' : 'max-h-0'
      )}>
        <div className="bg-violet-50/50 rounded-lg border border-violet-100 px-3 py-2 text-xs space-y-1.5">
          {meta.generated_by_name && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <User className="w-3 h-3 text-gray-400" />
              <span>Generated by <span className="font-medium text-gray-800">{meta.generated_by_name}</span></span>
            </div>
          )}
          {meta.as_of_date && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <Calendar className="w-3 h-3 text-gray-400" />
              <span>As of {new Date(meta.as_of_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            </div>
          )}
          {meta.template_name && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <Layers className="w-3 h-3 text-gray-400" />
              <span>Template: <span className="font-medium text-gray-800">{meta.template_name}</span></span>
            </div>
          )}
          <div className="flex items-center gap-3 text-gray-500">
            {meta.sections_count != null && <span>{meta.sections_count} sections</span>}
            {meta.fields_count != null && <span>{meta.fields_count} fields</span>}
          </div>
          <div className="flex items-center gap-2 pt-1 border-t border-violet-100">
            <button
              onClick={(e) => { e.stopPropagation(); handleDocClick(doc) }}
              className="text-xs text-violet-600 hover:text-violet-800 font-medium"
            >
              Download
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render a single artifact row (two-line layout) ────────────────

  const renderDocRow = (doc: UnifiedDoc) => {
    const Icon = getDocIcon(doc)
    const isOwner = doc.createdBy === user?.id
    const isNote = doc.sourceType === 'platform' || doc.sourceType === 'written'
    const isPinned = doc.reference?.is_pinned
    const artifactType = getArtifactType(doc)
    const badge = ARTIFACT_BADGE[artifactType]
    const authorName = getUserName(doc)

    return (
      <div key={`${doc.type}-${doc.id}`}>
        <div
          onClick={() => {
            if (doc.isExport) {
              setExpandedExport(prev => prev === doc.id ? null : doc.id)
            } else {
              handleDocClick(doc)
            }
          }}
          className={clsx(
            'group flex items-start gap-2.5 px-2 py-2 rounded-md cursor-pointer transition-colors',
            isPinned ? 'bg-blue-50/30 hover:bg-blue-50/60' :
            doc.isExport ? 'bg-violet-50/20 hover:bg-violet-50/40' :
            'hover:bg-gray-50'
          )}
        >
          {/* Icon */}
          <div className={clsx(
            'w-7 h-7 rounded flex items-center justify-center flex-shrink-0 mt-0.5',
            doc.isExport ? 'bg-violet-100' :
            doc.sourceType === 'external_link' ? 'bg-blue-50' :
            isNote ? 'bg-amber-50' :
            doc.type === 'model' ? 'bg-green-50' :
            'bg-gray-100'
          )}>
            <Icon className={clsx(
              'w-4 h-4',
              doc.isExport ? 'text-violet-500' :
              doc.sourceType === 'external_link' ? 'text-blue-500' :
              isNote ? 'text-amber-600' :
              doc.type === 'model' ? 'text-green-600' :
              'text-gray-500'
            )} />
          </div>

          {/* Two-line content */}
          <div className="flex-1 min-w-0">
            {/* Line 1: Title */}
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-gray-900 truncate">
                {doc.title}
              </span>
              {doc.sourceType === 'external_link' && (
                <ExternalLink className="w-3 h-3 text-gray-400 flex-shrink-0" />
              )}
              {doc.isExport && (
                <ChevronDown className={clsx(
                  'w-3.5 h-3.5 text-violet-400 transition-transform flex-shrink-0',
                  expandedExport === doc.id && 'rotate-180'
                )} />
              )}
            </div>

            {/* Line 2: Metadata */}
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {/* Type badge */}
              <span className={clsx(
                'text-[10px] leading-none px-1.5 py-0.5 rounded border font-medium',
                badge.bgColor, badge.color
              )}>
                {badge.label}
              </span>

              {/* Author */}
              {authorName && (
                <span className="text-[11px] text-gray-400">{authorName}</span>
              )}

              {/* Separator + date */}
              <span className="text-[11px] text-gray-300">&middot;</span>
              <span className="text-[11px] text-gray-400">{formatDate(doc.updatedAt)}</span>

              {/* Export template info */}
              {doc.isExport && doc.exportMeta?.template_name && (
                <>
                  <span className="text-[11px] text-gray-300">&middot;</span>
                  <span className="text-[11px] text-violet-500">{doc.exportMeta.template_name}</span>
                </>
              )}

              {/* "In Latest Export" badge */}
              {doc.includedInLatestExport && (
                <span className="text-[10px] leading-none px-1.5 py-0.5 rounded border bg-violet-50 border-violet-200 text-violet-600 font-medium">
                  In Export
                </span>
              )}

              {/* Shared indicator */}
              {doc.isShared && !isOwner && (
                <Share2 className="w-3 h-3 text-gray-400 flex-shrink-0" />
              )}
            </div>
          </div>

          {/* Hover actions */}
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5">
            {/* Pin */}
            <button
              onClick={(e) => { e.stopPropagation(); handleTogglePin(doc) }}
              className={clsx(
                'p-1 rounded transition-colors',
                isPinned
                  ? 'text-blue-500 hover:text-blue-600 hover:bg-blue-100'
                  : 'text-gray-400 hover:text-blue-500 hover:bg-gray-100'
              )}
              title={isPinned ? 'Unpin' : 'Pin to Key Artifacts'}
            >
              <Pin className={clsx('w-3.5 h-3.5', isPinned && 'fill-current')} />
            </button>

            {/* Edit (notes only) */}
            {isNote && onNoteClick && (
              <button
                onClick={(e) => { e.stopPropagation(); onNoteClick(doc.id) }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                title="Edit"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Download (files/models) */}
            {!isNote && doc.sourceType !== 'external_link' && (
              <button
                onClick={(e) => { e.stopPropagation(); handleDocClick(doc) }}
                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                title="Download"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Delete */}
            {isOwner && (
              <button
                onClick={(e) => { e.stopPropagation(); setPendingDelete(doc) }}
                className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Export detail expansion */}
        {renderExportDetail(doc)}
      </div>
    )
  }

  // ── Content rendering ───────────────────────────────────────────

  const renderContent = () => (
    <div
      ref={dropZoneRef}
      className={clsx(
        isEmbedded ? '' : 'border-t border-gray-100 px-6 py-4',
        isDragOver && 'ring-2 ring-primary-400 ring-inset bg-primary-50/30 rounded-b-lg'
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="flex items-center justify-center py-8 mb-4 border-2 border-dashed border-primary-300 rounded-lg bg-primary-50/50">
          <div className="text-center">
            <Upload className="w-8 h-8 text-primary-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-primary-700">Drop files to upload</p>
            <p className="text-xs text-primary-500">PDF, Word, Excel, PPT, Images</p>
          </div>
        </div>
      )}

      {/* Toolbar: Filter dropdown + Search + Add */}
      <div className="flex items-center gap-2 mb-3">
        {/* Filter dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowFilterDropdown(!showFilterDropdown)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-md border transition-colors',
              filter !== 'all'
                ? 'border-primary-200 bg-primary-50 text-primary-700 font-medium'
                : 'border-gray-200 text-gray-600 hover:bg-gray-50'
            )}
          >
            <Filter className="w-3.5 h-3.5" />
            {activeFilterLabel}
            {filter !== 'all' && (
              <span className="text-xs text-primary-500">{filterCounts[filter]}</span>
            )}
            <ChevronDown className={clsx(
              'w-3 h-3 transition-transform',
              showFilterDropdown && 'rotate-180'
            )} />
          </button>

          {showFilterDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowFilterDropdown(false)} />
              <div className="absolute left-0 mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                {/* Main filters */}
                {FILTER_OPTIONS.filter(o => o.group === 'main').map(opt => {
                  const count = filterCounts[opt.value]
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { setFilter(opt.value); setShowFilterDropdown(false) }}
                      className={clsx(
                        'w-full px-3 py-1.5 text-sm text-left flex items-center justify-between hover:bg-gray-50',
                        filter === opt.value && 'bg-primary-50 text-primary-700 font-medium'
                      )}
                    >
                      <span>{opt.label}</span>
                      <span className={clsx(
                        'text-xs',
                        filter === opt.value ? 'text-primary-500' : 'text-gray-400'
                      )}>
                        {count}
                      </span>
                    </button>
                  )
                })}

                {/* Separator + type filters */}
                <div className="border-t border-gray-100 my-1" />
                <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  By Type
                </div>
                {FILTER_OPTIONS.filter(o => o.group === 'type').map(opt => {
                  const count = filterCounts[opt.value]
                  return (
                    <button
                      key={opt.value}
                      onClick={() => { setFilter(opt.value); setShowFilterDropdown(false) }}
                      className={clsx(
                        'w-full px-3 py-1.5 text-sm text-left flex items-center justify-between hover:bg-gray-50',
                        filter === opt.value && 'bg-primary-50 text-primary-700 font-medium',
                        count === 0 && filter !== opt.value && 'text-gray-400'
                      )}
                    >
                      <span>{opt.label}</span>
                      <span className={clsx(
                        'text-xs',
                        filter === opt.value ? 'text-primary-500' : 'text-gray-400'
                      )}>
                        {count}
                      </span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        {/* Add Button */}
        <div className="relative flex-shrink-0">
          <Button
            size="sm"
            onClick={() => setShowAddDropdown(!showAddDropdown)}
            disabled={isUploading}
          >
            <Plus className="w-4 h-4 mr-1" />
            Add
          </Button>

          {showAddDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowAddDropdown(false)} />
              <div className="absolute right-0 mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                {onCreateNote && (
                  <button
                    onClick={() => { onCreateNote(); setShowAddDropdown(false) }}
                    className="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 text-left"
                  >
                    <Edit3 className="w-5 h-5 text-gray-500 mt-0.5" />
                    <div>
                      <div className="font-medium text-sm text-gray-900">Write Note</div>
                      <div className="text-xs text-gray-500">Create a new research note</div>
                    </div>
                  </button>
                )}

                <label className="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 text-left cursor-pointer">
                  <Upload className="w-5 h-5 text-gray-500 mt-0.5" />
                  <div>
                    <div className="font-medium text-sm text-gray-900">Upload Document</div>
                    <div className="text-xs text-gray-500">PDF, Word, Excel, PPT, etc.</div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp"
                    onChange={(e) => {
                      if (e.target.files?.length) handleUploadFiles(e.target.files)
                      e.target.value = ''
                      setShowAddDropdown(false)
                    }}
                  />
                </label>

                <button
                  onClick={() => { setShowExternalModal(true); setShowAddDropdown(false) }}
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
      </div>

      {/* Upload indicator */}
      {isUploading && (
        <div className="flex items-center gap-2 mb-3 px-2 py-2 bg-primary-50 rounded-lg text-sm text-primary-700">
          <div className="animate-spin w-4 h-4 border-2 border-primary-500 border-t-transparent rounded-full" />
          Uploading...
        </div>
      )}

      {/* Key Artifacts (pinned section) — only on Library/All view */}
      {pinnedDocs.length > 0 && filter === 'all' && (
        <div className="mb-4">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Pin className="w-3 h-3 text-blue-500" />
            <span className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">Key Artifacts</span>
            <span className="text-[11px] text-blue-400">({pinnedDocs.length})</span>
          </div>
          <div className="bg-blue-50/20 rounded-lg border border-blue-100/60 py-0.5">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handlePinnedDragEnd}
            >
              <SortableContext
                items={pinnedDocs.map(d => d.reference!.id)}
                strategy={verticalListSortingStrategy}
              >
                {pinnedDocs.map(doc => (
                  <SortablePinnedItem
                    key={doc.reference!.id}
                    doc={doc}
                    onDocClick={handleDocClick}
                    onUnpin={(refId) => togglePinned(refId)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
        </div>
      )}

      {/* Document list */}
      {isLoading ? (
        <div className="py-8 text-center text-gray-500">
          <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-2" />
          Loading...
        </div>
      ) : filteredDocs.length === 0 ? (
        <div
          className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-200 cursor-pointer hover:border-primary-300 hover:bg-primary-50/30 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 font-medium mb-1">
            {allDocs.length === 0
              ? 'No documents yet'
              : 'No matching artifacts'}
          </p>
          <p className="text-xs text-gray-500">
            Drop files here, or click to upload
          </p>
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto -mx-2 px-2">
          <div className="space-y-px">
            {paginatedDocs.map(doc => renderDocRow(doc))}
          </div>

          {hasMore && (
            <button
              onClick={() => setDisplayCount(prev => prev + 8)}
              className="w-full py-1.5 mt-1 text-xs text-primary-600 hover:text-primary-700 font-medium hover:bg-primary-50 rounded transition-colors"
            >
              Show More ({filteredDocs.length - displayCount} more)
            </button>
          )}
        </div>
      )}
    </div>
  )

  const externalModal = (
    <ExternalLinkModal
      isOpen={showExternalModal}
      onClose={() => setShowExternalModal(false)}
      onSubmit={handleCreateExternal}
      type="document"
      isLoading={isCreatingExternal}
    />
  )

  const deleteConfirmModal = (
    <ConfirmDialog
      isOpen={!!pendingDelete}
      onClose={() => setPendingDelete(null)}
      onConfirm={handleConfirmDelete}
      title="Delete document"
      message={`Are you sure you want to delete "${pendingDelete?.title || 'this document'}"? This action cannot be undone.`}
      confirmText="Delete"
      cancelText="Cancel"
      variant="danger"
      isLoading={isDeletingDoc}
    />
  )

  // Embedded mode — no Card wrapper
  if (isEmbedded) {
    return (
      <>
        {renderContent()}
        {externalModal}
        {deleteConfirmModal}
      </>
    )
  }

  // Non-embedded: Card wrapper with header
  return (
    <>
      <Card padding="none">
        <button
          onClick={onToggleExpanded}
          className="w-full px-6 py-4 flex items-center gap-2 hover:bg-gray-50 transition-colors"
        >
          <Library className="w-4 h-4 text-gray-500" />
          <span className="font-medium text-gray-900">Asset Library</span>
          <span className="text-sm text-gray-500">({totalCount})</span>
          {keyCount > 0 && (
            <span className="text-xs text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded flex items-center gap-1">
              <Pin className="w-3 h-3" />
              {keyCount} pinned
            </span>
          )}
          <div className="flex-1" />
          {isExpanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </button>

        {isExpanded && renderContent()}
      </Card>
      {externalModal}
      {deleteConfirmModal}
    </>
  )
}
