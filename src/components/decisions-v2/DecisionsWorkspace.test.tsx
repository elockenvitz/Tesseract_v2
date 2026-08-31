/**
 * Focused test for the Decisions workspace.
 *
 * The data hook is mocked. What this file is for is the surface's own
 * decisions: that it opens as memory rather than as a queue, that a
 * system-written note is never presented as reasoning, that historical and
 * current facts stay apart, that price after a decision carries no verdict, and
 * that every route out reuses a seam another stage already owns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { DecisionRecord } from '../../lib/desktop-decisions'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const decision = (over: Partial<DecisionRecord> = {}): DecisionRecord => ({
  id: 'dr-1', ideaId: 'tq-1',
  portfolioId: 'p1', portfolioName: 'Vision Fund 10K',
  assetId: 'a-orcl', symbol: 'ORCL', companyName: 'Oracle',
  status: 'accepted', action: 'buy',
  decidedBy: 'u1', decidedByName: 'Eric Lockenvitz', decidedAt: daysAgo(160),
  requestedByName: 'Seb Barbero', requestedAt: daysAgo(170),
  decisionNote: null, contextNote: null,
  sizingWeight: 2, sizingShares: null, baselineWeight: null,
  deferredUntil: null, execution: null,
  ...over,
})

const priceSeries = (days: number, rising: boolean) =>
  Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.now() - (days - i) * DAY).toISOString().slice(0, 10),
    close: rising ? 100 + i * 0.3 : 200 - i * 0.3,
  }))

let decisions: DecisionRecord[] = []
let detail: any = {}
let scanError: Error | null = null
const detailRequestedFor: string[] = []

vi.mock('../../hooks/useDesktopDecisions', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useDesktopDecisions')>()
  return {
    ...actual,
    useDecisionScan: () => ({ decisions, isLoading: false, error: scanError }),
    useDecisionDetail: (d: DecisionRecord | null) => {
      if (d) detailRequestedFor.push(d.id)
      return { detail: d ? detail : undefined, isLoading: false }
    },
  }
})

const openEngagement = vi.fn()
vi.mock('../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/engagement')>()
  return {
    ...actual,
    askAI: (t: any) => openEngagement('ai', t),
    discuss: (t: any) => openEngagement('discuss', t),
  }
})

import { DecisionsWorkspace } from './DecisionsWorkspace'

const tabEvents: CustomEvent[] = []
const typedEvents: CustomEvent[] = []
const onTab = (e: Event) => tabEvents.push(e as CustomEvent)
const onTyped = (e: Event) => typedEvents.push(e as CustomEvent)

beforeEach(() => {
  decisions = []
  detail = {}
  scanError = null
  detailRequestedFor.length = 0
  tabEvents.length = 0
  typedEvents.length = 0
  openEngagement.mockClear()
  window.addEventListener('decision-engine-action', onTab)
  window.addEventListener('tesseract:open-research', onTyped)
  window.addEventListener('tesseract:open-idea', onTyped)
})
afterEach(() => {
  window.removeEventListener('decision-engine-action', onTab)
  window.removeEventListener('tesseract:open-research', onTyped)
  window.removeEventListener('tesseract:open-idea', onTyped)
})

const metric = (label: string) =>
  screen.getAllByTestId('decision-metric').find(m => m.textContent?.includes(label))

/* ------------------------------------------------------------ entry state */

