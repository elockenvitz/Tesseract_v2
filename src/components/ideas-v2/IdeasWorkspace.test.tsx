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
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { IdeaRow } from '../../lib/desktop-ideas'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One instant for every fixture.
 *
 * This was `new Date().toISOString()` evaluated per idea, so building eight of
 * them in a loop could straddle a clock tick under parallel load: the ideas
 * then had different ages, scored differently, and the ranking -- which the
 * whole layout reads from -- came out in a different order about three runs in
 * four. Pinned, so only the fields a test actually sets can move a rank.
 */
const NOW = new Date().toISOString()

const idea = (over: Partial<IdeaRow> = {}): IdeaRow => ({
  id: 'i-1', assetId: 'a-1', symbol: 'AAA', companyName: 'Alpha Inc',
  direction: 'buy', stage: 'researching', maturity: 'researching',
  conviction: null, thesis: 'The market is under-modelling the renewal cohort.',
  urgency: null, proposedWeight: null,
  portfolioId: 'p1', portfolioName: 'Vision Fund 10K',
  createdBy: 'u1', authorName: 'Eric Lockenvitz',
  createdAt: NOW, updatedAt: null, decisionOutcome: null,
  ...over,
})

let scan: IdeaRow[] = []
let exposure: Record<string, any> = {}
let openPrice: Record<string, number> = {}

/** A book stake, in the shape the exposure hook returns. */
const held = (pct: number, rank = 1, of = 10, largestPct = pct) =>
  ({ pct, rank, of, largestPct, portfolioId: 'p1' })

/** A price series ending today, walking from `from` to `to`. */
const series = (from: number, to: number, days: number) =>
  Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.now() - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10),
    close: from + ((to - from) * i) / (days - 1),
  }))
let framework: Record<string, any> = {}
const detailFor: string[] = []

