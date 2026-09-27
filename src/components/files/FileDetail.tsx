import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { format } from 'date-fns'
import { ChevronLeft, Download, ExternalLink, Pencil, Archive, Link2, X } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import {
  useFileUrl, useRenameFile, useArchiveFile, useUnlinkFile,
  type FileRecord,
} from '../../hooks/useFiles'
import { canPreviewInline, fileKind, formatBytes } from '../../lib/files/file-format'
import { FileTypeIcon, uploaderName } from './FileRows'

/**
 * One file, in full.
 *
 * Rendered in a right-hand pane on a desktop and full-width on a phone, from
 * the same component — the difference is the container, not the content, so
 * there is one set of actions to keep correct.
 *
 * Who may do what is decided by RLS. The gates here only decide what to draw:
 * offering Rename to somebody the database will refuse is a worse experience
 * than not offering it, but hiding it is not what makes the rule true.
 */

interface Props {
  file: FileRecord
  onClose: () => void
  onArchived: () => void
  /** Phone renders a back affordance; desktop renders a close X. */
  variant: 'sheet' | 'pane'
}

export function FileDetail({ file, onClose, onArchived, variant }: Props) {
  const { user } = useAuth()
  const getUrl = useFileUrl()
  const rename = useRenameFile()
  const archive = useArchiveFile()
  const unlink = useUnlinkFile()

  const isUploader = file.uploaded_by === user?.id
  const kind = fileKind(file.mime_type, file.name)
  const previewable = canPreviewInline(file.mime_type, file.name)

  const [url, setUrl] = useState<string | null>(null)
  const [urlError, setUrlError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState(file.name)
  const [actionError, setActionError] = useState<string | null>(null)

  // A signed URL expires, so it is fetched per view and never stored.
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    setUrlError(null)
    getUrl(file)
      .then(u => { if (!cancelled) setUrl(u) })
      .catch(e => { if (!cancelled) setUrlError(e instanceof Error ? e.message : 'Could not open that file.') })
    return () => { cancelled = true }
  }, [file, getUrl])

  const commitRename = async () => {
    const next = draftName.trim()
    setEditing(false)
    if (!next || next === file.name) { setDraftName(file.name); return }
    try {
      setActionError(null)
      await rename.mutateAsync({ fileId: file.id, name: next })
    } catch (e) {
      setDraftName(file.name)
      setActionError(e instanceof Error ? e.message : 'Rename failed.')
    }
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-700 px-3 sm:px-4 py-2">
        {variant === 'sheet' ? (
          <button
            type="button"
            onClick={onClose}
            /* `tap-pad` is safe here specifically because nothing sits above
               this: its hit region extends 6px up into the panel's top
               padding, not into text. That is the distinction the Projects
               header had to learn — a padded control UNDER a heading steals
               taps meant for the heading. */
            className="no-touch-target tap-pad -ml-1 mb-1 flex h-7 items-center gap-0.5 text-[12px] font-medium leading-none text-primary-600 dark:text-primary-400"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Files
          </button>
        ) : null}

        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <FileTypeIcon file={file} className="w-5 h-5 mt-0.5" />
            <div className="min-w-0 flex-1">
              {editing ? (
                <input
                  autoFocus
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') { setDraftName(file.name); setEditing(false) }
                  }}
                  className="w-full bg-transparent border-b border-primary-400 text-[15px] font-semibold text-gray-900 dark:text-white focus:outline-none"
                />
              ) : (
                <h2 className="text-[15px] sm:text-base font-semibold leading-tight text-gray-900 dark:text-white break-words">
                  {file.name}
                  {isUploader && (
                    <button
                      type="button"
                      onClick={() => { setDraftName(file.name); setEditing(true) }}
                      aria-label="Rename file"
                      title="Rename"
                      /* `tap-pad` overlaps the filename, which is a heading
                         and not itself tappable — so there is no tap to
                         steal, only text selection, which is the cheaper
                         thing to trade for a reachable control. */
                      className="no-touch-target tap-pad ml-1.5 -mb-0.5 inline-flex p-0.5 text-gray-400 hover:text-primary-600"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </h2>
              )}
            </div>
          </div>
          {variant === 'pane' && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 p-1 rounded text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 sm:px-4 py-3 space-y-4">
        {actionError && (
          <p className="rounded-md bg-red-50 dark:bg-red-900/20 px-2.5 py-2 text-[13px] text-red-700 dark:text-red-300">
            {actionError}
          </p>
        )}

        {/* Preview.

            Images render inline. PDFs get an object element, which uses the
            browser's own viewer rather than a bundled renderer. Anything else
            says plainly that it has no preview — and Download stays available
            in every case, including when the signed URL itself failed. */}
        <section>
          {previewable && url && kind === 'image' && (
            <img
              src={url}
              alt={file.name}
              className="max-h-80 w-full rounded-lg border border-gray-200 dark:border-gray-700 object-contain bg-gray-50 dark:bg-gray-800"
            />
          )}
          {previewable && url && kind === 'pdf' && (
            <object
              data={url}
              type="application/pdf"
              className="h-80 w-full rounded-lg border border-gray-200 dark:border-gray-700"
            >
              {/* Mobile browsers routinely decline to embed a PDF. That is
                  not an error state — it is a link. */}
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                <p className="text-[13px] text-gray-500 dark:text-gray-400">
                  This browser will not display the PDF inline.
                </p>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-[13px] font-medium text-white"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open PDF
                </a>
              </div>
            </object>
          )}
          {previewable && !url && !urlError && (
            <div className="h-32 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          )}
          {!previewable && (
            <div className="rounded-lg border border-dashed border-gray-200 dark:border-gray-700 px-3 py-4 text-center">
              <p className="text-[13px] text-gray-500 dark:text-gray-400">
                No preview for this file type.
              </p>
            </div>
          )}
          {urlError && (
            <p className="mt-2 text-[12px] text-red-600 dark:text-red-400">{urlError}</p>
          )}
        </section>

        {/* Actions */}
        <section className="flex flex-wrap gap-2">
          <a
            href={url ?? undefined}
            download={file.original_name}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!url}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-lg border px-3 h-9 text-[13px] font-medium',
              url
                ? 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200'
                : 'border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600 pointer-events-none',
            )}
          >
            <Download className="w-4 h-4" />
            Download
          </a>
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 px-3 h-9 text-[13px] font-medium text-gray-700 dark:text-gray-200"
            >
              <ExternalLink className="w-4 h-4" />
              Open
            </a>
          )}
        </section>

        {/* Details */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Details</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <dt className="text-gray-500 dark:text-gray-400">Type</dt>
            <dd className="text-gray-900 dark:text-white break-all">{file.mime_type || 'Unknown'}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Size</dt>
            <dd className="text-gray-900 dark:text-white">{formatBytes(file.size_bytes)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Uploaded by</dt>
            <dd className="text-gray-900 dark:text-white">{uploaderName(file)}</dd>
            <dt className="text-gray-500 dark:text-gray-400">Added</dt>
            <dd className="text-gray-900 dark:text-white">{format(new Date(file.created_at), 'MMM d, yyyy')}</dd>
            {file.updated_at !== file.created_at && (
              <>
                <dt className="text-gray-500 dark:text-gray-400">Updated</dt>
                <dd className="text-gray-900 dark:text-white">{format(new Date(file.updated_at), 'MMM d, yyyy')}</dd>
              </>
            )}
            {file.original_name !== file.name && (
              <>
                <dt className="text-gray-500 dark:text-gray-400">Original name</dt>
                <dd className="text-gray-900 dark:text-white break-all">{file.original_name}</dd>
              </>
            )}
          </dl>
        </section>

        {/* Links */}
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Linked to</h3>
          {(file.file_links?.length ?? 0) === 0 ? (
            <p className="text-[13px] text-gray-400 dark:text-gray-500">Not linked to anything yet.</p>
          ) : (
            <ul className="space-y-1">
              {file.file_links!.map(link => (
                <li
                  key={link.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-gray-200 dark:border-gray-700 px-2.5 py-1.5"
                >
                  <span className="flex items-center gap-1.5 min-w-0 text-[13px] text-gray-700 dark:text-gray-200">
                    <Link2 className="w-3.5 h-3.5 shrink-0 text-gray-400" />
                    <span className="capitalize shrink-0">{link.target_type}</span>
                    <span className="truncate font-mono text-[11px] text-gray-400">{link.target_id.slice(0, 8)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => unlink.mutate(link.id)}
                    aria-label="Remove link"
                    /* Real height, not `tap-pad`: these stack, so a pad
                       would reach into the row above and steal its remove
                       button. */
                    className="no-touch-target shrink-0 flex h-7 w-7 items-center justify-center text-gray-400 hover:text-red-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Archive. Uploader or org admin — the database decides; if this is
            offered and refused, the error says so rather than pretending. */}
        <section className="pt-2">
          <button
            type="button"
            onClick={async () => {
              try {
                setActionError(null)
                await archive.mutateAsync(file.id)
                onArchived()
              } catch (e) {
                setActionError(e instanceof Error ? e.message : 'Archive failed.')
              }
            }}
            disabled={archive.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-[13px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50"
          >
            <Archive className="w-4 h-4" />
            {archive.isPending ? 'Archiving…' : 'Archive file'}
          </button>
          <p className="mt-1 text-[12px] text-gray-400 dark:text-gray-500">
            Archiving hides the file from the repository. Nothing is deleted.
          </p>
        </section>
      </div>
    </div>
  )
}
