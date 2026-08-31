/**
 * Focused test for the Decisions workspace.
 *
 * The data hook is mocked. What this file is for is the surface's own
 * decisions: that terminal records are the content rather than filtered away,
 * that a system-written note is never presented as reasoning, that historical
 * and current facts stay in separate columns, and that every route out reuses a
 * seam another stage already owns.
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

/* ------------------------------------------------------------------ specs */

describe('terminal work is the content, not something to filter out', () => {
  it('shows accepted, declined and withdrawn decisions together', () => {
    decisions = [
      decision({ id: 'a', status: 'accepted', symbol: 'AAA' }),
      decision({ id: 'b', status: 'rejected', symbol: 'BBB' }),
      decision({ id: 'c', status: 'withdrawn', symbol: 'CCC' }),
    ]
    render(<DecisionsWorkspace />)
    const cards = screen.getAllByTestId('decision-card')
    expect(cards).toHaveLength(3)
    expect(cards.map(c => c.getAttribute('data-outcome')).sort())
      .toEqual(['accepted', 'declined', 'withdrawn'])
  })

  it('does not drop a decision whose idea has been executed', () => {
    decisions = [decision({
      status: 'accepted',
      execution: { id: 'at', status: 'complete', completedAt: daysAgo(159), executedByName: 'Eric' },
    })]
    render(<DecisionsWorkspace />)
    // The active-Ideas filter would remove exactly this record.
    expect(screen.getAllByTestId('decision-card')).toHaveLength(1)
    expect(screen.getByText(/it was executed/)).toBeInTheDocument()
  })

  it('distinguishes a read failure from an empty history', () => {
    scanError = new Error('relation lookup failed')
    render(<DecisionsWorkspace />)
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
    expect(screen.getByText(/not an empty history/)).toBeInTheDocument()
    expect(screen.queryByText(/No decisions on record yet/)).not.toBeInTheDocument()
  })

  it('says nothing is recorded when nothing is', () => {
    render(<DecisionsWorkspace />)
    expect(screen.getByText(/No decisions on record yet/)).toBeInTheDocument()
  })
})

describe('the same idea in two books is two decisions', () => {
  beforeEach(() => {
    decisions = [
      decision({ id: 'core', portfolioId: 'p1', portfolioName: 'Large Cap Core', status: 'accepted', decidedAt: daysAgo(10) }),
      decision({ id: 'growth', portfolioId: 'p2', portfolioName: 'Large Cap Growth', status: 'withdrawn', decidedAt: daysAgo(11) }),
    ]
  })

  it('lists both, with their own outcomes', () => {
    render(<DecisionsWorkspace />)
    const cards = screen.getAllByTestId('decision-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByText('Large Cap Core')).toBeInTheDocument()
    expect(cards[0]).toHaveAttribute('data-outcome', 'accepted')
    expect(cards[1]).toHaveAttribute('data-outcome', 'withdrawn')
  })

  it('scopes the list when one book is chosen', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace />)
    await user.click(screen.getAllByRole('button', { name: /All portfolios/ })[0])
    await user.click(screen.getByRole('option', { name: /Large Cap Core/ }))
    const cards = screen.getAllByTestId('decision-card')
    expect(cards).toHaveLength(1)
    expect(within(cards[0]).getByText('Large Cap Core')).toBeInTheDocument()
  })

  it('drops the open decision when the book filter changes', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace selectedDecisionId="growth" />)
    expect(screen.getByTestId('decision-detail')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /All portfolios/ })[0])
    await user.click(screen.getByRole('option', { name: /Large Cap Core/ }))
    expect(screen.queryByTestId('decision-detail')).not.toBeInTheDocument()
  })
})

