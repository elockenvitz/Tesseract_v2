import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'

import { PageLoader, DELAY_MS, MIN_VISIBLE_MS } from '../PageLoader'

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
