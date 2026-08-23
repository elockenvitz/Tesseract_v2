import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { animateBootLoader, stopBootLoaderAnimation } from '../../boot-loader'
import { EDGES } from '../tesseract-geometry'

/**
 * Lives beside the geometry it drives rather than beside `boot-loader.ts`,
 * because `guard:unit` scopes to the brand and card surfaces — a test for the
 * loading mark that the loading guard does not run is not a guard.
 *
 * The boot element is the figure anybody actually watches: it sits at the top
 * of the stacking order across the whole cold boot, with React's own loader
 * mounted underneath it. If it does not move, nothing does.
 */

const frames: FrameRequestCallback[] = []

const mount = (edgeCount = EDGES.length) => {
  document.body.innerHTML = `
    <div id="tesseract-boot-loader">
      <svg>
        ${Array.from({ length: edgeCount }, () => '<line/>').join('')}
        ${Array.from({ length: 16 }, () => '<circle/>').join('')}
      </svg>
      <div id="tesseract-boot-loader-label">Loading…</div>
    </div>`
  return document.querySelector('#tesseract-boot-loader svg') as SVGSVGElement
}

beforeEach(() => {
  frames.length = 0
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb); return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => { stopBootLoaderAnimation(); vi.unstubAllGlobals(); document.body.innerHTML = '' })

describe('the element painted before the bundle moves once the bundle runs', () => {
  it('drives the mark that is already on screen', () => {
    const svg = mount()
    animateBootLoader()
    frames.splice(0).forEach(cb => cb(1200))
    const first = svg.querySelector('line')!
    expect(first.getAttribute('x1')).toBeTruthy()
    expect(first.getAttribute('opacity')).toBeTruthy()
  })

  it('drops the CSS breath, which animates the same property', () => {
    // Two overlapping opacity animations would fight. The breath existed only
    // because nothing could move the figure before this.
    const svg = mount()
    svg.style.animation = 'tesseract-boot-breathe 2.4s ease-in-out infinite'
    animateBootLoader()
    expect(svg.style.animation).toBe('none')
    expect(svg.style.opacity).toBe('1')
  })

  it('starts once, however many times it is asked', () => {
    mount()
    animateBootLoader()
    const after = frames.length
    animateBootLoader()
    expect(frames).toHaveLength(after)
  })

  it('does nothing when there is no boot element to drive', () => {
    document.body.innerHTML = ''
    expect(() => animateBootLoader()).not.toThrow()
    expect(frames).toHaveLength(0)
  })

  it('draws nothing rather than a scrambled figure if the markup has drifted', () => {
    // The SVG is generated from the geometry module at build time. A count
    // mismatch means the two no longer agree, and half a hypercube is worse
    // than a still one.
    mount(EDGES.length - 3)
    animateBootLoader()
    expect(frames).toHaveLength(0)
  })
})
