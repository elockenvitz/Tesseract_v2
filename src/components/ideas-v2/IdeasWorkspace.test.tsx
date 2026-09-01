/**
 * Focused test for the Ideas workspace's browse/engage contract.
 *
 * Deliberately narrow. Ranking, liveness and the engagement seam all have
 * their own suites in `lib/desktop-ideas`, and duplicating them here would
 * make this file a second source of truth for rules it does not own. What is
 * asserted is only what the SURFACE decides: that arrival lands in the
 * gallery, that opening a tile hands the canvas to one idea, that returning
 * brings the gallery back, that a typed arrival opens the exact object named,
 * and that the belief -- not the system state -- is the tile.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { IdeaRow } from '../../lib/desktop-ideas'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const idea = (over: Partial<IdeaRow> = {}): IdeaRow => ({
  id: 'i-1', assetId: 'a-1', symbol: 'AAA', companyName: 'Alpha Inc',
  direction: 'buy', stage: 'researching', maturity: 'researching',
  conviction: null, thesis: 'The market is under-modelling the renewal cohort.',
  urgency: null, proposedWeight: null,
  portfolioId: 'p1', portfolioName: 'Vision Fund 10K',
  createdBy: 'u1', authorName: 'Eric Lockenvitz',
  createdAt: new Date().toISOString(), updatedAt: null, decisionOutcome: null,
  ...over,
})

let scan: IdeaRow[] = []
let exposure: Record<string, number> = {}
let framework: Record<string, any> = {}
const detailFor: string[] = []

vi.mock('../../hooks/useDesktopIdeas', () => ({
  useIdeaScan: () => ({ ideas: scan, isLoading: false, error: null }),
  useScanExposure: () => exposure,
  useScanFramework: () => framework,
  useIdeaDetail: (i: IdeaRow | null) => {
    if (i) detailFor.push(i.id)
    return { detail: undefined, isLoading: false }
  },
}))

// The detail pane's own dependencies. Stubbed rather than exercised: this
// suite is about which object is on screen, not what the decision widget does.
vi.mock('../../hooks/useDesktopResearch', () => ({ useHasResearch: () => false }))
vi.mock('./DecisionModule', () => ({
  DecisionModule: ({ ideaId }: { ideaId: string }) =>
    <div data-testid="decision-module" data-idea={ideaId} />,
}))
vi.mock('../../hooks/useIdeaDecision', () => ({
  useIdeaDecision: () => ({ tracks: [], isLoading: false }),
}))

/** What the lens asked the deck to expand. The seam itself is real. */
const opened: any[] = []
vi.mock('../../lib/dashboard/focus', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/dashboard/focus')>()
  return { ...actual, openDashboardFocus: (r: any) => { opened.push(r); return true } }
})

const openEngagement = vi.fn()
vi.mock('../../lib/engagement', async importOriginal => {
  const actual = await importOriginal<typeof import('../../lib/engagement')>()
  return { ...actual, askAI: (t: any) => openEngagement('ai', t) }
})

import { IdeasWorkspace } from './IdeasWorkspace'
import { openIdea } from '../../lib/desktop-ideas'

beforeEach(() => {
  scan = []
  exposure = {}
  framework = {}
  detailFor.length = 0
  opened.length = 0
  openEngagement.mockClear()
})

