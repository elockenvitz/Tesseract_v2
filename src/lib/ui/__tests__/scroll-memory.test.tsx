/**
 * Where the reader was, kept across the surface being torn down.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * Reported: "Both the canonical Asset Page and embedded Asset Workspace
 * appear to reload when I navigate to another application tab and return."
 *
 * Part of that was the scroll offset. The two surfaces lose it for different
 * reasons -- the work pane's scroller is destroyed with the tab, the Asset
 * Page's scroller survives and has its offset CLAMPED by the next tab's
 * shorter content -- and `scroll-memory.ts` serves both. So both are driven
 * here.
 *
 * ── Why the browser is modelled rather than used ─────────────────────────
 *
 * jsdom has no layout. `scrollTop` is a plain stored number: it is never
 * clamped, and assigning it fires no scroll event. Both of those are the
 * things this module exists to survive, so a test using jsdom's scroller
 * as-is would assert nothing -- the clamp could not happen and the
 * write-back it causes could not fire.
 *
 * `asBrowserScroller` therefore installs the two behaviours a real scroller
 * has: a setter that clamps to the scrollable height, and a `scroll` event
 * on every change. `the modelled scroller reaches the hook` is the control
 * for it: if that dispatch ever stops arriving, it fails, and the cases
 * below cannot then pass by never firing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, act, fireEvent } from '@testing-library/react'
import { createScrollMemory, useRememberedScroll, TOP, type ScrollMemory } from '../scroll-memory'

describe('the memory itself', () => {
  let memory: ScrollMemory
  beforeEach(() => { memory = createScrollMemory(3) })

  it('reads a key nobody has scrolled as the top of it', () => {
    expect(memory.read('tab-1')).toEqual(TOP)
    expect(memory.read('tab-1').scrollTop).toBe(0)
  })

  it('gives back what was written', () => {
    memory.remember('tab-1', 740)
    expect(memory.read('tab-1').scrollTop).toBe(740)
  })

  it('keeps one key out of another', () => {
    memory.remember('tab-1', 740)
    memory.remember('tab-2', 120)
    expect(memory.read('tab-1').scrollTop).toBe(740)
    expect(memory.read('tab-2').scrollTop).toBe(120)
  })

  it('treats no key as nothing to remember, and does not throw on it', () => {
    /* `activeTabId` is optional in `Layout` and the pane's selection key is
       null with nothing selected. Both arrive here before the reader has
       done anything, and neither is an error. */
    expect(() => memory.remember(null, 300)).not.toThrow()
    expect(() => memory.remember(undefined, 300)).not.toThrow()
    expect(memory.read(null)).toEqual(TOP)
    expect(memory.read(undefined)).toEqual(TOP)
    expect(memory.read('')).toEqual(TOP)
  })

  it('refuses an offset that is not a number', () => {
    /* A stored NaN is assigned on the way back and moves the reader nowhere
       in particular, which reads as the surface jumping. The previous good
       value is the better answer. */
    memory.remember('tab-1', 500)
    memory.remember('tab-1', Number.NaN)
    memory.remember('tab-1', Number.POSITIVE_INFINITY)
    expect(memory.read('tab-1').scrollTop).toBe(500)
  })

  it('stores a whole, non-negative number', () => {
    memory.remember('a', 12.6)
    memory.remember('b', -40)
    expect(memory.read('a').scrollTop).toBe(13)
    expect(memory.read('b').scrollTop).toBe(0)
  })

  it('remembers a deliberate scroll back to the top', () => {
    /* The one that is easy to get wrong: treating 0 as "nothing recorded"
       and falling through to the previous value. A reader who scrolled back
       up and left would be handed the bottom of the page on return. */
    memory.remember('tab-1', 740)
    memory.remember('tab-1', 0)
    expect(memory.read('tab-1').scrollTop).toBe(0)
  })

  it('drops the least recently written once it is full', () => {
    memory.remember('a', 1)
    memory.remember('b', 2)
    memory.remember('c', 3)
    memory.remember('d', 4)
    expect(memory.read('a')).toEqual(TOP)
    expect(memory.read('d').scrollTop).toBe(4)
    expect(memory.read('b').scrollTop).toBe(2)
  })

  it('counts a rewrite as recent, so the wrong key is not the one dropped', () => {
    memory.remember('a', 1)
    memory.remember('b', 2)
    memory.remember('c', 3)
    memory.remember('a', 99)
    memory.remember('d', 4)
    /* `a` was written again, so `b` is now the oldest. */
    expect(memory.read('a').scrollTop).toBe(99)
    expect(memory.read('b')).toEqual(TOP)
  })

  it('holds exactly its stated limit', () => {
    expect(memory.limit).toBe(3)
  })

  it('cannot be reached by another memory s forget', () => {
    /* Why this is a factory and not one shared map: the tab offsets and the
       pane offsets are separate key spaces with separate budgets, and a
       reader working through a dozen names must not evict their tabs. */
    const other = createScrollMemory(3)
    memory.remember('tab-1', 740)
    other.remember('tab-1', 120)
    other.forget()
    expect(memory.read('tab-1').scrollTop).toBe(740)
    expect(other.read('tab-1')).toEqual(TOP)
  })
})

/**
 * A scroller that behaves like one in a browser: bounded, and noisy.
 *
 * `max` is the furthest it can scroll, i.e. `scrollHeight - clientHeight`.
 * A surface that has not laid out its content yet has a small one, which is
 * the whole of the clamping problem.
 */
