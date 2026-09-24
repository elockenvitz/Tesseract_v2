/**
 * Templates on a phone.
 *
 * Three of the four sections are desktop authoring built on drag, hover and
 * side-by-side panes. The product had already recorded that — the mobile
 * surface registry marks Templates `read-only`, "authoring stays on desktop" —
 * but nothing enforced it, so the full desktop UI rendered on a phone and
 * looked usable until it was touched.
 *
 * What these pin: the phone never LANDS in an authoring section, choosing one
 * gets an explanation rather than a broken mapper, and the desktop session's
 * own stored choice is not rewritten by a phone visiting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MOBILE_QUERY } from '../../../hooks/useMediaQuery'
import { DesktopAuthoringNotice } from '../DesktopAuthoringNotice'

/** Read a Templates source file, resolved from the repo root. */
const templateSrc = (file: string) =>
  readFileSync(resolve(process.cwd(), 'src/components/templates', file), 'utf8')

function setViewport(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

describe('the desktop-authoring notice', () => {
  beforeEach(() => setViewport(true))
  afterEach(() => vi.restoreAllMocks())

  it('names the section and says why it is desktop work', () => {
    render(
      <DesktopAuthoringNotice
        title="Excel Extraction"
        reason="Mapping a workbook means dragging across a spreadsheet to name cell ranges."
        onBack={() => {}}
      />,
    )
    expect(screen.getByText(/Excel Extraction is built on desktop/)).toBeInTheDocument()
    // The reason is about the work, not about the phone being unsupported.
    expect(screen.getByText(/dragging across a spreadsheet/)).toBeInTheDocument()
  })

  it('offers a way back rather than being a dead end', () => {
    const onBack = vi.fn()
    render(<DesktopAuthoringNotice title="Excel Extraction" reason="…" onBack={onBack} />)

    const back = screen.getByRole('button', { name: /Back to Templates/ })
    fireEvent.click(back)
    expect(onBack).toHaveBeenCalled()
    // A real control, not a clipped icon.
    expect(back.className).toContain('min-h-[44px]')
  })

  it('still shows whatever the phone can usefully read', () => {
    render(
      <DesktopAuthoringNotice title="Excel Extraction" reason="…">
        <p>3 templates</p>
      </DesktopAuthoringNotice>,
    )
    expect(screen.getByText('3 templates')).toBeInTheDocument()
  })

  it('omits the back control when the caller has no destination', () => {
    render(<DesktopAuthoringNotice title="Excel Extraction" reason="…" />)
    expect(screen.queryByRole('button', { name: /Back to Templates/ })).toBeNull()
  })
})

describe('the template editor header', () => {
  it('keeps one close control, repositioned rather than duplicated', () => {
    // A second copy behind `hidden`/`sm:block` would read the control twice
    // to a screen reader — the defect this lane has hit repeatedly.
    const src = templateSrc('TemplateEditor.tsx')

    const closes = src.match(/aria-label="Close editor"/g) ?? []
    expect(closes).toHaveLength(1)
    // And it leads the wrapped phone row, so the way out is not the control
    // that gets clipped.
    //
    // Anchored inside a className: an earlier version of this matched
    // anywhere in the file and was satisfied by the comment above the button,
    // which names both classes. A source assertion that a comment can pass is
    // not an assertion.
    expect(src).toMatch(/className="[^"]*order-first[^"]*sm:order-none[^"]*"/)
  })

  it('lets the header wrap instead of overflowing a clipped parent', () => {
    const src = templateSrc('TemplateEditor.tsx')

    // `flex-wrap` on the phone, `sm:flex-nowrap` to leave desktop on one line.
    expect(src).toMatch(/className="[^"]*flex-wrap[^"]*sm:flex-nowrap[^"]*"/)
  })
})

describe('the template list grids collapse on a phone', () => {
  it('gives the filter panel one column instead of four', () => {
    const src = templateSrc('TemplateList.tsx')

    // The category select had ~82px — narrower than its shortest option.
    expect(src).not.toMatch(/className="grid grid-cols-4/)
    expect(src).toMatch(/grid-cols-1[^"]*sm:grid-cols-4/)
  })

  it('gives the favourites cards one column instead of two', () => {
    const src = templateSrc('TemplateList.tsx')

    expect(src).not.toMatch(/className="grid grid-cols-2 gap-2"/)
    expect(src).toMatch(/grid-cols-1 gap-2 sm:grid-cols-2/)
  })
})
