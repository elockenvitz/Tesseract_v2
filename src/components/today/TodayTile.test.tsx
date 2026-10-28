/**
 * Focused test for the Today tile's action wiring.
 *
 * Covers the exit criteria that are about behaviour a user can observe:
 * the primary dominates, Ask AI opens with object + issue bound, Discuss only
 * appears when the object can hold a thread, and the overflow keeps personal
 * and shared apart.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { DecisionItem } from '../../engine/decisionEngine/types'
import { ENGAGEMENT_EVENT } from '../../lib/engagement'
import type { EngagementRequest } from '../../lib/engagement'
import { adaptDecisionItem } from '../../lib/today'
import { VISUAL_SLOT } from '../../lib/today'
import { TodayTile } from './TodayTile'

const decision = (over: Partial<DecisionItem> = {}): DecisionItem => ({
  id: 'thesis-stale-a-amzn',
  surface: 'action',
  severity: 'red',
  category: 'risk',
  title: 'Thesis May Be Stale',
  titleKey: 'THESIS_STALE',
  description: 'Research thesis has not been updated recently.',
  chips: [{ label: 'Ticker', value: 'AMZN' }, { label: 'Age', value: '210d' }],
  context: { assetId: 'a-amzn', assetTicker: 'AMZN' },
  ctas: [{ label: 'Update Thesis', actionKey: 'OPEN_ASSET_UPDATE_THESIS', kind: 'primary' }],
  sortScore: 0,
  ...over,
} as DecisionItem)

function renderTile(d: DecisionItem = decision(), props: Partial<Parameters<typeof TodayTile>[0]> = {}) {
  const handlers = {
    onPrimary: vi.fn(), onDismiss: vi.fn(), onSnooze: vi.fn(),
  }
  const view = render(
    <TodayTile item={adaptDecisionItem(d)} rank={1} {...handlers} {...props} />,
  )
  return Object.assign(handlers, { container: view.container })
}

let requests: EngagementRequest[]
let listener: (e: Event) => void

beforeEach(() => {
  requests = []
  // Registered and removed per test. Leaving it attached would accumulate one
  // listener per case, and every event would then be counted once per listener
  // -- which is what a "length 4" assertion failure on a single click means.
  listener = e => requests.push((e as CustomEvent<EngagementRequest>).detail)
  window.addEventListener(ENGAGEMENT_EVENT, listener)
})

afterEach(() => window.removeEventListener(ENGAGEMENT_EVENT, listener))

describe('TodayTile', () => {
  it('shows what happened, why it matters and why now', () => {
    renderTile()
    expect(screen.getByText('AMZN')).toBeInTheDocument()
    expect(screen.getByText('Thesis May Be Stale')).toBeInTheDocument()
    expect(screen.getByText('210d')).toBeInTheDocument()
    expect(screen.getByText(/has not been updated in over six months/)).toBeInTheDocument()
  })

  it('gives the primary action the dominant treatment', () => {
    renderTile()
    const primary = screen.getByRole('button', { name: /Review thesis/ })
    // Filled, not an outline or a text link — the one visually dominant verb.
    expect(primary.className).toMatch(/bg-blue-700/)
    expect(screen.getByRole('button', { name: /Ask AI/ }).className).not.toMatch(/bg-blue-700/)
  })

  it('runs the primary action through the engine CTA it was given', () => {
    const h = renderTile()
    fireEvent.click(screen.getByRole('button', { name: /Review thesis/ }))
    expect(h.onPrimary).toHaveBeenCalledTimes(1)
    expect(h.onPrimary.mock.calls[0][0].primary).toMatchObject({
      actionKey: 'OPEN_ASSET_UPDATE_THESIS',
    })
  })

  it('opens Ask AI with the object AND the triggering issue bound', () => {
    renderTile()
    fireEvent.click(screen.getByRole('button', { name: /Ask AI/ }))
    expect(requests).toHaveLength(1)
    expect(requests[0].mode).toBe('ai')
    expect(requests[0].target).toMatchObject({
      objectType: 'asset', objectId: 'a-amzn', symbol: 'AMZN',
    })
    // The model must know WHY the user clicked, not only which ticker.
    expect(requests[0].target.issue).toMatchObject({ reason: 'THESIS_STALE' })
    expect(requests[0].target.seedPrompt).toMatch(/AMZN/)
    expect(requests[0].target.contextChips?.length).toBeGreaterThan(0)
  })

  it('carries all three engagement slots on the same seam', () => {
    // Discuss was withheld here so that scattering the affordance would not
    // pre-empt the communication-pane review. That review question is now
    // settled in the product -- the Ideas field carries Respond / Ask AI /
    // Discuss -- so Today withholding it was the inconsistency rather than the
    // caution, and a finding could only be raised with the team by opening it.
    //
    // Still one seam: `discuss()` raises an EngagementRequest and the existing
    // CommunicationPane answers it. No second messaging system is introduced.
    renderTile()
    expect(screen.getByRole('button', { name: /Ask AI/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Discuss$/ })).toBeInTheDocument()
  })

  it('opens the object from the card body, and calls that overview', () => {
    // The card is the entrance. A click on its own ground is a request for the
    // object without naming a part of it.
    const h = renderTile()
    fireEvent.click(screen.getByTestId('today-tile'))
    expect(h.onPrimary).toHaveBeenCalled()
    expect(h.onPrimary.mock.calls[0][1].intent).toBe('overview')
  })

  it('never fires the card portal from a control inside it', () => {
    // Arbitration by event semantics: a click that started in a button is that
    // button's click. No coordinate maths, nothing that breaks on reflow.
    const h = renderTile()
    fireEvent.click(screen.getByRole('button', { name: /Ask AI/ }))
    expect(h.onPrimary).not.toHaveBeenCalled()
  })

  it('sends the reader to the part of the object they reached for', () => {
    const h = renderTile()
    fireEvent.click(screen.getByTestId('claim-portal'))
    expect(h.onPrimary.mock.calls[0][1].intent).toBe('claim')
  })

  it('keeps the object primary when a part is named', () => {
    // The intent refines a destination; it never becomes the identity. Two
    // findings on one ticker must stay distinct.
    const h = renderTile()
    fireEvent.click(screen.getByTestId('claim-portal'))
    const source = h.onPrimary.mock.calls[0][1]
    expect(source.intent).toBe('claim')
    expect(source.elementId).toBe(screen.getByTestId('today-tile').getAttribute('data-focus-source'))
  })

  it('reaches the portal by keyboard without nesting a button in a button', () => {
    const h = renderTile()
    const tile = screen.getByTestId('today-tile')
    // Not a <button>: it contains buttons, and nesting them is invalid markup.
    expect(tile.tagName.toLowerCase()).not.toBe('button')
    expect(tile).toHaveAttribute('aria-label')
    fireEvent.keyDown(tile, { key: 'Enter', target: tile })
    expect(h.onPrimary).toHaveBeenCalled()
  })

  it('renders no engagement affordance when there is no object to bind', () => {
    renderTile(decision({ context: {} }))
    expect(screen.queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Discuss$/ })).not.toBeInTheDocument()
  })

  it('says so when the evaluator offered no structured action', () => {
    renderTile(decision({ ctas: [] }))
    expect(screen.getByText(/No structured action yet/)).toBeInTheDocument()
  })

  /*
   * ── The menu lost its two section headers, and these cases with them ───
   *
   * The headers said "Personal — only affects your view" and "Shared —
   * changes the workflow for everyone", and under the second one sat a
   * forty-word paragraph explaining why there were no shared actions. The
   * cases below pinned all of it.
   *
   * What they were protecting is still protected, and it is worth saying
   * exactly what: a control that LOOKS like a shared mutation and performs
   * none is worse than no control, because the reader believes their team's
   * revisit date moved. No such control is rendered -- there is no Defer,
   * and the surviving items say "for me". What is gone is the essay about
   * the absence, which no reader opening a three-item menu needed to read.
   */
  it('dismisses for the reader, and says so in the words on the item', () => {
    const h = renderTile()
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    fireEvent.click(screen.getByText('Hide this for me'))
    expect(h.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('never renders a shared action Today cannot perform', () => {
    renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      context: { assetId: 'a-amzn', assetTicker: 'AMZN', tradeIdeaId: 'tq-1' },
    }))
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    expect(screen.queryByRole('button', { name: /Defer/ })).not.toBeInTheDocument()
  })

  it('snoozes for the chosen duration, and never calls it Defer', () => {
    const h = renderTile()
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    fireEvent.click(screen.getByText('Remind me in 1 week'))
    expect(h.onSnooze).toHaveBeenCalledWith(expect.anything(), 168)
  })

  it('renders the archetype the problem calls for', () => {
    // A waiting proposal earns its aging line from a real elapsed time — but
    // only when that time is not already in the metric strip. With no `Open`
    // chip the age comes from `createdAt` and appears nowhere else, so drawing
    // it adds something.
    renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }],
      createdAt: new Date(Date.now() - 62 * 86_400_000).toISOString(),
    }))
    expect(screen.getByText('Unresolved for')).toBeInTheDocument()
  })

  it('does not spend the visual slot on an age the strip already states', () => {
    // `Open` maps to a metric, so "62d" is already the first thing in the
    // strip. The aging line beside it was a picture of a number printed a
    // couple of hundred pixels to its left.
    renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
    }))
    expect(screen.queryByText('Unresolved for')).not.toBeInTheDocument()
    expect(screen.getByText('62d')).toBeInTheDocument()
  })

  it('composes a featured tile without a visual as one column, not a half-empty split', () => {
    const { container } = renderTile(decision(), { featured: true })
    // No visual for a stale thesis without history, so no reserved column.
    expect(container.querySelector('[data-archetype]')).toBeNull()
    const classes = [...container.querySelectorAll('div')].map(d => d.className).join(' ')
    expect(classes).not.toMatch(/grid-cols-\[minmax/)
  })

  it('keeps the two-column split when the featured item does have a visual', () => {
    const { container } = renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }],
      createdAt: new Date(Date.now() - 62 * 86_400_000).toISOString(),
    }), { featured: true })
    expect(container.querySelector('[data-archetype]')).not.toBeNull()
    expect(container.querySelector('[data-body]')?.getAttribute('data-body')).toBe('split')
  })

  it('caps the measure of a wide tile with nothing to draw, and reserves no column', () => {
    // The third state, and the one that was missing. A lead tile with no
    // visual used to set its claim across the full width of the lead column;
    // it now stops at a readable measure without holding an empty column open
    // for a chart that does not exist.
    const { container } = renderTile(decision(), { featured: true })
    expect(container.querySelector('[data-archetype]')).toBeNull()
    const body = container.querySelector('[data-body]')
    expect(body?.getAttribute('data-body')).toBe('capped')
    expect(body?.className).toMatch(/max-w-/)
  })

  it('lets the same finding take different geometry as its data changes', () => {
    // Presentation follows what there is to draw, not the evaluator that
    // produced it. Identical titleKey and identical role; only the drawable
    // data differs.
    const withAge = renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }],
      createdAt: new Date(Date.now() - 62 * 86_400_000).toISOString(),
    }), { featured: true })
    expect(withAge.container.querySelector('[data-body]')?.getAttribute('data-body')).toBe('split')

    // Each render owns its container, so both can be inspected side by side.
    const without = renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
    }), { featured: true })
    expect(without.container.querySelector('[data-body]')?.getAttribute('data-body')).toBe('capped')
  })

  it('omits the visual entirely rather than apologising for it', () => {
    // The user must never read implementation language about what the engine
    // could not measure. No visual is better than an apology.
    const { container } = renderTile(decision({ chips: [{ label: 'Ticker', value: 'AMZN' }] }))
    expect(screen.queryByText(/No chartable measure/)).not.toBeInTheDocument()
    expect(screen.queryByText(/What the engine found/i)).not.toBeInTheDocument()
    expect(container.querySelector('[data-archetype]')).toBeNull()
  })

  it('leads with the object at mobile weight, not a timid ticker', () => {
    renderTile()
    const id = screen.getByText('AMZN')
    // Mobile sets its headline font-black with tight tracking; parity matters
    // more than the exact size, which differs featured vs supporting.
    expect(id.className).toMatch(/font-black/)
    expect(id.className).toMatch(/tracking-\[-0\.035em\]/)
  })
})

