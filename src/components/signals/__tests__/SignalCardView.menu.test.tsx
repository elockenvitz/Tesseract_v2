import { describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'

import { SignalCardView } from '../SignalCardView'
import { buildActiveRiskCard } from '../../../lib/signals/builders/activeRisk'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'

/**
 * The overflow menu, and the two controls in it that did nothing.
 *
 * `builders/shared` has put Snooze, Dismiss and "Why am I seeing this" on every
 * card since the contract existed, and until this branch all three were inert
 * on the mobile feed. Two of them are now wired; the third was deleted, because
 * the panel directly above it already prints the answer.
 */

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

const CARD = unwrap(buildActiveRiskCard({
  assetId: 'a1', symbol: 'MSFT', companyName: 'Microsoft',
  weightPct: 6.2, benchmarkWeightPct: 3.1,
  portfolioId: 'p1', portfolioName: 'Core Equity',
  asOf: '2026-07-31T00:00:00.000Z',
}))

const noop = () => {}

function openMenu(card: SignalCard, onAction: (id: string, c: SignalCard) => void = noop) {
  const { container } = render(<SignalCardView card={card} onAction={onAction} />)
  fireEvent.click(container.querySelector('[data-slot="menu"]')!)
  return container
}

describe('the overflow menu', () => {
  it('still offers snooze and dismiss, and reports them by id', () => {
    const fired: string[] = []
    const container = openMenu(CARD, id => fired.push(id))

    const labels = [...container.querySelectorAll('[data-slot="menu-item"]')]
      .map(el => el.textContent?.trim())
    expect(labels).toContain('Snooze for a week')
    expect(labels).toContain('Dismiss')

    const dismiss = [...container.querySelectorAll('[data-slot="menu-item"]')]
      .find(el => el.textContent?.trim() === 'Dismiss')!
    fireEvent.click(dismiss)
    expect(fired).toEqual(['dismiss'])
  })

  it('does not offer a button that asks the question printed above it', () => {
    /**
     * The panel renders `provenance.reason` under a "Why this surfaced"
     * heading, and the builder's menu then carried "Why am I seeing this" a few
     * pixels below — a control whose answer was already on screen, and which
     * every call site wired to a no-op.
     *
     * Asserted on the rendered menu rather than on the contract: the action
     * stays in the grammar for surfaces that show the reason some other way.
     */
    const container = openMenu(CARD)

    expect(container.querySelector('[data-slot="menu-reason"]')?.textContent)
      .toContain('MSFT')

    const labels = [...container.querySelectorAll('[data-slot="menu-item"]')]
      .map(el => el.textContent?.trim())
    expect(labels).not.toContain('Why am I seeing this')
  })

  it('keeps the action in the contract, so another surface can still route it', () => {
    expect(CARD.actions.menu.map(a => a.id)).toContain('why')
  })
})

describe('the body disclosure', () => {
  it('puts the way deeper in the column, not floated over the card', () => {
    /**
     * What this replaces, and why the rule outlived the element.
     *
     * `body-more` was `absolute bottom-0 right-0`, and its nearest positioned
     * ancestor decided where that landed — with none between it and the
     * `<article>` it rendered at the bottom-right of the whole card, under the
     * sticky action bar. The ellipsis said there was more to read and the
     * control to read it was invisible. The fix at the time was to make the
     * paragraph's wrapper a positioning context.
     *
     * The affordance is a real row in the content column now, so no ancestor
     * can misplace it. That is the same defect closed structurally rather than
     * by pinning a `relative` somewhere and hoping it stays.
     */
    const { container } = render(
      <SignalCardView
        card={{ ...CARD, body: 'A body long enough to clamp. '.repeat(20) }}
        onAction={noop}
      />,
    )
    const way = container.querySelector('[data-slot="context-open"]') as HTMLElement
    expect(way).toBeTruthy()
    expect(way.className).not.toContain('absolute')
    // And it is outside the action bar: inspection is not an action.
    expect(way.closest('[data-slot="actions"]')).toBeNull()
  })
})
