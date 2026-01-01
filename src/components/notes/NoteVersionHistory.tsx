import React from 'react'
import { History, RotateCcw, User, Clock, Eye, ChevronRight, FileText } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { useNoteVersions, type NoteType, type NoteVersion } from '../../hooks/useNoteVersions'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { clsx } from 'clsx'
import { stripHtml } from '../../utils/stripHtml'

// Helper to get a content preview snippet
const getContentPreview = (content: string | null, maxLength: number = 100): string => {
  if (!content) return 'No content'
  const text = stripHtml(content).trim()
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength).trim() + '...'
}

// Helper to get character count (plain text only)
const getCharCount = (content: string | null): number => {
  if (!content) return 0
  const text = stripHtml(content).trim()
  return text.length
}

// Format character count for display
const formatCharCount = (count: number): string => {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k chars`
  }
  return `${count} chars`
}

interface NoteVersionHistoryProps {
  noteId: string
  noteType: NoteType
  isOpen: boolean
  onClose: () => void
  onRestore?: (version: NoteVersion) => void
}

export function NoteVersionHistory({
  noteId,
  noteType,
  isOpen,
  onClose,
  onRestore
}: NoteVersionHistoryProps) {
  const {
    versions,
    isLoading,
    restoreVersion,
    isRestoring,
    getVersionAuthor,
    fetchVersionContent
  } = useNoteVersions(noteId, noteType)

  const [previewVersion, setPreviewVersion] = React.useState<NoteVersion | null>(null)
  const [previewContent, setPreviewContent] = React.useState<string | null>(null)
  const [isLoadingContent, setIsLoadingContent] = React.useState(false)
  const [confirmRestore, setConfirmRestore] = React.useState<string | null>(null)

  // Load content when preview version changes
  const handlePreviewVersion = async (version: NoteVersion | null) => {
    if (!version) {
      setPreviewVersion(null)
      setPreviewContent(null)
      return
    }

    setPreviewVersion(version)
    setIsLoadingContent(true)
    try {
      const content = await fetchVersionContent(version.id)
      setPreviewContent(content)
    } catch (error) {
      console.error('Failed to load version content:', error)
      setPreviewContent(null)
    } finally {
      setIsLoadingContent(false)
    }
  }

  if (!isOpen) return null

  const handleRestore = async (version: NoteVersion) => {
    try {
      await restoreVersion({
        versionId: version.id,
        noteId,
        noteType
      })
      onRestore?.(version)
      setConfirmRestore(null)
      onClose()
    } catch (error) {
      console.error('Failed to restore version:', error)
    }
  }

  const getReasonLabel = (reason: string) => {
    switch (reason) {
      case 'auto':
        return 'Auto-saved'
      case 'manual':
        return 'Manual save'
      case 'restore':
        return 'Before restore'
      default:
        return reason
    }
  }

  const getReasonColor = (reason: string) => {
    switch (reason) {
      case 'auto':
        return 'default'
      case 'manual':
        return 'primary'
      case 'restore':
        return 'warning'
      default:
        return 'default'
    }
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="absolute right-0 top-0 h-full w-[480px] bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-2">
            <History className="h-5 w-5 text-gray-600" />
            <h2 className="text-lg font-semibold text-gray-900">Version History</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 text-center text-gray-500">
              Loading version history...
            </div>
          ) : versions.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <History className="h-12 w-12 mx-auto mb-3 text-gray-300" />
              <p className="font-medium">No version history yet</p>
              <p className="text-sm mt-1">Versions are created automatically as you edit.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {versions.map((version, index) => (
                <div
                  key={version.id}
                  className={clsx(
                    'p-4 hover:bg-gray-50 transition-colors cursor-pointer',
                    previewVersion?.id === version.id && 'bg-primary-50 border-l-2 border-primary-500'
                  )}
                  onClick={() => handlePreviewVersion(previewVersion?.id === version.id ? null : version)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="font-medium text-gray-900">
                          v{version.version_number}
                        </span>
                        <Badge variant={getReasonColor(version.version_reason)} size="sm">
                          {getReasonLabel(version.version_reason)}
                        </Badge>
                        {index === 0 && (
                          <Badge variant="success" size="sm">Latest</Badge>
                        )}
                      </div>

                      <p className="text-sm font-medium text-gray-800 truncate">
                        {version.title}
                      </p>

                      <div className="flex items-center space-x-3 mt-2 text-xs text-gray-400">
                        <span className="flex items-center">
                          <Clock className="h-3 w-3 mr-1" />
                          {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                        </span>
                        <span className="flex items-center">
                          <User className="h-3 w-3 mr-1" />
                          {getVersionAuthor(version)}
                        </span>
                      </div>
                    </div>

                    <div className="ml-3 flex items-center space-x-1">
                      {/* Preview indicator */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handlePreviewVersion(previewVersion?.id === version.id ? null : version)
                        }}
                        className={clsx(
                          'p-1.5 rounded-md transition-colors',
                          previewVersion?.id === version.id
                            ? 'bg-primary-100 text-primary-600'
                            : 'hover:bg-gray-100 text-gray-400'
                        )}
                        title="Preview this version"
                      >
                        <Eye className="h-4 w-4" />
                      </button>

                      {confirmRestore === version.id ? (
                        <div className="flex items-center space-x-1">
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRestore(version)
                            }}
                            disabled={isRestoring}
                          >
                            {isRestoring ? '...' : 'Restore'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmRestore(null)
                            }}
                          >
                            ×
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setConfirmRestore(version.id)
                          }}
                          className="p-1.5 rounded-md hover:bg-gray-100 text-gray-400 transition-colors"
                          title="Restore this version"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Preview Panel */}
        {previewVersion && (
          <div className="border-t-2 border-primary-200 bg-white flex-shrink-0" style={{ height: '45%' }}>
            <div className="flex items-center justify-between px-4 py-3 bg-primary-50 border-b border-primary-100">
              <div className="flex items-center space-x-3">
                <Eye className="h-4 w-4 text-primary-600" />
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Version {previewVersion.version_number} Preview
                  </h3>
                  <p className="text-xs text-gray-500">
                    {format(new Date(previewVersion.created_at), 'MMM d, yyyy h:mm a')}
                    {previewContent && ` · ${formatCharCount(getCharCount(previewContent))}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    setConfirmRestore(previewVersion.id)
                  }}
                  disabled={isLoadingContent}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Restore
                </Button>
                <button
                  onClick={() => handlePreviewVersion(null)}
                  className="p-1.5 hover:bg-primary-100 rounded-md text-gray-500 hover:text-gray-700 transition-colors"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto" style={{ height: 'calc(100% - 60px)' }}>
              <h4 className="text-lg font-semibold text-gray-900 mb-3 pb-2 border-b border-gray-100">
                {previewVersion.title}
              </h4>
              {isLoadingContent ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary-500 border-t-transparent" />
                  <span className="ml-2 text-sm text-gray-500">Loading content...</span>
                </div>
              ) : previewContent ? (
                <div
                  className="prose prose-sm max-w-none text-gray-700"
                  dangerouslySetInnerHTML={{ __html: previewContent }}
                />
              ) : (
                <p className="text-gray-400 italic">No content in this version</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
