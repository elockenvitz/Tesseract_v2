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
  render(
    <TodayTile item={adaptDecisionItem(d)} rank={1} {...handlers} {...props} />,
  )
  return handlers
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
    const primary = screen.getByRole('button', { name: /Update Thesis/ })
    // Filled, not an outline or a text link — the one visually dominant verb.
    expect(primary.className).toMatch(/bg-blue-700/)
    expect(screen.getByRole('button', { name: /Ask AI/ }).className).not.toMatch(/bg-blue-700/)
  })

  it('runs the primary action through the engine CTA it was given', () => {
    const h = renderTile()
    fireEvent.click(screen.getByRole('button', { name: /Update Thesis/ }))
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

  it('opens Discuss against the same target, never routed to AI', () => {
    renderTile()
    fireEvent.click(screen.getByRole('button', { name: /^Discuss$/ }))
    expect(requests[0].mode).toBe('discuss')
    expect(requests[0].target.objectId).toBe('a-amzn')
  })

  it('hides Discuss when the object cannot hold a thread', () => {
    // No object at all — nothing to attach a conversation to.
    renderTile(decision({ context: {} }))
    expect(screen.queryByRole('button', { name: /^Discuss$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ask AI/ })).not.toBeInTheDocument()
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

  it('offers shared Defer only where the object really supports it', () => {
    renderTile(decision({
      titleKey: 'PROPOSAL_AWAITING_DECISION',
      context: { assetId: 'a-amzn', assetTicker: 'AMZN', tradeIdeaId: 'tq-1' },
    }))
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    expect(screen.getByText('Defer the item')).toBeInTheDocument()
  })

  it('snoozes for the chosen duration, and never calls it Defer', () => {
    const h = renderTile()
    fireEvent.click(screen.getByRole('button', { name: /More actions/ }))
    fireEvent.click(screen.getByText('Snooze 3 days'))
    expect(h.onSnooze).toHaveBeenCalledWith(expect.anything(), 72)
  })

  it('renders the archetype the problem calls for', () => {
    renderTile()
    expect(screen.getByText('Evidence recency')).toBeInTheDocument()
  })

  it('degrades to typography rather than a decorative chart', () => {
    renderTile(decision({ chips: [{ label: 'Ticker', value: 'AMZN' }] }))
    expect(screen.getByText(/No chartable measure on this finding/)).toBeInTheDocument()
  })
})
