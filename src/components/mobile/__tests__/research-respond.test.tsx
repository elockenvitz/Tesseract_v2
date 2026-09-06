import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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
    fireEvent.click(screen.getByText('Your view'))
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

describe('the vertical budget, so long content cannot evict the rest', () => {
  /**
   * ── Why this is a contract test and not a geometry test ───────────────────
   *
   * jsdom has no layout: every box measures zero, so a pixel assertion here
   * would pass on a card that clips badly on a real phone. What CAN be proved
   * is the shape of the budget — that the regions which must not grow without
   * bound are bounded, and that the one region able to yield is the evidence
   * band rather than the prose.
   *
   * The failure this pins: every region above and below the band is `shrink-0`
   * and the band had a hard 172px floor, so once the fixed content exceeded
   * what was left nothing gave — the band held its height and the body ran off
   * the bottom, where the ancestor's `overflow-hidden` cut it silently. The
   * New Research headline names an event and is the longest the family emits,
   * which is why that card showed it first.
   */
  const shell = () => {
    const { container } = render(<Harness framing="new_evidence" onSubmit={() => {}} />)
    return container
  }

  it('bounds the headline, which is the only unbounded region left', () => {
    const h = shell().querySelector('h2')
    expect(h?.className).toContain('line-clamp-3')
  })

  it('gives the carousel workspace every pixel the shell does not need', () => {
    /**
     * ── Three shapes of the same region ─────────────────────────────────────
     *
     * `flex-1` with a PIXEL floor made the band a residual: a card with a
     * heavy header got a smaller chart than one with a light header — same
     * component, same branch, charts that looked like different products.
     *
     * `min-h-[38%] max-h-[46%]` fixed that and introduced the regression this
     * replaces. The ceiling capped the workspace at ~300px on a 737px card
     * while the body spacer — an equal `flex-grow: 1` claimant — took the
     * 135px left over. Content was compressed and emptiness was not, inside
     * one card.
     *
     * `basis-[38%]` with a 999 grow factor is the share as a STARTING point
     * rather than a wall: free space is measured from there and handed back,
     * so the workspace ends up at exactly the remainder, and on a card too
     * short for its content it gives some back instead of pushing the footer
     * off the bottom.
     */
    expect(shell().innerHTML).toContain('basis-[38%]')
    expect(shell().innerHTML).toContain('grow-[999]')
    // The ceiling is gone, and so are the pixel floors before it.
    expect(shell().innerHTML).not.toContain('max-h-[46%]')
    expect(shell().innerHTML).not.toContain('min-h-[140px]')
    expect(shell().innerHTML).not.toContain('min-h-[172px]')
  })

  it('keeps the supporting description out of the tile entirely', () => {
    /**
     * The supporting description no longer renders in a tile.
     *
     * It is Depth 2 in every state now — `Why this matters` is the whole of
     * its presence on the card. What this rule protected, that a variable
     * paragraph could not move anything below it, is protected absolutely by
     * its absence.
     */
    const root = shell()
    expect(root.querySelector('[data-slot="body-region"]')).toBeNull()
    const way = root.querySelector('[data-slot="context-open"]')
    expect(way).toBeTruthy()
    expect(way!.textContent).toContain('Why this matters')
  })

  it('sits against the footer, with the slack spent above it', () => {
    /**
     * The spacer still absorbs the slack; what follows it changed.
     *
     * Free space in a flex column collects after the last growable item, so
     * the rule is that nothing below the spacer may grow. The description used
     * to be that final fixed region; it has left the tile, and `Why this
     * matters` — a `shrink-0` row — is what holds the position now.
     */
    const root = shell()
    const spacer = root.querySelector('[data-slot="body-spacer"]')!
    expect(spacer).toBeTruthy()
    expect(spacer.className).toContain('h-3.5')
    expect(spacer.className).toContain('grow')
    expect(spacer.className).not.toContain('flex-1')
    const after = spacer.nextElementSibling as HTMLElement | null
    expect(after?.getAttribute('data-slot')).toBe('context-open')
    expect(after!.className).toContain('shrink-0')
    expect(after!.nextElementSibling).toBeNull()
  })

  it('keeps the headline itself short enough not to need the clamp', () => {
    // The clamp is a guard, not the fix. The copy was trimmed at source: the
    // anchor age is already the metric and the body.
    const h = shell().querySelector('h2')
    expect((h?.textContent ?? '').length).toBeLessThan(50)
  })
})

