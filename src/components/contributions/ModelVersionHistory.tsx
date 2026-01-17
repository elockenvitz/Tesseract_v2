import React, { useState } from 'react'
import { clsx } from 'clsx'
import {
  X,
  History,
  Download,
  RotateCcw,
  Check,
  Clock,
  User,
  FileSpreadsheet,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { Button } from '../ui/Button'
import { useModelVersions, type ModelVersion } from '../../hooks/useAssetModels'
import { useAssetModels } from '../../hooks/useAssetModels'

interface ModelVersionHistoryProps {
  isOpen: boolean
  onClose: () => void
  modelId: string
  assetId: string
  modelName: string
  currentVersion: number
}

export function ModelVersionHistory({
  isOpen,
  onClose,
  modelId,
  assetId,
  modelName,
  currentVersion
}: ModelVersionHistoryProps) {
  const {
    versions,
    isLoading,
    getVersionDownloadUrl,
    getVersionAuthor
  } = useModelVersions(modelId)

  const { restoreVersion, isRestoring } = useAssetModels(assetId)

  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)

  const handleDownload = async (version: ModelVersion) => {
    setDownloadingId(version.id)
    try {
      const url = await getVersionDownloadUrl(version)
      if (url) {
        // Create a temporary link and trigger download
        const link = document.createElement('a')
        link.href = url
        link.download = version.file_name
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    } catch (error) {
      console.error('Download failed:', error)
    } finally {
      setDownloadingId(null)
    }
  }

  const handleRestore = async (version: ModelVersion) => {
    try {
      await restoreVersion({
        modelId,
        versionId: version.id
      })
      setConfirmRestoreId(null)
      onClose()
    } catch (error) {
      console.error('Restore failed:', error)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
              <History className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{modelName}</h2>
              <p className="text-sm text-gray-500">Version History</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current version indicator */}
        <div className="px-6 py-3 bg-primary-50 border-b border-primary-100">
          <div className="flex items-center gap-2 text-sm">
            <Check className="w-4 h-4 text-primary-600" />
            <span className="text-primary-700 font-medium">
              Current version: v{currentVersion}
            </span>
          </div>
        </div>

        {/* Version list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="py-12 text-center text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading version history...
            </div>
          ) : versions.length === 0 ? (
            <div className="py-12 text-center">
              <History className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-600 font-medium">No version history yet</p>
              <p className="text-sm text-gray-500 mt-1">
                Upload new versions to see them here
              </p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {versions.map((version, index) => {
                const isExpanded = expandedVersionId === version.id
                const isLatestArchived = index === 0
                const isDownloading = downloadingId === version.id
                const showConfirmRestore = confirmRestoreId === version.id

                return (
                  <div key={version.id} className="px-6 py-4">
                    {/* Main row */}
                    <div className="flex items-start gap-3">
                      {/* Version indicator */}
                      <div className={clsx(
                        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-medium',
                        isLatestArchived
                          ? 'bg-gray-200 text-gray-600'
                          : 'bg-gray-100 text-gray-500'
                      )}>
                        v{version.version_number}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-gray-900">
                            {version.file_name}
                          </span>
                          {isLatestArchived && (
                            <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                              Previous
                            </span>
                          )}
                        </div>

                        {/* Metadata */}
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {format(new Date(version.created_at), 'MMM d, yyyy h:mm a')}
                          </span>
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {getVersionAuthor(version)}
                          </span>
                        </div>

                        {/* Change summary */}
                        {version.change_summary && (
                          <p className="mt-2 text-sm text-gray-600 italic border-l-2 border-gray-200 pl-3">
                            "{version.change_summary}"
                          </p>
                        )}

                        {/* Expanded details */}
                        {isExpanded && (
                          <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm">
                            <div className="grid grid-cols-2 gap-2 text-gray-600">
                              <div>
                                <span className="text-gray-400">Size:</span>{' '}
                                {version.file_size
                                  ? `${(version.file_size / 1024).toFixed(1)} KB`
                                  : 'Unknown'}
                              </div>
                              <div>
                                <span className="text-gray-400">Type:</span>{' '}
                                {version.file_type || 'Unknown'}
                              </div>
                              <div className="col-span-2">
                                <span className="text-gray-400">Created:</span>{' '}
                                {formatDistanceToNow(new Date(version.created_at), { addSuffix: true })}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Restore confirmation */}
                        {showConfirmRestore && (
                          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <p className="text-sm font-medium text-amber-800">
                                  Restore to version {version.version_number}?
                                </p>
                                <p className="text-xs text-amber-700 mt-1">
                                  The current version will be saved before restoring.
                                </p>
                                <div className="flex gap-2 mt-3">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => setConfirmRestoreId(null)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => handleRestore(version)}
                                    disabled={isRestoring}
                                  >
                                    {isRestoring && (
                                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                                    )}
                                    Restore
                                  </Button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => setExpandedVersionId(
                            isExpanded ? null : version.id
                          )}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                          title={isExpanded ? 'Hide details' : 'Show details'}
                        >
                          {isExpanded ? (
                            <ChevronUp className="w-4 h-4" />
                          ) : (
                            <ChevronDown className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => handleDownload(version)}
                          disabled={isDownloading}
                          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded disabled:opacity-50"
                          title="Download"
                        >
                          {isDownloading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download className="w-4 h-4" />
                          )}
                        </button>

                        <button
                          onClick={() => setConfirmRestoreId(version.id)}
                          disabled={isRestoring}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded disabled:opacity-50"
                          title="Restore this version"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {versions.length} version{versions.length !== 1 ? 's' : ''} in history
            </p>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
