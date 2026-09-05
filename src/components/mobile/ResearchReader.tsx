import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import DOMPurify from 'dompurify'
import { ArrowLeft, ArrowUpRight, Loader2, Pencil } from 'lucide-react'

import { useResearchItem } from '../../hooks/mobile/useResearchItem'
import type { ResearchReaderTarget } from '../../lib/signals/feed-actions'

/**
 * Reading a piece of research, which the product could not previously do.
 *
 * ── The bug this exists to remove ─────────────────────────────────────────
 *
 * "Read the research" opened `NoteEditor`. Every research destination in the
 * app was a tab, and every research tab is an authoring surface, so following
 * a button that said READ put a cursor into a rich-text field with a save
 * pipeline behind it. A reader who wanted to know what a colleague had written
 * was handed the tools to overwrite it.
 *
 * Reading and authoring are different acts. This is the first one: the words,
 * who wrote them, when, and nothing else. Editing is still the existing
 * editor — it is reached FROM here, deliberately and secondarily, and only by
 * somebody the app already treats as able to edit the object.
 *
 * ── Full screen, not a sheet ──────────────────────────────────────────────
 *
 * Same reasoning as `ArticleReader`, which this is modelled on: a note can run
 * to several screens, and a sheet spends the top fifth of the display on a
 * feed the reader is trying to ignore. It is also why the body scrolls HERE
 * rather than in the card — a scroller inside a snapping feed tile makes the
 * same drag mean two different things.
 */

interface ResearchReaderProps {
  open: boolean
  /** The exact object that produced the signal. Never an asset to guess from. */
  target: ResearchReaderTarget | null
  /** For the eyebrow, so the reader knows whose research this is. */
  symbol?: string | null
  onClose: () => void
  /**
   * Hand off to the EXISTING note editor. Absent where no editor exists —
   * see `canEdit` below.
   */
  onEdit?: (target: ResearchReaderTarget, assetId: string | null) => void
  onOpenAsset?: (assetId: string) => void
  /** `auth.uid()`, for the ownership check. */
  currentUserId?: string | null
}

/** The object's own word for what it is, in the eyebrow. */
function kindLabel(kind: 'note' | 'thought', itemType: string | null): string {
  if (kind === 'thought') return itemType === 'prompt' ? 'Prompt' : 'Quick thought'
  if (!itemType) return 'Research note'
  // Stored as a slug: `earnings_review` becomes `Earnings review`.
  const words = itemType.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Research note'
}

function readableDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Whether the stored content is markup at all.
 *
 * Thoughts are typed into a textarea and contain none, so putting one through
 * a prose renderer would collapse the line breaks its author pressed.
 */
function looksLikeHtml(s: string): boolean {
  return /<[a-z][\s\S]*>/i.test(s)
}

