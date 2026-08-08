import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Check, History, Loader2, Pencil, X } from 'lucide-react'
import { useAuth } from '../../../hooks/useAuth'
import { useContributions } from '../../../hooks/useContributions'
import { ExpandableText } from '../ExpandableText'
import { CaseFieldHistory } from './CaseFieldHistory'

interface MobileCaseSectionProps {
  assetId: string
  /** The key new contributions are written under. */
  sectionKey: string
  /** Every key this field's prose might already be stored under, most likely
   *  first. Some template slugs are aliases with legacy content behind them. */
  readSectionKeys?: string[]
  title: string
  /** Shown when nobody has written anything, so the section is never a blank box. */
  emptyHint: string
  /** 'aggregated' shows everyone; a user id narrows to that analyst's view. */
  viewFilter?: 'aggregated' | string
}

/** Draft writes are debounced to avoid a request per keystroke. */
const DRAFT_DEBOUNCE_MS = 1200

/**
 * One section of an asset case, readable and editable on a phone.
 *
 * Reuses useContributions unchanged, so a phone edit is the same write the
 * desktop page makes — same draft/publish split, same revision history, same
 * visibility rules. The mobile-specific part is only the interaction: tap to
 * edit, autosave to draft, explicit publish.
 *
 * Draft and published are kept distinct rather than collapsed into one
 * autosaving field. A half-finished thought typed on a phone should not become
 * the firm's stated view of a position the moment the keyboard closes;
 * publishing stays deliberate, exactly as on desktop.
 */
