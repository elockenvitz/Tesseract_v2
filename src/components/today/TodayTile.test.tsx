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
    expect(screen.getByText(/has not been revisited in over six months/)).toBeInTheDocument()
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

  it('renders no engagement affordance when there is no object to bind', () => {
    renderTile(decision({ context: {} }))
    expect(screen.queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Discuss$/ })).not.toBeInTheDocument()
  })

  it('says so when the evaluator offered no structured action', () => {
    renderTile(decision({ ctas: [] }))
    expect(screen.getByText(/No structured action yet/)).toBeInTheDocument()
  })

  it('keeps personal and shared dispositions visibly apart', () => {
    const h = renderTile()
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))

    expect(screen.getByText(/Personal — only affects your view/)).toBeInTheDocument()
    expect(screen.getByText(/Shared — changes the workflow for everyone/)).toBeInTheDocument()

    // An asset has no shared revisit date, so no shared Defer is offered.
    expect(screen.queryByText('Defer the item')).not.toBeInTheDocument()
    expect(screen.getByText(/no shared revisit date to move/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Dismiss for me'))
    expect(h.onDismiss).toHaveBeenCalledTimes(1)
  })

  it('never renders a clickable shared action Today cannot perform', () => {
    // A control that looks like a shared mutation and performs none is worse
    // than no control: the user believes their team's revisit date moved.
    renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      context: { assetId: 'a-amzn', assetTicker: 'AMZN', tradeIdeaId: 'tq-1' },
    }))
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))

    expect(screen.queryByRole('button', { name: /Defer/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Today cannot move it yet/)).toBeInTheDocument()
    expect(screen.getByText(/defer it from the trade queue/)).toBeInTheDocument()
  })

  it('does not offer Snooze as a substitute for the shared action', () => {
    renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      context: { assetId: 'a-amzn', assetTicker: 'AMZN', tradeIdeaId: 'tq-1' },
    }))
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    // Snooze stays where it belongs -- under Personal, and never renamed.
    expect(screen.getByText('Snooze 1 day')).toBeInTheDocument()
    expect(screen.queryByText(/Defer the item/)).not.toBeInTheDocument()
  })

  it('snoozes for the chosen duration, and never calls it Defer', () => {
    const h = renderTile()
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    fireEvent.click(screen.getByText('Snooze 3 days'))
    expect(h.onSnooze).toHaveBeenCalledWith(expect.anything(), 72)
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
