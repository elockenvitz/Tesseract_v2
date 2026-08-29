import { useCallback, useRef, useState } from 'react'

import { ScenarioRespond } from './ScenarioRespond'
import type { ScenarioReviewChoice } from '../../lib/signals/scenario-review'

/**
 * Case vs price: four panes, and one primary that means what it says.
 *
 * ── The pane order is the argument ────────────────────────────────────────
 *
 * LADDER states the discrepancy, RESPOND asks what it means, and PRICE and
 * CASES are the evidence for anybody who wants it. The response used to sit
 * fifth behind two probability panes that are usually empty, so the question
 * the card exists to ask was four swipes from the headline.
 *
 * Two of those probability panes are gone entirely. `Conviction`
 * (`ScenarioDistribution`) and `Reweight` (`CaseChartPane`) rendered only when
 * a ladder carried usable probabilities — measured, four of ten laddered
 * symbols — so the card's pane COUNT changed with the data, and the two extra
 * pages sat between the decision and its evidence. What they showed is not
 * lost: the Cases pane states every probability beside the case it belongs to
 * and the expected value beneath them, and `Review cases` opens the editor that
 * changes any of it.
 *
 * ── The footer, and why it is not this component's ────────────────────────
 *
 * The card has exactly one action bar and it is the shared one: `Actions` on
 * the left on every pane, and on the right the card's own `Review cases` —
 * except on RESPOND, where the thing to do is submit. That substitution is
 * `primaryOverride`, which `SignalCardView` already supports and
 * `TargetExpiredPanes` already uses; this is the second card to use it rather
 * than a second mechanism.
 *
 * ── Selection mutates nothing ─────────────────────────────────────────────
 *
 * Choosing an answer changes the footer's label and does nothing else. The
 * write happens on `Submit response` and only a successful one records
 * anything — so a failed save leaves the answer selected, the note intact and
 * the signal unresolved, which is what the reader is told.
 *
 * Pure: no Supabase and no data fetching. The panes it does not own — the tape
 * and the ladder's 52-week context — arrive as nodes, so the gallery can render
 * this composition exactly as the feed does.
 */

export const SCENARIO_RESPOND_PANE_ID = 'verdict'

export interface ScenarioPane {
  id: string
  label: string
  content: React.ReactNode
}

interface ScenarioGapPanesProps {
  /** Must cover all four answers. Labels the radiogroup. */
  question: string
  /** The ladder, already wrapped with whatever it needs to fetch. */
  ladderPane: React.ReactNode
  /**
   * The tape. Null where no series is cached for the name — the pane is then
   * omitted rather than paging to two lines saying there is no chart.
   */
  pricePane: React.ReactNode | null
  casesPane: React.ReactNode
  /**
   * Persists the judgment and its note through the existing path.
   *
   * Returns false (or throws) when nothing was persisted, which keeps the
   * answer and the note and leaves the signal unresolved.
   */
  onSubmit: (choice: ScenarioReviewChoice, note: string) => Promise<boolean>
  children: (composed: {
    panes: ScenarioPane[]
    onPaneChange: (paneId: string) => void
    primaryOverride:
      | { id: string; label: string; disabled?: boolean; run?: () => void }
      | null
  }) => React.ReactNode
}

export function ScenarioGapPanes({
  question, ladderPane, pricePane, casesPane, onSubmit, children,
}: ScenarioGapPanesProps) {
  const [choice, setChoice] = useState<ScenarioReviewChoice | null>(null)
  const [note, setNote] = useState('')
  const [recorded, setRecorded] = useState<ScenarioReviewChoice | null>(null)
  const [activePane, setActivePane] = useState('ladder')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /**
   * Guards a double tap into two judgments and two audit rows.
   *
   * A ref, not state: the second tap can arrive before React re-renders the
   * first, so `disabled` alone is a race. Set synchronously inside the handler,
   * this is the actual gate.
   */
  const inFlight = useRef(false)

  const submit = useCallback(async () => {
    if (!choice || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    try {
      const ok = await onSubmit(choice, note.trim())
      if (!ok) {
        setError('That did not save. Your answer and note are still here.')
        return
      }
      setRecorded(choice)
    } catch {
      setError('That did not save. Your answer and note are still here.')
    } finally {
      setSaving(false)
      inFlight.current = false
    }
  }, [choice, note, onSubmit])

  const panes: ScenarioPane[] = [
    { id: 'ladder', label: 'Ladder', content: ladderPane },
    {
      id: SCENARIO_RESPOND_PANE_ID,
      label: 'Respond',
      content: (
        <ScenarioRespond
          question={question}
          selected={choice}
          onSelect={c => { setChoice(c); setError(null) }}
          note={note}
          onNoteChange={setNote}
          saving={saving}
          error={error}
          recorded={recorded}
          // Clears the confirmation, keeps the note. Choosing again writes a
          // new judgment rather than editing the one already recorded.
          onChangeAnswer={() => { setRecorded(null); setError(null) }}
        />
      ),
    },
    ...(pricePane ? [{ id: 'price', label: 'Price', content: pricePane }] : []),
    { id: 'cases', label: 'Cases', content: casesPane },
  ]

  /**
   * The one substitution, and only where it is true.
   *
   * Off every pane but RESPOND, so LADDER, PRICE and CASES keep the card's own
   * `Review cases` — which is the right next step from all three, and is what
   * the builder declares.
   *
   * On RESPOND with nothing chosen the button states what it WOULD do and is
   * disabled, rather than disappearing: the bar keeping its shape is what stops
   * the card reflowing under the thumb as the reader pages across it.
   *
   * Once a response is recorded the override lifts entirely and the footer
   * returns to `Review cases`. A disabled "Submitted" would be a dead end on
   * the one pane the reader is already finished with, and reviewing the cases
   * is genuinely what three of the four answers point at next.
   */
  const primaryOverride = activePane !== SCENARIO_RESPOND_PANE_ID || recorded
    ? null
    : {
        id: 'submit_response',
        label: saving ? 'Saving…' : 'Submit response',
        disabled: !choice || saving,
        run: () => void submit(),
      }

  return <>{children({ panes, onPaneChange: setActivePane, primaryOverride })}</>
}