export function MobileCaseSection({
  assetId,
  sectionKey,
  readSectionKeys,
  title,
  emptyHint,
  viewFilter = 'aggregated',
}: MobileCaseSectionProps) {
  const { user } = useAuth()
  const {
    contributions,
    myContribution,
    isLoading,
    saveDraft,
    publishDraft,
    discardDraft,
  } = useContributions({ assetId, section: sectionKey })

  // Aliased slugs can have prose stored under an older key. Reading only the
  // write key would render an empty section over content that exists.
  const aliases = (readSectionKeys ?? []).filter(k => k !== sectionKey)
  const { contributions: aliased } = useContributions({
    assetId,
    section: aliases[0],
  })

  const all = aliases.length ? [...contributions, ...(aliased ?? [])] : contributions

  // Everyone else's work on this field, or one named analyst's.
  const otherContributions = all.filter(c => {
    if (c.created_by === user?.id) return false
    return viewFilter === 'aggregated' || c.created_by === viewFilter
  })

  // Firm view is the summary of everyone's work, so it is read-only: an edit
  // made from it has no unambiguous author and would silently be attributed to
  // whoever happened to be looking. Editing lives in "My view", which is one
  // tap away in the picker above. Only your own view is writable — reading
  // someone else's means reading theirs, not editing yours.
  const isFirmView = viewFilter === 'aggregated'
  const canEdit = !!user && viewFilter === user.id
  // Your own prose still appears on the firm view; it is part of the summary.
  const showsMine = isFirmView || viewFilter === user?.id

  const [editing, setEditing] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** The text last sent to the server, so an unchanged blur saves nothing. */
  const lastSaved = useRef('')

  const draft = myContribution?.draft_content ?? null
  const published = myContribution?.content ?? ''
  const hasDraft = !!draft && draft !== published

  const beginEdit = () => {
    const start = draft ?? published
    setValue(start)
    lastSaved.current = start
    setEditing(true)
  }

  useEffect(() => {
    if (!editing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    // Caret to the end: starting mid-text is disorienting when the field was
    // pre-filled with existing work.
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  // Autosave to draft, never straight to published.
  useEffect(() => {
    if (!editing) return
    if (value === lastSaved.current) return
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => {
      lastSaved.current = value
      saveDraft.mutate({ content: value, sectionKey })
    }, DRAFT_DEBOUNCE_MS)
    return () => {
      if (debounce.current) clearTimeout(debounce.current)
    }
  }, [value, editing, sectionKey, saveDraft])

  const stopEditing = () => {
    // Flush anything the debounce still owes, so closing the editor never
    // silently drops the last few characters typed.
    if (debounce.current) clearTimeout(debounce.current)
    if (value !== lastSaved.current) {
      lastSaved.current = value
      saveDraft.mutate({ content: value, sectionKey })
    }
    setEditing(false)
  }

  const publish = () => {
    if (debounce.current) clearTimeout(debounce.current)
    const commit = () => publishDraft.mutate({ sectionKey })
    if (value !== lastSaved.current) {
      lastSaved.current = value
      // Publish reads the stored draft, so the newest text has to land first.
      saveDraft.mutate({ content: value, sectionKey }, { onSuccess: commit })
    } else {
      commit()
    }
    setEditing(false)
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden">
      {/* Title and actions are separate rows rather than one. Field names come
          from the organisation's template and run long ("Where we are different
          from consensus"); sharing a row with two buttons truncated most of
          them to a few words, which is exactly the part that identifies the
          field. The title now wraps and the actions sit under it. */}
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 min-w-0 text-sm font-semibold leading-snug text-gray-900 dark:text-gray-100">
            {title}
          </h3>
          {canEdit && hasDraft && !editing && (
            <span className="mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              Draft
            </span>
          )}
        </div>

        {!editing && (myContribution || canEdit) && (
          <div className="mt-1.5 flex items-center gap-1">
            {myContribution && (
              <button
                type="button"
                onClick={() => setShowHistory(v => !v)}
                aria-expanded={showHistory}
                className={clsx(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold no-touch-target',
                  showHistory
                    ? 'text-primary-700 bg-primary-50 dark:text-primary-300 dark:bg-primary-900/30'
                    : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
                )}
              >
                <History className="h-3.5 w-3.5" />
                Changes
              </button>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={beginEdit}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-primary-600 dark:text-primary-400 active:bg-primary-50 dark:active:bg-primary-900/30 no-touch-target"
              >
                <Pencil className="h-3.5 w-3.5" />
                {published || draft ? 'Edit' : 'Add'}
              </button>
            )}
            {isFirmView && (
              <span className="ml-auto text-[11px] text-gray-400">
                Firm view · read-only
              </span>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2.5">
        {editing ? (
          <div>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={7}
              placeholder={emptyHint}
              className="w-full resize-y rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-[15px] leading-relaxed text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />

            <div className="mt-2 flex items-center gap-2">
              <span className="flex-1 min-w-0 text-[11px] text-gray-400 truncate">
                {saveDraft.isPending ? 'Saving draft…' : 'Saved as draft'}
              </span>
              <button
                type="button"
                onClick={stopEditing}
                className="inline-flex items-center gap-1 h-9 px-3 rounded-lg text-sm font-medium text-gray-600 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
              >
                Done
              </button>
              <button
                type="button"
                onClick={publish}
                disabled={publishDraft.isPending || !value.trim()}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary-600 text-white text-sm font-semibold disabled:opacity-40 no-touch-target"
              >
                {publishDraft.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Check className="h-4 w-4" />}
                Publish
              </button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="h-4 w-2/3 rounded bg-gray-100 dark:bg-gray-800 animate-pulse" />
        ) : (
          <>
            {canEdit && hasDraft && (
              <div className="mb-2 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                    Your unpublished draft
                  </span>
                  <button
                    type="button"
                    onClick={() => discardDraft.mutate({ sectionKey })}
                    className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 no-touch-target"
                  >
                    <X className="h-3 w-3" /> Discard
                  </button>
                </div>
                <ExpandableText text={draft!} lines={4} markdown />
              </div>
            )}

            {showsMine && published ? (
              <ExpandableText text={published} lines={6} markdown />
            ) : !hasDraft && otherContributions.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">{emptyHint}</p>
            ) : null}

            {showHistory && myContribution && (
              <div className="mb-3 pb-3 border-b border-gray-100 dark:border-gray-800">
                <CaseFieldHistory contributionId={myContribution.id} />
              </div>
            )}

            {otherContributions.length > 0 && (
              <div className={clsx(
                'space-y-3',
                (showsMine && (published || hasDraft)) &&
                  'mt-3 pt-3 border-t border-gray-100 dark:border-gray-800'
              )}>
                {otherContributions.map(c => (
                  <div key={c.id}>
                    <p className="mb-0.5 text-[11px] font-semibold text-gray-500 dark:text-gray-400">
                      {c.user?.full_name ?? 'Colleague'}
                    </p>
                    <ExpandableText text={c.content} lines={4} markdown />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