export function ResearchReader({
  open, target, symbol, onClose, onEdit, onOpenAsset, currentUserId,
}: ResearchReaderProps) {
  const { data: item, isLoading, isError } = useResearchItem(open ? target : null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Escape closes, and the feed behind must not scroll — a snapping list under
  // a fixed overlay is what makes the overlay feel like it is sliding.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // Opening a second arrival from the same mounted reader starts at the top of
  // the new item, not partway down where the last one was left.
  //
  // `scrollTop`, not `scrollTo`: the property exists on every element in every
  // environment, and the method does not — jsdom has no layout and no
  // `Element.scrollTo`, so calling it threw inside a passive effect and took
  // the whole reader down with it.
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0 }, [target?.id])

  if (!open || !target) return null

  /**
   * ── The permission rule, and what it is NOT ─────────────────────────────
   *
   * Authorship, which is the rule this app already applies when it decides
   * whether to show an Edit control on a research object: `MasonryGrid` gates
   * the Ideas feed's edit action on `item.author?.id === currentUserId`. It is
   * reused rather than reinvented.
   *
   * It is a DISPLAY rule, not the database's answer. The repository's
   * migrations define SELECT policies on `asset_notes` and no UPDATE policy at
   * all, so what the server will actually permit cannot be known from the
   * client until a write is attempted. Ownership is the conservative side of
   * that uncertainty: an author is the one person nearly any write policy
   * would allow, so this can hide the control from somebody who could edit,
   * and cannot offer it to somebody who will be refused. That is the failure
   * direction worth having — a button that does nothing is worse than a
   * button that is not there.
   *
   * A quick thought is excluded for a plainer reason: no mobile editor for one
   * exists, so there is nothing to hand off to.
   */
  const canEdit = !!onEdit
    && item?.kind === 'note'
    && !!currentUserId
    && !!item.authorId
    && item.authorId === currentUserId

  const title = item?.title ?? target.title ?? null
  const eyebrow = kindLabel(item?.kind ?? target.kind, item?.itemType ?? null)
  const date = readableDate(item?.createdAt ?? null)
  const raw = item?.content ?? ''

  return createPortal(
    <div
      data-slot="research-reader"
      className="fixed inset-0 z-[100] flex flex-col bg-white dark:bg-gray-950"
    >
      {/* The way out stays put. On a long note it should not require scrolling
          back to the top to find it. */}
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-gray-200 bg-white/95 px-2 py-2 backdrop-blur dark:border-gray-800 dark:bg-gray-950/95">
        <button
          type="button"
          data-slot="reader-back"
          onClick={onClose}
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {symbol ? `${symbol} · ${eyebrow}` : eyebrow}
          </div>
        </div>
        {canEdit && (
          // Secondary, and it says which object it edits. The primary purpose
          // of this surface is reading; the editor is downstream of it.
          <button
            type="button"
            data-slot="reader-edit"
            onClick={() => onEdit!(target, item?.assetId ?? null)}
            className="flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Pencil className="h-4 w-4" />
            Edit note
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain">
        {/* 65ch is the measure past which a line becomes tiring to track back
            from. On a phone the padding does the work; on a tablet the cap does. */}
        <article className="mx-auto w-full max-w-[65ch] px-5 pt-6 pb-16">
          {title && (
            <h1 className="text-[26px] font-bold leading-[1.22] tracking-[-0.02em] text-gray-900 dark:text-gray-50">
              {title}
            </h1>
          )}

          <div
            data-slot="reader-byline"
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-gray-500 dark:text-gray-400${title ? ' mt-3' : ''}`}
          >
            <span className="font-medium">{item?.authorName ?? 'Unknown author'}</span>
            {date && (<><span aria-hidden>·</span><span>{date}</span></>)}
          </div>

          {isLoading && (
            <div className="mt-8 space-y-3" aria-live="polite" aria-busy>
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
              {/* Lines rather than a spinner alone: the shape of what is
                  arriving is itself a progress signal. */}
              {[100, 96, 88, 99, 72].map((w, i) => (
                <div
                  key={i}
                  className="h-4 animate-pulse rounded bg-gray-100 dark:bg-gray-900"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          )}

          {!isLoading && raw && (
            looksLikeHtml(raw)
              ? (
                /* Notes are stored as the editor's HTML. Sanitised through the
                   same path `NoteVersionHistory` uses to show note content —
                   there is one safe render for this markup and this is it. */
                <div
                  data-slot="reader-body"
                  data-body-format="html"
                  className="prose prose-sm mt-6 max-w-none text-[16px] leading-[1.7] text-gray-800 dark:prose-invert dark:text-gray-200"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(raw) }}
                />
              )
              : (
                /* A quick thought is typed into a textarea: plain text whose
                   only structure is the line breaks its author pressed. Those
                   are preserved and nothing else is inferred — running it
                   through a markdown parser would reformat anything that
                   merely looks like markup. */
                <p
                  data-slot="reader-body"
                  data-body-format="text"
                  className="mt-6 whitespace-pre-wrap text-[16px] leading-[1.7] text-gray-800 dark:text-gray-200"
                >
                  {raw}
                </p>
              )
          )}

          {!isLoading && !raw && (
            <p className="mt-8 text-[14px] text-gray-500 dark:text-gray-400">
              {isError
                ? 'This research could not be loaded.'
                : 'This item has no content.'}
            </p>
          )}

          {onOpenAsset && item?.assetId && (
            <div className="mt-10 border-t border-gray-200 pt-5 dark:border-gray-800">
              <button
                type="button"
                data-slot="reader-open-asset"
                onClick={() => onOpenAsset(item.assetId!)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 dark:text-primary-400"
              >
                Open {symbol ?? 'the asset'}
                <ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </article>
      </div>
    </div>,
    document.body,
  )
}
