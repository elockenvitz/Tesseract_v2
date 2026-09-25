/**
 * Pure helpers for the Files repository.
 *
 * Kept separate from the hooks so they can be tested without a database, and
 * so desktop and mobile cannot drift into formatting the same record two
 * different ways.
 */

/** 50 MB, the `assets` bucket's own `file_size_limit` read from the live catalog. */
export const MAX_FILE_BYTES = 52_428_800

export type FileKind = 'image' | 'pdf' | 'spreadsheet' | 'document' | 'archive' | 'text' | 'other'

/**
 * Coarse category for an upload, from its MIME type.
 *
 * Deliberately coarse: this drives an icon and a preview decision, not
 * storage. Nothing is REFUSED on the basis of type — a file the repository
 * cannot preview is still a file the organisation chose to keep, so unknown
 * types store fine and simply offer Download.
 */
export function fileKind(mimeType: string | null | undefined, name?: string): FileKind {
  const mime = (mimeType ?? '').toLowerCase()

  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  // CSV before the generic `text/` branch: its MIME type is `text/csv`, so
  // testing `text/` first would classify every spreadsheet export as plain
  // text and give it the wrong icon.
  if (
    mime.includes('spreadsheet') ||
    mime.includes('excel') ||
    mime === 'text/csv'
  ) return 'spreadsheet'
  if (mime.startsWith('text/')) return 'text'
  if (
    mime.includes('word') ||
    mime.includes('document') ||
    mime.includes('presentation') ||
    mime.includes('powerpoint')
  ) return 'document'
  if (
    mime.includes('zip') ||
    mime.includes('compressed') ||
    mime.includes('tar')
  ) return 'archive'

  // Fall back to the extension. A browser that supplies no MIME type at all
  // is common on mobile, and an empty `type` should not cost the user their
  // icon.
  const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'heic'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(ext)) return 'spreadsheet'
  if (['doc', 'docx', 'ppt', 'pptx'].includes(ext)) return 'document'
  if (['zip', 'gz', 'tar', '7z', 'rar'].includes(ext)) return 'archive'
  if (['txt', 'md', 'json', 'log'].includes(ext)) return 'text'

  return 'other'
}

/** Whether V1 renders this inline. Everything else opens or downloads. */
export function canPreviewInline(mimeType: string | null | undefined, name?: string): boolean {
  const kind = fileKind(mimeType, name)
  return kind === 'image' || kind === 'pdf'
}

/**
 * Human file size.
 *
 * `null` renders as an em dash rather than "0 B": a missing size and an empty
 * file are different facts, and saying the wrong one is worse than saying
 * nothing.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** The extension, lowercased, for the type column. */
export function fileExtension(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : ''
}

export interface FileValidationFailure {
  ok: false
  reason: string
}
export interface FileValidationSuccess {
  ok: true
}

/**
 * What this refuses, and what it deliberately does not.
 *
 * Size and emptiness only. There is no type whitelist: the repository's job
 * is to hold what the organisation decided to keep, and a list of blessed
 * extensions would reject exactly the unusual document somebody needed to
 * store. Preview is a separate question, answered per type at render time.
 */
export function validateUpload(file: { size: number; name: string }): FileValidationSuccess | FileValidationFailure {
  if (file.size === 0) {
    return { ok: false, reason: 'That file is empty.' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `That file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_FILE_BYTES)}.`,
    }
  }
  if (!file.name.trim()) {
    return { ok: false, reason: 'That file has no name.' }
  }
  return { ok: true }
}
