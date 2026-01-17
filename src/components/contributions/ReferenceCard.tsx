import React, { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  FileSpreadsheet,
  FileText,
  File,
  Link2,
  Presentation,
  Edit3,
  MoreVertical,
  Trash2,
  Pin,
  AlertTriangle,
  Star,
  ExternalLink,
  Download,
  History,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  ArrowDown,
  Check,
  X
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import type { KeyReference, ReferenceImportance } from '../../hooks/useKeyReferences'

interface ReferenceCardProps {
  reference: KeyReference
  onEdit?: (id: string, description: string) => void
  onDelete?: (id: string) => void
  onTogglePin?: (id: string) => void
  onSetImportance?: (id: string, importance: ReferenceImportance) => void
  onClick?: () => void
  onViewHistory?: () => void
  isCompact?: boolean
}

const IMPORTANCE_CONFIG: Record<ReferenceImportance, {
  label: string
  color: string
  bgColor: string
  borderColor: string
  icon?: React.ElementType
}> = {
  critical: {
    label: 'Critical',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    icon: AlertTriangle
  },
  high: {
    label: 'High',
    color: 'text-amber-700',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    icon: Star
  },
  normal: {
    label: 'Normal',
    color: 'text-gray-600',
    bgColor: 'bg-white',
    borderColor: 'border-gray-200'
  },
  low: {
    label: 'Low',
    color: 'text-gray-400',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-100'
  }
}

function getDocumentIcon(reference: KeyReference) {
  if (reference.reference_type === 'external_link') return Link2
  if (reference.reference_type === 'note') return Edit3
  if (reference.reference_type === 'slide') return Presentation

  // For models/files, check file type
  const fileName = reference.target_model?.file_name?.toLowerCase() || ''
  const fileType = reference.target_model?.file_type?.toLowerCase() || ''

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

  return FileSpreadsheet // Default for models
}

function formatDate(dateStr: string): string {
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true })
  } catch {
    return 'Unknown date'
  }
}

