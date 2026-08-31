import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { CasePane } from '../CasePane'
import { CaseGapPane } from '../CaseGapPane'
import { EvidencePane } from '../EvidencePane'
import type { EvidenceArrival } from '../../../lib/research/case-state'

/**
 * The three Research panes, asserted on what they must never say.
 *
 * Most of these are honesty guards rather than layout checks: a pane that
 * renders a plausible-looking number it does not have is the failure mode this
 * family is most exposed to, and it is invisible in a screenshot.
 */

const ev = (over: Partial<EvidenceArrival> = {}): EvidenceArrival => ({
  id: 'e1', at: '2026-04-01T00:00:00Z', kind: 'note',
  authorName: 'Priya Raman', title: 'PSKY x WBD Analysis', preview: 'A short preview.',
  ...over,
})

describe('EvidencePane', () => {
  it('lists each arrival with its author and date', () => {
    render(<EvidencePane items={[ev(), ev({ id: 'e2', at: '2026-05-02T00:00:00Z', title: null })]} reviewAnchor="2026-01-01T00:00:00Z" />)
    expect(screen.getByText('PSKY x WBD Analysis')).toBeTruthy()
    // A note with no title says what it is rather than showing an empty row.
    expect(screen.getByText('Untitled note')).toBeTruthy()
    expect(screen.getAllByText(/Priya Raman/).length).toBe(2)
    expect(screen.getByText(/2 arrived after the case was written/)).toBeTruthy()
  })

  it('names a quick thought as one, since it has no title to show', () => {
    render(<EvidencePane items={[ev({ kind: 'thought', title: null })]} reviewAnchor={null} />)
    expect(screen.getByText('Quick thought')).toBeTruthy()
  })

  it('never claims the evidence supports or challenges anything', () => {
    /**
     * The single most important assertion in this file. `note_type` is a
     * document class and `sentiment` is about the asset; neither is a relation
     * to the thesis, and nothing else records one. The pane says so explicitly
     * rather than leaving the reader to assume the product has already judged.
     */
    const { container } = render(<EvidencePane items={[ev()]} reviewAnchor="2026-01-01T00:00:00Z" />)
    // Matched against ASSERTIVE phrasing only. The pane's own disclaimer uses
    // the same two verbs, which is the point — the only place a stance appears
    // is in the sentence saying nobody has taken one.
    expect(container.textContent).not.toMatch(
      /(supports|challenges|contradicts|confirms|refutes) the (thesis|case)(?!\.\s*That is the review)/i,
    )
    expect(container.textContent).toMatch(/Nothing records whether this supports or challenges the thesis/)
    expect(container.textContent).not.toMatch(/\b(bullish|bearish|positive for|negative for)\b/i)
  })

  it('tints nothing, because nothing here is graded', () => {
    const { container } = render(<EvidencePane items={[ev()]} reviewAnchor={null} />)
    const classes = container.innerHTML
    expect(classes).not.toMatch(/text-(red|rose|green|emerald|amber)-/)
  })

  it('renders nothing at all when there is no evidence', () => {
    const { container } = render(<EvidencePane items={[]} reviewAnchor="2026-01-01T00:00:00Z" />)
    // An empty pane in a carousel costs a swipe and teaches the reader that
    // swiping is not worth it.
    expect(container.firstChild).toBeNull()
  })
})

