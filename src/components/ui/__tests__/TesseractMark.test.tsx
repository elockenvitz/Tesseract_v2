import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'

import { TesseractMark } from '../TesseractMark'

/**
 * The phase is shared, so a loader handing over to another loader continues the
 * loop instead of restarting it. A cold boot passes through three of them.
 */

const frames: FrameRequestCallback[] = []
const geometry = (c: HTMLElement) =>
  [...c.querySelectorAll('line')].map(l => l.getAttribute('x1')).join(',')

afterEach(() => { frames.length = 0; vi.unstubAllGlobals() })

const stubRaf = () => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb); return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
}

describe('the loop does not restart when a loader is replaced', () => {
  it('draws the same frame for the same moment, whenever it mounted', () => {
    // Two marks mounted at different times, driven to the same timestamp, must
    // agree — which is only true if neither owns its own start.
    stubRaf()
    const a = render(<TesseractMark size={96} periodMs={4500} animate />)
    frames.splice(0).forEach(cb => cb(1200))

    const b = render(<TesseractMark size={96} periodMs={4500} animate />)
    frames.splice(0).forEach(cb => cb(1200))

    expect(geometry(b.container)).toBe(geometry(a.container))
  })

  it('advances with the clock rather than with time-since-mount', () => {
    stubRaf()
    const { container } = render(<TesseractMark size={96} periodMs={4500} animate />)
    frames.splice(0).forEach(cb => cb(0))
    const atZero = geometry(container)
    frames.splice(0).forEach(cb => cb(1500))
    expect(geometry(container)).not.toBe(atZero)
  })
})

describe('it holds still where motion is unwelcome', () => {
  it('draws the resting frame under prefers-reduced-motion', () => {
    // A continuously inverting hypercube is close to the worst thing that
    // setting exists to suppress.
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    stubRaf()
    render(<TesseractMark size={96} periodMs={4500} animate />)
    expect(frames).toHaveLength(0)
  })

  it('asks for no frames at all when it is not animating', () => {
    stubRaf()
    render(<TesseractMark size={96} periodMs={4500} animate={false} />)
    expect(frames).toHaveLength(0)
  })
})