describe('an idea expands into the deck, in place', () => {
  const two = () => {
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB', thesis: 'Channel inventory has cleared.' }),
    ]
  }

  it('draws the field without opening anything', () => {
    two()
    render(<IdeasWorkspace />)
    expect(screen.getAllByTestId('idea-tile')).toHaveLength(2)
    expect(detailFor).toHaveLength(0)
    expect(opened).toHaveLength(0)
  })

  it('asks the deck to expand the exact idea', async () => {
    const user = userEvent.setup()
    two()
    render(<IdeasWorkspace />)
    // By name, not by index: two ideas with identical inputs tie in the
    // ranking, and a test that depends on how a tie breaks is a flaky test.
    // The card body is a stretched button, so quick actions can be siblings
    // rather than nested inside it.
    await user.click(screen.getByRole('button', { name: /Open AAA/ }))

    const req = opened.at(-1)!
    expect(req.target.objectId).toBe('i-1')
    expect(req.target.originLens).toBe('ideas')
    expect(req.backLabel).toBe('Ideas')
    // The claim is what distinguishes one belief from another, so it is what
    // the rail card carries.
    expect(req.rail[0].detail).toBeTruthy()
  })

  it('renders only the workspace when the deck expands it', () => {
    two()
    render(<IdeasWorkspace focusObjectId="i-1" />)
    expect(screen.queryAllByTestId('idea-tile')).toHaveLength(0)
    expect(detailFor).toEqual(['i-1'])
  })

  it('forwards a typed arrival to the deck rather than absorbing it', async () => {
    two()
    render(<IdeasWorkspace />)
    await React.act(async () => { openIdea({ ideaId: 'i-2' }) })

    expect(opened.at(-1)!.target.objectId).toBe('i-2')
    // Never the head of the ranking standing in for the object asked for.
    expect(opened.at(-1)!.target.objectId).not.toBe('i-1')
  })
})

describe('the card is the belief, and rank is the layout', () => {
  it('sets the written claim above the metadata around it', () => {
    scan = [idea({ thesis: 'Taylor does not order food delivery.' })]
    render(<IdeasWorkspace />)
    const tile = screen.getByTestId('idea-tile')

    const claim = within(tile).getByText('Taylor does not order food delivery.')
    const book = within(tile).getByText('Vision Fund 10K')
    const size = (el: Element) => Number(/text-\[([\d.]+)px\]/.exec(el.className)?.[1] ?? 0)
    expect(size(claim)).toBeGreaterThan(size(book))
  })

  it('says an idea has no claim rather than leaving the card blank', () => {
    scan = [idea({ thesis: null })]
    render(<IdeasWorkspace />)
    expect(screen.getByTestId('idea-tile')).toHaveTextContent('No claim written yet')
  })

  it('assigns slots from rank alone, in order', () => {
    scan = Array.from({ length: 9 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const slots = screen.getAllByTestId('idea-tile').map(t => t.getAttribute('data-slot'))
    expect(slots.slice(0, 6)).toEqual(['lead', 'second', 'mid', 'mid', 'mid', 'mid'])
    expect(slots.slice(6)).toEqual(['scan', 'scan', 'scan'])
  })

  it('never lets content decide where an idea sits', () => {
    // A rich rank #3 must not leap over a sparse rank #1. The slot map reads
    // the index and nothing else.
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA', thesis: null }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB', thesis: null }),
      idea({ id: 'i-3', assetId: 'a-3', symbol: 'CCC', thesis: 'A very rich idea indeed.' }),
    ]
    framework = { 'a-3': { ladder: [{ name: 'Bear', price: 80 }, { name: 'Bull', price: 140 }], spot: 100 } }
    const tiles = (render(<IdeasWorkspace />), screen.getAllByTestId('idea-tile'))
    const rich = tiles.find(t => within(t).queryByText('CCC'))!
    expect(rich).toHaveAttribute('data-slot', 'mid')
  })

  it('gives the lead the whole ladder, and smaller cards the compact one', () => {
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB' }),
    ]
    framework = {
      'a-1': { ladder: [{ name: 'Bear', price: 80 }, { name: 'Bull', price: 140 }], spot: 100 },
    }
    render(<IdeasWorkspace />)
    const tiles = screen.getAllByTestId('idea-tile')
    const withLadder = tiles.find(t => within(t).queryByText('AAA'))!
    const without = tiles.find(t => within(t).queryByText('BBB'))!
    // Named, priced rungs -- not three unlabelled ticks.
    expect(within(withLadder).getByText('Bear · Base · Bull')).toBeInTheDocument()
    expect(within(withLadder).getByText(/inside the range/)).toBeInTheDocument()
    // No framework: no chart. A sparse card is not decorated.
    expect(within(without).queryByText(/inside the range|inside the case/)).not.toBeInTheDocument()
  })

  it('falls back to a stated target when there is no ladder', () => {
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' })]
    framework = { 'a-1': { target: 150, spot: 100 } }
    render(<IdeasWorkspace />)
    expect(screen.getByText(/100\.00 → 150\.00/)).toBeInTheDocument()
  })

  it('treats an outstanding decision as work, never as a break', () => {
    scan = [idea({ maturity: 'decision_ready' })]
    render(<IdeasWorkspace />)
    // Amber on the maturity label. Nothing in Ideas is a capital-risk state,
    // and a stance is never a severity.
    const tile = screen.getByTestId('idea-tile')
    expect(tile).toHaveAttribute('data-maturity', 'decision_ready')
    expect(tile.innerHTML).not.toMatch(/text-rose|bg-rose/)
  })

  it('exposes no internal stage ids', () => {
    scan = [idea({ maturity: 'decision_ready', stage: 'ready_for_decision' })]
    render(<IdeasWorkspace />)
    expect(screen.getByTestId('idea-tile')).not.toHaveTextContent('ready_for_decision')
  })
})

