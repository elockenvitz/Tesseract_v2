import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

import { PageLoader, DELAY_MS, MIN_VISIBLE_MS, LOADER_ANCHOR } from '../PageLoader'

/**
 * The thresholds are the whole reason this component exists, so they are what
 * is tested. A spinner needs none of this; a phrased animation does.
 */

const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })
const shown = (c: HTMLElement) => !!c.querySelector('[data-testid="page-loader"]')

describe('it does not flicker on a fast load', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows nothing at all before the delay', () => {
    // Most queries against a warm cache return inside this window, and a loader
    // that never appears beats one that flashes: the screen simply changes.
    const { container } = render(<PageLoader loading />)
    expect(shown(container)).toBe(false)
    tick(DELAY_MS - 20)
    expect(shown(container)).toBe(false)
  })

  it('never appears when the wait finishes inside the delay', () => {
    const { container, rerender } = render(<PageLoader loading />)
    tick(DELAY_MS - 50)
    rerender(<PageLoader loading={false} />)
    tick(1000)
    expect(shown(container)).toBe(false)
  })

  it('appears once the wait has proved itself long', () => {
    const { container } = render(<PageLoader loading />)
    tick(DELAY_MS + 10)
    expect(shown(container)).toBe(true)
  })
})

describe('once shown, it stays long enough to be a phrase', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('holds the minimum even if the data lands immediately after', () => {
    // Without this the delay only moves the flicker: a 210ms request would
    // show the mark for 10ms.
    const { container, rerender } = render(<PageLoader loading />)
    tick(DELAY_MS + 10)
    expect(shown(container)).toBe(true)

    rerender(<PageLoader loading={false} />)
    tick(MIN_VISIBLE_MS - 50)
    expect(shown(container)).toBe(true)

    tick(100)
    expect(shown(container)).toBe(false)
  })

  it('clears promptly after a long wait, without adding a hold', () => {
    // The minimum is measured from when it became visible, so a slow load does
    // not pay the penalty twice.
    const { container, rerender } = render(<PageLoader loading />)
    tick(DELAY_MS + 5000)
    rerender(<PageLoader loading={false} />)
    tick(MIN_VISIBLE_MS + 10)
    expect(shown(container)).toBe(false)
  })

  it('does not strand the loader on screen forever', () => {
    // The hold timer runs on a state change it also causes, so a naive
    // dependency list re-arms it on every tick and it never clears.
    const { container, rerender } = render(<PageLoader loading />)
    tick(DELAY_MS + 10)
    rerender(<PageLoader loading={false} />)
    tick(MIN_VISIBLE_MS * 4)
    expect(shown(container)).toBe(false)
  })
})

describe('it announces itself without interrupting', () => {
  it('is a polite status region', () => {
    vi.useFakeTimers()
    const { container } = render(<PageLoader loading />)
    tick(DELAY_MS + 10)
    const el = container.querySelector('[data-testid="page-loader"]')!
    expect(el.getAttribute('role')).toBe('status')
    expect(el.getAttribute('aria-live')).toBe('polite')
    vi.useRealTimers()
  })

  it('carries the mark, which labels itself', () => {
    vi.useFakeTimers()
    const { container } = render(<PageLoader loading />)
    tick(DELAY_MS + 10)
    expect(container.querySelector('[data-testid="tesseract-mark"]')).toBeTruthy()
    vi.useRealTimers()
  })
})

describe('one figure across the whole cold start', () => {
  it('draws the same mark the boot splash paints, at the same size', () => {
    // The pre-JS splash in index.html renders the resting frame at 96px from
    // the same geometry module. Matching here is what makes React's mount a
    // handover rather than a second loading screen.
    vi.useFakeTimers()
    const { container } = render(<PageLoader loading />)
    tick(DELAY_MS + 10)
    const svg = container.querySelector('[data-testid="tesseract-mark"]')!
    expect(svg.getAttribute('width')).toBe('96')
    expect(svg.getAttribute('viewBox')).toBe('0 0 100 100')
    vi.useRealTimers()
  })
})

describe('every loading state sits in the same place', () => {
  it('anchors to the viewport, not to whatever box it is rendered in', () => {
    // Centred in its parent, the mark landed BELOW the app header — so it
    // stepped down the screen as the pre-JS boot element handed over to it,
    // midway through a single wait. Fixed and centred matches the boot
    // element on every screen, with no header height to guess at: that header
    // carries `env(safe-area-inset-top)` and is a different height on every
    // device, so any padding-based fix would be a guess.
    vi.useFakeTimers()
    const { container } = render(<PageLoader loading />)
    tick(DELAY_MS + 10)
    const el = container.querySelector('[data-testid="page-loader"]')!
    expect(el.className).toContain(LOADER_ANCHOR)
    vi.useRealTimers()
  })

  it('does not swallow the header it is drawn over', () => {
    // The overlay is transparent, so the chrome underneath stays visible —
    // which is the reason it can cover the screen rather than sit below it.
    vi.useFakeTimers()
    const { container } = render(<PageLoader loading />)
    tick(DELAY_MS + 10)
    expect(container.querySelector('[data-testid="page-loader"]')!.className)
      .toContain('pointer-events-none')
    vi.useRealTimers()
  })

  it('can still be told to belong to a panel', () => {
    vi.useFakeTimers()
    const { container } = render(<PageLoader loading inline />)
    tick(DELAY_MS + 10)
    const el = container.querySelector('[data-testid="page-loader"]')!
    expect(el.className).not.toContain('fixed')
    vi.useRealTimers()
  })
})
