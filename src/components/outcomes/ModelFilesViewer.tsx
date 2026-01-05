import { useState } from 'react'
import { clsx } from 'clsx'
import {
  FileSpreadsheet,
  Download,
  Trash2,
  Clock,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Eye,
  History,
  User,
  GitCompare,
  ArrowUp,
  ArrowDown,
  Minus,
  RotateCcw
} from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { useModelFiles, type ModelFile } from '../../hooks/useModelTemplates'
import { useAuth } from '../../hooks/useAuth'

interface ModelFilesViewerProps {
  assetId: string
  className?: string
}

// Sync status badge
function SyncStatusBadge({ status }: { status: ModelFile['sync_status'] }) {
  const config = {
    pending: { icon: Clock, color: 'text-gray-500 bg-gray-100', label: 'Pending' },
    processing: { icon: Loader2, color: 'text-blue-600 bg-blue-100', label: 'Processing', animate: true },
    synced: { icon: CheckCircle2, color: 'text-green-600 bg-green-100', label: 'Synced' },
    error: { icon: AlertCircle, color: 'text-red-600 bg-red-100', label: 'Error' }
  }

  const { icon: Icon, color, label, animate } = config[status] || config.pending

  return (
    <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium', color)}>
      <Icon className={clsx('w-3 h-3', animate && 'animate-spin')} />
      {label}
    </span>
  )
}

// Version comparison component
interface VersionComparisonProps {
  currentFile: ModelFile
  previousFile?: ModelFile
}

