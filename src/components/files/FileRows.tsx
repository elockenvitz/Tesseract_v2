import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  FileText, FileSpreadsheet, FileImage, FileArchive, File as FileIcon,
  MoreHorizontal, Link2,
} from 'lucide-react'
import { fileKind, formatBytes, fileExtension } from '../../lib/files/file-format'
import type { FileRecord } from '../../hooks/useFiles'

/**
 * One repository row, drawn two ways.
 *
 * Desktop gets a dense table; a phone gets a stacked row. Both read the same
 * `FileRecord` from the same query — the split is presentational only, which
 * is the thing Projects had to be rebuilt to achieve.
 */

export function FileTypeIcon({ file, className }: { file: FileRecord; className?: string }) {
  const kind = fileKind(file.mime_type, file.name)
  const cls = clsx('shrink-0', className ?? 'w-4 h-4')
  switch (kind) {
    case 'image':       return <FileImage className={clsx(cls, 'text-pink-500')} />
    case 'pdf':         return <FileText className={clsx(cls, 'text-red-500')} />
    case 'spreadsheet': return <FileSpreadsheet className={clsx(cls, 'text-green-600')} />
    case 'document':    return <FileText className={clsx(cls, 'text-blue-500')} />
    case 'archive':     return <FileArchive className={clsx(cls, 'text-amber-500')} />
    case 'text':        return <FileText className={clsx(cls, 'text-gray-500')} />
    default:            return <FileIcon className={clsx(cls, 'text-gray-400')} />
  }
}

export function uploaderName(file: FileRecord): string {
  const u = file.uploader
  if (!u) return 'Unknown'
  const full = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()
  return full || u.email?.split('@')[0] || 'Unknown'
}

interface RowProps {
  files: FileRecord[]
  onSelect: (file: FileRecord) => void
  onOpenActions: (file: FileRecord) => void
}

/** The phone list. Several files scannable in one viewport. */
export function MobileFileRows({ files, onSelect, onOpenActions }: RowProps) {
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {files.map(file => {
        const links = file.file_links?.length ?? 0
        return (
          <li key={file.id}>
            <div className="flex items-stretch">
              <button
                type="button"
                onClick={() => onSelect(file)}
                className="no-touch-target flex-1 min-w-0 text-left px-4 py-2.5 active:bg-gray-50 dark:active:bg-gray-800/60"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileTypeIcon file={file} />
                  {/* A filename is the thing being scanned for, so it gets
                      the row. Long names truncate rather than wrap: two-line
                      names would halve how many files fit. */}
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-gray-900 dark:text-white">
                    {file.name}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-gray-500 dark:text-gray-400">
                  <span className="uppercase">{fileExtension(file.name) || 'file'}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatBytes(file.size_bytes)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{uploaderName(file)}</span>
                  {links > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="flex items-center gap-0.5 shrink-0">
                        <Link2 className="w-3 h-3" />
                        {links}
                      </span>
                    </>
                  )}
                </div>
              </button>
              <button
                type="button"
                onClick={() => onOpenActions(file)}
                aria-label={`Actions for ${file.name}`}
                className="flex w-11 shrink-0 items-center justify-center text-gray-400 active:bg-gray-50 dark:active:bg-gray-800/60"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** The desktop table. */
export function DesktopFileTable({ files, onSelect, onOpenActions }: RowProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      <table className="w-full">
        <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <tr>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Name</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Type</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Linked to</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Uploaded by</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Added</th>
            <th className="px-4 py-2.5 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">Size</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {files.map(file => {
            const links = file.file_links?.length ?? 0
            return (
              <tr
                key={file.id}
                onClick={() => onSelect(file)}
                className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/40"
              >
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileTypeIcon file={file} />
                    <span className="truncate text-sm font-medium text-gray-900 dark:text-white">{file.name}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-sm uppercase text-gray-500 dark:text-gray-400">
                  {fileExtension(file.name) || '—'}
                </td>
                <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                  {links > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Link2 className="w-3.5 h-3.5" />
                      {links}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">{uploaderName(file)}</td>
                <td className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400">
                  {formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}
                </td>
                <td className="px-4 py-2.5 text-right text-sm tabular-nums text-gray-500 dark:text-gray-400">
                  {formatBytes(file.size_bytes)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onOpenActions(file) }}
                    aria-label={`Actions for ${file.name}`}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