export function ReferenceCard({
  reference,
  onEdit,
  onDelete,
  onTogglePin,
  onSetImportance,
  onClick,
  onViewHistory,
  isCompact = false
}: ReferenceCardProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [isEditingAnnotation, setIsEditingAnnotation] = useState(false)
  const [annotationText, setAnnotationText] = useState(reference.description || '')
  const [showImportanceMenu, setShowImportanceMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const importanceRef = useRef<HTMLDivElement>(null)

  const importanceConfig = IMPORTANCE_CONFIG[reference.importance]
  const Icon = getDocumentIcon(reference)

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false)
      }
      if (importanceRef.current && !importanceRef.current.contains(event.target as Node)) {
        setShowImportanceMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSaveAnnotation = () => {
    if (onEdit && annotationText !== reference.description) {
      onEdit(reference.id, annotationText)
    }
    setIsEditingAnnotation(false)
  }

  const handleCancelAnnotation = () => {
    setAnnotationText(reference.description || '')
    setIsEditingAnnotation(false)
  }

  // Get display info
  const isExternal = reference.reference_type === 'external_link'
  const isNote = reference.reference_type === 'note'
  const isModel = reference.reference_type === 'model'

  const updatedAt = isNote && reference.target_note?.updated_at
    ? reference.target_note.updated_at
    : isModel && reference.target_model?.updated_at
      ? reference.target_model.updated_at
      : reference.updated_at

  const version = isModel && reference.target_model?.version
    ? reference.target_model.version
    : null

  if (isCompact) {
    return (
      <div
        onClick={onClick}
        className={clsx(
          'group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all',
          importanceConfig.bgColor,
          importanceConfig.borderColor,
          'border hover:shadow-sm',
          reference.importance === 'critical' && 'ring-1 ring-red-300'
        )}
      >
        {/* Icon */}
        <div className={clsx(
          'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
          isExternal ? 'bg-blue-100' :
          isNote ? 'bg-amber-100' :
          'bg-emerald-100'
        )}>
          <Icon className={clsx(
            'w-4 h-4',
            isExternal ? 'text-blue-600' :
            isNote ? 'text-amber-600' :
            'text-emerald-600'
          )} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {reference.title}
            </span>
            {reference.is_pinned && (
              <Pin className="w-3 h-3 text-primary-500 flex-shrink-0" />
            )}
            {isExternal && (
              <ExternalLink className="w-3 h-3 text-gray-400 flex-shrink-0" />
            )}
          </div>
          {reference.description && (
            <p className="text-xs text-gray-500 truncate mt-0.5">
              {reference.description}
            </p>
          )}
        </div>

        {/* Metadata */}
        <div className="flex items-center gap-2 text-xs text-gray-400 flex-shrink-0">
          {version && <span>v{version}</span>}
          <span>{formatDate(updatedAt)}</span>
        </div>

        {/* Actions on hover */}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setShowMenu(!showMenu)
            }}
            className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
      </div>
    )
  }

  // Full card view
  return (
    <div
      className={clsx(
        'group relative rounded-lg border transition-all',
        importanceConfig.bgColor,
        importanceConfig.borderColor,
        reference.importance === 'critical' && 'ring-1 ring-red-300',
        'hover:shadow-md'
      )}
    >
      {/* Main content area */}
      <div
        onClick={onClick}
        className="px-4 py-3 cursor-pointer"
      >
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={clsx(
            'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
            isExternal ? 'bg-blue-100' :
            isNote ? 'bg-amber-100' :
            'bg-emerald-100'
          )}>
            <Icon className={clsx(
              'w-5 h-5',
              isExternal ? 'text-blue-600' :
              isNote ? 'text-amber-600' :
              'text-emerald-600'
            )} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-sm font-medium text-gray-900 truncate">
                {reference.title}
              </h4>
              {reference.is_pinned && (
                <Pin className="w-3.5 h-3.5 text-primary-500 flex-shrink-0" />
              )}
              {reference.importance !== 'normal' && importanceConfig.icon && (
                <importanceConfig.icon className={clsx('w-3.5 h-3.5 flex-shrink-0', importanceConfig.color)} />
              )}
            </div>

            {/* Metadata row */}
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {isExternal && reference.external_provider && (
                <span className="capitalize">{reference.external_provider.replace('_', ' ')}</span>
              )}
              {isNote && <span>Note</span>}
              {isModel && (
                <>
                  <span>Model</span>
                  {version && (
                    <span className="text-gray-400">v{version}</span>
                  )}
                  {version && version > 1 && onViewHistory && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onViewHistory()
                      }}
                      className="flex items-center gap-0.5 text-primary-600 hover:text-primary-700"
                    >
                      <History className="w-3 h-3" />
                      <span>{version} versions</span>
                    </button>
                  )}
                </>
              )}
              <span className="text-gray-400">·</span>
              <span>{formatDate(updatedAt)}</span>
            </div>

            {/* Annotation */}
            {isEditingAnnotation ? (
              <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                <textarea
                  value={annotationText}
                  onChange={(e) => setAnnotationText(e.target.value)}
                  placeholder="Why is this important to your thesis?"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent resize-none"
                  rows={2}
                  autoFocus
                />
                <div className="flex justify-end gap-2 mt-2">
                  <button
                    onClick={handleCancelAnnotation}
                    className="px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 rounded"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAnnotation}
                    className="px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700"
                  >
                    Save
                  </button>
                </div>
              </div>
            ) : reference.description ? (
              <p
                onClick={(e) => {
                  e.stopPropagation()
                  setIsEditingAnnotation(true)
                }}
                className="mt-2 text-sm text-gray-600 italic border-l-2 border-gray-200 pl-3 cursor-text hover:bg-gray-50 rounded-r py-1"
              >
                "{reference.description}"
              </p>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsEditingAnnotation(true)
                }}
                className="mt-2 text-xs text-gray-400 hover:text-gray-600 italic"
              >
                + Add annotation
              </button>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {/* Importance selector */}
            <div className="relative" ref={importanceRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowImportanceMenu(!showImportanceMenu)
                }}
                className={clsx(
                  'p-1.5 rounded hover:bg-gray-100',
                  importanceConfig.color
                )}
                title="Set importance"
              >
                {importanceConfig.icon ? (
                  <importanceConfig.icon className="w-4 h-4" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
              </button>

              {showImportanceMenu && (
                <div className="absolute right-0 top-full mt-1 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  {(Object.entries(IMPORTANCE_CONFIG) as [ReferenceImportance, typeof IMPORTANCE_CONFIG.critical][]).map(([key, config]) => (
                    <button
                      key={key}
                      onClick={(e) => {
                        e.stopPropagation()
                        onSetImportance?.(reference.id, key)
                        setShowImportanceMenu(false)
                      }}
                      className={clsx(
                        'w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 hover:bg-gray-50',
                        reference.importance === key && 'bg-gray-50'
                      )}
                    >
                      {config.icon ? (
                        <config.icon className={clsx('w-4 h-4', config.color)} />
                      ) : (
                        <div className="w-4 h-4" />
                      )}
                      <span className={config.color}>{config.label}</span>
                      {reference.importance === key && (
                        <Check className="w-3 h-3 ml-auto text-primary-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* More menu */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowMenu(!showMenu)
                }}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
                  {onTogglePin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTogglePin(reference.id)
                        setShowMenu(false)
                      }}
                      className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-gray-50"
                    >
                      <Pin className="w-4 h-4 text-gray-500" />
                      {reference.is_pinned ? 'Unpin' : 'Pin to top'}
                    </button>
                  )}

                  {isExternal && reference.external_url && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        window.open(reference.external_url!, '_blank')
                        setShowMenu(false)
                      }}
                      className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-gray-50"
                    >
                      <ExternalLink className="w-4 h-4 text-gray-500" />
                      Open link
                    </button>
                  )}

                  {isModel && onViewHistory && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onViewHistory()
                        setShowMenu(false)
                      }}
                      className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-gray-50"
                    >
                      <History className="w-4 h-4 text-gray-500" />
                      Version history
                    </button>
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setIsEditingAnnotation(true)
                      setShowMenu(false)
                    }}
                    className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-gray-50"
                  >
                    <Edit3 className="w-4 h-4 text-gray-500" />
                    Edit annotation
                  </button>

                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(reference.id)
                        setShowMenu(false)
                      }}
                      className="w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-gray-50 text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
