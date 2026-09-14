/**
 * The pilot's locked Trade Book and Outcomes previews at 390px.
 *
 * They were desktop compositions: `p-8`, a three-column card grid that cut
 * the cards off at 390px, and a root with no scroller inside a shell wrapper
 * that is `overflow-hidden` for both tabs. jsdom does not lay out, so these
 * assert the classes that decide it: phone values unprefixed or `max-md:`,
 * and every desktop value still in force from `md:` up.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'

vi.mock('../../../hooks/usePilotMode', () => ({
  usePilotMode: () => ({ isLoading: false, isPilot: true, hasCommittedTutorialTrade: false }),
}))
vi.mock('../../../hooks/usePilotProgress', () => ({
  usePilotProgress: () => ({ hasUnlockedTradeBook: false, hasUnlockedOutcomes: false, mark: vi.fn() }),
}))

import { PilotTradeBookPreview } from '../PilotTradeBookPreview'
import { PilotOutcomesPreview } from '../PilotOutcomesPreview'

afterEach(cleanup)

describe('the lock copy names the lineage', () => {
  it('Trade Book opens after the pilot idea is committed, and its decision lands there', () => {
    const text = render(<PilotTradeBookPreview onGoToTradeLab={vi.fn()} />).container.textContent ?? ''
    expect(text).toContain("This opens after you commit the idea you're working through in the pilot")
    expect(text).toContain('That decision lands here')
    expect(text).toContain("Example recommendations in the Decision Inbox don't open it")
  })

  it('Outcomes opens after the pilot idea reaches Trade Book, not after any trade', () => {
    const text = render(<PilotOutcomesPreview onGoToTradeLab={vi.fn()} />).container.textContent ?? ''
    expect(text).toContain('This opens after your pilot idea is committed and reaches Trade Book')
    expect(text).toContain("A trade on any other idea doesn't count")
  })
})

const classes = (el: Element | null) => new Set((el?.getAttribute('class') ?? '').split(/\s+/))

describe.each([
  ['Trade Book', PilotTradeBookPreview, [
    'Decision rationale', 'Sizing derivation', 'Portfolio context',
    'Decision traceability', 'Pro-forma lifecycle', 'Audit trail',
  ]],
  ['Outcomes', PilotOutcomesPreview, [
    'Thesis preservation', 'Price-target evaluation', 'Analyst scorecards',
    'Post-mortem flow', 'Decision accountability', 'Historical dataset',
  ]],
])('%s locked preview', (_name, Preview, titles) => {
  const mount = () => render(<Preview onGoToTradeLab={vi.fn()} />).container

  it('stacks the cards in one column on a phone and keeps three columns from md', () => {
    const grid = mount().querySelector('[data-slot="pilot-preview-cards"]')
    const c = classes(grid)
    expect(c.has('grid-cols-1')).toBe(true)
    expect(c.has('md:grid-cols-3')).toBe(true)
    // No unprefixed three-column grid left to overflow a phone.
    expect(c.has('grid-cols-3')).toBe(false)
  })

  it('scrolls itself on a phone, inside the shell’s overflow-hidden wrapper', () => {
    const c = classes(mount().querySelector('[data-slot="pilot-locked-preview"]'))
    expect(c.has('max-md:h-full')).toBe(true)
    expect(c.has('max-md:overflow-y-auto')).toBe(true)
  })

  it('uses phone padding, and restores the desktop padding and spacing from md', () => {
    const c = classes(mount().querySelector('[data-slot="pilot-locked-preview"]'))
    expect(c.has('px-4')).toBe(true)
    expect(c.has('p-8')).toBe(false)
    expect(c.has('md:p-8')).toBe(true)
    expect(c.has('md:space-y-6')).toBe(true)
    expect(c.has('max-w-4xl')).toBe(true)
  })

  it('gives the CTA the full width and a 44px target on a phone only', () => {
    const cta = Array.from(mount().querySelectorAll('button')).find(b => b.textContent?.includes('Go to Trade Lab'))!
    const c = classes(cta)
    expect(c.has('max-md:w-full')).toBe(true)
    expect(c.has('max-md:h-11')).toBe(true)
    expect(c.has('w-full')).toBe(false)
  })

  it('says it opens on the pilot idea, not on any trade', () => {
    const text = mount().textContent ?? ''
    expect(text).toMatch(/pilot idea|idea you're working through in the pilot/)
    expect(text).not.toContain('first accepted simulation')
    expect(text).not.toContain('first committed trade')
  })

  it('keeps every explanatory card', () => {
    const text = mount().textContent ?? ''
    for (const t of titles) expect(text).toContain(t)
    expect(text).toContain('Go to Trade Lab')
  })
})
