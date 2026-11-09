/**
 * The scroll that two Asset-page deep-links share.
 *
 * ── Why this is worth a test ────────────────────────────────────────────
 *
 * It replaced `scrollIntoView`, which adjusts EVERY scrollable ancestor. Under
 * this page's nested scroll container and sticky header that overshot by about
 * 600px and left the target above the viewport — a failure that looks like
 * "the link does nothing", because the reader never sees where it went.
 *
 * The regression is invisible in a screenshot and invisible in source review,
 * so the geometry is asserted directly: the right element moves, by the right
 * amount, and the return value distinguishes "not in the DOM yet" from "done".
 * That distinction is what lets the caller clear its anchor only on success.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { scrollToSection } from '../scroll-to-section'

/** A scroll container holding a target `offsetFromTop` pixels down. */
function mount({ overflowY = 'auto', scrollable = true, nested = false } = {}) {
  document.body.innerHTML = ''
  const container = document.createElement('div')
  const inner = document.createElement('div')
  const target = document.createElement('div')
  target.id = 'section'

  Object.defineProperty(container, 'scrollHeight', { value: scrollable ? 2000 : 300, configurable: true })
  Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true })
  container.style.overflowY = overflowY

  container.getBoundingClientRect = () => ({ top: 100, left: 0, bottom: 400, right: 0, width: 0, height: 300, x: 0, y: 100, toJSON: () => ({}) })
  target.getBoundingClientRect = () => ({ top: 284, left: 0, bottom: 300, right: 0, width: 0, height: 16, x: 0, y: 284, toJSON: () => ({}) })

  const scrollBy = vi.fn()
  container.scrollBy = scrollBy as unknown as typeof container.scrollBy
  const scrollIntoView = vi.fn()
  target.scrollIntoView = scrollIntoView as unknown as typeof target.scrollIntoView

  if (nested) {
    inner.appendChild(target)
    container.appendChild(inner)
  } else {
    container.appendChild(target)
  }
  document.body.appendChild(container)
  return { container, target, scrollBy, scrollIntoView }
}

beforeEach(() => { document.body.innerHTML = '' })

describe('it moves the container that actually scrolls', () => {
  it('scrolls by the rect delta, landing the section 8px below the top', () => {
    const { scrollBy, scrollIntoView } = mount()
    expect(scrollToSection('section')).toBe(true)
    // target.top 284 − container.top 100 − 8 = 176
    expect(scrollBy).toHaveBeenCalledWith({ top: 176, behavior: 'smooth' })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('honours a caller-supplied offset', () => {
    const { scrollBy } = mount()
    scrollToSection('section', 0)
    expect(scrollBy).toHaveBeenCalledWith({ top: 184, behavior: 'smooth' })
  })

  it('walks past a non-scrolling parent to find the real container', () => {
    const { scrollBy } = mount({ nested: true })
    scrollToSection('section')
    expect(scrollBy).toHaveBeenCalledWith({ top: 176, behavior: 'smooth' })
  })

  it('ignores an overflow-auto ancestor that is not actually overflowing', () => {
    // `overflow-y: auto` on a box shorter than its content is the only
    // scrollable one; a box that fits does not scroll and moving it does
    // nothing visible.
    const { scrollBy, scrollIntoView } = mount({ scrollable: false })
    expect(scrollToSection('section')).toBe(true)
    expect(scrollBy).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('ignores a visible-overflow ancestor', () => {
    const { scrollBy, scrollIntoView } = mount({ overflowY: 'visible' })
    scrollToSection('section')
    expect(scrollBy).not.toHaveBeenCalled()
    expect(scrollIntoView).toHaveBeenCalled()
  })
})

describe('it reports whether it found anything', () => {
  it('returns false for an element that is not in the DOM', () => {
    // The callers run inside an animation frame and clear their anchor only
    // on true. Returning true here would clear an anchor for a section that
    // had not rendered yet, and the scroll would never happen.
    mount()
    expect(scrollToSection('no-such-section')).toBe(false)
  })

  it('returns true once the element exists', () => {
    mount()
    expect(scrollToSection('section')).toBe(true)
  })
})
