/**
 * Keeping an answer: the form, not a confirmation.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * A `ConfirmDialog` with a title the reader could not change, no sight of
 * what was being kept, and nowhere to say what it was about. So the only way
 * to find an artifact again was to recognise, in a list, a sentence a model
 * had written and the product had silently adopted as a name.
 *
 * Four things now, which are the four the brief asks for: the title, a
 * preview of the answer, what it is about, and optionally which project it
 * goes in.
 *
 * ── Why it still writes nothing ──────────────────────────────────────────
 *
 * The caller owns the write, as it did before. This component takes a draft,
 * hands back a draft, and reaches no database -- which is what lets the
 * whole form be tested without auth, an organization or a Supabase client.
 *
 * ── The gate has NOT moved ───────────────────────────────────────────────
 *
 * `ai_artifacts` does not exist in any environment. Nothing here is reachable
 * until `useAiArtifacts` probes the table and reports `available`, and the
 * menu row that opens this is absent -- not disabled -- until then. The form
 * being finished does not turn the feature on, and is not a reason to apply
 * the migration without review.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Search } from 'lucide-react'
import {
  ARTIFACT_TITLE_MAX, artifactDraftError, artifactPreview, describeArtifactSave,
  isArtifactSubjectType,
  type ArtifactDraft, type ArtifactSubject,
} from '../../lib/ai/artifact-store'

/** An object the picker can offer. The same shape the sidebar search uses. */
export interface ArtifactSubjectOption {
  type: string
  id: string
  label: string
  detail?: string | null
}

export interface AiArtifactSaveProps {
  open: boolean
  /** The answer being kept, for the preview. */
  content: string
  draft: ArtifactDraft
  onChange: (draft: ArtifactDraft) => void
  onCancel: () => void
  onSave: () => void
  /** The reader's projects, for the optional filing step. */
  folders?: { id: string; name: string }[]
  /** Objects matching what was typed into the subject search. */
  subjectResults?: ArtifactSubjectOption[]
  /** The subject query, mirrored up so the host can run the search. */
  onSubjectQueryChange?: (query: string) => void
  /** A rejection from the write, shown without closing the form. */
  error?: string | null
  isSaving?: boolean
}

