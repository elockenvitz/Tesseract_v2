import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { WorkDeck } from '../WorkDeck'
import type { RailCard } from '../../../lib/dashboard/focus'

/**
 * The way back out of a workspace must not scroll away with the work.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Clicking a Today tile opens the work deck: a left rail holding the rest of
 * the findings, and the chosen one expanded beside it. The "← Today" control
 * was the first child INSIDE the rail's own scroller, so the further a reader
 * got through the other work, the further the exit receded.
 *
 * Measured on the live Dashboard at 1920 with thirteen findings: the rail had
 * 1076px of scroll, and at the bottom of it the back button's lower edge sat
 * 1034px ABOVE the rail's top edge — entirely off the pane. The only way back
 * to the Dashboard was to scroll a list of other work to its top first.
 *
 * ── What these cases can and cannot see ──────────────────────────────────
 *
 * jsdom computes no layout and compiles no Tailwind, so "did it scroll out of
 * view" is not observable here and a test that claimed to measure it would be
 * decoration. The property that IS observable, and that is the actual defect,
 * is STRUCTURAL: between the back button and the rail there must be no
 * element that scrolls. That is what moved, and moving it back is what would
 * re-open this.
 */

const SCROLLS = /\boverflow(-y)?-(auto|scroll)\b/

function card(id: string, symbol: string): RailCard {
  return {
    id,
    workspaceLens: 'research',
    objectType: 'asset',
    symbol,
    reason: 'Thesis may be stale',
    figure: '342d',
    figureLabel: 'since update',
  } as RailCard
}

function renderDeck(peers = 12) {
  const rail = [
    card('active', 'AMZN'),
    ...Array.from({ length: peers }, (_, i) => card(`p${i}`, `T${i}`)),
  ]
  const onBack = vi.fn()
  render(
    <WorkDeck
      backLabel="Today"
      onBack={onBack}
      rail={rail}
      activeId="active"
      onRotate={() => {}}
    >
      <div data-testid="surface" />
    </WorkDeck>,
  )
  return { onBack }
}

/** Every ancestor of `el` up to and including `stop`. */
function ancestorsTo(el: Element, stop: Element): Element[] {
  const out: Element[] = []
  let n: Element | null = el.parentElement
  while (n && n !== stop.parentElement) { out.push(n); n = n.parentElement }
  return out
}

describe('the rail keeps its exit', () => {
  it('puts nothing that scrolls between the back control and the rail', () => {
    renderDeck()
    const rail = screen.getByTestId('work-rail')
    const back = screen.getByTestId('workspace-back')
    expect(rail.contains(back)).toBe(true)

    const scrolling = ancestorsTo(back, rail)
      .filter(n => SCROLLS.test(n.className))
      .map(n => n.className)
    expect(scrolling).toEqual([])
  })

  it('still scrolls the work itself, in its own container', () => {
    // The fix must not be "nothing scrolls" — thirteen findings do not fit.
    renderDeck()
    const list = screen.getByTestId('work-rail-list')
    expect(SCROLLS.test(list.className)).toBe(true)
    expect(list.contains(screen.getByTestId('workspace-back'))).toBe(false)
  })

  it('holds the control at a fixed height whatever the rail holds', () => {
    // A `shrink-0` sibling of the scroller, not a row competing for space
    // with twelve tiles.
    renderDeck()
    const back = screen.getByTestId('workspace-back')
    const header = back.parentElement!
    expect(header.className).toContain('shrink-0')
    expect(screen.getByTestId('work-rail').className).toContain('flex-col')
  })

  it('separates the pinned control from the work sliding under it', () => {
    // Without a rule, a tile scrolling up meets the exit with nothing
    // between them and the pane looks broken rather than pinned.
    renderDeck()
    expect(screen.getByTestId('workspace-back').parentElement!.className)
      .toMatch(/\bborder-b\b/)
  })

  it('is the control that actually leaves, not a lookalike', () => {
    const { onBack } = renderDeck()
    screen.getByTestId('workspace-back').click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('reaches the exit even when there is no other work to list', () => {
    renderDeck(0)
    expect(screen.getByTestId('workspace-back')).toHaveTextContent('Today')
  })
})
