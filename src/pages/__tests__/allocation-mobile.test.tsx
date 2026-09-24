/**
 * Allocation on a phone.
 *
 * The surface is a 900px matrix of asset class × five conviction views, and
 * its horizontal scroller is deliberate — five columns that must stay
 * inspectable do not become cards. So these do not test that the matrix fits;
 * they test that everything around it does, and that panning it still tells
 * you which row you are reading.
 *
 * The defects were: the legend that decodes the abbreviated column headers
 * was the one element running off screen, the name column scrolled away with
 * the data, the header row did not wrap, and every cell was a bare `div` with
 * an onClick — no touch target, no keyboard.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const raw = readFileSync(resolve(process.cwd(), 'src/pages/AssetAllocationPage.tsx'), 'utf8')

/**
 * Comments stripped. A comment explaining a fix names the classes the fix
 * adds, so matching the raw file lets the prose satisfy the test.
 */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

const classesWith = (...fragments: string[]) =>
  new RegExp(`'[^']*${fragments.join("[^']*")}[^']*'|"[^"]*${fragments.join('[^"]*')}[^"]*"`)

describe('the matrix stays inspectable while it scrolls', () => {
  it('keeps the deliberate scroller rather than turning the matrix into cards', () => {
    // Five conviction columns need to stay comparable; the visible scrollbar
    // is what says there is more to the right.
    expect(src).toMatch(/mobile-scroll-x show-scrollbar/)
    expect(src).toMatch(/min-w-\[900px\]/)
  })

  it('freezes the asset class name so a panned row still identifies itself', () => {
    // Only ~43% of the matrix is visible at 390px. Reaching Strong Overweight
    // used to scroll the name off screen entirely.
    expect(src).toMatch(classesWith('sticky left-0 z-10', 'bg-white'))
    expect(src).toMatch(classesWith('sticky left-0 z-20'))
  })

  it('does not change the conviction columns or their order', () => {
    // The model is out of scope for a compatibility pass.
    const keys = src.match(/key: '(strong_underweight|underweight|market_weight|overweight|strong_overweight)'/g) ?? []
    expect(keys).toHaveLength(5)
  })
})

describe('the chrome around the matrix fits 390px', () => {
  it('wraps the legend that decodes the abbreviated headers', () => {
    // Five full labels at gap-8 ≈ 700px, outside the matrix's scroller, with
    // the page scrollbar hidden on a phone: neither visible nor reachable.
    expect(src).toMatch(classesWith('flex flex-wrap items-center justify-center', 'sm:gap-8'))
    expect(src).not.toMatch(/className="mt-6 flex items-center justify-center gap-8"/)
  })

  it('names both the short and full form in the legend', () => {
    // Below 1024px the header shows `S-UW`; the legend is the only key.
    expect(src).toMatch(/col\.shortLabel/)
    expect(src).toMatch(/col\.label/)
  })

  it('wraps the page header instead of pushing New Period off the edge', () => {
    expect(src).toMatch(classesWith('flex flex-wrap items-center justify-between', 'gap-y-3'))
  })

  it('stacks the period date fields on a phone', () => {
    expect(src).not.toMatch(/className="grid grid-cols-2 gap-4"/)
    expect(src).toMatch(classesWith('grid-cols-1 gap-4', 'sm:grid-cols-2'))
  })
})

describe('the one write on the page is reachable and honest', () => {
  it('makes a cell a real control, not a div with a click handler', () => {
    // The 44px coarse-pointer floor is scoped to buttons and roles, so a bare
    // div got none of it — and there was no keyboard path to the only write.
    expect(src).toMatch(/role="button"/)
    expect(src).toMatch(/tabIndex=\{0\}/)
    expect(src).toMatch(/onKeyDown/)
    expect(src).toMatch(/aria-pressed=\{isCurrentView\}/)
  })

  it('keeps the write writable on a phone', () => {
    // Setting a view is a tap and a button — no drag, no precision — so it is
    // not gated behind a desktop-only notice.
    expect(src).toMatch(/updateOfficialViewMutation\.mutate/)
    expect(src).not.toMatch(/DesktopAuthoringNotice/)
  })

  it('does not draw a plus in every unselected cell on touch', () => {
    // index.css reveals opacity-0/group-hover on a coarse pointer, which drew
    // a dashed "+" in four cells per row and buried the one solid check.
    expect(src).toMatch(classesWith('hidden sm:block opacity-0', 'group-hover:opacity-100'))
  })

  it('tells a phone reader to tap rather than click', () => {
    expect(src).toMatch(/Tap any cell/)
  })
})