export function AiArtifactSave({
  open, content, draft, onChange, onCancel, onSave,
  folders = [], subjectResults = [], onSubjectQueryChange,
  error = null, isSaving = false,
}: AiArtifactSaveProps) {
  const [subjectQuery, setSubjectQuery] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)

  /* The title is the one field the reader is most likely to change, and it
     arrives pre-filled with a machine's guess at it. Selected rather than
     focused at the end, so replacing it is one gesture. */
  useEffect(() => {
    if (open) titleRef.current?.select()
  }, [open])

  /* Cleared between openings. A subject search left over from the last
     answer, sitting above a different one, is a trap. */
  useEffect(() => {
    if (!open) { setSubjectQuery(''); onSubjectQueryChange?.('') }
  }, [open, onSubjectQueryChange])

  const preview = useMemo(() => artifactPreview(content), [content])
  const problem = artifactDraftError(draft)
  const folderName = draft.folderId
    ? folders.find(f => f.id === draft.folderId)?.name ?? null
    : null

  if (!open) return null

  const pickSubject = (option: ArtifactSubjectOption) => {
    if (!isArtifactSubjectType(option.type)) return
    const subject: ArtifactSubject = { type: option.type, id: option.id, label: option.label }
    onChange({ ...draft, subject })
    setSubjectQuery('')
    onSubjectQueryChange?.('')
  }

  return (
    <div
      data-testid="ai-artifact-save"
      role="dialog"
      aria-modal="true"
      aria-label="Keep this answer"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Keep this answer</h2>

        {/* What is being kept. The reader is about to accept a name for it
            that a model wrote; showing the text is the difference between
            agreeing and guessing. */}
        <p
          data-testid="ai-artifact-preview"
          className="mt-2 max-h-24 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2
                     text-[11px] leading-relaxed text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300"
        >
          {preview || 'This answer has no text yet.'}
        </p>

        <label className="mt-3 block text-[11px] font-medium text-gray-600 dark:text-gray-300">
          Name
          <input
            ref={titleRef}
            data-testid="ai-artifact-title"
            value={draft.title}
            maxLength={ARTIFACT_TITLE_MAX}
            onChange={e => onChange({ ...draft, title: e.target.value })}
            className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-[13px]
                       text-gray-900 outline-none focus:ring-1 focus:ring-primary-400
                       dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </label>

        {/* What it is about. Pre-filled from where the reader is, and
            removable, because an answer read on the AAPL page can be about
            the sector. */}
        <div className="mt-3">
          <span className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">
            About
          </span>
          {draft.subject ? (
            <div
              data-testid="ai-artifact-subject"
              className="mt-1 inline-flex items-center gap-1 rounded-full border border-gray-300
                         px-2 py-0.5 text-[11px] text-gray-700 dark:border-gray-600 dark:text-gray-200"
            >
              <span>{draft.subject.label}</span>
              <span className="text-gray-400">{draft.subject.type}</span>
              <button
                type="button"
                data-testid="ai-artifact-subject-clear"
                aria-label={`Remove ${draft.subject.label}`}
                onClick={() => onChange({ ...draft, subject: null })}
                className="rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400" />
              <input
                data-testid="ai-artifact-subject-search"
                value={subjectQuery}
                placeholder="An asset, portfolio or theme (optional)"
                onChange={e => { setSubjectQuery(e.target.value); onSubjectQueryChange?.(e.target.value) }}
                className="w-full rounded border border-gray-300 bg-white py-1 pl-7 pr-2 text-[12px]
                           outline-none focus:ring-1 focus:ring-primary-400
                           dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              />
              {subjectResults.length > 0 && (
                <ul
                  data-testid="ai-artifact-subject-results"
                  className="mt-1 max-h-32 overflow-y-auto rounded border border-gray-200 dark:border-gray-700"
                >
                  {subjectResults.map(o => (
                    <li key={`${o.type}:${o.id}`}>
                      <button
                        type="button"
                        data-testid={`ai-artifact-subject-${o.type}-${o.id}`}
                        onClick={() => pickSubject(o)}
                        className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px]
                                   hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">
                          {o.type}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* The project. Last, and plainly optional: filing is a convenience,
            and refusing to keep an answer for want of a shelf would be the
            wrong trade. */}
        {folders.length > 0 && (
          <label className="mt-3 block text-[11px] font-medium text-gray-600 dark:text-gray-300">
            Project (optional)
            <select
              data-testid="ai-artifact-folder"
              value={draft.folderId ?? ''}
              onChange={e => onChange({ ...draft, folderId: e.target.value || null })}
              className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1 text-[12px]
                         dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            >
              <option value="">No project</option>
              {folders.map(f => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </label>
        )}

        {/*
          What this is and is not. An artifact is a pointer the reader can
          find again; it is not research, not a decision, and not an approved
          firm view -- and nothing downstream says so, so this is the only
          place it gets said.
        */}
        <p data-testid="ai-artifact-effect" className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
          {describeArtifactSave(draft, folderName)} It is not filed as research
          and it is not a decision. The answer itself is not copied, so deleting
          this conversation removes it.
        </p>

        {(problem || error) && (
          <p data-testid="ai-artifact-error" className="mt-2 text-[11px] text-red-600 dark:text-red-400">
            {error || problem}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            data-testid="ai-artifact-cancel"
            onClick={onCancel}
            className="rounded px-3 py-1 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="ai-artifact-save-confirm"
            /* Disabled on a problem the reader can see named above, which is
               the one case where a disabled control is not a mystery. */
            disabled={!!problem || isSaving}
            onClick={onSave}
            className="rounded bg-primary-600 px-3 py-1 text-[12px] font-medium text-white
                       hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Keeping…' : 'Keep'}
          </button>
        </div>
      </div>
    </div>
  )
}