function asBrowserScroller(el: HTMLElement, max: number) {
  let value = 0
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => value,
    set: (next: number) => {
      value = Math.min(Math.max(0, next), max)
      /* A real scroller tells the page it moved, however it was moved --
         including by an assignment. That event is what the restore has to
         avoid mistaking for the reader. */
      fireEvent.scroll(el)
    },
  })
}

function Surface({ memory, k, max }: { memory: ScrollMemory; k: string | null; max: number }) {
  const { scroller, onScroll } = useRememberedScroll<HTMLDivElement>(memory, k)
  return (
    <div
      data-testid="surface"
      onScroll={onScroll}
      ref={node => {
        /* Installed in the callback ref, which React runs BEFORE layout
           effects -- so the hook's restore meets a modelled scroller rather
           than jsdom's unbounded one. */
        if (node) asBrowserScroller(node, max)
        scroller.current = node
      }}
    />
  )
}

describe('a scroller the reader comes back to', () => {
  let memory: ScrollMemory
  beforeEach(() => {
    memory = createScrollMemory(4)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      /* Synchronous, so the hook's single retry is observable rather than
         racing the assertions. Its scheduling is not what is under test. */
      cb(0)
      return 1
    })
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('the modelled scroller reaches the hook', () => {
    /* The control. The reader scrolls, the element dispatches, the hook
       records. If this fails the cases below are measuring nothing. */
    const r = render(<Surface memory={memory} k="tab-1" max={2000} />)
    const el = r.getByTestId('surface')
    act(() => { el.scrollTop = 250 })
    expect(memory.read('tab-1').scrollTop).toBe(250)
  })

  it('puts the reader back where they were', () => {
    const first = render(<Surface memory={memory} k="tab-1" max={2000} />)
    act(() => { first.getByTestId('surface').scrollTop = 880 })
    first.unmount()

    const second = render(<Surface memory={memory} k="tab-1" max={2000} />)
    expect(second.getByTestId('surface').scrollTop).toBe(880)
  })

  it('starts a key nobody has scrolled at the top', () => {
    const r = render(<Surface memory={memory} k="tab-new" max={2000} />)
    expect(r.getByTestId('surface').scrollTop).toBe(0)
  })

  it('does not overwrite the real offset with a clamped one', () => {
    /* THE regression, and the reason the restore holds an `applying` flag.
       The reader is 900px down. They come back while the surface is still
       short -- content not laid out, queries not landed -- so the browser
       clamps the assignment to 300 and dispatches a scroll event for it.
       Without the flag the hook reads that back as the reader's own position
       and writes 300 over the 900. The next return then lands even higher,
       and the one after that higher again. */
    memory.remember('tab-asset', 900)

    const short = render(<Surface memory={memory} k="tab-asset" max={300} />)
    expect(short.getByTestId('surface').scrollTop).toBe(300)
    expect(memory.read('tab-asset').scrollTop).toBe(900)
    short.unmount()

    const grown = render(<Surface memory={memory} k="tab-asset" max={2000} />)
    expect(grown.getByTestId('surface').scrollTop).toBe(900)
  })

  it('survives repeated navigation rather than drifting', () => {
    /* Four trips. The complaint is about a habit, not one switch, and a
       restore that loses a little each time is the shape a clamp bug takes
       in use. */
    let r = render(<Surface memory={memory} k="tab-1" max={2000} />)
    act(() => { r.getByTestId('surface').scrollTop = 640 })

    for (let i = 0; i < 4; i++) {
      r.unmount()
      r = render(<Surface memory={memory} k="tab-1" max={2000} />)
      expect(r.getByTestId('surface').scrollTop, `trip ${i + 1}`).toBe(640)
    }
  })

  it('gives each tab its own position in the one shared scroller', () => {
    /* `Layout` owns a single scrollport that every non-full-width tab
       renders into, so this is not a hypothetical: the same element is
       re-keyed as the reader moves. */
    const r = render(<Surface memory={memory} k="tab-1" max={2000} />)
    act(() => { r.getByTestId('surface').scrollTop = 700 })

    r.rerender(<Surface memory={memory} k="tab-2" max={2000} />)
    expect(r.getByTestId('surface').scrollTop).toBe(0)
    act(() => { r.getByTestId('surface').scrollTop = 150 })

    r.rerender(<Surface memory={memory} k="tab-1" max={2000} />)
    expect(r.getByTestId('surface').scrollTop).toBe(700)
    r.rerender(<Surface memory={memory} k="tab-2" max={2000} />)
    expect(r.getByTestId('surface').scrollTop).toBe(150)
  })

  it('follows the reader back to the top', () => {
    const first = render(<Surface memory={memory} k="tab-1" max={2000} />)
    act(() => { first.getByTestId('surface').scrollTop = 800 })
    act(() => { first.getByTestId('surface').scrollTop = 0 })
    first.unmount()

    const second = render(<Surface memory={memory} k="tab-1" max={2000} />)
    expect(second.getByTestId('surface').scrollTop).toBe(0)
  })

  it('records nothing against a key that is not there yet', () => {
    const r = render(<Surface memory={memory} k={null} max={2000} />)
    act(() => { r.getByTestId('surface').scrollTop = 300 })
    expect(memory.read(null)).toEqual(TOP)
  })
})
