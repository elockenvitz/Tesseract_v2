import { FileText, ChevronRight, Plus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Badge } from '../../ui/Badge'
import { Button } from '../../ui/Button'
import { getContentPreview } from '../../../utils/stripHtml'

/**
 * The last few notes written on this theme.
 *
 * ── Why a digest and not the notes surface ───────────────────────────────
 *
 * The notes themselves live in Research, under References, with their editor.
 * This is the Overview's answer to "has anyone written anything lately", so it
 * is read-only, capped, and every row leaves for the place that owns it.
 * Two editable copies of the same list is the duplication this restructure is
 * reducing, not adding to.
 *
 * It takes the rows rather than querying, because `ThemeTab` already holds the
 * `theme_notes` query that the Research pane's surface reads. A second query
 * for the same rows under a different key would be a second cache entry that
 * can disagree with the first.
 *
 * RLS posture: none of its own. It renders rows the caller already fetched.
 */

export interface ThemeNoteDigestRow {
  id: string
  title: string | null
  content: string | null
  note_type: string | null
  is_shared: boolean | null
  updated_at: string | null
}

interface ThemeNotesDigestProps {
  notes: ThemeNoteDigestRow[] | null | undefined
  /** Opens a note in the Research pane's notes surface. */
  onOpenNote: (noteId: string) => void
  /** Opens the notes surface with the editor on a new note. */
  onCreateNote: () => void
  /** Opens the notes surface itself. */
  onViewAll: () => void
}

const SHOWN = 3

export function ThemeNotesDigest({
  notes, onOpenNote, onCreateNote, onViewAll,
}: ThemeNotesDigestProps) {
  const all = notes ?? []
  const shown = all.slice(0, SHOWN)

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between gap-3 px-1">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Notes</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {all.length === 0
              ? 'Nothing written on this theme yet.'
              : `${all.length} ${all.length === 1 ? 'note' : 'notes'}, newest first.`}
          </p>
        </div>
        {all.length > 0 && (
          <button
            type="button"
            onClick={onViewAll}
            className="shrink-0 flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
          >
            All notes
            <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>

      {all.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center dark:border-gray-600">
          <FileText className="h-6 w-6 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-500 mb-3 dark:text-gray-400">
            Notes on a theme sit beside its case, under References.
          </p>
          <Button size="sm" onClick={onCreateNote}>
            <Plus className="h-4 w-4 mr-2" />
            Add a note
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 divide-y divide-gray-100 overflow-hidden dark:divide-gray-700 dark:border-gray-700">
          {shown.map(note => (
            <button
              key={note.id}
              type="button"
              onClick={() => onOpenNote(note.id)}
              className="w-full px-3 py-2 text-left hover:bg-gray-50 transition-colors dark:hover:bg-gray-800"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                  {note.title || 'Untitled note'}
                </span>
                {note.note_type && <Badge variant="default" size="sm">{note.note_type}</Badge>}
                {note.is_shared && <Badge variant="primary" size="sm">Shared</Badge>}
              </div>
              <p className="mt-0.5 line-clamp-1 text-xs text-gray-500 dark:text-gray-400">
                {getContentPreview(note.content || '', 120)}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-400 dark:text-gray-500">
                {note.updated_at
                  ? formatDistanceToNow(new Date(note.updated_at), { addSuffix: true })
                  : 'no date'}
              </p>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
