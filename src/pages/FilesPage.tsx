import { useRef, useState } from 'react'
import { clsx } from 'clsx'
import { FolderOpen, Search, Upload, HardDrive, AlertTriangle } from 'lucide-react'
import { useIsMobile } from '../hooks/useMediaQuery'
import { useFiles, useUploadFile, type FileRecord } from '../hooks/useFiles'
import { MobileFileRows, DesktopFileTable } from '../components/files/FileRows'
import { FileDetail } from '../components/files/FileDetail'
import { MAX_FILE_BYTES, formatBytes } from '../lib/files/file-format'

interface FilesPageProps {
  onItemSelect?: (item: any) => void
  initialFileId?: string
}

/**
 * Files — the organisation's shared repository.
 *
 * ── What this replaced ─────────────────────────────────────────────────────
 *
 * This surface was a design mock: a category chip row with counts, a
 * grid/list toggle, a five-column table with per-row Download, Share and Star
 * buttons, and Upload and New Folder opening a modal that admitted "coming
 * soon". The query behind all of it was `return []`, so the grid and the
 * table were unreachable code and the empty state was the only branch that
 * had ever rendered. It was then briefly replaced by an honest
 * not-connected-yet statement, which is what this supersedes.
 *
 * It is real now: one query, one upload path, one set of mutations, shared by
 * the desktop table and the phone rows. The split between them is
 * presentational only.
 *
 * ── Still deliberately absent ──────────────────────────────────────────────
 *
 * Folders, starring and sharing. Those were the placeholder controls, and
 * drawing a control that does nothing is the thing this surface was rebuilt
 * to stop doing.
 */
export function FilesPage({ initialFileId }: FilesPageProps) {
  const isMobile = useIsMobile()
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(initialFileId ?? null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: files, isLoading, isError, refetch } = useFiles(search)
  const upload = useUploadFile()

  const selected = files?.find(f => f.id === selectedId) ?? null

  const handlePicked = async (picked: FileList | null) => {
    const file = picked?.[0]
    if (!file) return
    setUploadError(null)
    try {
      const created = await upload.mutateAsync(file)
      setSelectedId(created.id)
    } catch (e) {
      // Truthful: the error carries whether bytes were left behind.
      setUploadError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const openDetail = (file: FileRecord) => setSelectedId(file.id)

  // On a phone the detail takes the whole surface rather than opening a pane
  // over the list it was launched from.
  if (isMobile && selected) {
    return (
      <div className="h-full">
        <FileDetail
          file={selected}
          variant="sheet"
          onClose={() => setSelectedId(null)}
          onArchived={() => setSelectedId(null)}
        />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 sm:px-6 py-2 sm:py-4">
        <div className="flex items-center justify-between gap-2 mb-2 sm:mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="hidden sm:block p-2 bg-violet-100 dark:bg-violet-900/30 rounded-lg shrink-0">
              <FolderOpen className="w-5 h-5 text-violet-600 dark:text-violet-400" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-xl font-semibold leading-tight text-gray-900 dark:text-white">Files</h1>
              <p className="hidden sm:block text-sm text-gray-500 dark:text-gray-400">
                Shared repository for models, documents and resources
              </p>
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => handlePicked(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
            className="no-touch-target shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-2.5 sm:px-3 h-8 sm:h-9 text-[13px] sm:text-sm font-medium text-white disabled:opacity-60"
          >
            <Upload className="w-4 h-4" />
            {/* Truthful: the storage client reports no byte-level progress,
                so this says what is happening rather than animating a
                percentage it would have to invent. */}
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files…"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 dark:text-white pl-9 pr-3 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
        </div>

        {uploadError && (
          <p className="mt-2 rounded-md bg-red-50 dark:bg-red-900/20 px-2.5 py-2 text-[13px] text-red-700 dark:text-red-300">
            {uploadError}
          </p>
        )}
      </div>

      <div className="flex-1 flex min-h-0">
        <div className={clsx('flex-1 overflow-auto overscroll-contain min-w-0', !isMobile && 'p-4 sm:p-6')}>
          {/* Loading, error and empty are three states saying three different
              things. Rendering "no files" for a failed query is the specific
              untruth this replaces. */}
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-violet-600" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
              <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">Couldn't load files</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Something went wrong fetching the repository.</p>
              <button
                type="button"
                onClick={() => void refetch()}
                className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white"
              >
                Try again
              </button>
            </div>
          ) : (files?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center px-4">
              <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded-full mb-3">
                <HardDrive className="w-7 h-7 text-gray-400" />
              </div>
              <h3 className="text-base font-medium text-gray-900 dark:text-white mb-1">
                {search ? 'No files match that search' : 'No files yet'}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm">
                {search
                  ? 'Try a different filename.'
                  : `Upload a document to start the repository. Up to ${formatBytes(MAX_FILE_BYTES)} per file.`}
              </p>
            </div>
          ) : isMobile ? (
            <div className="bg-white dark:bg-gray-800">
              <MobileFileRows files={files!} onSelect={openDetail} onOpenActions={openDetail} />
            </div>
          ) : (
            <DesktopFileTable files={files!} onSelect={openDetail} onOpenActions={openDetail} />
          )}
        </div>

        {/* Desktop keeps the list visible beside the detail. */}
        {!isMobile && selected && (
          <div className="w-[420px] shrink-0 border-l border-gray-200 dark:border-gray-700">
            <FileDetail
              file={selected}
              variant="pane"
              onClose={() => setSelectedId(null)}
              onArchived={() => setSelectedId(null)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