describe('a system string is never shown as reasoning', () => {
  it('quotes a human reason on the card', () => {
    decisions = [decision({ decisionNote: 'i like this idea, makes sense' })]
    render(<DecisionsWorkspace />)
    expect(screen.getByText(/i like this idea, makes sense/)).toBeInTheDocument()
  })

  it('keeps the machine note off the card entirely', () => {
    decisions = [decision({ decisionNote: 'Self-proposed via Trade Lab Execute' })]
    render(<DecisionsWorkspace />)
    expect(screen.queryByText(/Self-proposed via Trade Lab Execute/)).not.toBeInTheDocument()
  })

  it('labels it a system record in the workspace, not a reason', () => {
    decisions = [decision({ id: 'x', decisionNote: 'Self-proposed via Trade Lab Execute' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    const why = screen.getByText('Why').closest('section')!
    expect(within(why).getByText('No reason was written when this decision was recorded.')).toBeInTheDocument()
    expect(within(why).getByText('System record')).toBeInTheDocument()
    expect(within(why).getByText(/Not a stated rationale/)).toBeInTheDocument()
    expect(within(why).queryByText('Why we decided')).not.toBeInTheDocument()
  })

  it('labels the requester rationale as the submission, not the decision', () => {
    decisions = [decision({ id: 'x', decisionNote: null, contextNote: 'get long pal' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    const why = screen.getByText('Why').closest('section')!
    expect(within(why).getByText('Why it was proposed')).toBeInTheDocument()
    expect(within(why).getByText('get long pal')).toBeInTheDocument()
    expect(within(why).getByText(/the submission rationale, not the decision/)).toBeInTheDocument()
  })
})

describe('what we knew then is kept apart from what is true now', () => {
  const selected = (over: Partial<DecisionRecord> = {}) => {
    decisions = [decision({ id: 'x', ...over })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    return {
      then: screen.getByText('At the decision').closest('section')!,
      now: screen.getByText('Today').closest('section')!,
    }
  }

  it('names the framework facts that were never captured', () => {
    const { then } = selected()
    expect(within(then).getByText(/Not captured at decision time/)).toBeInTheDocument()
    expect(within(then).getByText(/the thesis as written that day/)).toBeInTheDocument()
    expect(within(then).getByText(/not what was known that day/)).toBeInTheDocument()
  })

  it('shows a decision-time weight only where the snapshot recorded one', () => {
    const a = selected({ baselineWeight: 3.9 })
    expect(within(a.then).getByText('Weight then')).toBeInTheDocument()
    expect(within(a.then).getByText('3.9%')).toBeInTheDocument()
  })

  it('omits the decision-time weight rather than borrowing today’s', () => {
    detail = { currentWeightPct: 1.1 }
    const { then, now } = selected({ baselineWeight: null })
    expect(within(then).queryByText('Weight then')).not.toBeInTheDocument()
    // Today's number exists and stays in Today's column.
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
    const { then, now } = selected()
    expect(within(then).queryByText('Price then')).not.toBeInTheDocument()
    expect(within(now).getByText('Price now')).toBeInTheDocument()
  })
})

describe('what happened next', () => {
  const withHistory = (days: number, decidedDaysAgo: number | null) => {
    detail = {
      history: Array.from({ length: days }, (_, i) => ({
        date: new Date(Date.now() - (days - i) * DAY).toISOString().slice(0, 10),
        close: 100 - i * 0.2,
      })),
    }
    decisions = [decision({ id: 'x', decidedAt: decidedDaysAgo != null ? daysAgo(decidedDaysAgo) : null })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
  }

  it('anchors the chart at the decision when history reaches it', () => {
    withHistory(300, 160)
    expect(screen.getByTestId('price-since-decision')).toBeInTheDocument()
    expect(screen.getByText('Price since this decision')).toBeInTheDocument()
    expect(screen.getByText('DECIDED')).toBeInTheDocument()
  })

  it('refuses the claim when history starts after the decision', () => {
    withHistory(30, 400)
    expect(screen.getByText('Price over available history')).toBeInTheDocument()
    expect(screen.queryByText('DECIDED')).not.toBeInTheDocument()
    expect(screen.getByText(/does not reach the decision date/)).toBeInTheDocument()
  })

  it('states the path without calling it a verdict', () => {
    withHistory(300, 160)
    expect(screen.getByText(/Not a verdict on the decision/)).toBeInTheDocument()
    expect(screen.queryByText(/good call|bad call|correct|mistake/i)).not.toBeInTheDocument()
  })

  it('renders no module at all when nothing followed', () => {
    detail = {}
    decisions = [decision({ id: 'x' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.queryByTestId('price-since-decision')).not.toBeInTheDocument()
    expect(screen.queryByText('What happened next')).not.toBeInTheDocument()
  })

  it('says plainly when an accepted decision was never executed', () => {
    detail = { history: Array.from({ length: 300 }, (_, i) => ({
      date: new Date(Date.now() - (300 - i) * DAY).toISOString().slice(0, 10), close: 100 + i,
    })) }
    decisions = [decision({ id: 'x', status: 'accepted', decidedAt: daysAgo(160), execution: null })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    expect(screen.getAllByText(/No execution is recorded/).length).toBeGreaterThan(0)
  })
})

describe('selecting keeps the history beside you', () => {
  beforeEach(() => {
    decisions = [
      decision({ id: 'a', symbol: 'AAA', decidedAt: daysAgo(10) }),
      decision({ id: 'b', symbol: 'BBB', decidedAt: daysAgo(20) }),
    ]
  })

  it('shows a navigator, not the decision alone', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace />)
    await user.click(screen.getAllByRole('button', { name: /Revisit this decision/ })[0])
    expect(screen.getByTestId('decision-detail')).toBeInTheDocument()
    expect(screen.getAllByTestId('decision-nav-card')).toHaveLength(2)
  })

  it('enriches only the selected decision', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace />)
    expect(detailRequestedFor).toHaveLength(0)
    await user.click(screen.getAllByRole('button', { name: /Revisit this decision/ })[0])
    expect(new Set(detailRequestedFor)).toEqual(new Set(['a']))
  })

  it('switches decision without leaving the workspace', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace selectedDecisionId="a" />)
    await user.click(screen.getAllByTestId('decision-nav-card')[1])
    expect(screen.getByTestId('decision-detail')).toBeInTheDocument()
    expect(detailRequestedFor).toContain('b')
  })

  it('returns to the full history', async () => {
    const user = userEvent.setup()
    render(<DecisionsWorkspace selectedDecisionId="a" />)
    await user.click(screen.getByRole('button', { name: 'All decisions' }))
    expect(screen.queryByTestId('decision-detail')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('decision-card')).toHaveLength(2)
  })
})

describe('routes reuse the seams other stages own', () => {
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

    const tab = tabEvents.at(-1)!.detail
    expect(tab.id).toBe('ideas-v2')
    expect(tab.data.selectedIdeaId).toBe('tq-9')
    expect(tabEvents.some(e => e.detail?.type === 'trade-queue')).toBe(false)
  })

  it('binds Ask AI to the decision, its book and its outcome', async () => {
    const user = userEvent.setup()
    decisions = [decision({ id: 'x', portfolioId: 'p2', portfolioName: 'Large Cap Growth' })]
    render(<DecisionsWorkspace selectedDecisionId="x" />)
    await user.click(screen.getByRole('button', { name: /Ask AI/ }))

    const [view, target] = openEngagement.mock.calls[0]
    expect(view).toBe('ai')
    expect(target.objectId).toBe('a-orcl')
    expect(target.portfolioId).toBe('p2')
    expect(target.origin.itemId).toBe('x')
    expect(target.issue.reason).toBe('decision:accepted')
  })
})

describe('outcome chips are categories, not grades', () => {
  it('uses no severity colour for accepted, declined or withdrawn', () => {
    decisions = [
      decision({ id: 'a', status: 'accepted', symbol: 'AAA' }),
      decision({ id: 'b', status: 'rejected', symbol: 'BBB' }),
      decision({ id: 'c', status: 'withdrawn', symbol: 'CCC' }),
    ]
    render(<DecisionsWorkspace />)
    for (const label of ['Accepted', 'Declined', 'Withdrawn']) {
      const chip = screen.getAllByText(label)[0]
      // Not rose, not amber, not emerald — history is not an alert and not a
      // scoreboard.
      expect(chip.className).not.toMatch(/rose|amber|emerald|red-|green-/)
    }
  })

  it('keeps blue for the one genuinely live state', () => {
    decisions = [decision({ status: 'pending', decidedAt: null, decidedByName: null })]
    render(<DecisionsWorkspace />)
    expect(screen.getAllByText('Awaiting decision')[0].className).toMatch(/blue/)
  })
})
