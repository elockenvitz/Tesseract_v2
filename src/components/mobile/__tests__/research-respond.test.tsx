import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

import { SignalCardSection } from '../SignalCardSection'
import { VerdictBar } from '../../signals/VerdictBar'
import { JUDGMENT_PANE_ID } from '../../signals/SignalCardView'
import { buildInsightCard } from '../../../lib/signals/builders/legacy-kinds'
import {
  caseCoverageFrom, researchBaseFor, researchCopy, researchIssueFor,
  researchSignalTypeFor, reviewClocks,
} from '../../../lib/research/case-state'
import type { DerivedInsight } from '../../../hooks/mobile/useDerivedInsights'
import type { SignalCard } from '../../../lib/signals/contract'

/**
 * The Respond seam, rendered rather than reasoned about.
 *
 * ── The bug this pins, and why a source test would have missed it ─────────
 *
 * The footer computes its override from "is the reader on the verdict pane",
 * and learns that from `onPaneChange`. But `onPaneChange` fires from
 * `CardCarousel.onActiveChange`, and an `on_engage` card's judgment pane is
 * FILTERED OUT of the carousel — it takes the whole band instead. So the
 * callback was never once called with `verdict` on a Research card, the
 * override never computed, and the sticky CTA still said "Review the case"
 * while the pane below it showed a selected answer and its consequence.
 *
 * Ideas and Pair are `judgment: 'inline'`; their verdict IS a carousel pane, so
 * the identical wiring worked there. The bug was invisible to every test that
 * did not actually mount an `on_engage` card and press the control.
 */

const DAY = 86_400_000
const NOW = new Date('2026-08-31T00:00:00.000Z').getTime()
const ago = (d: number) => new Date(NOW - d * DAY).toISOString()

/** A Research insight in a given framing, through the real rule. */
function insight(framing: 'price_move' | 'new_evidence' | 'long_silence'): DerivedInsight {
  const coverage = caseCoverageFrom(
    ['thesis', 'where_different', 'risks_to_thesis'].map(section => ({
      section, hasContent: true, updated_at: ago(200),
    })),
  )
  const clocks = reviewClocks(coverage, null)
  const evidence = framing === 'new_evidence'
    ? [{ id: 'e1', at: ago(20), kind: 'note' as const, title: 'On fire', authorName: 'Priya Raman' }]
    : []
  const issue = researchIssueFor({
    clocks, coverage, evidence,
    movePct: framing === 'price_move' ? -30.5 : null,
    now: NOW,
  })!
  expect(issue.framing).toBe(framing)
  const copy = researchCopy({ symbol: 'NKE', issue, portfolioName: 'Core', weightPct: 3, held: true })
  return {
    id: `research-${framing}-a1`,
    kind: researchSignalTypeFor(issue.framing) === 'no_research' ? 'no_thesis' : 'stale_research',
    headline: copy.headline, body: copy.body, prompt: copy.prompt,
    assetId: '9f1c2b7e-0000-4000-8000-000000000001',
    symbol: 'NKE', companyName: 'Nike',
    portfolioName: 'Core', portfolioId: 'p1', weightPct: 3,
    held: true, portfolioCount: 1, liveIdeas: [], coverageOwners: [], evidenceCount: evidence.length,
    issue,
    caseWrittenAt: clocks.caseWrittenAt,
    researchReviewAt: clocks.researchReviewAt,
    reviewAnchor: clocks.effectiveAnchor,
    anchoredOn: issue.anchoredOn,
    daysSinceReview: issue.daysSinceReview,
    daysSinceWritten: issue.daysSinceWritten,
    score: researchBaseFor(issue),
  }
}

const OPTIONS = [
  { key: 'change_accounted_for', label: 'Case holds', tone: 'affirm' as const, disposition: 'settled' as const, note: 'n1' },
  { key: 'view_needs_update', label: 'Case needs updating', tone: 'neutral' as const, disposition: 'flagged' as const, note: 'n2' },
  { key: 'needs_review', label: 'Need to review properly', tone: 'neutral' as const, disposition: 'flagged' as const, note: 'n3' },
]

/**
 * The card, wired exactly as `MobileDashboard` wires it.
 *
 * The state lives in the parent there too — that is the point of the test. A
 * harness that owned the pending selection inside the card would prove the
 * opposite of what is being asserted.
 */
