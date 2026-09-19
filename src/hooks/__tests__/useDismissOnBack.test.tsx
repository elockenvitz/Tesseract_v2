/**
 * Back closes the overlay in front of you, not the application.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * The authenticated product is ONE history entry. `App` mounts DashboardPage
 * under `/*`, tabs live in sessionStorage, and DashboardPage never calls a
 * router hook — so nothing a user opens on a phone is in history. The Android
 * back gesture, which is the primary back on a phone, walked straight out of
 * Tesseract from behind a drawer or a sheet.
 *
 * These assertions are about the history stack rather than about pixels,
 * because that is where the defect lives: the number of entries pushed, that
 * they are consumed however the overlay closes, and that a user can never be
 * held in the app by an overlay that keeps re-pushing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useDismissOnBack } from '../useDismissOnBack'

/**
 * A history stack small enough to reason about. jsdom's own history does not
 * fire popstate for `back()`, so the stack is modelled here and the event is
 * dispatched the way a browser would.
 */
function installHistory() {
  const stack: any[] = [{ base: true }]
  let index = 0

  const history = {
    get state() { return stack[index] },
    get length() { return stack.length },
    pushState(state: any) {
      stack.splice(index + 1)
      stack.push(state)
      index = stack.length - 1
    },
    back() {
      if (index === 0) {
        // Leaving the app. Nothing further to dispatch.
        left = true
        return
      }
      index -= 1
      window.dispatchEvent(new PopStateEvent('popstate', { state: stack[index] }))
    },
  }

  let left = false

  Object.defineProperty(window, 'history', { value: history, configurable: true, writable: true })

  return {
    /** Back presses remaining before the app is left. */
    depth: () => index,
    didLeaveApp: () => left,
    pressBack: () => act(() => { history.back() }),
  }
}

let h: ReturnType<typeof installHistory>

beforeEach(() => {
  h = installHistory()
})

function overlay(enabled = true) {
  const onDismiss = vi.fn()
  const view = renderHook(
    ({ open }: { open: boolean }) => useDismissOnBack(open, onDismiss, { enabled }),
    { initialProps: { open: false } },
  )
  return { ...view, onDismiss }
}

describe('an open overlay puts itself in history', () => {
  it('adds exactly one entry when it opens', () => {
    const { rerender } = overlay()

    expect(h.depth()).toBe(0)
    act(() => rerender({ open: true }))

    expect(h.depth()).toBe(1)
  })

  it('does not stack entries while it stays open', () => {
    const { rerender } = overlay()
    act(() => rerender({ open: true }))
    act(() => rerender({ open: true }))
    act(() => rerender({ open: true }))

    expect(h.depth()).toBe(1)
  })
})

describe('back closes the overlay instead of the app', () => {
  it('dismisses on back', () => {
    const { rerender, onDismiss } = overlay()
    act(() => rerender({ open: true }))

    h.pressBack()

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(h.didLeaveApp()).toBe(false)
  })

  it('leaves the history stack where it started', () => {
    const { rerender, onDismiss } = overlay()
    act(() => rerender({ open: true }))

    h.pressBack()
    act(() => rerender({ open: false }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
    expect(h.depth()).toBe(0)
    expect(h.didLeaveApp()).toBe(false)
  })

  it('lets the next back leave the app, so nobody is trapped', () => {
    const { rerender } = overlay()
    act(() => rerender({ open: true }))
    h.pressBack()
    act(() => rerender({ open: false }))

    h.pressBack()

    expect(h.didLeaveApp()).toBe(true)
  })
})

describe('closing any other way spends the entry too', () => {
  it('consumes its entry when closed by button or backdrop', () => {
    const { rerender } = overlay()
    act(() => rerender({ open: true }))
    expect(h.depth()).toBe(1)

    act(() => rerender({ open: false }))

    // Without this, a later back press would be spent stepping over an
    // overlay that is already gone, and the user would press back twice to
    // go anywhere.
    expect(h.depth()).toBe(0)
  })

  it('does not call onDismiss for a close it did not cause', () => {
    const { rerender, onDismiss } = overlay()
    act(() => rerender({ open: true }))

    act(() => rerender({ open: false }))

    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('reopens cleanly, adding one entry again and no more', () => {
    const { rerender } = overlay()
    act(() => rerender({ open: true }))
    act(() => rerender({ open: false }))
    act(() => rerender({ open: true }))

    expect(h.depth()).toBe(1)
  })
})

describe('overlays stacked on top of one another', () => {
  it('back closes only the topmost', () => {
    const outer = overlay()
    act(() => outer.rerender({ open: true }))
    const inner = overlay()
    act(() => inner.rerender({ open: true }))

    expect(h.depth()).toBe(2)
    h.pressBack()

    expect(inner.onDismiss).toHaveBeenCalledTimes(1)
    expect(outer.onDismiss).not.toHaveBeenCalled()
  })

  it('a second back then closes the one underneath', () => {
    const outer = overlay()
    act(() => outer.rerender({ open: true }))
    const inner = overlay()
    act(() => inner.rerender({ open: true }))

    h.pressBack()
    act(() => inner.rerender({ open: false }))
    h.pressBack()

    expect(outer.onDismiss).toHaveBeenCalledTimes(1)
    expect(h.didLeaveApp()).toBe(false)
  })
})

describe('desktop is untouched', () => {
  it('never touches history when disabled', () => {
    const { rerender, onDismiss } = overlay(false)

    act(() => rerender({ open: true }))
    expect(h.depth()).toBe(0)

    act(() => rerender({ open: false }))
    expect(h.depth()).toBe(0)
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('leaves the app on back, exactly as a desktop dialog always did', () => {
    const { rerender } = overlay(false)
    act(() => rerender({ open: true }))

    h.pressBack()

    expect(h.didLeaveApp()).toBe(true)
  })
})
