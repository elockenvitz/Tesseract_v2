import { supabase } from '../supabase'

/**
 * Storage cleanup for files embedded in a note.
 *
 * Deleting a note removed the row and left its uploaded files in the bucket
 * forever. Nothing renders them afterwards and no row points at them, so they
 * were personal data we held, could not show anyone, and would not have
 * thought to include in a deletion request or a breach notification.
 *
 * Note content is stored as HTML, and the two extensions that own files
 * serialise their storage path into an attribute:
 *
 *   FileAttachmentExtension  data-file-path        -> `assets` bucket
 *   CaptureExtension         data-screenshot-path  -> `captures` bucket
 *
 * Parsing those out of the markup is deliberate rather than walking a
 * ProseMirror document: the stored column is HTML, and this has to work from a
 * plain string fetched out of the database with no editor instance around —
 * including from a server-side sweep.
 */

/** Matches the storage path in a rendered attachment/capture node. */
const FILE_PATH_RE = /data-file-path="([^"]+)"/g
const SCREENSHOT_PATH_RE = /data-screenshot-path="([^"]+)"/g

export interface NoteAttachmentPaths {
  /** Paths in the `assets` bucket. */
  assets: string[]
  /** Paths in the `captures` bucket. */
  captures: string[]
}

function matchAll(re: RegExp, html: string): string[] {
  const out: string[] = []
  // Fresh lastIndex per call — these are module-level /g regexes and would
  // otherwise resume mid-string on the second note in a loop, silently
  // skipping attachments.
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const decoded = decodeHtmlEntities(m[1])
    if (decoded) out.push(decoded)
  }
  return out
}

/** Attribute values are HTML-escaped on the way in; paths can contain `&`. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Every storage path referenced by a note's rendered content. */
export function collectNoteAttachmentPaths(content: string | null | undefined): NoteAttachmentPaths {
  if (!content) return { assets: [], captures: [] }
  return {
    assets: [...new Set(matchAll(FILE_PATH_RE, content))],
    captures: [...new Set(matchAll(SCREENSHOT_PATH_RE, content))],
  }
}

/**
 * Delete the storage objects a note referenced.
 *
 * Best-effort by design: the caller deletes the note whether or not this
 * succeeds, because the user asked for the note to go and failing the whole
 * operation over a storage hiccup would be worse. Anything missed is caught by
 * `scripts/sweep-orphaned-assets.mjs`.
 *
 * @param content   the note's stored HTML
 * @param filePath  the note's own `file_path` column, for notes that *are* an
 *                  uploaded document rather than containing one
 */
export async function removeNoteAttachments(
  content: string | null | undefined,
  filePath?: string | null,
): Promise<void> {
  const { assets, captures } = collectNoteAttachmentPaths(content)
  if (filePath) assets.push(filePath)

  const jobs: Array<Promise<unknown>> = []
  if (assets.length) jobs.push(supabase.storage.from('assets').remove([...new Set(assets)]))
  if (captures.length) jobs.push(supabase.storage.from('captures').remove(captures))
  if (!jobs.length) return

  const results = await Promise.allSettled(jobs)
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('Failed to remove note attachments from storage:', r.reason)
    } else {
      const err = (r.value as { error?: unknown } | null)?.error
      if (err) console.error('Failed to remove note attachments from storage:', err)
    }
  }
}
