import { useCallback, useRef, useState } from 'react'

import { TargetReview } from './TargetReview'
import { ReviseTargetEditor, type ReviseTargetValue } from './ReviseTargetEditor'
import type { PriceSnapshot } from '../../lib/signals/price-snapshot'
import type { TargetReviewChoice } from '../../lib/signals/target-review'

/**
 * The expired-target card: two panes, and one primary that means what it says.
 *
 * ── Why the HORIZON pane is gone ──────────────────────────────────────────
 *
 * It showed the stated horizon, the overdue span and three dates — every one of
 * which the header already carries ("8mo overdue", the kind pill, the headline).
 * It answered no question the reader was being asked.
 *
 * The replacement considered was THEN vs NOW: what the price was when the
 * target was written against what it is today. That is a genuinely useful
 * comparison and the data does not support it. Measured against production,
 * only 20 of 30 fixed targets have a cached close on or before their set date —
 * `price_history_cache` starts later than the target for GOOGL and NVDA, and
 * CEG has no series at all — and no table records the price at creation.
 * Drawing it would mean fabricating the "THEN" half for a third of the corpus.
 *
 * Two useful panes beat three where one is filler, so: PRICE → REVIEW.
 *
 * ── Selection mutates nothing ─────────────────────────────────────────────
 *
 * The single most important property of this file. Choosing an answer changes
 * what the sticky footer offers and does nothing else — no judgment, no audit
 * row, no disposition, no write. The flow the footer opens is where every
 * mutation happens, and only a SUCCESSFUL save records anything.
 *
 * This replaces a state machine that committed on selection and opened the
 * editor afterwards, so backing out of the horizon picker left a `settled`
 * disposition suppressing the card for ninety days over a view that was still
 * expired.
 */

export const TARGET_REVIEW_PANE_ID = 'verdict'

export interface TargetExpiredSubject {
  symbol: string
  target: number
  timeframe: string | null
  statedAt: string
  expiredAt: string
}

/** What a completed flow reports back. The card resolves only on success. */
export interface TargetResolution {
  choice: TargetReviewChoice
  note: string
  /** Present for the two editing flows; absent for cases and review-later. */
  value?: ReviseTargetValue
}

interface TargetExpiredPanesProps {
  subject: TargetExpiredSubject
  question: string
  snapshot: PriceSnapshot | null
  pricePane: React.ReactNode
  /**
   * Commits the whole resolution: mutation first, then judgment.
   *
   * Returns false (or throws) when nothing was persisted, which keeps the flow
   * open with the reader's values intact and the signal unresolved.
   */
  onCommit: (r: TargetResolution) => Promise<boolean>
  /** Opens the existing Bull / Base / Bear sheet. Resolves when it is saved. */
  onOpenCases: (r: TargetResolution) => void
  children: (composed: {
    panes: { id: string; label: string; content: React.ReactNode }[]
    onPaneChange: (paneId: string) => void
    primaryOverride:
      | { id: string; label: string; disabled?: boolean; run?: () => void }
      | null
  }) => React.ReactNode
}

export function TargetExpiredPanes({
  subject, question, snapshot, pricePane, onCommit, onOpenCases, children,
}: TargetExpiredPanesProps) {
  const [choice, setChoice] = useState<TargetReviewChoice | null>(null)
  const [note, setNote] = useState('')
  const [activePane, setActivePane] = useState('price')
  const [flow, setFlow] = useState<TargetReviewChoice | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Guards a double tap into two mutations and two audit rows.
   *
   * A ref, not state: the second tap can arrive before React re-renders the
   * first, so `disabled` alone is a race. This is set synchronously inside the
   * handler and is the actual gate.
   */
  const inFlight = useRef(false)

  const commit = useCallback(async (value?: ReviseTargetValue) => {
    if (!choice || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const ok = await onCommit({ choice, note: note.trim(), value })
      if (!ok) {
        // Editor stays open, values retained, signal unresolved.
        setError('That did not save. Your answer and note are still here.')
        return
      }
      setFlow(null)
    } catch {
      setError('That did not save. Your answer and note are still here.')
    } finally {
      setSaving(false)
      inFlight.current = false
    }
  }, [choice, note, onCommit])

  /** What the sticky primary does, per choice. Never fires on selection. */
  const runPrimary = useCallback(() => {
    if (!choice || saving) return
    if (choice.surface === 'cases') {
      // Opening the ladder is NOT the resolution. The sheet reports back.
      onOpenCases({ choice, note: note.trim() })
      return
    }
    if (choice.surface === 'note') {
      // Nothing to edit — the acknowledgement IS the action.
      void commit()
      return
    }
    setFlow(choice)
  }, [choice, saving, note, onOpenCases, commit])

  const editing = flow?.surface === 'refresh_horizon' || flow?.surface === 'revise_target'

  const reviewContent = editing ? (
    <div className="flex h-full min-h-0 flex-col" data-testid="target-review-editor" data-surface={flow!.surface}>
      <div className="mb-1.5 flex shrink-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-wide text-gray-400">
          {flow!.label}
        </span>
        {/* Cancel: closes the flow and mutates nothing. The selection and the
            note survive, so backing out costs the reader no work. */}
        <button
          type="button"
          data-testid="target-review-back"
          disabled={saving}
          onClick={() => { setFlow(null); setError(null) }}
          className="shrink-0 text-[12px] font-semibold text-gray-500 underline underline-offset-2 disabled:opacity-60 dark:text-gray-400 no-touch-target"
        >
          Cancel
        </button>
      </div>
      <ReviseTargetEditor
        symbol={subject.symbol}
        snapshot={snapshot}
        recordedTarget={subject.target}
        expiredHorizon={subject.timeframe}
        horizonOnly={flow!.surface === 'refresh_horizon'}
        saving={saving}
        error={error}
        onSave={v => void commit(v)}
      />
    </div>
  ) : (
    <TargetReview
      question={question}
      selected={choice}
      onSelect={c => { setChoice(c); setError(null) }}
      note={note}
      onNoteChange={setNote}
      saving={saving}
      error={error}
    />
  )

  const panes = [
    { id: 'price', label: 'Price', content: pricePane },
    { id: TARGET_REVIEW_PANE_ID, label: 'Review', content: reviewContent },
  ]

  /**
   * The one primary, and it is the footer's.
   *
   * Absent on the evidence pane, so the card keeps its own action there. On
   * REVIEW it is the selected choice's CTA — and while an editor is open the
   * footer steps aside entirely, because the editor owns its own Save and two
   * competing commit buttons is the duplication this pass removed.
   */
  const primaryOverride = activePane !== TARGET_REVIEW_PANE_ID
    ? null
    : editing
      ? { id: 'review_target', label: flow!.cta, disabled: true }
      : choice
        ? {
            id: choice.surface === 'cases' ? 'open_cases' : 'review_target',
            label: choice.cta,
            disabled: saving,
            run: runPrimary,
          }
        : { id: 'review_target', label: 'Choose an answer', disabled: true }

  return <>{children({ panes, onPaneChange: setActivePane, primaryOverride })}</>
}