/*
 * Two things the reader notices before they notice any content: four buttons
 * repeated on every tile, and the surface re-arranging itself seven seconds
 * after it painted.
 */
describe('the action row costs nothing until it is approached', () => {
  it('hides every verb at rest, the primary included', () => {
    // Fading only the secondaries left "Review thesis" and "Simulate idea"
    // as the loudest marks on the surface. At rest the tile shows its
    // finding; the actions arrive when the reader does.
    const { container } = renderTile()
    const row = container.querySelector('[data-testid="today-actions"]')!
    expect(row.className).toMatch(/opacity-0/)
    expect(row.className).toMatch(/group-hover:opacity-100/)
    // Tabbing in must reveal them too, or the keyboard path has no actions.
    expect(row.className).toMatch(/group-focus-within:opacity-100/)
    expect(row.contains(screen.getByRole('button', { name: /Review thesis/ }))).toBe(true)
  })

  it('takes the row out of flow, so hovering moves nothing', () => {
    // It used to reserve 60px whether or not anything in it was visible, so
    // the space was spent either way. Out of flow, the tile is the same
    // height hovered and not.
    const { container } = renderTile()
    const row = container.querySelector('[data-testid="today-actions"]')!
    expect(row.className).toMatch(/absolute/)
  })

  it('sits on the eyebrow, never on the tile\'s bottom edge', () => {
    /*
     * Pinned to the bottom it kept landing on the one control it shared the
     * card with: full width it covered the chart, and stopped at 48% it still
     * covered "See the full chart" on any tile whose body stacks rather than
     * splits -- the link sat under the scrim and could not be clicked.
     *
     * The position was the defect, not its width, so the assertion is about
     * position: top, never bottom.
     */
    const { container } = renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }],
      createdAt: new Date(Date.now() - 62 * 86_400_000).toISOString(),
    }), { featured: true })
    const row = container.querySelector('[data-testid="today-actions"]')!
    expect(row.className).toMatch(/(^|\s)top-0(\s|$)/)
    expect(row.className).not.toMatch(/bottom-0/)
  })

  it('leaves the visual portal clickable while the row is up', () => {
    // The portal is the control that was being buried. It must not share an
    // ancestor with the action row, or it is under the scrim again.
    const { container } = renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }],
      createdAt: new Date(Date.now() - 62 * 86_400_000).toISOString(),
    }), { featured: true })
    const row = container.querySelector('[data-testid="today-actions"]')!
    const portal = container.querySelector('[data-testid="visual-portal"]')!
    expect(portal).not.toBeNull()
    expect(row.contains(portal)).toBe(false)
  })

  it('anchors the reveal on the tile, not on the row', () => {
    // `group-hover:` resolves against the nearest ancestor marked `group`.
    // Without it on the article the row never un-hides -- the whole
    // mechanism is dead and every other assertion here still passes.
    const { container } = renderTile()
    expect(container.querySelector('article')?.className).toMatch(/(^|\s)group(\s|$)/)
  })

  it('does not clip the overflow menu to the card', () => {
    // A 288px panel opened from inside an `overflow-hidden` box was cut off:
    // the snooze presets were unreachable on every tile.
    const { container } = renderTile()
    expect(container.querySelector('article')?.className).not.toMatch(/overflow-hidden/)
  })

  it('offers three plain choices, with no briefing to read first', () => {
    /*
     * It was two sections -- "Personal — only affects your view", four items
     * each with its own explanatory hint, "Shared — changes the workflow for
     * everyone", and a forty-word paragraph about why there are no shared
     * actions. Six lines of prose to put something off until next week.
     *
     * Every sentence was true, which is how it got there, and none of it was
     * a decision the reader was making. Whose view it leaves is carried by
     * the words on the item instead.
     */
    renderTile()
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    const labels = screen.getAllByRole('button')
      .map(b => (b.textContent ?? '').trim())
      .filter(t => /^(Hide this|Remind me)/.test(t))
    expect(labels).toEqual(['Hide this for me', 'Remind me in 1 day', 'Remind me in 1 week'])

    for (const gone of [/only affects your view/i, /changes the workflow for everyone/i, /no shared revisit date/i]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument()
    }
  })

  it('keeps the body clear of the overlay on a tile with no slack', () => {
    // The row is out of flow, so this padding is the only thing between it
    // and the last line of content.
    const { container } = renderTile()
    expect(container.querySelector('[data-body]')?.className).toMatch(/\bpb-3\b/)
  })
})

