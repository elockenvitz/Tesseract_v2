/**
 * The picture is bounded and weighted, never stretched.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * Every size in `ExploreVisual` was chosen against a 178px phone cell, and
 * the desktop gallery renders the same markup at 421px on a narrow tile and
 * 881px on a wide one. A track is a percentage width with a FIXED height, so
 * it does not get bigger when the card does -- it gets thinner-looking.
 *
 * Measured live at 1920x889 on AMZN's scenario card, before:
 *
 *   the modelled band     524 x 6px     -- 87:1
 *   its two labels        810px apart, one in each bottom corner
 *   the picture           64px tall, top-aligned in a 172px panel box
 *                         -- 108px of void, 63% of the box, all below it
 *
 * ── What is asserted here, and what is not ────────────────────────────────
 *
 * GEOMETRY is not, and cannot be: jsdom performs no layout, so every
 * `getBoundingClientRect` here reads 0. The pixel results were measured in
 * the running app -- see the commit that introduced this file. What is
 * asserted is the two things the measurement depends on and that a later
 * edit could silently undo:
 *
 *   the phone is untouched   `card` is the default and must stay exactly
 *                            what shipped, class for class. Scaling the
 *                            desktop by editing the shared numbers would
 *                            pass any test that only checked the desktop.
 *
 *   the rule, not a number   every archetype is bounded at tile density and
 *                            none of them keeps a root margin, asserted
 *                            across the whole set rather than on the one
 *                            archetype that prompted the change.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { ExploreVisualBlock } from '../ExploreVisual'
import type { ExploreVisual } from '../../../lib/mobile/explore-visual'

/** One of every archetype that draws something, with the data it needs. */
const EVERY: ExploreVisual[] = [
  { kind: 'scenario_range', low: 120, high: 180, current: 249, breachedLabel: 'Bull', cases: [{ label: 'Bear', price: 120 }, { label: 'Bull', price: 180 }] },
  { kind: 'target_compare', current: 210, target: 260 },
  { kind: 'target_compare', current: 210, target: null },
  { kind: 'timeline', statedAt: '2025-01-01T00:00:00Z', dueAt: '2025-06-01T00:00:00Z' },
  { kind: 'timeline', statedAt: '2025-01-01T00:00:00Z', dueAt: null },
  { kind: 'exposure', weightPct: 3.4, portfolioName: 'Core Equity' },
  { kind: 'comparison', rows: [{ label: 'Position', pct: 3.4 }, { label: 'Index', pct: 1.1 }], deltaLabel: '+2.3 pts active' },
  { kind: 'last_look', movePct: 29, lastLookAt: '2025-03-01T00:00:00Z' },
  { kind: 'workflow', stages: ['Idea', 'Model', 'Decide', 'Done'], activeIndex: 1 },
  { kind: 'quote', text: 'People want cheap food.' },
  { kind: 'question', text: 'What best describes this position?' },
]

const NOW = Date.UTC(2026, 0, 1)

const draw = (visual: ExploreVisual, density?: 'card' | 'tile') => {
  const { container } = render(<ExploreVisualBlock visual={visual} now={NOW} density={density} />)
  const root = container.querySelector('[data-explore-visual]')
  if (!root) throw new Error(`${visual.kind} drew nothing`)
  return { container, root }
}

describe('the phone is the default, and is left exactly as it shipped', () => {
  it.each(EVERY.map(v => [v.kind, v] as const))('%s keeps its own root margin', (_kind, v) => {
    /* On a phone the picture follows prose directly and owns the gap. The
       desktop container supplies that gap itself, which is why the margin
       moves -- and why removing it from the phone would close a gap nobody
       asked to close. */
    const { root } = draw(v)
    expect(root.className).toContain('mt-2')
  })

  it.each([
    ['scenario_range', EVERY[0], '[data-scenario-band]', 'h-1.5'],
    ['exposure', EVERY[5], '.rounded-full.overflow-hidden, .overflow-hidden.rounded-full', 'h-2'],
    ['timeline', EVERY[4], '[data-timeline-elapsed]', 'h-full'],
  ] as const)('%s keeps its phone track weight', (_k, v, sel, weight) => {
    const { root } = draw(v as ExploreVisual)
    const el = root.matches(sel) ? root : root.querySelector(sel)
    expect(el).toBeTruthy()
    expect((el as Element).className).toContain(weight)
  })

  it('is never bounded, because the cap is wider than a phone cell', () => {
    /* 520px against a 178px cell: a wrapper here would be a div that does
       nothing, on sixty cards. */
    for (const v of EVERY) {
      const { container } = draw(v)
      expect(container.querySelector('[class*="max-w-[520px]"]')).toBeNull()
    }
  })
})

describe('a gallery tile bounds the picture and gives it weight', () => {
  it.each(EVERY.map(v => [v.kind, v] as const))('%s is capped at the measure', (_kind, v) => {
    /* Asserted on every archetype rather than on the one that prompted this.
       A new archetype that reached for the full width of a 923px tile would
       be the same defect again, and this is the only case that would catch
       it. */
    const { container } = draw(v, 'tile')
    expect(container.querySelector('[class*="max-w-[520px]"]')).toBeTruthy()
  })

  it.each(EVERY.map(v => [v.kind, v] as const))('%s leaves the gap to its container', (_kind, v) => {
    /* The container above already spaces the picture from the prose. Two
       margins stacked is the 8px the narrow tiles were carrying, and at the
       panel box it was the margin that collapsed THROUGH the box and moved
       the grid when a carousel paged. */
    const { root } = draw(v, 'tile')
    expect(root.className).not.toMatch(/(^|\s)mt-/)
  })

  it.each([
    ['scenario_range', EVERY[0], '[data-scenario-band]', 'h-1.5', 'h-2.5'],
    ['scenario_range marker', EVERY[0], '[data-scenario-current]', 'h-3', 'h-3.5'],
    ['workflow rail', EVERY[8], '[data-workflow-stage="Idea"]', 'h-1', 'h-1.5'],
  ] as const)('%s is thicker than the phone draws it', (_k, v, sel, phone, tile) => {
    const el = draw(v as ExploreVisual, 'tile').root.querySelector(sel)
    expect(el).toBeTruthy()
    expect((el as Element).className).toContain(tile)
    expect((el as Element).className).not.toContain(` ${phone} `)
  })
})

describe('the one picture that is not bounded', () => {
  it('leaves a plotted series its full width', () => {
    /*
     * `price_trend` hands back whatever the caller injected, and a series is
     * the one picture that genuinely reads better the wider it gets --
     * resolution on the x axis is the information. Capping a chart at 520px
     * would be the opposite of this rule rather than an instance of it.
     */
    const { container } = render(
      <ExploreVisualBlock
        visual={{ kind: 'price_trend' }}
        density="tile"
        sparkline={<svg data-testid="plot" />}
      />,
    )
    expect(container.querySelector('[data-testid="plot"]')).toBeTruthy()
    expect(container.querySelector('[class*="max-w-[520px]"]')).toBeNull()
  })

  it('still draws nothing when no series was injected', () => {
    const { container } = render(<ExploreVisualBlock visual={{ kind: 'price_trend' }} density="tile" />)
    expect(container.innerHTML).toBe('')
  })
})
