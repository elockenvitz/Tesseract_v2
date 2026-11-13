/**
 * "Keep this" on an answer.
 *
 * ── What it does, exactly ─────────────────────────────────────────────────
 *
 * Opens the canonical capture form with the answer's text already in it, and
 * nothing else. It does not write a record, it does not create a second kind
 * of object, and it does not reach the database at all: the request goes out
 * on the capture channel, the shell opens the pane, and the form the rest of
 * the application already uses takes it from there, with its own validation,
 * its own visibility choice and its own server-side org stamping.
 *
 * ── Why a confirmation for something that saves nothing ───────────────────
 *
 * Because of what it is about to put into the research corpus. The dialog
 * says who wrote the text, that it is a draft, and that it is not a decision
 * or an audit record. A reader who promotes a paragraph without seeing that
 * sentence can end up with a thesis draft in their own name that a model
 * wrote, and no later screen says otherwise.
 *
 * It also opens a pane over the conversation, which is a navigation the
 * reader should choose rather than discover.
 *
 * ── Why the control hides itself ──────────────────────────────────────────
 *
 * A streaming answer has no end yet, an empty one has nothing in it, and the
 * reader's own turn is what the capture form is already for. In all three
 * cases there is no control, rather than a control that explains itself after
 * being pressed.
 */
import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { BookmarkPlus } from 'lucide-react'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  ARTIFACT_PROMOTIONS,
  buildArtifactPromotion,
  promotable,
  promotionConfirmation,
  type ArtifactPromotionId,
  type ArtifactPromotionSpec,
  type PromotionSubject,
} from '../../lib/ai/artifacts'
import { dispatchCaptureOpen } from '../../lib/capture/prefill'
import type { AiRenderableMessage } from '../../lib/ai/presentation'

export interface AiKeepProps {
  message: Pick<AiRenderableMessage, 'role' | 'content' | 'streaming' | 'truncated'>
  /** The thread's title. Becomes the record's provenance line. */
  conversationTitle?: string | null
  /** What the pane is open on, when it is an asset. */
  subject?: PromotionSubject | null
  /** Told what was promoted, for a toast or a log. Never required. */
  onPromoted?: (id: ArtifactPromotionId) => void
  className?: string
}

export function AiKeep({ message, conversationTitle, subject, onPromoted, className }: AiKeepProps) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<ArtifactPromotionSpec | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // No control at all where there is nothing to keep. See the note above.
  if (!promotable(message).ok) return null

  const subjectLabel = subject?.type === 'asset' ? subject.label ?? null : null
  const confirmation = pending
    ? promotionConfirmation(pending, { subjectLabel, truncated: message.truncated })
    : null

  const confirm = () => {
    if (!pending) return
    const request = buildArtifactPromotion({
      message,
      promotion: pending,
      conversationTitle,
      subject,
    })
    setPending(null)
    if (!request) return
    dispatchCaptureOpen(request)
    onPromoted?.(pending.id)
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        data-testid="ai-keep"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        title="Keep this answer"
        className={clsx(
          'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] shrink-0',
          'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
          'hover:bg-gray-200 dark:hover:bg-gray-700',
          className,
        )}
      >
        <BookmarkPlus className="h-3 w-3" />Keep
      </button>

      {open && (
        <ul
          data-testid="ai-keep-menu"
          className="absolute bottom-full right-0 z-20 mb-1 w-64 rounded-md border border-gray-200
                     bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
        >
          {ARTIFACT_PROMOTIONS.map(promotion => (
            <li key={promotion.id}>
              <button
                type="button"
                data-slot="ai-keep-option"
                data-promotion={promotion.id}
                onClick={() => {
                  setOpen(false)
                  setPending(promotion)
                }}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left
                           hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <span className="text-[12px] font-medium text-gray-800 dark:text-gray-100">
                  {promotion.label}
                </span>
                <span className="text-[11px] text-gray-500 dark:text-gray-400">{promotion.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        isOpen={!!confirmation}
        onClose={() => setPending(null)}
        onConfirm={confirm}
        title={confirmation?.title ?? ''}
        /* One paragraph: the dialog renders the message as a single block, so
           the lines are joined rather than losing their separators to it. */
        message={confirmation ? confirmation.lines.join(' ') : ''}
        confirmText={confirmation?.confirmLabel ?? 'Continue'}
        cancelText="Cancel"
        variant="info"
      />
    </div>
  )
}
