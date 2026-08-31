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

  it('does not render Discuss on Today while the pane review is pending', () => {
    // The D1 seam is intact and EngagementThread still works; only the button
    // is withheld, so the communication-pane review is not pre-empted by
    // Discuss affordances scattered across surfaces.
    renderTile()
    expect(screen.queryByRole('button', { name: /^Discuss$/ })).not.toBeInTheDocument()
    // Ask AI is unaffected.
    expect(screen.getByRole('button', { name: /Ask AI/ })).toBeInTheDocument()
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
    // A waiting proposal still earns its aging line from a real elapsed time.
    renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
    }))
    expect(screen.getByText('Unresolved for')).toBeInTheDocument()
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
      chips: [{ label: 'Ticker', value: 'CLOV' }, { label: 'Open', value: '62d' }],
    }), { featured: true })
    expect(container.querySelector('[data-archetype]')).not.toBeNull()
    const classes = [...container.querySelectorAll('div')].map(d => d.className).join(' ')
    expect(classes).toMatch(/grid-cols-\[minmax/)
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
