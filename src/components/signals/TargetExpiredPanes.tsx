import { useCallback, useState } from 'react'

import { HorizonTimeline } from './HorizonTimeline'
import { TargetReview } from './TargetReview'
import type { ReviseTargetValue } from './ReviseTargetEditor'
import type { VerdictOption } from './VerdictBar'
import type { PriceSnapshot } from '../../lib/signals/price-snapshot'
import type { TargetReviewChoice } from '../../lib/signals/target-review'

/**
 * The expired-target card's three panes and its contextual footer.
 *
 * ── Why the price arrives as a NODE and a VALUE ───────────────────────────
 *
 * So the gallery can render the real thing. `PricePane` reaches Supabase
 * through `useSymbolHistory`, and the gallery has no Supabase environment —
 * importing it takes the harness down at module load, which is why every fixture
 * on this surface injects its chart rather than importing one (see
 * `MobileExplore.renderSparkline` for the same seam and the same reason).
 *
 * Everything that is not the fetch lives here: the pane order, the review
 * grammar, the editor, which pane owns the footer and what the footer says. So
 * the gallery and the feed render one composition, and the phone suite measures
 * the geometry the app actually ships. A fixture that hand-copies this markup
 * is a fixture that cannot catch a layout bug in it, which this card has been
 * bitten by before.
 *
 * ── The three panes ───────────────────────────────────────────────────────
 *
 *   PRICE    the tape, with the target on the axis and its distance in the
 *            header — evidence
 *   HORIZON  how long the view was given against how long it has overrun —
 *            evidence
 *   REVIEW   what to do about it — resolution
 *
 * It was four: PRICE, HORIZON, TARGET, RESPOND. TARGET was a permanently-open
 * editor between the evidence and the question, so a reader swiped past a
 * control they had not asked for to reach the decision, and the decision's
 * answers pointed back at it. Editing is one of four possible responses, not a
 * peer of the chart, and it now sits behind the choice that selects it.
 */

export const TARGET_REVIEW_PANE_ID = 'verdict'

export interface TargetExpiredSubject {
  symbol: string
  /** The target that expired. */
  target: number
  /** The horizon it was given, as the analyst wrote it. */
  timeframe: string | null
  /** When the view was stated. ISO. */
  statedAt: string
  /** When the horizon ran out. ISO. */
  expiredAt: string
}

interface TargetExpiredPanesProps {
  subject: TargetExpiredSubject
  /** The question, from the card's own prompt. */
  question: string
  /** The card's one price. See `price-snapshot`. */
  snapshot: PriceSnapshot | null
  /** The chart, already fetched. Injected — see the header. */
  pricePane: React.ReactNode
  onRespond: (option: VerdictOption) => Promise<boolean> | boolean | void
  onSaveTarget: (value: ReviseTargetValue) => Promise<void> | void
  onOpenCases: () => void
  onAddNote: () => void
  resolveNext?: (option: VerdictOption) => { label: string; run: () => void } | null
  /** Given the composed panes and the footer wiring. */
  children: (composed: {
    panes: { id: string; label: string; content: React.ReactNode }[]
    onPaneChange: (paneId: string) => void
    primaryOverride: { id: string; label: string; disabled?: boolean } | null
  }) => React.ReactNode
}

export function TargetExpiredPanes({
  subject, question, snapshot, pricePane,
  onRespond, onSaveTarget, onOpenCases, onAddNote, resolveNext, children,
}: TargetExpiredPanesProps) {
  const [choice, setChoice] = useState<TargetReviewChoice | null>(null)
  const [activePane, setActivePane] = useState('price')
  const [saving, setSaving] = useState(false)

  const saveTarget = useCallback(async (v: ReviseTargetValue) => {
    setSaving(true)
    try { await onSaveTarget(v) } finally { setSaving(false) }
  }, [onSaveTarget])

  const panes = [
    { id: 'price', label: 'Price', content: pricePane },
    {
      id: 'horizon',
      label: 'Horizon',
      content: (
        <HorizonTimeline
          statedAt={subject.statedAt}
          horizonAt={subject.expiredAt}
          timeframe={subject.timeframe}
        />
      ),
    },
    {
      id: TARGET_REVIEW_PANE_ID,
      // "Review", not "Respond". Two of the four paths through this pane edit
      // something rather than answer anything, and a label promising only a
      // response undersells what is behind it.
      label: 'Review',
      content: (
        <TargetReview
          symbol={subject.symbol}
          question={question}
          snapshot={snapshot}
          recordedTarget={subject.target}
          expiredHorizon={subject.timeframe}
          saving={saving}
          resolveNext={resolveNext}
          onRespond={onRespond}
          onSaveTarget={saveTarget}
          onOpenCases={onOpenCases}
          onAddNote={onAddNote}
          onChoiceChange={setChoice}
        />
      ),
    },
  ]

  /**
   * The footer's primary, once the review pane owns the decision.
   *
   * Null on the evidence panes, which keeps `card.actions.primary` and the
   * behaviour every other card has. On REVIEW a "Review target" button offers
   * to open what is already filling the screen — and once the reader has
   * answered "Replace with cases" it is not merely redundant but wrong. So it
   * becomes the chosen resolution's own action, and before anything is chosen
   * it says what is needed and does nothing.
   */
  const primaryOverride = activePane !== TARGET_REVIEW_PANE_ID
    ? null
    : choice
      ? { id: choice.surface === 'cases' ? 'open_cases' : 'review_target', label: choice.cta }
      : { id: 'review_target', label: 'Choose an answer', disabled: true }

  return <>{children({ panes, onPaneChange: setActivePane, primaryOverride })}</>
}