describe('the price line and its fill are one decision', () => {
  it('never draws a graded line over a neutral wash', () => {
    /**
     * The disconnect: `directionNeutral` neutralised the fill and the return
     * text and missed the polyline's own `up ? emerald : rose`, so a Research
     * chart drew a green line over a grey area. Both now read one `plotTone`,
     * so they cannot diverge again.
     */
    const src = readFileSync(
      resolve(__dirname, '../../signals/PriceContext.tsx'), 'utf8',
    )
    // No hard-coded direction colour survives on the stroke.
    expect(src).not.toMatch(/stroke-emerald|stroke-rose/)
    // The polygon, the polyline and the gradient all take the same class.
    //
    // Three, not two. `currentColor` in a `<stop>` resolves against the
    // GRADIENT element, not the shape referencing it, and a `<linearGradient>`
    // in `<defs>` inherits from the `<svg>` — which carries no tone. Measured
    // on the rendered card: polygon `rgb(225,29,72)`, its stops `rgb(0,0,0)`.
    // Black at 0.26 is the grey wash under a coloured line that survived a
    // pass whose JSX read correctly. See `research-panes` for the rest.
    expect(src.match(/className=\{plotTone\}/g) ?? []).toHaveLength(3)
    // And the gradient inherits rather than deciding for itself.
    expect(src).toContain('stopColor="currentColor"')
  })
})

describe('the multi-arrival primary sends the reader to the list', () => {
  /**
   * §12. With one arrival the primary opens that item, which is unambiguous.
   * With more, opening the newest would be the card choosing on the reader's
   * behalf — the exact thing the brief forbids — so it scrolls to the Research
   * pane, where every arrival is listed newest-first and individually openable.
   */
  function MultiHarness({ count, onFocus }: { count: number; onFocus: (id: string) => void }) {
    const [focus, setFocus] = useState<string | null>(null)
    const evidence = Array.from({ length: count }, (_, i) => ({
      id: `e${i}`, at: `2026-0${i + 1}-01T00:00:00Z`, kind: 'note' as const, title: `Note ${i}`,
    }))
    return (
      <SignalCardSection
        card={{
          ...(() => {
            const r = buildInsightCard(insight('new_evidence'))
            if (!r.ok) throw new Error('suppressed')
            return r.card
          })(),
        }}
        panes={[{ id: 'evidence', label: 'Research', content: <p>list</p> }]}
        focusPaneId={focus}
        primaryOverride={
          evidence.length > 1
            ? {
                id: 'review_research',
                label: 'Review new research',
                run: () => { setFocus('evidence'); onFocus('evidence') },
              }
            : null
        }
        onOpenAsset={() => {}} onCapture={() => {}} onSnooze={() => {}} onDismiss={() => {}}
        onPrimary={() => {}}
      />
    )
  }

  it('offers "Review new research" rather than opening one of them', () => {
    const onFocus = vi.fn()
    render(<MultiHarness count={3} onFocus={onFocus} />)
    const cta = screen.getByText('Review new research')
    expect(cta).toBeTruthy()
    fireEvent.click(cta)
    expect(onFocus).toHaveBeenCalledWith('evidence')
  })

  it('leaves the single-arrival card on its own direct action', () => {
    // One arrival is unambiguous, so the footer still opens it.
    render(<MultiHarness count={1} onFocus={() => {}} />)
    expect(screen.queryByText('Review new research')).toBeNull()
    expect(document.body.textContent).toMatch(/Read the research/)
  })

  it('threads focusPaneId all the way to the carousel', () => {
    // It existed on `CardCarousel` and nothing passed it, which is why the
    // footer had no way to move the reader without navigating.
    const src = readFileSync(resolve(__dirname, '../../signals/SignalCardView.tsx'), 'utf8')
    expect(src).toContain('focusPaneId={focusPaneId}')
  })
})
