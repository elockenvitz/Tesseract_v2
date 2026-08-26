import { useState } from 'react'

import { VerdictBar, type VerdictOption } from './VerdictBar'
import { ReviseTargetEditor, type ReviseTargetValue } from './ReviseTargetEditor'
import type { PriceSnapshot } from '../../lib/signals/price-snapshot'
import { choiceFor, targetReviewOptions, type TargetReviewChoice } from '../../lib/signals/target-review'

/**
 * The resolution surface for an expired target: one pane, four paths.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Two peer panes, TARGET and RESPOND. The card carried a permanently-open
 * target editor beside a response control, so the reader paged past an editor
 * they had not asked for to reach the question, and the question's answers then
 * pointed back at the editor they had just swiped through.
 *
 * That is an architecture mixing evidence with resolution. PRICE and HORIZON
 * are evidence — things that are true whatever the reader decides. Editing a
 * target is not evidence; it is one of four things you might do about the
 * evidence, and it belongs behind the choice that selects it.
 *
 * So: choose, then act. The editor appears when "Revise target" is chosen and
 * not before, which is also what stops the card offering a slider to somebody
 * whose answer is "replace this with cases".
 *
 * ── Why the editor expands in place rather than opening a sheet ───────────
 *
 * A sheet is right for the CASE ladder — it is a longer form with per-case
 * horizons and probabilities, it already exists, and it has room to scroll. It
 * is wrong for four fields: dismissing a sheet to see the chart you were
 * comparing against, then reopening it, is the navigation this surface exists
 * to avoid. Inline keeps the evidence one swipe away.
 *
 * The pane is bounded and never scrolls. Vertical belongs to the feed.
 */

interface TargetReviewProps {
  symbol: string
  question: string
  /** The card's one price. Same object the chart pane draws from. */
  snapshot: PriceSnapshot | null
  recordedTarget: number | null
  /** The horizon that ran out, as the analyst wrote it. */
  expiredHorizon: string | null
  /** Records the judgment. Returns false when the write did not stick. */
  onRespond: (option: VerdictOption) => boolean | void | Promise<boolean | void>
  /** Save a new target and horizon. Both editing paths land here. */
  onSaveTarget: (value: ReviseTargetValue) => void | Promise<void>
  /** Open `MobileCaseTargets` for the Bull / Base / Bear ladder. */
  onOpenCases: () => void
  /** Open the note field for "Needs review". The signal stays either way. */
  onAddNote: () => void
  /** Told what is selected, so the card's footer can offer that action. */
  onChoiceChange?: (choice: TargetReviewChoice | null) => void
  resolveNext?: (option: VerdictOption) => { label: string; run: () => void } | null
  saving?: boolean
}

export function TargetReview({
  symbol, question, snapshot, recordedTarget, expiredHorizon,
  onRespond, onSaveTarget, onOpenCases, onAddNote, onChoiceChange, resolveNext, saving,
}: TargetReviewProps) {
  /**
   * The surface the reader has committed to, or null while still choosing.
   *
   * Set on COMMIT rather than on selection. Tapping a choice states what it
   * would do; the editor arriving under a tap that was still being considered
   * is the same "another card that wasn't there" problem the judgment pane
   * already solved by taking the band instead of adding a pane.
   */
  const [open, setOpen] = useState<TargetReviewChoice | null>(null)

  const options = targetReviewOptions(symbol)

  if (open && (open.surface === 'refresh_horizon' || open.surface === 'revise_target')) {
    return (
      <div className="flex h-full min-h-0 flex-col" data-testid="target-review-editor" data-surface={open.surface}>
        <div className="mb-1.5 flex shrink-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-bold uppercase tracking-wide text-gray-400">
            {open.label}
          </span>
          {/* A way back, in the place the judgment pane puts one. A control that
              replaces the whole pane and offers no exit is a dead end. */}
          <button
            type="button"
            data-testid="target-review-back"
            onClick={() => { setOpen(null); onChoiceChange?.(null) }}
            className="shrink-0 text-[12px] font-semibold text-gray-500 underline underline-offset-2 dark:text-gray-400 no-touch-target"
          >
            Back
          </button>
        </div>
        <ReviseTargetEditor
          symbol={symbol}
          snapshot={snapshot}
          recordedTarget={recordedTarget}
          expiredHorizon={expiredHorizon}
          // "Still valid" keeps the number and restates only the clock.
          horizonOnly={open.surface === 'refresh_horizon'}
          saving={saving}
          onSave={v => void onSaveTarget(v)}
        />
      </div>
    )
  }

  return (
    <VerdictBar
      question={question}
      options={options}
      hideQuestion
      resolveNext={resolveNext}
      onPick={o => onChoiceChange?.(choiceFor(o?.key))}
      onRespond={async o => {
        const ok = await onRespond(o)
        if (ok === false) return false
        /**
         * The judgment is recorded FIRST, then the surface opens.
         *
         * Order matters: the answer is the durable contribution and it must not
         * depend on whether the reader completes the follow-on. Somebody who
         * chooses "Revise target", sees the editor and then puts their phone
         * down has still told the desk the target needs revising.
         */
        const choice = choiceFor(o.key)
        if (!choice) return ok
        onChoiceChange?.(choice)
        if (choice.surface === 'cases') onOpenCases()
        else if (choice.surface === 'note') onAddNote()
        else setOpen(choice)
        return ok
      }}
    />
  )
}
