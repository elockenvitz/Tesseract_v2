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
import { render, fireEvent } from '@testing-library/react'
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

/*
 * ── The picture takes the room the tile was stretched to ──────────────────
 *
 * The grid stretches a tile to its row again, so the card is as tall as its
 * tallest neighbour. `fill` is what stops that height being void: the
 * archetypes that can use it say so, and the scenario axis stops being
 * bounded because its labels moved onto their own marks.
 *
 * Measured in the running app at 1920x889, first row: 418 / 303 / 303 before,
 * 418 / 418 / 418 after with `maxSpread` 0 across all sixteen rows, and the
 * range picture 881px wide where it had been 520 in an 881px box.
 *
 * jsdom still performs no layout, so what is asserted is the markup those
 * measurements depend on.
 */
const fillDraw = (visual: ExploreVisual) => {
  const { container } = render(
    <ExploreVisualBlock visual={visual} now={NOW} density="tile" fill />,
  )
  const root = container.querySelector('[data-explore-visual]')
  if (!root) throw new Error(`${visual.kind} drew nothing`)
  return { container, root }
}

describe('a filling tile', () => {
  it('lets the scenario axis off the measure, and nothing else', () => {
    /* The cap exists to keep a LABEL PAIR readable. This archetype no longer
       has one -- each case names itself under its own tick -- so width now
       separates the cases instead of being spent on void. Every other kind
       keeps its two-ended row and keeps the cap with it. */
    expect(fillDraw(EVERY[0]).container.querySelector('[class*="max-w-[520px]"]')).toBeNull()
    for (const v of EVERY.slice(1)) {
      expect(fillDraw(v).container.querySelector('[class*="max-w-[520px]"]')).toBeTruthy()
    }
  })

  it('thickens the band past what a bounded tile draws', () => {
    const band = fillDraw(EVERY[0]).root.querySelector('[data-scenario-band]')
    expect(band?.className).toContain('h-[34%]')
    /* A floor and a ceiling, so a phone-sized box keeps its shape and a very
       tall tile gets a thicker bar rather than a slab. */
    expect(band?.className).toContain('min-h-[10px]')
    expect(band?.className).toContain('max-h-[22px]')
  })

  it('names every mark under its own position', () => {
    const labels = [...fillDraw(EVERY[0]).root.querySelectorAll('[data-scenario-label]')]
    expect(labels.map(l => l.getAttribute('data-scenario-label')))
      .toEqual(['Bear', 'Bull', 'current'])
    /* Positioned, not laid out in a row: that is what uses the width. */
    for (const l of labels) expect((l as HTMLElement).style.left).toMatch(/%$/)
  })

  it('writes every price in the row the same way', () => {
    /* `money` keeps cents below $100 and drops them above, which nobody saw
       while the two labels sat in opposite corners. Under their own marks
       they are a row, and AMZN read "BEAR $90.00 · BASE $120 · BULL $180". */
    const mixed: ExploreVisual = {
      kind: 'scenario_range', low: 90, high: 180, current: 255,
      cases: [{ label: 'Bear', price: 90 }, { label: 'Bull', price: 180 }],
    }
    const text = [...fillDraw(mixed).root.querySelectorAll('[data-scenario-label]')]
      .map(l => l.textContent)
    expect(text).toEqual(['Bear $90', 'Bull $180', '$255'])

    /* And still cents where every mark is under $100, or this "fix" would
       round a penny stock's whole range to the same dollar. */
    const penny: ExploreVisual = {
      kind: 'scenario_range', low: 2.5, high: 4, current: 3.25,
      cases: [{ label: 'Bear', price: 2.5 }],
    }
    expect([...fillDraw(penny).root.querySelectorAll('[data-scenario-label]')]
      .map(l => l.textContent)).toEqual(['Bear $2.50', '$3.25'])
  })

  it('shows the lines that fit instead of a fixed count of them', () => {
    for (const [v, clamp] of [[EVERY[9], 'line-clamp-4'], [EVERY[10], 'line-clamp-3']] as const) {
      const p = fillDraw(v).root.querySelector('p')
      expect(p?.className).not.toContain(clamp)
      expect(p?.className).toContain('flex-1')
    }
  })
})

describe('the scenario axis answers when asked, and only on a desktop', () => {
  it('gives every mark a press target and a name', () => {
    const { root } = fillDraw(EVERY[0])
    const marks = [...root.querySelectorAll('button[data-scenario-mark]')]
    expect(marks.map(m => m.getAttribute('aria-label')))
      .toEqual(['Bear $120', 'Bull $180', 'Last price $249'])
    /* The hit area is the button; the 1px tick it wraps is the picture. A
       1px press target is not one. */
    expect(marks[0].querySelector('[data-scenario-case="Bear"]')).toBeTruthy()
  })

  it('reports the mark the reader is pointing at', () => {
    const { root } = fillDraw(EVERY[0])
    const bear = root.querySelector('button[aria-label="Bear $120"]')!
    fireEvent.mouseEnter(bear)
    expect(root.textContent).toContain('$120')
    /* Distance from the last price, which is the question a case prompts. */
    expect(root.textContent).toContain('+108% vs last')
    fireEvent.mouseLeave(bear)
    expect(root.textContent).not.toContain('+108% vs last')
  })

  it('answers the keyboard the same way', () => {
    const { root } = fillDraw(EVERY[0])
    const bull = root.querySelector('button[aria-label="Bull $180"]')!
    fireEvent.focus(bull)
    expect(root.textContent).toContain('$180')
    fireEvent.blur(bull)
    expect(root.textContent).not.toContain('+38% vs last')
  })

  it('holds the readout row open so pointing never moves the card', () => {
    /*
     * The trap this change set for itself. A card INSIDE its range has no
     * deviation to lead with, so the readout row was absent -- and the first
     * hover inserted a row, pushing the axis down under the cursor. Caught
     * live, not here: jsdom has no layout. What is pinned is the reservation.
     */
    const inside: ExploreVisual = {
      kind: 'scenario_range', low: 120, high: 180, current: 150,
      cases: [{ label: 'Bear', price: 120 }, { label: 'Bull', price: 180 }],
    }
    const { root } = fillDraw(inside)
    const slot = root.firstElementChild as HTMLElement
    expect(slot.textContent).toBe('')
    expect(slot.style.minHeight).toBe('20px')
  })

  it('does not claim a breach on a price that is inside the range', () => {
    /*
     * Found by the test above, not by review. `deviation` is computed against
     * `low` whenever the price is not above `high`, so it is a positive
     * number for an in-range card and says "below your range" about a price
     * that is nowhere near it. The outer `outside &&` used to hide that, and
     * holding the row open for hover removed the gate without replacing it.
     */
    const inside: ExploreVisual = {
      kind: 'scenario_range', low: 120, high: 180, current: 150,
      cases: [{ label: 'Bear', price: 120 }],
    }
    expect(fillDraw(inside).root.querySelector('[data-scenario-deviation]')).toBeNull()
    /* Still drawn where it IS a breach, or this test passes by drawing
       nothing at all. */
    expect(fillDraw(EVERY[0]).root.querySelector('[data-scenario-deviation]')).toBeTruthy()
  })

  it('leaves the phone inert, because a card there is one tap target', () => {
    /* `card` density keeps no handlers at all: a child that captures a drag
       competes with the grid's own scroll. The flag that opens this is the
       density, never `fill`. */
    const { root } = draw(EVERY[0])
    expect(root.querySelectorAll('button')).toHaveLength(0)
    expect(root.querySelector('[data-scenario-current]')).toBeTruthy()
  })
})