describe('CasePane', () => {
  it('shows every core section, present or not', () => {
    render(<CasePane present={['thesis']} caseWrittenAt="2026-03-07T00:00:00Z" daysSinceWritten={177} />)
    expect(screen.getByText('Thesis')).toBeTruthy()
    expect(screen.getByText('Where different')).toBeTruthy()
    expect(screen.getByText('Risks')).toBeTruthy()
    expect(screen.getAllByLabelText('not written')).toHaveLength(2)
    expect(screen.getAllByLabelText('written')).toHaveLength(1)
  })

  it('never turns presence into a score', () => {
    // 1 of 3 is not 33% of a case. The sections are different kinds of work,
    // not interchangeable units of it.
    const { container } = render(<CasePane present={['thesis']} caseWrittenAt="2026-03-07T00:00:00Z" daysSinceWritten={177} />)
    expect(container.textContent).not.toMatch(/%|33|67|complete|score|quality/i)
  })

  it('says "written" for the edit, and says nothing about a review that did not happen', () => {
    const { container } = render(<CasePane present={['thesis']} caseWrittenAt="2026-03-07T00:00:00Z" daysSinceWritten={177} />)
    expect(container.textContent).toMatch(/Last written 177 days ago/)
    expect(container.textContent).not.toMatch(/review|looked/i)
  })

  it('shows both clocks when a completed review is newer than the edit', () => {
    /**
     * §6. The review is why the card may be quiet; the write date is what the
     * reader will actually find when they open the case. Before the clocks were
     * separated this pane said "Last written 5 days ago" about a case last
     * edited in November.
     */
    const { container } = render(
      <CasePane present={['thesis']} caseWrittenAt="2025-11-21T00:00:00Z" daysSinceWritten={283} daysSinceReviewed={5} />,
    )
    expect(container.textContent).toMatch(/Reviewed 5 days ago · unchanged/)
    expect(container.textContent).toMatch(/Last written 283 days ago/)
    // The write date is never restated as a review date.
    expect(container.textContent).not.toMatch(/written 5 days/)
  })

  it('says so plainly when the case has never been written', () => {
    const { container } = render(<CasePane present={[]} caseWrittenAt={null} daysSinceWritten={null} />)
    expect(container.textContent).toMatch(/Never written/)
  })
})

describe('CaseGapPane', () => {
  const base = {
    symbol: 'MSFT', coverageOwners: [], held: false, portfolioName: null,
    portfolioCount: 0, weightPct: null, liveIdeas: [], evidenceCount: 0,
  }

  it('names the current weight when there is one', () => {
    render(<CaseGapPane {...base} held portfolioName="Vision Fund 10K" weightPct={5.1} portfolioCount={1} />)
    expect(screen.getByText('5.1% · Vision Fund 10K')).toBeTruthy()
  })

  it('never prints 0.0% for a held name with no weight recorded', () => {
    // 26 of 36 current production positions carry no weight at all.
    const { container } = render(<CaseGapPane {...base} held portfolioName="Vision Fund 10K" portfolioCount={1} />)
    expect(screen.getByText('Held in Vision Fund 10K')).toBeTruthy()
    expect(container.textContent).not.toMatch(/0\.0%/)
  })

  it('shows no exposure row at all for a covered but unheld name', () => {
    // ORCL and the twelve like it. Coverage put them in the universe; a book
    // chip would be a claim the data does not support.
    const { container } = render(<CaseGapPane {...base} coverageOwners={['Priya Raman']} />)
    expect(screen.getByText('Priya Raman')).toBeTruthy()
    expect(container.textContent).not.toMatch(/Exposure|Held|%/)
  })

  it('counts several live ideas rather than picking one', () => {
    render(<CaseGapPane {...base} liveIdeas={[{ id: 'a', action: 'buy' }, { id: 'b', action: 'sell' }]} />)
    expect(screen.getByText('2 live')).toBeTruthy()
  })

  it('names the single live idea by its direction', () => {
    render(<CaseGapPane {...base} liveIdeas={[{ id: 'a', action: 'buy' }]} />)
    expect(screen.getByText('BUY')).toBeTruthy()
  })

  it('says the truth in a sentence when there is genuinely nothing', () => {
    // A table of dashes reads as a form the product failed to fill in.
    const { container } = render(<CaseGapPane {...base} />)
    expect(container.textContent).toMatch(/MSFT is in the research universe and nothing else is recorded/)
    expect(container.textContent).not.toMatch(/—|n\/a|none/i)
  })
})
