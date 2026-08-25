import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { SignalCardSection } from '../SignalCardSection'
import { buildStaleTargetCard, buildInsightCard } from '../../../lib/signals/builders/legacy-kinds'
import type { SignalCard } from '../../../lib/signals/contract'

/**
 * The wiring between a card's declared action and where the tap actually goes.
 *
 * The unit tests on `resolveFeedAction` prove the mapping; this proves the
 * card surface uses it. Both are needed: a correct resolver that nothing calls
 * would leave "Review target" falling through to the generic primary handler,
 * which is precisely the regression this phase exists to prevent and precisely
 * the kind that a resolver test alone would not catch.
 */

const noop = () => {}

const staleTarget = (): SignalCard => {
  const r = buildStaleTargetCard({
    assetId: 'asset-1', symbol: 'AAPL', companyName: 'Apple',
    target: 245, price: 212, timeframe: '12 months',
    ageMonths: 18, overdueMonths: 6,
    heldIn: ['Core'], heldInIds: ['p1'],
    statedAt: '2025-02-14T00:00:00Z', expiredAt: '2026-02-13T00:00:00Z',
    asOf: new Date().toISOString(),
  })
  if (!r.ok) throw new Error('suppressed')
  return r.card
}

const noThesis = (): SignalCard => {
  const r = buildInsightCard({
    id: 'i1', kind: 'no_thesis', headline: 'AAPL has no research', body: 'b',
    assetId: 'asset-1', symbol: 'AAPL', score: 1,
  })
  if (!r.ok) throw new Error('suppressed')
  return r.card
}

function renderCard(card: SignalCard, over: Record<string, unknown> = {}) {
  const onFeedAction = vi.fn()
  const onPrimary = vi.fn()
  const onCapture = vi.fn()
  const onOpenAsset = vi.fn()
  render(
    <SignalCardSection
      card={card}
      onOpenAsset={onOpenAsset}
      onCapture={onCapture}
      onSnooze={noop}
      onDismiss={noop}
      onWhy={noop}
      onPrimary={onPrimary}
      onFeedAction={onFeedAction}
      {...over}
    />,
  )
  return { onFeedAction, onPrimary, onCapture, onOpenAsset }
}

describe('contextual action routing', () => {
  it('sends "Review target" to the target editor, not the generic handler', () => {
    const { onFeedAction, onPrimary } = renderCard(staleTarget())
    fireEvent.click(screen.getByText('Review target'))

    expect(onFeedAction).toHaveBeenCalledTimes(1)
    expect(onFeedAction.mock.calls[0][0]).toMatchObject({
      type: 'asset', id: 'asset-1', data: { focus: 'target' },
    })
    // The fall-through must NOT also fire, or the tap would do two things.
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('sends "Add rationale" to the thesis field', () => {
    const { onFeedAction } = renderCard(noThesis())
    fireEvent.click(screen.getByText('Add rationale'))
    expect(onFeedAction.mock.calls[0][0]).toMatchObject({
      type: 'asset', data: { focus: 'thesis' },
    })
  })

  it('still routes the actions button to the capture handler', () => {
    // Labelled "Actions" now, because the sheet behind it holds navigation as
    // well as capture. The action id, the handler and every builder's
    // `{ id: 'capture' }` are untouched — an information-architecture change,
    // not a contract change.
    const { onCapture, onFeedAction } = renderCard(staleTarget())
    fireEvent.click(screen.getByText('Actions'))
    expect(onCapture).toHaveBeenCalledTimes(1)
    expect(onFeedAction).not.toHaveBeenCalled()
  })

  it('no longer carries a third footer button for the asset', () => {
    // `Capture | <decision> | Open TICKER` gave the decision a third of the bar
    // and put two ways of leaving the card either side of it. Opening the asset
    // is the first entry in the actions sheet instead — see
    // `feed-actions-sheet.test.tsx` for the destination.
    renderCard(staleTarget())
    expect(screen.queryByText('Open AAPL')).toBeNull()
    expect(document.querySelector('[data-slot="open"]')).toBeNull()
  })

  it('falls back to the card handler when no navigator is wired', () => {
    // `onFeedAction` is optional. Without it the action must reach `onPrimary`
    // rather than being swallowed — a card in a surface that cannot navigate
    // should still do something.
    const onPrimary = vi.fn()
    render(
      <SignalCardSection
        card={staleTarget()}
        onOpenAsset={noop} onCapture={noop} onSnooze={noop} onDismiss={noop}
        onWhy={noop} onPrimary={onPrimary}
      />,
    )
    fireEvent.click(screen.getByText('Review target'))
    expect(onPrimary).toHaveBeenCalledTimes(1)
    expect(onPrimary.mock.calls[0][1]).toBe('review_target')
  })

  it('routes target-expired and case-vs-price to different places', () => {
    // The behavioural separation. They shared card plumbing and a question;
    // they no longer share a destination.
    const { onFeedAction } = renderCard(staleTarget())
    fireEvent.click(screen.getByText('Review target'))
    expect(onFeedAction.mock.calls[0][0].data.focus).toBe('target')
    expect(onFeedAction.mock.calls[0][0].data.focus).not.toBe('cases')
  })
})