function VersionComparison({ currentFile, previousFile }: VersionComparisonProps) {
  if (!previousFile || !currentFile.extracted_data?.values || !previousFile.extracted_data?.values) {
    return null
  }

  const currentValues = currentFile.extracted_data.values as Array<{ field: string; formattedValue: any; label?: string }>
  const previousValues = previousFile.extracted_data.values as Array<{ field: string; formattedValue: any; label?: string }>

  const previousMap = new Map(previousValues.map(v => [v.field, v.formattedValue]))

  const changes: Array<{
    field: string
    label: string
    oldValue: any
    newValue: any
    change: 'up' | 'down' | 'same' | 'new'
  }> = []

  for (const curr of currentValues) {
    const prev = previousMap.get(curr.field)
    if (prev === undefined) {
      changes.push({
        field: curr.field,
        label: curr.label || curr.field,
        oldValue: null,
        newValue: curr.formattedValue,
        change: 'new'
      })
    } else if (prev !== curr.formattedValue) {
      const numCurr = typeof curr.formattedValue === 'number' ? curr.formattedValue : parseFloat(curr.formattedValue)
      const numPrev = typeof prev === 'number' ? prev : parseFloat(prev)

      changes.push({
        field: curr.field,
        label: curr.label || curr.field,
        oldValue: prev,
        newValue: curr.formattedValue,
        change: !isNaN(numCurr) && !isNaN(numPrev) ? (numCurr > numPrev ? 'up' : 'down') : 'same'
      })
    }
  }

  if (changes.length === 0) {
    return (
      <div className="text-xs text-gray-500 italic">
        No changes from previous version
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <h6 className="text-xs font-medium text-gray-700 flex items-center gap-1">
        <GitCompare className="w-3 h-3" />
        Changes from v{previousFile.version}
      </h6>
      <div className="space-y-1">
        {changes.slice(0, 5).map((change, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="text-gray-600">{change.label}</span>
            <div className="flex items-center gap-2">
              {change.oldValue !== null && (
                <span className="text-gray-400 line-through">
                  {typeof change.oldValue === 'number' ? change.oldValue.toLocaleString() : change.oldValue}
                </span>
              )}
              <span className={clsx(
                'font-medium flex items-center gap-0.5',
                change.change === 'up' ? 'text-green-600' :
                change.change === 'down' ? 'text-red-600' :
                change.change === 'new' ? 'text-blue-600' : 'text-gray-900'
              )}>
                {change.change === 'up' && <ArrowUp className="w-3 h-3" />}
                {change.change === 'down' && <ArrowDown className="w-3 h-3" />}
                {typeof change.newValue === 'number' ? change.newValue.toLocaleString() : change.newValue}
              </span>
            </div>
          </div>
        ))}
        {changes.length > 5 && (
          <div className="text-xs text-gray-400">+{changes.length - 5} more changes</div>
        )}
      </div>
    </div>
  )
}

// File row component
interface FileRowProps {
  file: ModelFile
  previousVersion?: ModelFile
  isOwner: boolean
  onDownload: () => void
  onDelete: () => void
  onResync?: () => void
  isDeleting: boolean
  isResyncing?: boolean
}

function FileRow({ file, previousVersion, isOwner, onDownload, onDelete, onResync, isDeleting, isResyncing }: FileRowProps) {
  const [showDetails, setShowDetails] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showComparison, setShowComparison] = useState(false)

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete()
      setConfirmDelete(false)
    } else {
      setConfirmDelete(true)
      // Auto-cancel after 3 seconds
      setTimeout(() => setConfirmDelete(false), 3000)
    }
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Main row */}
      <div className="flex items-center gap-3 p-3 bg-white hover:bg-gray-50">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="p-1 text-gray-400 hover:text-gray-600"
        >
          {showDetails ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>

        <FileSpreadsheet className="w-8 h-8 text-green-600 flex-shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-900 truncate">
              {file.filename}
            </span>
            {file.version > 1 && (
              <span className="text-xs text-gray-500">v{file.version}</span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}
            </span>
            {file.user && (
              <span className="flex items-center gap-1">
                <User className="w-3 h-3" />
                {file.user.first_name} {file.user.last_name}
              </span>
            )}
            {file.template && (
              <span className="text-gray-400">
                Template: {file.template.name}
              </span>
            )}
          </div>
        </div>

        <SyncStatusBadge status={file.sync_status} />

        <div className="flex items-center gap-1">
          {/* Re-sync button */}
          {isOwner && onResync && file.sync_status === 'synced' && (
            <button
              onClick={onResync}
              disabled={isResyncing}
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
              title="Re-sync data from file"
            >
              {isResyncing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4" />
              )}
            </button>
          )}

          {/* Version comparison toggle */}
          {previousVersion && (
            <button
              onClick={() => setShowComparison(!showComparison)}
              className={clsx(
                'p-1.5 rounded transition-colors',
                showComparison
                  ? 'text-blue-600 bg-blue-50'
                  : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
              )}
              title="Compare with previous version"
            >
              <GitCompare className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={onDownload}
            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
            title="Download"
          >
            <Download className="w-4 h-4" />
          </button>
          {isOwner && (
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className={clsx(
                'p-1.5 rounded transition-colors',
                confirmDelete
                  ? 'text-white bg-red-500 hover:bg-red-600'
                  : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
              )}
              title={confirmDelete ? 'Click again to confirm' : 'Delete'}
            >
              {isDeleting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Details panel */}
      {showDetails && (
        <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 text-sm">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-gray-500">File Size:</span>
              <span className="ml-2 text-gray-900">
                {file.file_size ? `${(file.file_size / 1024).toFixed(1)} KB` : 'Unknown'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Uploaded:</span>
              <span className="ml-2 text-gray-900">
                {format(new Date(file.created_at), 'MMM d, yyyy h:mm a')}
              </span>
            </div>
            {file.synced_at && (
              <div>
                <span className="text-gray-500">Last Synced:</span>
                <span className="ml-2 text-gray-900">
                  {format(new Date(file.synced_at), 'MMM d, yyyy h:mm a')}
                </span>
              </div>
            )}
            {file.sync_error && (
              <div className="col-span-2">
                <span className="text-red-600">Error:</span>
                <span className="ml-2 text-red-700">{file.sync_error}</span>
              </div>
            )}
          </div>

          {/* Extracted data preview */}
          {file.extracted_data && (
            <div className="mt-3 pt-3 border-t border-gray-200">
              <h5 className="text-xs font-medium text-gray-700 mb-2">Extracted Data</h5>
              <div className="grid grid-cols-3 gap-2">
                {file.extracted_data.values?.slice(0, 6).map((val: any, i: number) => (
                  <div key={i} className="text-xs">
                    <span className="text-gray-500">{val.label || val.field}:</span>
                    <span className="ml-1 text-gray-900">
                      {val.formattedValue ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
              {file.extracted_data.values?.length > 6 && (
                <p className="text-xs text-gray-400 mt-1">
                  +{file.extracted_data.values.length - 6} more fields
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Version comparison panel */}
      {showComparison && previousVersion && (
        <div className="px-4 py-3 bg-blue-50 border-t border-blue-200">
          <VersionComparison currentFile={file} previousFile={previousVersion} />
        </div>
      )}
    </div>
  )
}

// Main component
export function ModelFilesViewer({ assetId, className }: ModelFilesViewerProps) {
  const { user } = useAuth()
  const {
    files,
    myFiles,
    isLoading,
    deleteFile,
    getDownloadUrl,
    resyncFile
  } = useModelFiles({ assetId, latestOnly: false })

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [resyncingId, setResyncingId] = useState<string | null>(null)

  // Build a map of previous versions for each file
  const previousVersionMap = new Map<string, ModelFile>()
  const sortedFiles = [...files].sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
  // Group by user to find previous versions
  const filesByUser = new Map<string, ModelFile[]>()
  for (const file of sortedFiles) {
    const userFiles = filesByUser.get(file.user_id) || []
    userFiles.push(file)
    filesByUser.set(file.user_id, userFiles)
  }
  // Map each file to its previous version (same user, older)
  for (const [userId, userFiles] of filesByUser) {
    for (let i = 0; i < userFiles.length - 1; i++) {
      previousVersionMap.set(userFiles[i].id, userFiles[i + 1])
    }
  }

  // Handle download
  const handleDownload = async (file: ModelFile) => {
    try {
      const url = await getDownloadUrl(file.storage_path)
      window.open(url, '_blank')
    } catch (err) {
      console.error('Download error:', err)
    }
  }

  // Handle delete
  const handleDelete = async (fileId: string) => {
    setDeletingId(fileId)
    try {
      await deleteFile.mutateAsync(fileId)
    } catch (err) {
      console.error('Delete error:', err)
    } finally {
      setDeletingId(null)
    }
  }

  // Handle resync
  const handleResync = async (fileId: string) => {
    if (!resyncFile) return
    setResyncingId(fileId)
    try {
      await resyncFile.mutateAsync(fileId)
    } catch (err) {
      console.error('Resync error:', err)
    } finally {
      setResyncingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className={clsx('bg-white rounded-lg border border-gray-200 p-4', className)}>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
        </div>
      </div>
    )
  }

  if (files.length === 0) {
    return null // Don't show anything if no files
  }

  // Group files by user
  const myFilesGroup = files.filter(f => f.user_id === user?.id)
  const otherFilesGroup = files.filter(f => f.user_id !== user?.id)

  return (
    <div className={clsx('bg-white rounded-lg border border-gray-200', className)}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <History className="w-4 h-4 text-gray-500" />
          Uploaded Models
        </h4>
        <span className="text-xs text-gray-500">
          {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* My Files */}
        {myFilesGroup.length > 0 && (
          <div>
            <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              My Uploads ({myFilesGroup.length})
            </h5>
            <div className="space-y-2">
              {myFilesGroup.map(file => (
                <FileRow
                  key={file.id}
                  file={file}
                  previousVersion={previousVersionMap.get(file.id)}
                  isOwner={true}
                  onDownload={() => handleDownload(file)}
                  onDelete={() => handleDelete(file.id)}
                  onResync={resyncFile ? () => handleResync(file.id) : undefined}
                  isDeleting={deletingId === file.id}
                  isResyncing={resyncingId === file.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Other Files */}
        {otherFilesGroup.length > 0 && (
          <div>
            <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              Team Uploads ({otherFilesGroup.length})
            </h5>
            <div className="space-y-2">
              {otherFilesGroup.map(file => (
                <FileRow
                  key={file.id}
                  file={file}
                  previousVersion={previousVersionMap.get(file.id)}
                  isOwner={false}
                  onDownload={() => handleDownload(file)}
                  onDelete={() => {}}
                  isDeleting={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