vi.mock('../../hooks/useDesktopIdeas', () => ({
  useIdeaScan: () => ({ ideas: scan, isLoading: false, error: null }),
  useScanExposure: () => exposure,
  useScanFramework: () => framework,
  useScanOpenPrice: () => openPrice,
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
  return {
    ...actual,
    askAI: (t: any) => openEngagement('ai', t),
    discuss: (t: any) => openEngagement('discuss', t),
  }
})

import { IdeasWorkspace } from './IdeasWorkspace'
import { openAnchor } from './IdeaCard'
import { openIdea } from '../../lib/desktop-ideas'

beforeEach(() => {
  scan = []
  exposure = {}
  openPrice = {}
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
    // The book now shares one context line with the age and any elevated
    // conviction or urgency, so it is matched as part of that line.
    const book = within(tile).getAllByText(/Vision Fund 10K/)[0]
    const size = (el: Element) => Number(/text-\[([\d.]+)px\]/.exec(el.className)?.[1] ?? 0)
    expect(size(claim)).toBeGreaterThan(size(book))
    expect(book.textContent).toMatch(/\d+d open|open \d+ months/)
  })

  it('says an idea has no claim rather than leaving the card blank', () => {
    scan = [idea({ thesis: null })]
    render(<IdeasWorkspace />)
    expect(screen.getByTestId('idea-tile')).toHaveTextContent('No claim written yet')
  })

  it('assigns a density from rank alone, in order', () => {
    scan = Array.from({ length: 12 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const d = screen.getAllByTestId('idea-tile').map(t => t.getAttribute('data-density'))
    // Two featured, three standard, everything else compact -- so every row
    // divides evenly: 8+4, then 4+4+4, then the compact field from a clean
    // start. A fourth standard card left two columns hanging at its row end.
    expect(d.slice(0, 2)).toEqual(['featured', 'featured'])
    expect(d.slice(2, 5)).toEqual(['standard', 'standard', 'standard'])
    expect(new Set(d.slice(5))).toEqual(new Set(['compact']))
  })

  it('offers exactly three densities, and no fourth under another name', () => {
    scan = Array.from({ length: 15 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const seen = new Set(screen.getAllByTestId('idea-tile').map(t => t.getAttribute('data-density')))
    expect([...seen].sort()).toEqual(['compact', 'featured', 'standard'])

    // And the old geometry vocabulary is gone from the source, not merely
    // unused -- renaming lead/second/third/major/minor/scan/mini would be the
    // same seven-shape page wearing three labels.
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    for (const dead of ['LeadCard', 'ClusterCard', 'TierCard', 'ScanCard', 'DenseRow', 'MiniTile', 'slotForRank']) {
      expect(card).not.toContain(dead)
    }
  })

  it('lays every idea on one twelve-column grid, in rank order', () => {
    scan = Array.from({ length: 12 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const field = screen.getByTestId('idea-field')
    expect(field.className).toContain('grid-cols-12')
    // Cells stretch to their row, so same-row shells share a top and bottom
    // edge. That is the outer box only -- nothing inside a card stretches.
    expect(field.className).not.toContain('items-start')
    // Every tile is a direct child. No region wrappers, no nested grids.
    expect(field.children).toHaveLength(12)
    for (const child of field.children) {
      expect(child).toHaveAttribute('data-testid', 'idea-tile')
    }
  })


  it('places every rank deterministically, from the index alone', () => {
    // 8 + 4, then rows of three. The two-row lead with #3 pinned beneath #2
    // existed only because #2 used to be a short text card; it moved the void
    // under the lead rather than removing it. #2 now carries a real chart.
    scan = Array.from({ length: 12 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const tiles = screen.getAllByTestId('idea-tile')
    expect(tiles[0].className).toContain('lg:col-span-8')
    expect(tiles[1].className).toContain('lg:col-span-4')
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    const body = card.slice(card.indexOf('export function spanForRank')).split('\n}')[0]
    expect(body).not.toContain('row-span')
    expect(body).not.toContain('col-start')
    // Nothing is padded, and nothing pushes to the bottom of borrowed space.
    expect(card).not.toContain('self-stretch')
    expect(card).not.toContain('mt-auto')
    // Still one field of direct children, in rank order.
    expect(screen.getByTestId('idea-field').children).toHaveLength(12)
  })

  it('gives a standard card real information, not a reserved empty slot', () => {
    // Measured against production: most ideas at this tier have no scenario
    // cases and no recent close, so there is no chart to draw. The middle
    // density has to earn its footprint from what is already loaded.
    // Uniform inputs within each render, because conviction and urgency feed
    // the ranking: singling one idea out would just promote it out of the
    // tier under test.
    const six = (over: Partial<IdeaRow>) => Array.from({ length: 6 }, (_, i) =>
      idea({
        id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}`,
        createdAt: new Date(Date.now() - 208 * 86_400_000).toISOString(),
        ...over,
      }))
    const standards = () => screen.getAllByTestId('idea-tile')
      .filter(t => t.getAttribute('data-density') === 'standard')

    scan = six({ conviction: 'high', urgency: 'urgent' })
    const loud = render(<IdeasWorkspace />)
    expect(standards()).toHaveLength(3)
    for (const t of standards()) {
      // Age is unconditional: seven months open is a different object from
      // one opened last week, and that was nowhere on the page. These have no
      // framework, so it arrives inside the state map rather than beside it.
      expect(t.textContent).toContain('open 7 months')
      expect(t.textContent).toContain('Urgent urgency')
      expect(t.textContent).toContain('High conviction')
    }
    loud.unmount()

    // The default urgency is set on nearly every row in production, so
    // printing it would be chrome rather than signal.
    scan = six({ conviction: null, urgency: 'medium' })
    render(<IdeasWorkspace />)
    for (const t of standards()) {
      expect(t.textContent).toContain('open 7 months')
      expect(t.textContent).not.toMatch(/urgency|conviction/i)
    }
  })

  it('reads a standard claim larger than a compact one', () => {
    // Hierarchy from typography and information, never from minimum height.
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    const std = card.slice(card.indexOf('function StandardCard'), card.indexOf('function CompactCard'))
    const at = card.indexOf('function CompactCard')
    const cmp = card.slice(at, card.indexOf('/* ==', at))
    expect(std).toContain('line-clamp-2 text-[13.5px]')
    expect(cmp).toContain('line-clamp-2 text-[12.5px]')
    // The claim is set with weight, as it is on the phone -- it was grey body
    // text, which is why the page read as instrumentation.
    expect(std).toContain('font-medium')
    expect(cmp).toContain('font-medium')
  })

  it('spends the amber edge once, at the top, not on every card', () => {
    // It marks a decision nobody has taken. But the ranking already sorts that
    // work to the top, so an edge on every qualifying card put one on the
    // first five -- which reads as structural chrome, or as five simultaneous
    // warnings for what is a workflow state, not a fault.
    scan = Array.from({ length: 8 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}`, maturity: 'decision_ready' }))
    render(<IdeasWorkspace />)
    const tiles = screen.getAllByTestId('idea-tile')
    const edged = tiles.filter(t => t.className.includes('border-l-amber-400'))
    expect(edged).toHaveLength(2)
    expect(edged.every(t => t.getAttribute('data-density') === 'featured')).toBe(true)
    // The state itself is still carried everywhere, by the maturity label.
    //
    // It used to be an amber-filled capsule, which put a filled warning on
    // every decision-ready card for what is a workflow state rather than a
    // fault. The colour survives on the word -- where it is a label -- and the
    // fill and the capsule are gone, so this pins the ink and not the badge.
    for (const t of tiles) expect(t.innerHTML).toMatch(/text-amber-700/)
    for (const t of tiles) expect(t.innerHTML).not.toMatch(/rounded-full[^"]*bg-amber/)
  })

  it('lets a reader inspect each case without leaving the card', async () => {
    const user = userEvent.setup()
    framework = { 'a-1': { ladder: [
      { name: 'Bear', price: 80 }, { name: 'Base', price: 120 }, { name: 'Bull', price: 150 },
    ], spot: 100 } }
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' })]
    render(<IdeasWorkspace />)

    // Resting: the asymmetry, and no case foregrounded. A field of ten cards
    // stays calm because nothing is permanently expanded to say this.
    expect(screen.queryByTestId('case-readout')).not.toBeInTheDocument()

    // Keyboard reaches a case and foregrounds it, with its own value and its
    // distance from today.
    fireEvent.focus(screen.getByTestId('case-bull'))
    expect(screen.getByTestId('case-bull')).toHaveAttribute('data-selected')
    expect(screen.getByTestId('case-readout')).toHaveTextContent('150.00')
    expect(screen.getByTestId('case-readout')).toHaveTextContent('+50%')

    // Inspecting is not navigating -- running across three cases must never
    // pull the reader out of the field.
    expect(opened).toHaveLength(0)

    // Activating one is a request to work on the framework, which is the idea.
    await user.click(screen.getByTestId('case-bear'))
    expect(opened.at(-1)!.target.objectId).toBe('i-1')
  })

  it('never reorders by content height', () => {
    const ws = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeasWorkspace.tsx'), 'utf8')
    // grid-auto-flow: dense would let a short card jump a gap above a taller
    // one, which silently breaks rank order, reading order and tab order.
    expect(ws).not.toMatch(/grid-flow-dense|auto-flow:\s*dense/)
  })

  it('divides the featured row on a line the tiers below also divide on', () => {
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    const fn = card.slice(card.indexOf('export function spanForRank'))
    const body = fn.split('\n}')[0]
    // 8 + 4, then 4 / 4 / 4, then 4 narrowing to 3. Eight is two four-column
    // tracks, so the featured split lands on a standard column edge.
    expect(body).toContain('lg:col-span-8')
    expect(body).toContain('lg:col-span-4')
    expect(body).toContain('2xl:col-span-3')
    // Width comes from rank and nothing else.
    expect(body).not.toMatch(/tone|ladder|thesis|direction|conviction|maturity/)
  })

  it('reads in rank order, so tab order is rank order', () => {
    scan = Array.from({ length: 8 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const symbols = screen.getAllByTestId('idea-tile')
      .map(t => within(t).getByText(/^S\d$/).textContent)
    expect(symbols).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])
  })

  it('gives the top two the same composition, at different widths', () => {
    // They used to be a lead surface with the second nested inside it, which
    // was a second layout family wearing the same name and meant their
    // internal anchors never lined up. Same card, 8 columns against 4.
    scan = Array.from({ length: 3 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const [first, second] = screen.getAllByTestId('idea-tile')
    expect(first).toHaveAttribute('data-density', 'featured')
    expect(second).toHaveAttribute('data-density', 'featured')
    expect(first.className).toContain('lg:col-span-8')
    expect(second.className).toContain('lg:col-span-4')
    // #1 wins on width and type size, not by being a different kind of object.
    expect(first.innerHTML).toContain('text-[30px]')
    expect(second.innerHTML).toContain('text-[24px]')
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
    expect(rich).toHaveAttribute('data-density', 'standard')
  })

  it('gives a featured idea the whole chart, and a standard one the compact chart', () => {
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
    // A real chart: the range drawn, and the asymmetry stated -- how far down
    // to the bear case against how far up to the bull.
    expect(within(withLadder).getByText('to bear')).toBeInTheDocument()
    expect(within(withLadder).getByText('to bull')).toBeInTheDocument()
    expect(within(withLadder).getByText('-20%')).toBeInTheDocument()   // 80 from 100
    expect(within(withLadder).getByText('+40%')).toBeInTheDocument()   // 140 from 100
    // No framework: no chart, and the card says so rather than being decorated.
    expect(within(without).queryByText('to bear')).not.toBeInTheDocument()
  })

  it('falls back to a stated target when there is no ladder', () => {
    // Whichever density it lands at, nothing is drawn that was not written.
    scan = [
      idea({ id: 'i-0', assetId: 'a-0', symbol: 'ZZZ' }),
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' }),
    ]
    framework = { 'a-1': { target: 150, spot: 100 } }
    render(<IdeasWorkspace />)
    const aaa = screen.getAllByTestId('idea-tile').find(t => within(t).queryByText('AAA'))!
    expect(within(aaa).getByText('150.00')).toBeInTheDocument()
    expect(within(aaa).getByText('+50%')).toBeInTheDocument()
    expect(within(aaa).getByText('to target')).toBeInTheDocument()
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

  it('lets the shell fill its row without pushing content down it', () => {
    // The distinction that matters. Same-row cards SHOULD share a bottom edge
    // -- that is what makes the page read as rows. What must never come back
    // is the `mt-auto` push that drove a card's own footer to the bottom of
    // space it had not earned, leaving a band of empty card above it.
    const card = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    expect(card).not.toContain('mt-auto')
    expect(card).not.toContain('self-stretch')
    // And no placeholder or spacer standing in for content. (`justify-end`
    // does appear, inside the action strip's own fixed height, where it
    // bottom-aligns two absolutely-positioned layers rather than pushing
    // anything through space the card did not earn.)
    expect(card).not.toMatch(/flex-grow|spacer|placeholder/i)
    expect(card).not.toMatch(/flex-1[^"]*justify-end|justify-end[^"]*flex-1/)
    // Geometry is still index-only: no span hacks came back with the change.
    const body = card.slice(card.indexOf('export function spanForRank')).split('\n}')[0]
    expect(body).not.toContain('row-span')
    expect(body).not.toContain('col-start')
  })



  it('gives every card a visual, whatever its data', () => {
    // Ideas with a framework read as investment objects and ideas without read
    // as text records, which split the page in two. That split was a data
    // accident, not a design choice: most ideas in production have no scenario
    // cases and no recent close.
    scan = Array.from({ length: 12 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    framework = { 'a-0': { spot: 100, ladder: [
      { name: 'Bear', price: 80 }, { name: 'Base', price: 110 }, { name: 'Bull', price: 140 },
    ] } }
    render(<IdeasWorkspace />)
    for (const t of screen.getAllByTestId('idea-tile')) {
      expect(t.querySelector('[data-visual]')).not.toBeNull()
    }
  })

  it('shows the stage as a label, and never as a drawing', () => {
    // It was a four-segment fill, then a four-station track. Both drew workflow
    // state as geometry, in the one place on the card that is supposed to say
    // something about the investment.
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA', maturity: 'decision_ready' })]
    render(<IdeasWorkspace />)
    const tile = screen.getByTestId('idea-tile')
    expect(within(tile).getByText('Decision ready')).toBeInTheDocument()
    // Whatever the card draws, it is not the stage.
    const band = tile.querySelector('[data-visual]')!
    expect(band.getAttribute('data-visual')).not.toBe('state')
    // No stage name appears in the visual band. ("Thesis" does appear there as
    // a case dimension -- whether a case is written about the asset -- which
    // is a different thing from the stage the idea is in.)
    for (const stage of ['Researching', 'Thesis forming', 'Deciding', 'Decision ready']) {
      expect(band.textContent).not.toContain(stage)
    }

    const visuals = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeaVisuals.tsx'), 'utf8')
    for (const gone of ['DecisionState', 'MaturityTrack', 'STATIONS']) {
      expect(visuals).not.toContain(gone)
    }
  })

  it('keeps the stage semantic without making it a warning', () => {
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'OPEN', maturity: 'decision_ready' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'EARLY', maturity: 'researching' }),
    ]
    render(<IdeasWorkspace />)
    // Found by its own text: the stance pill is also a bordered pill.
    const pill = (symbol: string, label: string) => within(
      screen.getAllByTestId('idea-tile').find(t => within(t).queryByText(symbol))!,
    ).getByText(label).className
    // A decision nobody has taken is work outstanding; research is not.
    expect(pill('OPEN', 'Decision ready')).toMatch(/amber/)
    expect(pill('EARLY', 'Researching')).not.toMatch(/amber/)
  })

  it('selects the visual deterministically, richest truthful first', () => {
    const kind = (symbol: string) => screen.getAllByTestId('idea-tile')
      .find(t => within(t).queryByText(symbol))!
      .querySelector('[data-visual]')!.getAttribute('data-visual')

    scan = [
      idea({ id: 'i-0', assetId: 'a-0', symbol: 'RANGE' }),
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'TARGET' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'SIZING', proposedWeight: 11 }),
      idea({ id: 'i-3', assetId: 'a-3', symbol: 'BARE' }),
      // A proposal measured against a dash is not a relationship, so this one
      // falls past sizing rather than drawing half a comparison.
      idea({ id: 'i-4', assetId: 'a-4', symbol: 'HALF', proposedWeight: 11 }),
      // A real position with no proposal to compare it against.
      idea({ id: 'i-5', assetId: 'a-5', symbol: 'HELD' }),
      // Price history reaching back past the day it was written.
      idea({ id: 'i-6', assetId: 'a-6', symbol: 'MOVED',
             createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString() }),
    ]
    framework = {
      'a-0': { spot: 100, ladder: [
        { name: 'Bear', price: 80 }, { name: 'Base', price: 110 }, { name: 'Bull', price: 140 },
      ] },
      // A ladder AND a target: the ladder wins, because it says more.
      'a-1': { spot: 100, target: 130 },
      'a-6': { spot: 118, closes: series(100, 118, 30) },
    }
    exposure = { 'a-2': held(8.2), 'a-5': held(25.3, 2, 14, 31.0) }
    render(<IdeasWorkspace />)
    expect(kind('RANGE')).toBe('range')
    expect(kind('TARGET')).toBe('target')
    expect(kind('SIZING')).toBe('sizing')
    // What the market did since we wrote it beats what we happen to hold.
    expect(kind('MOVED')).toBe('since')
    expect(kind('HELD')).toBe('exposure')
    // Nothing quantitative at all: what is on the record is the last thing
    // left to say, and saying it is better than saying how old the idea is.
    // Nothing quantitative: the two ways an idea can be thin are drawn
    // differently, because they are different findings.
    expect(kind('HALF')).toBe('gap')
    expect(kind('BARE')).toBe('gap')
  })



  it('scales one visual language across the three densities', () => {
    scan = Array.from({ length: 8 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const band = (density: string) => screen.getAllByTestId('idea-tile')
      .find(t => t.getAttribute('data-density') === density)!
      .querySelector('[data-visual]')!.innerHTML
    // Same primitive, three masses, one construction. Compact is quieter but
    // never faint: it keeps the hero figure and the named absences.
    for (const d of ['featured', 'standard', 'compact']) {
      expect(band(d)).toContain('Modelled cases')
      expect(band(d)).toContain('font-bold tabular-nums leading-none')
      // The 10px label, bold, as the phone sets it.
      expect(band(d)).toContain('text-[10px] font-bold uppercase tracking-wide')
    }
    expect(band('featured')).toContain('text-[26px]')
    expect(band('standard')).toContain('text-[21px]')
    expect(band('compact')).toContain('text-[16px]')
  })

  it('anchors the opening price to a close the author could have seen', () => {
    // Nearest-by-distance was rejected: it silently prefers a close three days
    // AFTER the idea over one four days before, which reports a price the
    // author could not have seen as the price they wrote at.
    const day = (n: number) =>
      new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)
    const at = (n: number, c: number) => ({ date: day(n), close: c })
    const created = new Date(Date.now() - 10 * 86_400_000).toISOString()

    // Before wins over after, even when the after is closer in time.
    expect(openAnchor(created, [at(14, 90), at(7, 110)])).toEqual(
      { price: 90, date: day(14), approximate: false })
    // The latest qualifying close before, not the earliest.
    expect(openAnchor(created, [at(16, 80), at(12, 95)])).toEqual(
      { price: 95, date: day(12), approximate: false })
    // Nothing before within the window: an after-close is allowed, but marked.
    expect(openAnchor(created, [at(8, 105)])).toEqual(
      { price: 105, date: day(8), approximate: true })
    // Nothing within the window at all: no anchor, and no interpolation.
    expect(openAnchor(created, [at(40, 70), at(1, 130)])).toBeNull()
    expect(openAnchor(created, [])).toBeNull()
    expect(openAnchor(created, undefined)).toBeNull()
    // A recorded snapshot beats any close we could pick.
    expect(openAnchor(created, [at(12, 95)], 99)).toEqual(
      { price: 99, date: day(10), approximate: false })
  })

  it('measures the move from the day the idea was written', () => {
    scan = [idea({
      id: 'i-1', assetId: 'a-1', symbol: 'MOVED',
      createdAt: new Date(Date.now() - 29 * 86_400_000).toISOString(),
    })]
    framework = { 'a-1': { spot: 115, closes: series(100, 115, 30) } }
    render(<IdeasWorkspace />)
    const band = screen.getByTestId('idea-tile').querySelector('[data-visual="since"]')!
    expect(band.textContent).toContain('+15.0%')
    // The opening price rides with the figure it is measured from, which is
    // what let the separate axis row under the plot go.
    expect(band.textContent).toContain('Since opened')
    expect(band.textContent).toContain('100.00')
    // The origin is on the chart, and so is today. They are HTML rather than
    // SVG on purpose: the plot stretches with preserveAspectRatio="none", so
    // an SVG circle inside it renders as a flat ellipse at card width.
    expect(band.querySelectorAll('circle')).toHaveLength(0)
    expect(band.querySelectorAll('span.rounded-full[style*="top"]')).toHaveLength(2)
    // A real plot, not a hairline -- and not a feature panel either. 3S put
    // 165px here, which read beautifully and cost most of the first viewport.
    const plot = band.querySelector('svg')!.parentElement as HTMLElement
    expect(plot.style.height).toBe('128px')
  })

  it('says a fall as plainly as a rise, and calls neither a verdict', () => {
    scan = [idea({
      id: 'i-1', assetId: 'a-1', symbol: 'DOWN',
      createdAt: new Date(Date.now() - 29 * 86_400_000).toISOString(),
    })]
    framework = { 'a-1': { spot: 85, closes: series(100, 85, 30) } }
    render(<IdeasWorkspace />)
    const band = screen.getByTestId('idea-tile').querySelector('[data-visual="since"]')!
    expect(band.textContent).toContain('-15.0%')
    // A stock down since a buy was written is a reason to look again, not
    // proof the thesis was wrong. No red, no green, no verdict.
    expect(band.innerHTML).not.toMatch(/rose|red|green|emerald/)
  })

  it('draws exposure against the book, never against an invented ceiling', () => {
    // The 30% track had no source: there is no limit, policy or constraint
    // table in the schema, so the bar implied a threshold the product does
    // not have. The book's own largest position is the honest comparison.
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'BIG' })]
    exposure = { 'a-1': held(8.0, 3, 14, 16.0) }
    render(<IdeasWorkspace />)
    const band = screen.getByTestId('idea-tile').querySelector('[data-visual="exposure"]')!
    expect(band.textContent).toContain('#3 of 14')
    expect(band.textContent).toContain('3rd largest of 14')
    // Half the book's biggest stake, so the bar is half full.
    expect((band.querySelector('[style*="width"]') as HTMLElement).style.width).toBe('50%')

    const visuals = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeaVisuals.tsx'), 'utf8')
    expect(visuals).not.toContain('SCALE = 30')
  })

  it('draws written-but-unpriced cases as the gap they are', () => {
    // Three named cases and no prices is not a thin idea; it is somebody
    // stopping one step short of a decidable one.
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'THIN' })]
    framework = { 'a-1': { casesNamed: 3, caseNames: ['Bear', 'Base', 'Bull'] } }
    render(<IdeasWorkspace />)
    const band = screen.getByTestId('idea-tile').querySelector('[data-visual="cases"]')!
    // The relationship as the hero, not a caption: three written, none priced.
    expect(band.textContent).toContain('Cases written')
    expect(band.textContent).toContain('Priced')
    // The real names, carried from rows the scan already reads.
    for (const n of ['Bear', 'Base', 'Bull']) {
      expect(within(band as HTMLElement).getByText(n)).toBeInTheDocument()
    }
    // Two figures, not a fraction, and no dashed-input aesthetic.
    expect(band.textContent).not.toMatch(/\bof\b|%|complete|score|progress/i)
    expect(band.innerHTML).not.toContain('border-dashed')
  })

  it('states an unmodelled idea bluntly, and names what is missing', () => {
    // GH and LRCX genuinely have nothing. The emptiness is the finding, and a
    // row of empty cells said it limply.
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'HOLLOW' })]
    render(<IdeasWorkspace />)
    const band = screen.getByTestId('idea-tile').querySelector('[data-visual="gap"]')!
    // The absence as the hero figure, then what is missing, named.
    expect(band.textContent).toContain('0')
    expect(band.textContent).toContain('Modelled cases')
    for (const gap of ['cases', 'target', 'price', 'held']) {
      expect(band.textContent!.toLowerCase()).toContain(gap)
    }
    // Not a disabled form, and not a four-row table either: the facts sit
    // across one row, which says the same thing in a fifth of the height.
    expect(band.innerHTML).not.toContain('border-dashed')
    expect(band.innerHTML).toContain('grid-template-columns: repeat(4')
    // No denominator anywhere: nothing here is scored out of anything.
    expect(band.textContent).not.toMatch(/\bof\b|%|complete|score/i)
  })

  it('gives the since-open chart real plot height at every density', () => {
    // It read as a hairline sparkline. A chart nobody can read at page scale
    // is not a visual, whatever it encodes.
    const visuals = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeaVisuals.tsx'), 'utf8')
    const fn = visuals.slice(visuals.indexOf('export function SinceOpen'))
    // Real plot area at every density -- 165 / 118 / 70, against the 46 / 34
    // / 22 that read as a hairline.
    expect(visuals).toContain('const PLOT: Record<VisualSize, number> = { lg: 128, md: 88, sm: 54 }')
    expect(fn).toContain('style={{ height: h }}')
    // A readable line, real markers, and the move shaded against the opening.
    expect(fn).toContain("strokeWidth={size === 'sm' ? 1.75 : 2.25}")
    expect(fn).toContain('fill-slate-500/[0.13]')
    expect(fn).toContain("size === 'sm' ? 'h-[9px] w-[9px]' : 'h-[12px] w-[12px]'")
    // The return is the hero of the visual, not a line of text under it.
    expect(fn).toContain('FIG[size]')

    // The domain is read from the move, never forced to zero, and never so
    // tight that a flat name looks volatile.
    const dom = visuals.slice(visuals.indexOf('function domainFor'))
    expect(dom).toContain('anchorPrice * 0.01')
    expect(dom).toContain('(hi - lo) * 0.18')
    expect(dom).not.toMatch(/\b0\s*,\s*hi\b|Math\.min\(0/)
  })



  it('signs both legs, so a breached framework reads correctly', () => {
    // Spot above the bull case makes the bull leg negative. A hard-coded plus
    // rendered "+-10%" -- broken on exactly the ideas where price has left the
    // range and the figure matters most.
    scan = Array.from({ length: 10 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    framework = { 'a-9': { spot: 150, ladder: [
      { name: 'Bear', price: 100 }, { name: 'Base', price: 120 }, { name: 'Bull', price: 140 },
    ] } }
    render(<IdeasWorkspace />)
    const tile = screen.getAllByTestId('idea-tile').find(t => within(t).queryByText('S9'))!
    expect(tile.textContent).toContain('-33%')
    expect(tile.textContent).toContain('-7%')
    expect(tile.textContent).not.toContain('+-')
    // And a breach is rose, because price has left the range the desk wrote.
    expect(tile.innerHTML).toMatch(/text-rose-700/)
  })




  it('keeps one surface language across all three densities', () => {
    scan = Array.from({ length: 12 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const tiles = screen.getAllByTestId('idea-tile')
    // Same radius, same border, same elevation. Density changes padding, type
    // and how much is said -- never the design language. Featured being an
    // editorial surface, standard a SaaS card and compact raw text is exactly
    // the fragmentation this stage exists to remove.
    for (const t of tiles) {
      expect(t.className).toContain('rounded-lg')
      expect(t.className).toContain('border-gray-200/90')
      expect(t.className).toContain('shadow-[0_1px_2px_rgba(0,0,0,0.03)]')
    }
    // And there is no separate tail: no heading, no rule, no queue region.
    const ws = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeasWorkspace.tsx'), 'utf8')
    expect(ws).not.toContain('Also open')
    expect(screen.getByTestId('idea-field').parentElement!.querySelectorAll('h2')).toHaveLength(0)
  })


  it('fits the resting strip inside the height it reserves', () => {
    // The two resting lines naturally want 38.5px; the strip reserves 34 at
    // standard and 28 at compact. Flex used to absorb that by shrinking the
    // line boxes below the face size, which cut the descenders off every
    // context line on the page. Stating the leading is what makes them fit
    // honestly -- 15+15+4 = 34, and 13+14+0 = 27 -- so this pins the leading
    // rather than the fact that some class is present.
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    expect(card).toContain("compact ? 'text-[10.5px] leading-[13px]'")
    expect(card).toContain("compact ? 'text-[12px] leading-[14px]'")
    expect(card).toContain("compact ? 'gap-0' : 'gap-1'")
  })

  it('draws a second primitive only where the data earns one', () => {
    // The featured slot is wide enough for two, and `secondVisual` is the
    // runner-up chosen by the same rule as the first. An idea with only one
    // set of inputs must still draw one visual, not one chart beside a
    // reserved empty panel.
    framework = {
      'a-1': { target: 40, spot: 30, closes: series(28, 30, 40) },
      'a-2': { casesNamed: 2, caseNames: ['Bear', 'Base'] },
    }
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB' }),
    ]
    render(<IdeasWorkspace />)
    const tiles = screen.getAllByTestId('idea-tile')
    const aaa = tiles.find(t => within(t).queryByText('AAA'))!
    const bbb = tiles.find(t => within(t).queryByText('BBB'))!

    // AAA has a target AND an open anchor, so it earns both halves.
    expect(aaa.querySelector('[data-visual-second]')).not.toBeNull()
    // BBB has only named cases. One visual, and no empty second column.
    expect(bbb.querySelector('[data-visual-second]')).toBeNull()
  })

  it('never draws the absence of data as a second opinion', () => {
    // `gap` is the statement that there is nothing to draw. It can be the only
    // thing on a card and never the second thing beside a real primitive.
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    const body = card.slice(card.indexOf('const available = (['))
    const literal = body.slice(0, body.indexOf('].filter(Boolean)'))
    expect(literal).toContain("'exposure'")
    expect(literal).not.toContain("'gap'")
  })

  it('reserves the inspect layer a fixed strip, so nothing moves on hover', () => {
    // Both layers live inside one reserved height, which is what guarantees no
    // reflow, no neighbour movement and no scroll jump.
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    // One reserved height per band, holding two absolutely-positioned layers.
    expect(card).toContain("size === 'featured' ? 'h-[40px]' : compact ? 'h-[28px]' : 'h-[34px]'")
    expect(card).toContain('absolute inset-0 flex flex-col justify-end')
    expect(card).toContain('absolute inset-x-0 bottom-0 flex flex-col justify-end')
  })

  it('reveals why an idea is here now, not merely two links', () => {
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA', maturity: 'decision_ready' })]
    render(<IdeasWorkspace />)
    const tile = screen.getByTestId('idea-tile')
    // Present in the DOM at fixed height, revealed on hover or focus -- the
    // reserved strip is what keeps the layout still.
    expect(tile).toHaveTextContent('Why now')
    expect(tile).toHaveTextContent(/Decision ready · in Vision Fund 10K/)
  })

  it('offers a quiet next step on the top three, before any hover', () => {
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA', maturity: 'decision_ready' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB', maturity: 'researching' }),
    ]
    render(<IdeasWorkspace />)
    const tiles = screen.getAllByTestId('idea-tile')
    // The next step is set as an action, not as another metadata line, and the
    // verb is the desk's -- `primaryActionFor`, the same one the detail panes
    // show. The card used to keep its own shorter list, so browse and detail
    // could name different next steps for one idea.
    expect(tiles[0]).toHaveTextContent('Review decision')
    expect(tiles[1]).toHaveTextContent('Advance research')
  })

  it('names the business action, never a generic open', () => {
    // A tile cannot record a decision, so it never offers to -- but it must
    // not fall back to "Open idea" either, which is precisely the generic verb
    // the engagement seam's primary-action slot exists to avoid.
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA', maturity: 'deciding' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB', maturity: 'thesis_forming' }),
    ]
    render(<IdeasWorkspace />)
    const labels = screen.getAllByTestId('idea-quick-open').map(b => b.textContent)
    expect(labels).toEqual(['Review decision', 'Advance thesis'])
    expect(labels.join(' ')).not.toMatch(/open/i)
  })

  it('offers the three engagement slots, and nothing beyond them', () => {
    // Respond / Ask AI / Discuss is the shared grammar, and the field carries
    // all three: Discuss reached only the detail pane before, so an idea could
    // not be raised with anyone without opening it first.
    //
    // The count is still guarded. The point of the old "no more than two" was
    // never the number two -- it was that actions stay subordinate to the
    // investment content and never become a CTA footer -- so the guard is kept
    // and re-pinned to the three named slots.
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' })]
    render(<IdeasWorkspace />)
    const tile = screen.getByTestId('idea-tile')
    expect(within(tile).getByTestId('idea-quick-open')).toBeInTheDocument()
    expect(within(tile).getByTestId('idea-quick-ai')).toBeInTheDocument()
    expect(within(tile).getByTestId('idea-quick-discuss')).toBeInTheDocument()
    // Create joins them, from the same menu the Dashboard and the workbench
    // use. The guard is still a count -- actions must stay subordinate to the
    // investment content and never become a CTA footer -- re-pinned to four
    // named slots plus the stretched open-affordance.
    expect(within(tile).getByTestId('create-menu')).toBeInTheDocument()
    expect(within(tile).getAllByRole('button')).toHaveLength(5)
  })

  it('takes the idea under the cursor to the team, without opening it', async () => {
    const user = userEvent.setup()
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB' }),
    ]
    render(<IdeasWorkspace />)

    const bbb = screen.getAllByTestId('idea-tile').find(t => within(t).queryByText('BBB'))!
    await user.click(within(bbb).getByTestId('idea-quick-discuss'))

    const [view, target] = openEngagement.mock.calls[0]
    expect(view).toBe('discuss')
    expect(target.objectId).toBe('i-2')
    expect(opened).toHaveLength(0)
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
