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
  it('anchors "more" to the paragraph, not to the card', () => {
    /**
     * `[data-slot="body-more"]` is `absolute bottom-0 right-0`. Its nearest
     * positioned ancestor decides where that lands, and there was none between
     * it and the `<article>` — so on every card with a long body the affordance
     * rendered at the bottom-right corner of the whole card, underneath the
     * sticky action bar, which paints over it because it comes later in the
     * DOM. The ellipsis said there was more to read and the control to read it
     * was invisible.
     *
     * jsdom applies no Tailwind CSS, so this asserts the structural fact the
     * layout depends on: the wrapper is a positioning context.
     */
    const { container } = render(
      <SignalCardView
        card={{ ...CARD, body: 'A body long enough to clamp. '.repeat(20) }}
        onAction={noop}
      />,
    )
    // Matched on the region, not on the paragraph's class: supporting prose is
    // `truncate` and primary prose `line-clamp-2` (see `bodyIsPrimaryProse`),
    // so no one class spans both. This test is about the positioning context,
    // which is the same either way — and `data-slot="body-toggle"` is not
    // usable here because it depends on a measured overflow that jsdom, having
    // no layout, never reports.
    const wrapper = container.querySelector('[data-slot="body-region"]')!

    expect(wrapper.className).toContain('relative')
    // And it really is the nearest one — an ancestor gaining `relative` later
    // would silently move the affordance again.
    expect(wrapper.parentElement!.className).not.toContain('relative')
  })
})