describe('scan, inspect, engage', () => {
  it('says everything it needs to without being touched', () => {
    scan = [idea({ symbol: 'DASH', direction: 'sell', maturity: 'decision_ready' })]
    render(<IdeasWorkspace />)
    const tile = screen.getByTestId('idea-tile')
    // Identity, stance, maturity, claim and context, with no interaction.
    expect(tile).toHaveTextContent('DASH')
    expect(tile).toHaveTextContent('sell')
    expect(tile).toHaveTextContent('Decision ready')
    expect(tile).toHaveTextContent('renewal cohort')
    expect(tile).toHaveTextContent('Vision Fund 10K')
  })

  it('reserves the actions a fixed strip, so nothing moves on hover', () => {
    // Both layers are absolutely positioned inside one reserved height, which
    // is what guarantees no reflow, no neighbour movement and no scroll jump.
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    expect(card).toContain('relative h-[26px] shrink-0')
    expect(card.match(/absolute inset-0/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('asks AI about the idea under the cursor, not the last one opened', async () => {
    const user = userEvent.setup()
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB' }),
    ]
    render(<IdeasWorkspace />)

    const bbb = screen.getAllByTestId('idea-tile').find(t => within(t).queryByText('BBB'))!
    await user.click(within(bbb).getByTestId('idea-quick-ai'))

    const [view, target] = openEngagement.mock.calls[0]
    expect(view).toBe('ai')
    expect(target.objectId).toBe('i-2')
    // Asking about an idea is not opening it.
    expect(opened).toHaveLength(0)
  })

  it('does not fire the card body when a quick action is used', async () => {
    const user = userEvent.setup()
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' })]
    render(<IdeasWorkspace />)
    await user.click(screen.getByTestId('idea-quick-ai'))
    expect(opened).toHaveLength(0)
  })

  it('opens the work deck from the card body', async () => {
    const user = userEvent.setup()
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' })]
    render(<IdeasWorkspace />)
    await user.click(screen.getByRole('button', { name: /Open AAA/ }))
    expect(opened.at(-1)!.target.objectId).toBe('i-1')
    expect(opened.at(-1)!.target.originLens).toBe('ideas')
  })

  it('reaches every action by keyboard', async () => {
    const user = userEvent.setup()
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' })]
    render(<IdeasWorkspace />)

    await user.tab()   // the card body
    expect(screen.getByRole('button', { name: /Open AAA/ })).toHaveFocus()
    await user.tab()   // the primary quick action
    await user.tab()   // Ask AI
    expect(screen.getByTestId('idea-quick-ai')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(openEngagement).toHaveBeenCalled()
  })
})