describe('it opens as memory, not as a queue', () => {
  const three = () => {
    decisions = [
      decision({ id: 'newest', symbol: 'AAA', decidedAt: daysAgo(5) }),
      decision({ id: 'middle', symbol: 'BBB', decidedAt: daysAgo(50) }),
      decision({ id: 'oldest', symbol: 'CCC', decidedAt: daysAgo(500) }),
    ]
  }

  it('lands in the record, not inside one of them', () => {
    three()
    render(<DecisionsWorkspace />)
    expect(screen.getByTestId('workspace-browse')).toBeInTheDocument()
    expect(screen.queryByTestId('decision-detail')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('decision-tile')).toHaveLength(3)
    // Opening the newest on arrival is the queue reading again, quieter.
    expect(detailRequestedFor).toHaveLength(0)
  })

  it('gives the chosen record the whole canvas', async () => {
    const user = userEvent.setup()
    three()
    render(<DecisionsWorkspace />)
    // Newest first, so the first tile is the newest -- ordering, not opening.
    await user.click(screen.getAllByTestId('decision-tile')[0])

    expect(screen.getByTestId('decision-detail')).toBeInTheDocument()
    expect(screen.queryAllByTestId('decision-tile')).toHaveLength(0)
    expect(detailRequestedFor).toEqual(['newest'])
  })

  it('has no standalone card grid and no repeated revisit button', () => {
    three()
    render(<DecisionsWorkspace />)
    expect(screen.queryAllByTestId('decision-card')).toHaveLength(0)
    // Selection is the revisit; a CTA per row is what read as an inbox.
    expect(screen.queryByRole('button', { name: /Revisit this decision/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'All decisions' })).not.toBeInTheDocument()
  })

  it('keeps the index chronological, newest first', () => {
    three()
    render(<DecisionsWorkspace />)
    const rows = screen.getAllByTestId('decision-tile')
    expect(rows.map(r => within(r).getAllByText(/^[A-Z]{3}$/)[0].textContent))
      .toEqual(['AAA', 'BBB', 'CCC'])
  })

  it('distinguishes a read failure from an empty history', () => {
    scanError = new Error('relation lookup failed')
    render(<DecisionsWorkspace />)
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.queryByText(/No decisions on record yet/)).not.toBeInTheDocument()
  })

  it('says nothing is recorded when nothing is', () => {
    render(<DecisionsWorkspace />)
    expect(screen.getByText(/No decisions on record yet/)).toBeInTheDocument()
  })
})

/* ---------------------------------------------------------------- metrics */