function Harness({
  framing, onSubmit,
}: {
  framing: 'price_move' | 'new_evidence' | 'long_silence'
  onSubmit: (key: string, note: string) => void
}) {
  const ins = insight(framing)
  const result = buildInsightCard(ins)
  if (!result.ok) throw new Error('suppressed')
  const card: SignalCard = result.card

  const [activePane, setActivePane] = useState<string>('')
  const [pending, setPending] = useState<{ key: string; label: string; note: string } | null>(null)

  return (
    <SignalCardSection
      card={card}
      panes={[
        { id: 'case', label: 'Case', content: <p>case pane</p> },
        {
          id: JUDGMENT_PANE_ID,
          label: 'Respond',
          content: (
            <VerdictBar
              question={ins.prompt}
              options={OPTIONS}
              externalCommit
              onPick={o => setPending(o ? { key: o.key, label: o.label, note: '' } : null)}
              onCommentaryChange={note => setPending(p => (p ? { ...p, note } : p))}
              onRespond={async () => true}
            />
          ),
        },
      ]}
      onPaneChange={setActivePane}
      primaryOverride={
        activePane === JUDGMENT_PANE_ID && pending
          ? {
              id: 'submit_response',
              label: 'Submit response',
              run: () => onSubmit(pending.key, pending.note),
            }
          : null
      }
      onOpenAsset={() => {}} onCapture={() => {}} onSnooze={() => {}} onDismiss={() => {}}
      onPrimary={() => {}}
    />
  )
}

const primary = () => document.querySelector('[data-slot="primary"]')
  ?? screen.getByRole('button', { name: /Review the case|Read the research|Submit response/ })

const FRAMINGS = ['new_evidence', 'price_move', 'long_silence'] as const

describe.each(FRAMINGS)('%s — the shared Respond seam', framing => {
  it('starts on the framing action, not on a submit control', () => {
    render(<Harness framing={framing} onSubmit={() => {}} />)
    expect(document.body.textContent).toMatch(/(Review the case|Read the research)/)
    expect(screen.queryByText('Submit response')).toBeNull()
  })

  it('renders a Back control whenever Respond is open', () => {
    /**
     * §3. It used to live only in the context-row branch, so a card with no
     * context chips could be entered and never left. Both branches render the
     * same control in both states now.
     */
    render(<Harness framing={framing} onSubmit={() => {}} />)
    fireEvent.click(screen.getByTestId ? screen.getByText('Your view') : screen.getByText('Your view'))
    expect(document.querySelector('[data-slot="judgment-back"]')).toBeTruthy()
    expect(screen.getByText('Back')).toBeTruthy()
  })

  it('morphs the sticky footer once an answer is selected', () => {
    // The bug: `onPaneChange` never reported `verdict` for an `on_engage`
    // card, so this override could not compute and the CTA never changed.
    render(<Harness framing={framing} onSubmit={() => {}} />)
    fireEvent.click(screen.getByText('Your view'))
    fireEvent.click(screen.getByText('Case needs updating'))
    expect(screen.getByText('Submit response')).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/(Review the case|Read the research)/)
  })

  it('keeps the selection across Back and forward, and submits exactly it', () => {
    // §4, designed in Stage 1.2 and never proven. Nothing persists until the
    // footer is pressed, so leaving and returning must lose nothing.
    const onSubmit = vi.fn()
    render(<Harness framing={framing} onSubmit={onSubmit} />)

    fireEvent.click(screen.getByText('Your view'))
    fireEvent.click(screen.getByText('Case needs updating'))
    expect(screen.getByText('Submit response')).toBeTruthy()

    fireEvent.click(screen.getByText('Back'))
    // Nothing was written by leaving.
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Your view'))
    expect(screen.getByText('Submit response')).toBeTruthy()

    fireEvent.click(screen.getByText('Submit response'))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0][0]).toBe('view_needs_update')
  })

  it('offers no second commit control inside the pane', () => {
    // §1/§30: one primary CTA. The bar's own Apply is off under
    // `externalCommit`.
    render(<Harness framing={framing} onSubmit={() => {}} />)
    fireEvent.click(screen.getByText('Your view'))
    fireEvent.click(screen.getByText('Case holds'))
    expect(screen.queryByTestId('verdict-send')).toBeNull()
    expect(screen.getAllByText('Submit response')).toHaveLength(1)
  })

  it('returns the footer to the framing action when Back is pressed', () => {
    render(<Harness framing={framing} onSubmit={() => {}} />)
    fireEvent.click(screen.getByText('Your view'))
    fireEvent.click(screen.getByText('Case holds'))
    fireEvent.click(screen.getByText('Back'))
    expect(document.body.textContent).toMatch(/(Review the case|Read the research)/)
  })
})

describe('the authoring framings have no Respond at all', () => {
  it('shows no Your view when the card carries no judgment pane', () => {
    // §31. `offersEngagement` already requires a judgment pane; this pins it,
    // because the authoring framings now pass none.
    const ins = insight('price_move')
    const result = buildInsightCard(ins)
    if (!result.ok) throw new Error('suppressed')
    render(
      <SignalCardSection
        card={result.card}
        panes={[{ id: 'case', label: 'Case', content: <p>case pane</p> }]}
        onOpenAsset={() => {}} onCapture={() => {}} onSnooze={() => {}} onDismiss={() => {}}
        onPrimary={() => {}}
      />,
    )
    expect(screen.queryByText('Your view')).toBeNull()
    expect(document.querySelector('[data-slot="engage"]')).toBeNull()
  })
})
