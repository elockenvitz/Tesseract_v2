/**
 * The gallery fetch window, and the properties that keep it from becoming a
 * worse problem than the one it solves.
 *
 * ── What it is for ───────────────────────────────────────────────────────
 *
 * Measured cold on a 142-tile Dashboard, every tile's symbol went into the
 * batched `useGalleryCloses` read. That chunks at five symbols per request,
 * so sparklines and year ranges together cost 60 `price_history_cache`
 * requests while NINE tiles were on screen.
 *
 * ── What it must never do ────────────────────────────────────────────────
 *
 * The window only ever GROWS. Two separate things depend on that:
 *
 *   - `useGalleryCloses` holds the previous result through
 *     `placeholderData: prev => prev`. That is only correct while each key
 *     is a SUPERSET of the last; shrink it and the held data is an answer
 *     to a different question.
 *   - A tile losing its sparkline because the reader scrolled past it is
 *     the "blank card during ordinary scrolling" this must not cause.
 *
 * The stepping matters for the same reason: without it the key changes on
 * every pixel of scroll, and a request per scroll frame is a storm, not a
 * saving.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  useScrollWindow,
  DEFAULT_INITIAL_WINDOW,
  DEFAULT_WINDOW_STEP,
} from '../useScrollWindow'

/** A stand-in for `.gallery-host`: an element that reports a scroll geometry. */
function makeScroller(opts: { clientHeight: number; scrollHeight: number }) {
  const el = document.createElement('div')
  Object.defineProperty(el, 'clientHeight', { value: opts.clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: opts.scrollHeight, configurable: true })
  el.scrollTop = 0
  /* `findScroller` asks for the computed style, so the element must actually
     be in the document and actually claim to scroll. */
  el.style.overflowY = 'auto'
  document.body.appendChild(el)
  return el
}

const scrollTo = (el: HTMLElement, top: number) => {
  el.scrollTop = top
  act(() => { el.dispatchEvent(new Event('scroll')) })
}

beforeEach(() => {
  /* jsdom has no ResizeObserver; the hook treats it as optional. */
  ;(globalThis as Record<string, unknown>).ResizeObserver = class {
    observe() {} disconnect() {}
  }
})
afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('the window grows and never shrinks', () => {
  it('starts at the initial window, not at the whole field', () => {
    const { result } = renderHook(() => useScrollWindow(142))
    expect(result.current.count).toBe(DEFAULT_INITIAL_WINDOW)
    expect(result.current.complete).toBe(false)
  })

  it('admits more as the reader scrolls down', () => {
    const el = makeScroller({ clientHeight: 726, scrollHeight: 12677 })
    const { result } = renderHook(() => useScrollWindow(142))
    act(() => { result.current.containerRef(el) })

    const first = result.current.count
    scrollTo(el, 6000)
    expect(result.current.count).toBeGreaterThan(first)
  })

  it('NEVER shrinks when the reader scrolls back up', () => {
    const el = makeScroller({ clientHeight: 726, scrollHeight: 12677 })
    const { result } = renderHook(() => useScrollWindow(142))
    act(() => { result.current.containerRef(el) })

    /*
     * Deliberately a MIDDLE position, not the bottom. Scrolling to the end
     * admits the whole field, after which an early return keeps the count
     * pinned for a reason that has nothing to do with monotonicity -- so a
     * bottom-then-top test passes even when the window shrinks freely.
     */
    scrollTo(el, 6000)
    const partWay = result.current.count
    expect(partWay).toBeGreaterThan(DEFAULT_INITIAL_WINDOW)
    expect(partWay, 'scrolled to the end, so this proves nothing').toBeLessThan(142)

    scrollTo(el, 0)
    /* The held `placeholderData` is only valid while each key is a superset
       of the last, and a tile must not lose its sparkline to a scroll-up. */
    expect(result.current.count).toBe(partWay)
  })

  it('is monotonic across a whole feed traversal', () => {
    const el = makeScroller({ clientHeight: 726, scrollHeight: 12677 })
    const { result } = renderHook(() => useScrollWindow(142))
    act(() => { result.current.containerRef(el) })

    const seen: number[] = [result.current.count]
    for (const top of [500, 1800, 3000, 1200, 4200, 5500, 900, 6700, 7900, 9100, 11600, 200]) {
      scrollTo(el, top)
      seen.push(result.current.count)
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i], `window shrank at step ${i}: ${seen.join(',')}`)
        .toBeGreaterThanOrEqual(seen[i - 1])
    }
  })

  it('never exceeds the number of items there are', () => {
    const el = makeScroller({ clientHeight: 726, scrollHeight: 12677 })
    const { result } = renderHook(() => useScrollWindow(30))
    act(() => { result.current.containerRef(el) })
    scrollTo(el, 11600)
    expect(result.current.count).toBeLessThanOrEqual(30)
    expect(result.current.complete).toBe(true)
  })

  it('reaches the end of the field by the bottom of the scroll', () => {
    const el = makeScroller({ clientHeight: 726, scrollHeight: 12677 })
    const { result } = renderHook(() => useScrollWindow(142))
    act(() => { result.current.containerRef(el) })
    scrollTo(el, 12677 - 726)
    expect(result.current.count).toBe(142)
  })
})

describe('it does not become a request storm', () => {
  it('does not change the count on every pixel of scroll', () => {
    const el = makeScroller({ clientHeight: 726, scrollHeight: 12677 })
    const { result } = renderHook(() => useScrollWindow(142))
    act(() => { result.current.containerRef(el) })

    const counts = new Set<number>()
    /* A pixel-by-pixel drag through a whole screen. Each distinct count is
       a new query key, which is a new request. */
    for (let top = 0; top < 700; top += 10) {
      scrollTo(el, top)
      counts.add(result.current.count)
    }
    expect(counts.size, `a new fetch window on ${counts.size} of 70 scroll events`)
      .toBeLessThanOrEqual(2)
  })

  it('steps in whole increments rather than one item at a time', () => {
    const el = makeScroller({ clientHeight: 726, scrollHeight: 12677 })
    const { result } = renderHook(() => useScrollWindow(142))
    act(() => { result.current.containerRef(el) })
    scrollTo(el, 3000)
    expect(result.current.count % DEFAULT_WINDOW_STEP).toBe(0)
  })
})

describe('it degrades safely', () => {
  it('keeps the initial window when there is no scrolling ancestor', () => {
    /* A gallery short enough not to scroll, or a host not yet laid out.
       The field must still fetch its first screens. */
    const plain = document.createElement('div')
    document.body.appendChild(plain)
    const { result } = renderHook(() => useScrollWindow(142))
    act(() => { result.current.containerRef(plain) })
    expect(result.current.count).toBe(DEFAULT_INITIAL_WINDOW)
  })

  it('survives a null container without throwing', () => {
    const { result } = renderHook(() => useScrollWindow(142))
    expect(() => act(() => { result.current.containerRef(null) })).not.toThrow()
  })

  it('does not strand the window above a field a filter has shortened', () => {
    /* Filtering to five tiles while the window sits at 24 would ask for
       symbols that are no longer shown. */
    const { result, rerender } = renderHook(({ n }) => useScrollWindow(n), {
      initialProps: { n: 142 },
    })
    rerender({ n: 5 })
    expect(result.current.count).toBeLessThanOrEqual(5)
  })

  it('reports complete for an empty field rather than waiting forever', () => {
    const { result } = renderHook(() => useScrollWindow(0))
    expect(result.current.count).toBe(0)
    expect(result.current.complete).toBe(true)
  })
})