describe('the header counts say what they mean', () => {
  it('never calls submission context a decision rationale', () => {
    decisions = [
      decision({ id: 'a', decisionNote: 'i like this idea, makes sense', contextNote: 'we need 2%' }),
      decision({ id: 'b', decisionNote: 'Self-proposed via Trade Lab Execute', contextNote: 'get long pal' }),
      decision({ id: 'c', decisionNote: 'Self-proposed via Trade Lab Execute', contextNote: 'earnings' }),
    ]
    render(<DecisionsWorkspace />)

    // One person wrote a reason for deciding; three wrote a reason for asking.
    expect(metric('decision rationale')).toHaveTextContent('1')
    expect(metric('with submission context')).toHaveTextContent('3')
    // The fused label that overstated the record fourfold.
    expect(screen.queryByText(/carry a written reason/)).not.toBeInTheDocument()
    expect(screen.queryByText(/3 decision rationale/)).not.toBeInTheDocument()
  })

  it('counts only human notes as rationale', () => {
    decisions = [
      decision({ id: 'a', decisionNote: 'Self-proposed via Trade Lab Execute' }),
      decision({ id: 'b', decisionNote: 'Withdrawn during cleanup — no active recommendation' }),
    ]
    render(<DecisionsWorkspace />)
    expect(metric('decision rationales')).toHaveTextContent('0')
  })

  it('counts resolved and executed separately', () => {
    decisions = [
      decision({ id: 'a', status: 'accepted',
                 execution: { id: 'x', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' } }),
      decision({ id: 'b', status: 'accepted', execution: null }),
      decision({ id: 'c', status: 'pending', decidedAt: null, decidedByName: null }),
    ]
    render(<DecisionsWorkspace />)
    expect(metric('resolved')).toHaveTextContent('2')
    expect(metric('executed')).toHaveTextContent('1')
  })
})

/* -------------------------------------------------------------- the index */

describe('the index is a memory scan', () => {
  it('shows terminal accepted and withdrawn records side by side', () => {
    decisions = [
      decision({ id: 'a', status: 'accepted', symbol: 'AAA', decidedAt: daysAgo(5) }),
      decision({ id: 'b', status: 'rejected', symbol: 'BBB', decidedAt: daysAgo(6) }),
      decision({ id: 'c', status: 'withdrawn', symbol: 'CCC', decidedAt: daysAgo(7) }),
    ]
    render(<DecisionsWorkspace />)
    expect(screen.getAllByTestId('decision-tile').map(r => r.getAttribute('data-outcome')))
      .toEqual(['accepted', 'declined', 'withdrawn'])
  })

  it('does not drop a decision whose idea has been executed', () => {
    decisions = [decision({
      status: 'accepted',
      execution: { id: 'at', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' },
    })]
    render(<DecisionsWorkspace />)
    // The active-Ideas filter would remove exactly this record.
    expect(screen.getAllByTestId('decision-tile')).toHaveLength(1)
  })

  it('quotes a real rationale on the tile rather than badging that one exists', () => {
    decisions = [decision({
      id: 'a',
      decisionNote: 'i like this idea, makes sense',
      contextNote: 'we need 2%',
      execution: { id: 'x', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' },
    })]
    render(<DecisionsWorkspace />)
    const tile = screen.getByTestId('decision-tile')
    // One decision in eighty-three has a written reason. Where there is one,
    // the scan shows the words, not a label saying words exist.
    expect(within(tile).getByText(/i like this idea, makes sense/)).toBeInTheDocument()
    // The requester's note is a different claim and stays in the workspace.
    expect(within(tile).queryByText(/we need 2%/)).not.toBeInTheDocument()
  })
})

/* -------------------------------------------------- portfolio-scoped memory */

describe('the same idea in two books is two decisions', () => {
  beforeEach(() => {
    decisions = [
      decision({ id: 'core', portfolioId: 'p1', portfolioName: 'Large Cap Core', status: 'accepted', decidedAt: daysAgo(10) }),
      decision({ id: 'growth', portfolioId: 'p2', portfolioName: 'Large Cap Growth', status: 'withdrawn', decidedAt: daysAgo(11) }),
    ]
  })

  it('indexes both, with their own outcomes', () => {
    render(<DecisionsWorkspace />)
    const rows = screen.getAllByTestId('decision-tile')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Large Cap Core')).toBeInTheDocument()
    expect(rows[0]).toHaveAttribute('data-outcome', 'accepted')
    expect(rows[1]).toHaveAttribute('data-outcome', 'withdrawn')
  })

  it('scopes the index when one book is chosen', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace />)
    await user.click(screen.getByRole('button', { name: /All portfolios/ }))
    await user.click(screen.getByRole('option', { name: /Large Cap Core/ }))
    const rows = screen.getAllByTestId('decision-tile')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Large Cap Core')).toBeInTheDocument()
  })

  it('returns to the filtered book rather than stranding the reader', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace selectedDecisionId="growth" />)
    expect(screen.getByTestId('decision-detail')).toBeInTheDocument()

    // The filter belongs to browsing the record, so narrowing means coming
    // back to it -- never leaving a Growth decision open under a Core filter.
    await user.click(screen.getByRole('button', { name: /All decisions/ }))
    await user.click(screen.getByRole('button', { name: /All portfolios/ }))
    await user.click(screen.getByRole('option', { name: /Large Cap Core/ }))

    expect(screen.queryByTestId('decision-detail')).not.toBeInTheDocument()
    const rows = screen.getAllByTestId('decision-tile')
    expect(rows).toHaveLength(1)
    expect(within(rows[0]).getByText('Large Cap Core')).toBeInTheDocument()
  })
})

/* ----------------------------------------------------------- the Why module */

describe('a system string is never shown as reasoning', () => {
  it('gives a real reason the strongest treatment on the page', () => {
    decisions = [decision({ id: 'x', decisionNote: 'i like this idea, makes sense' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    const why = screen.getByText('Why we decided').closest('section')!
    const quote = within(why).getByText(/i like this idea, makes sense/)
    expect(quote.tagName.toLowerCase()).toBe('blockquote')
    expect(quote.className).toMatch(/text-\[17px\]/)
    expect(screen.queryByText('Decision record')).not.toBeInTheDocument()
  })

  it('compresses the absence instead of giving it a hero box', () => {
    decisions = [decision({ id: 'x', decisionNote: 'Self-proposed via Trade Lab Execute' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getByText('Decision record')).toBeInTheDocument()
    expect(screen.getByText('No human rationale was captured.')).toBeInTheDocument()
    expect(screen.getByText(/written by the system, not a stated rationale/)).toBeInTheDocument()
    // Never dressed up as reasoning.
    expect(screen.queryByText('Why we decided')).not.toBeInTheDocument()
  })

  it('keeps the proposal rationale separately attributed', () => {
    decisions = [decision({ id: 'x', decisionNote: null, contextNote: 'get long pal' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getByText('Why it was proposed')).toBeInTheDocument()
    expect(screen.getByText(/get long pal/)).toBeInTheDocument()
    expect(screen.getByText(/Submitted by Seb Barbero/)).toBeInTheDocument()
    expect(screen.getByText(/the proposal rationale, not the decider/)).toBeInTheDocument()
    expect(screen.queryByText('Why we decided')).not.toBeInTheDocument()
  })

  it('keeps both apart when both exist', () => {
    decisions = [decision({
      id: 'x',
      decisionNote: 'i like this idea, makes sense',
      contextNote: 'We need to be 2% in this portfolio',
    })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getByText('Why we decided')).toBeInTheDocument()
    expect(screen.getByText('Why it was proposed')).toBeInTheDocument()
    expect(screen.getByText(/Submitted by Seb Barbero/)).toBeInTheDocument()
  })
})

/* ------------------------------------------------------ then versus today */

describe('what we knew then is kept apart from what is true now', () => {
  const selected = (over: Partial<DecisionRecord> = {}) => {
    decisions = [decision({ id: 'x', ...over })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    return {
      then: screen.getByText('At the decision').closest('section')!,
      now: screen.getByText('Today').closest('section')!,
    }
  }

  it('names the framework facts that were never captured, quietly', () => {
    const { then } = selected()
    const note = within(then).getByText(/Historical framework not captured/)
    expect(note).toBeInTheDocument()
    // A footnote, not the loudest thing in the column it qualifies.
    expect(note.className).toMatch(/text-\[10px\]/)
  })

  it('shows a decision-time weight only where the snapshot recorded one', () => {
    const { then } = selected({ baselineWeight: 3.9 })
    expect(within(then).getByText('Weight then')).toBeInTheDocument()
    expect(within(then).getByText('3.9%')).toBeInTheDocument()
  })

  it('omits it rather than borrowing today’s weight', () => {
    detail = { currentWeightPct: 1.1 }
    const { then, now } = selected({ baselineWeight: null })
    expect(within(then).queryByText('Weight then')).not.toBeInTheDocument()
    expect(within(now).getByText('Weight now')).toBeInTheDocument()
    expect(within(now).getByText('1.1%')).toBeInTheDocument()
  })

  it('labels the current column as current', () => {
    const { now } = selected()
    expect(within(now).getByText('current state')).toBeInTheDocument()
    expect(within(now).getByText(/the state right now, not the state when the decision was made/))
      .toBeInTheDocument()
  })

  it('shows a decision-time price where one was captured', () => {
    detail = { priceAtDecision: 120.5, currentPrice: 46.86 }
    const { then, now } = selected()
    expect(within(then).getByText('Price then')).toBeInTheDocument()
    expect(within(now).getByText('Price now')).toBeInTheDocument()
  })

  it('omits it rather than borrowing today’s price', () => {
    detail = { currentPrice: 46.86 }
    const { then } = selected()
    expect(within(then).queryByText('Price then')).not.toBeInTheDocument()
  })

  it('states the outcome once, not four times, before the substance', () => {
    selected({ decidedByName: 'Eric Lockenvitz' })
    const detailEl = screen.getByTestId('decision-detail')
    const header = detailEl.firstElementChild as HTMLElement
    // The actor appears in the narrative sentence and nowhere else in the header.
    expect(within(header).getAllByText(/Eric Lockenvitz/)).toHaveLength(1)
  })
})

/* -------------------------------------------------------- what happened next */

describe('price after a decision carries no verdict', () => {
  const withPath = (rising: boolean) => {
    detail = { history: priceSeries(300, rising) }
    decisions = [decision({ id: 'x', decidedAt: daysAgo(160) })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    return screen.getByTestId('price-since-decision')
  }

  it('does not paint a fall in critical red', () => {
    const chart = withPath(false)
    expect(chart.querySelector('svg')!.innerHTML).not.toMatch(/rose|red-/)
    expect(within(chart).getByText(/^-\d/)).toBeInTheDocument()
  })

  it('does not paint a rise in success green', () => {
    const chart = withPath(true)
    expect(chart.querySelector('svg')!.innerHTML).not.toMatch(/emerald|green-/)
    expect(within(chart).getByText(/^\+\d/)).toBeInTheDocument()
  })

  it('draws the same ink either way', () => {
    const down = withPath(false).querySelector('path')!.getAttribute('class')
    screen.getByTestId('decision-detail')
    const upChart = (() => {
      detail = { history: priceSeries(300, true) }
      decisions = [decision({ id: 'y', decidedAt: daysAgo(160) })]
      const { container } = render(<DecisionsWorkspace selectedDecisionId="y" />)
      return container.querySelector('[data-testid="price-since-decision"] path')!
    })()
    expect(upChart.getAttribute('class')).toBe(down)
  })

  it('keeps the sign on the number, because the sign is a fact', () => {
    const chart = withPath(false)
    const value = within(chart).getByText(/^-\d/)
    expect(value.className).not.toMatch(/rose|emerald|red-|green-/)
  })

  it('anchors at the decision only when history reaches it', () => {
    withPath(false)
    expect(screen.getByText('Price after decision')).toBeInTheDocument()
    expect(screen.getByText('DECIDED')).toBeInTheDocument()
    expect(screen.getByText(/Not a verdict on the decision/)).toBeInTheDocument()
  })

  it('refuses the claim when history starts after the decision', () => {
    detail = { history: priceSeries(30, false) }
    decisions = [decision({ id: 'x', decidedAt: daysAgo(400) })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getByText('Price over available history')).toBeInTheDocument()
    expect(screen.queryByText('DECIDED')).not.toBeInTheDocument()
  })

  it('renders no module at all when nothing followed', () => {
    detail = {}
    decisions = [decision({ id: 'x' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.queryByTestId('price-since-decision')).not.toBeInTheDocument()
    expect(screen.queryByText('What happened next')).not.toBeInTheDocument()
  })

  it('keeps the chronology readable beside the chart', () => {
    detail = { history: priceSeries(300, false) }
    decisions = [decision({
      id: 'x', decidedAt: daysAgo(160),
      execution: { id: 'at', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' },
    })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    const chron = screen.getByTestId('decision-chronology')
    expect(within(chron).getByText(/Proposed by/)).toBeInTheDocument()
    expect(within(chron).getByText(/Accepted by/)).toBeInTheDocument()
    expect(within(chron).getByText(/Executed by/)).toBeInTheDocument()
  })

  it('says plainly when an accepted decision was never executed', () => {
    detail = { history: priceSeries(300, true) }
    decisions = [decision({ id: 'x', status: 'accepted', decidedAt: daysAgo(160), execution: null })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getAllByText(/No execution is recorded/).length).toBeGreaterThan(0)
  })
})

/* ----------------------------------------------------------------- routing */

describe('navigating and routing', () => {
  it('switches decision without leaving the workspace', async () => {
    const user = userEvent.setup()
    decisions = [
      decision({ id: 'a', symbol: 'AAA', decidedAt: daysAgo(10) }),
      decision({ id: 'b', symbol: 'BBB', decidedAt: daysAgo(20) }),
    ]
    render(<DecisionsWorkspace />)
    await user.click(screen.getAllByTestId('decision-tile')[1])
    expect(screen.getByTestId('decision-detail')).toBeInTheDocument()
    expect(detailRequestedFor).toContain('b')

    // Back, then a different record: the scan is where switching happens.
    await user.click(screen.getByRole('button', { name: /All decisions/ }))
    await user.click(screen.getAllByTestId('decision-tile')[0])
    expect(detailRequestedFor).toContain('a')
  })

  it('enriches only the decision that was opened', async () => {
    const user = userEvent.setup()
    decisions = [
      decision({ id: 'a', decidedAt: daysAgo(10) }),
      decision({ id: 'b', decidedAt: daysAgo(20) }),
    ]
    render(<DecisionsWorkspace />)
    expect(detailRequestedFor).toHaveLength(0)
    await user.click(screen.getAllByTestId('decision-tile')[0])
    expect(new Set(detailRequestedFor)).toEqual(new Set(['a']))
  })

  it('opens Research on the exact asset', async () => {
    const user = userEvent.setup()
    decisions = [decision({ id: 'x', assetId: 'a-orcl' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    await user.click(screen.getByRole('button', { name: /Review the case today/ }))

    const tab = tabEvents.at(-1)!.detail
    expect(tab.id).toBe('research-v2')
    expect(tab.data.selectedAssetId).toBe('a-orcl')
    expect(tab.data.origin).toBe('decisions')
    expect(typedEvents.at(-1)!.detail).toMatchObject({ assetId: 'a-orcl', origin: 'decisions' })
  })

  it('opens Ideas V2 on the exact idea, never the legacy pipeline', async () => {
    const user = userEvent.setup()
    decisions = [decision({ id: 'x', ideaId: 'tq-9' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    await user.click(screen.getByRole('button', { name: 'Open the idea' }))
    expect(tabEvents.at(-1)!.detail.id).toBe('ideas-v2')
    expect(tabEvents.at(-1)!.detail.data.selectedIdeaId).toBe('tq-9')
    expect(tabEvents.some(e => e.detail?.type === 'trade-queue')).toBe(false)
  })

  it('binds Ask AI to the decision, its book and its outcome', async () => {
    const user = userEvent.setup()
    decisions = [decision({ id: 'x', portfolioId: 'p2', portfolioName: 'Large Cap Growth' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    await user.click(screen.getByRole('button', { name: 'Ask AI' }))

    const [view, target] = openEngagement.mock.calls[0]
    expect(view).toBe('ai')
    expect(target.objectId).toBe('a-orcl')
    expect(target.portfolioId).toBe('p2')
    expect(target.origin.itemId).toBe('x')
  })

  it('shows Ask AI as an action, not as a number', () => {
    decisions = [decision({ id: 'x' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    const btn = screen.getByRole('button', { name: 'Ask AI' })
    // The old "Ask AI 7" was contextChips.length — an implementation detail.
    expect(btn.textContent?.trim()).toBe('Ask AI')
  })
})

/* ----------------------------------------------------------------- outcomes */

describe('outcome chips are categories, not grades', () => {
  it('uses no severity colour for accepted, declined or withdrawn', () => {
    decisions = [
      decision({ id: 'a', status: 'accepted', symbol: 'AAA', decidedAt: daysAgo(5) }),
      decision({ id: 'b', status: 'rejected', symbol: 'BBB', decidedAt: daysAgo(6) }),
      decision({ id: 'c', status: 'withdrawn', symbol: 'CCC', decidedAt: daysAgo(7) }),
    ]
    render(<DecisionsWorkspace />)
    for (const label of ['Accepted', 'Declined', 'Withdrawn']) {
      const chip = screen.getAllByText(label)[0]
      expect(chip.className).not.toMatch(/rose|amber|emerald|red-|green-/)
    }
  })

  it('keeps blue for the one genuinely live state', () => {
    decisions = [decision({ status: 'pending', decidedAt: null, decidedByName: null })]
    render(<DecisionsWorkspace />)
    expect(screen.getAllByText('Awaiting decision')[0].className).toMatch(/blue/)
  })
})
