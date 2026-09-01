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

  it('assigns a density from rank alone, in order', () => {
    scan = Array.from({ length: 12 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const d = screen.getAllByTestId('idea-tile').map(t => t.getAttribute('data-density'))
    // Two featured, four standard, everything else compact. Four is what the
    // placement needs: #3 sits beneath #2 in the top-right, so #4/#5/#6 form
    // one full row of three rather than a row with a hole in it.
    expect(d.slice(0, 2)).toEqual(['featured', 'featured'])
    expect(d.slice(2, 6)).toEqual(['standard', 'standard', 'standard', 'standard'])
    expect(new Set(d.slice(6))).toEqual(new Set(['compact']))
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
    // Content-driven height: a card never inherits its neighbour's.
    expect(field.className).toContain('items-start')
    // Every tile is a direct child. No region wrappers, no nested grids.
    expect(field.children).toHaveLength(12)
    for (const child of field.children) {
      expect(child).toHaveAttribute('data-testid', 'idea-tile')
    }
  })

  it('lets the third card sit under the second, not under the lead', () => {
    // A grid row cannot end until its tallest item does, so with #1 and #2
    // side by side nothing could begin beneath #2 until #1 had finished --
    // leaving a card-sized hole in the top right that read as a failed render.
    // #1 spans two rows in the left eight columns instead, and #3 is placed
    // directly under #2. Placement, not height.
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    const body = card.slice(card.indexOf('export function spanForRank')).split('\n}')[0]
    expect(body).toContain('lg:row-span-2')
    expect(body.match(/lg:col-start-9/g)).toHaveLength(2)   // ranks 1 and 2
    // The lead fills the two rows it declares -- its height is set by the two
    // real cards beside it, not bought by its rank. Nothing else stretches,
    // and nothing anywhere pushes content to the bottom of borrowed space.
    expect(body.match(/self-stretch/g)).toHaveLength(1)
    expect(card.slice(card.indexOf('function FeaturedCard'))).not.toContain('self-stretch')
    expect(card).not.toContain('mt-auto')
  })

  it('places every rank deterministically, from the index alone', () => {
    scan = Array.from({ length: 12 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    render(<IdeasWorkspace />)
    const tiles = screen.getAllByTestId('idea-tile')
    expect(tiles[0].className).toContain('lg:row-span-2')
    expect(tiles[1].className).toContain('lg:col-start-9')
    expect(tiles[2].className).toContain('lg:col-start-9')
    // Ranks 4-6 form one full row of three; nothing is pinned after that.
    for (const t of tiles.slice(3, 6)) expect(t.className).not.toContain('col-start')
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
    expect(standards()).toHaveLength(4)
    for (const t of standards()) {
      // Age is unconditional: seven months open is a different object from
      // one opened last week, and that was nowhere on the page.
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
    expect(std).toContain('line-clamp-4 text-[14.5px]')
    expect(cmp).toContain('line-clamp-2 text-[12px]')
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
    // The state itself is still carried everywhere, by the maturity mark.
    for (const t of tiles) expect(t.innerHTML).toMatch(/bg-amber-500/)
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
    expect(first.innerHTML).toContain('text-[34px]')
    expect(second.innerHTML).toContain('text-[26px]')
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
    expect(within(aaa).getByText('target')).toBeInTheDocument()
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

  it('draws how far an idea has come, not just its name', () => {
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA', maturity: 'researching' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB', maturity: 'decision_ready' }),
    ]
    render(<IdeasWorkspace />)
    const tiles = screen.getAllByTestId('idea-tile')
    // Four positions, so "what kind of idea is this" is answerable without
    // reading the label.
    for (const t of tiles) {
      expect(t.querySelectorAll('[title]').length).toBeGreaterThan(0)
    }
    // And decision-ready work is amber, because a decision nobody has taken is
    // work outstanding. Research is not.
    const track = (t: HTMLElement) => t.querySelector('[title]')!.innerHTML
    const ready = tiles.find(t => within(t).queryByText('BBB'))!
    const early = tiles.find(t => within(t).queryByText('AAA'))!
    expect(track(ready)).toMatch(/bg-amber/)
    expect(track(early)).not.toMatch(/bg-amber/)
  })

  it('marks where an idea has got to, and does not fill up to it', () => {
    // A cumulative fill is a progress bar, and says something false: that
    // decision-ready is 100% of something and researching is 25% of it.
    // Maturity is a position among four, so exactly one mark is emphasised
    // however late the idea is.
    scan = [
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA', maturity: 'researching' }),
      idea({ id: 'i-2', assetId: 'a-2', symbol: 'BBB', maturity: 'deciding' }),
      idea({ id: 'i-3', assetId: 'a-3', symbol: 'CCC', maturity: 'decision_ready' }),
    ]
    render(<IdeasWorkspace />)
    for (const symbol of ['AAA', 'BBB', 'CCC']) {
      const tile = screen.getAllByTestId('idea-tile')
        .find(t => within(t).queryByText(symbol))!
      const marks = tile.querySelector('[title]')!.querySelectorAll('span > span')
      // Four positions; one emphasised, whichever it is.
      expect(marks).toHaveLength(4)
      const filled = [...marks].filter(m =>
        /bg-amber-500|bg-slate-600|bg-slate-300/.test(m.className))
      expect(filled).toHaveLength(1)
    }
  })

  it('draws no progress-track grammar anywhere in the visuals', () => {
    const visuals = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeaVisuals.tsx'), 'utf8')
    const track = visuals.slice(
      visuals.indexOf('export function MaturityTrack'),
      visuals.indexOf('/* --', visuals.indexOf('export function MaturityTrack')))
    // The tell of a progress bar is a comparison against the current index.
    // A position marker only ever asks whether this IS the current one.
    expect(track).toContain('i === at')
    expect(track).not.toMatch(/i\s*[<>]=?\s*at/)
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

  it('gives no card height it has not earned', () => {
    const card = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    // Nothing pushes a footer to the bottom of space a neighbour won.
    expect(card).not.toContain('mt-auto')
    // And nothing stretches a cell to its row: the one grid is items-start.
    const ws = readFileSync(
      join(process.cwd(), 'src/components/ideas-v2/IdeasWorkspace.tsx'), 'utf8')
    expect(ws).toContain('grid grid-cols-12 items-start')
  })

  it('draws no empty visual slot for an idea that has no setup', () => {
    // An early-stage idea is not a broken late-stage one. A reserved chart
    // wrapper with nothing in it is exactly what makes it look like one.
    scan = [
      idea({ id: 'i-0', assetId: 'a-0', symbol: 'RICH' }),
      idea({ id: 'i-1', assetId: 'a-1', symbol: 'BARE', proposedWeight: null }),
    ]
    framework = { 'a-0': { spot: 100, ladder: [
      { name: 'Bear', price: 80 }, { name: 'Base', price: 110 }, { name: 'Bull', price: 140 },
    ] } }
    render(<IdeasWorkspace />)
    const bare = screen.getAllByTestId('idea-tile').find(t => within(t).queryByText('BARE'))!
    // The claim and the footer, and nothing between them.
    expect(within(bare).queryByText('to bear')).not.toBeInTheDocument()
    expect(within(bare).queryByText('target')).not.toBeInTheDocument()
    expect(within(bare).queryByText('Held')).not.toBeInTheDocument()
    expect(bare.innerHTML).not.toMatch(/rounded-full bg-slate-100|h-\[46px\]|h-\[30px\] w-full/)
  })

  it('states a compact framework as one concise relationship, not a chart', () => {
    scan = Array.from({ length: 10 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    framework = { 'a-9': { spot: 100, ladder: [
      { name: 'Bear', price: 80 }, { name: 'Base', price: 110 }, { name: 'Bull', price: 140 },
    ] } }
    render(<IdeasWorkspace />)
    const tile = screen.getAllByTestId('idea-tile').find(t => within(t).queryByText('S9'))!
    expect(tile).toHaveAttribute('data-density', 'compact')
    // Spot, then both distances -- the chart's intelligence at a size that fits.
    expect(within(tile).getByText('100.00')).toBeInTheDocument()
    expect(within(tile).getByText(/-20% \/ \+40%/)).toBeInTheDocument()
    expect(within(tile).getByText('bear / bull')).toBeInTheDocument()
    // But not the chart itself.
    expect(within(tile).queryByText('Bear 80')).not.toBeInTheDocument()
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
    expect(tile.textContent).toContain('-33% / -7%')
    expect(tile.textContent).not.toContain('+-')
    // And a breach is rose, because price has left the range the desk wrote.
    expect(tile.innerHTML).toMatch(/text-rose-700/)
  })

  it('states a compact target as one figure', () => {
    scan = Array.from({ length: 10 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}` }))
    framework = { 'a-9': { spot: 100, target: 112 } }
    render(<IdeasWorkspace />)
    const tile = screen.getAllByTestId('idea-tile').find(t => within(t).queryByText('S9'))!
    expect(within(tile).getByText('+12%')).toBeInTheDocument()
    expect(within(tile).getByText('to target')).toBeInTheDocument()
  })

  it('states a compact sizing question only when both weights are real', () => {
    // Identical inputs throughout, so nothing about this idea's ranking is in
    // play -- only what a compact card does with two real weights.
    scan = Array.from({ length: 10 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}`, proposedWeight: 11 }))
    exposure = Object.fromEntries(scan.map(i => [i.assetId!, 8.2]))
    render(<IdeasWorkspace />)
    const compact = screen.getAllByTestId('idea-tile')
      .filter(t => t.getAttribute('data-density') === 'compact')
    expect(compact.length).toBeGreaterThan(0)
    expect(compact[0].textContent).toMatch(/8\.2% held\s*→\s*11\.0% proposed/)
  })

  it('draws no sizing relationship against a weight that does not exist', () => {
    // A proposal measured against a dash is not a relationship, and drawing
    // it as one invents a comparison the book never made.
    scan = Array.from({ length: 10 }, (_, i) =>
      idea({ id: `i-${i}`, assetId: `a-${i}`, symbol: `S${i}`, proposedWeight: null }))
    exposure = {}
    render(<IdeasWorkspace />)
    for (const t of screen.getAllByTestId('idea-tile')) {
      expect(t.textContent).not.toContain('proposed')
    }
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


  it('reserves the inspect layer a fixed strip, so nothing moves on hover', () => {
    // Both layers live inside one reserved height, which is what guarantees no
    // reflow, no neighbour movement and no scroll jump.
    const card = readFileSync(join(process.cwd(), 'src/components/ideas-v2/IdeaCard.tsx'), 'utf8')
    // One reserved height per band, holding two absolutely-positioned layers.
    expect(card).toContain("size === 'featured' ? 'h-[40px]' : compact ? 'h-[30px]' : 'h-[36px]'")
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
    expect(tiles[0]).toHaveTextContent('Next · Assess decision')
    expect(tiles[1]).toHaveTextContent('Next · Continue research')
  })

  it('offers no more than two actions', () => {
    scan = [idea({ id: 'i-1', assetId: 'a-1', symbol: 'AAA' })]
    render(<IdeasWorkspace />)
    const tile = screen.getByTestId('idea-tile')
    // The stretched open-affordance, plus exactly two quick actions.
    expect(within(tile).getAllByRole('button')).toHaveLength(3)
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