describe('the analysis zone is one fixed slot', () => {
  it('gives every archetype the same slot, so a swap costs nothing', () => {
    // Measured: aging 107px, scenario 122px, review-window taller again --
    // which is why replacing one with another moved every tile below it.
    // `createdAt` is what the aging track is built from -- no enrichment.
    const drawsNow = decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }],
      createdAt: new Date(Date.now() - 62 * 86_400_000).toISOString(),
    })
    const h = (c: HTMLElement) => (c.querySelector('[data-archetype]') as HTMLElement).style.height
    expect(h(renderTile(drawsNow, { featured: true }).container)).toBe(`${VISUAL_SLOT.featured}px`)
    expect(h(renderTile(drawsNow, { wide: true }).container)).toBe(`${VISUAL_SLOT.compact}px`)
  })

})

/**
 * Paging between the pictures a finding can draw.
 *
 * The data half of this is enrichment's (`visuals`); what the tile owes the
 * reader is a way to reach the alternatives without leaving the card, and a
 * promise that reaching for them does not move the page.
 */
describe('a tile pages between its pictures', () => {
  /** A finding whose price path leads and whose framework is one tab away. */
  const two = () => {
    const item = adaptDecisionItem(decision())
    const price = { archetype: 'review-window' as const, caption: 'Price since the thesis', window: '210d',
      reviewWindow: { series: [100, 110, 130], changePct: 30, reachesAnchor: true, anchorLabel: 'thesis' } }
    const cases = { archetype: 'scenario' as const, caption: 'Price against the framework', window: '3 cases',
      scenario: { cases: [{ name: 'Bear', price: 90 }, { name: 'Bull', price: 180 }], spot: 130 } }
    return { ...item, visual: price, visuals: [price, cases] }
  }

  it('draws one tab per picture, named for the question it answers', () => {
    renderTile(decision(), { item: two() } as never)
    const tabs = screen.getAllByTestId('visual-pager-tab')
    expect(tabs.map(t => t.getAttribute('data-archetype'))).toEqual(['review-window', 'scenario'])
    expect(tabs.map(t => (t.textContent ?? '').trim())).toEqual(['Price', 'Cases'])
  })

  it('swaps the picture, and the portal follows it', () => {
    // Paging to the framework must not leave a portal still offering the
    // chart -- the control under a picture has to open what is drawn.
    const { container } = renderTile(decision(), { item: two() } as never)
    expect(container.querySelector('[data-archetype]')?.getAttribute('data-archetype'))
      .toBe('review-window')
    expect(screen.getByTestId('visual-portal').textContent).toMatch(/full chart/i)

    fireEvent.click(screen.getAllByTestId('visual-pager-tab')[1])

    expect(container.querySelector('[data-archetype]')?.getAttribute('data-archetype'))
      .toBe('scenario')
    expect(screen.getByTestId('visual-portal').textContent).toMatch(/price cases/i)
  })

  it('costs no height: the slot is the same before and after a swap', () => {
    // The whole reason the strip shares the portal's row.
    const { container } = renderTile(decision(), { item: two(), featured: true } as never)
    const h = () => (container.querySelector('[data-archetype]') as HTMLElement).style.height
    const before = h()
    fireEvent.click(screen.getAllByTestId('visual-pager-tab')[1])
    expect(h()).toBe(before)
    expect(before).toBe(`${VISUAL_SLOT.featured}px`)
  })

  it('draws no strip for a tile with one picture', () => {
    // A single dead tab is worse than no tab: it implies something to page to.
    renderTile()
    expect(screen.queryByTestId('visual-pager')).not.toBeInTheDocument()
  })
})
