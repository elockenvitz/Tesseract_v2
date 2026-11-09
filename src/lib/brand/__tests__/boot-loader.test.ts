import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  animateBootLoader, hideBootLoader, showBootLoader, stopBootLoaderAnimation,
} from '../../boot-loader'
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
  /* A real cancel, not a no-op. The loop is stopped by cancelling the frame
     it has already asked for, so a stub that keeps that callback queued
     cannot tell a stopped loop from a running one -- which is exactly what
     the pause cases below are about. */
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    if (id >= 1 && id <= frames.length) frames.splice(id - 1, 1)
  })
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

/**
 * And it stops once nobody can see it.
 *
 * ── The cost this closes ──────────────────────────────────────────────────
 *
 * The element is kept in the DOM for the whole session so a later gate can
 * re-show it without a remount, and the loop was kept running for the whole
 * session along with it. Only the first half of that buys anything.
 *
 * MEASURED in the running app, on the Dashboard, long after boot and with
 * nothing happening: 4,704 DOM mutations in 700ms of idleness, every one of
 * them this element's, at `opacity: 0`, behind the entire application. The
 * loop writes 32 lines x 5 attributes and 16 nodes x 4 on every frame, and
 * the browser restyles and repaints that subtree for each one -- which is
 * what turns an already-long frame, such as revealing a lens with 145 tiles,
 * into a hitch the reader sees.
 *
 * Nothing about the figure changes. `EPOCH` is module-level and `phaseAt`
 * reads the wall clock, so a restarted loop draws the frame it would have
 * been on had it never stopped; every property the continuous loop was for
 * -- one clock, no handover, no remount, in phase with any React mark beside
 * it -- belongs to that epoch and survives a pause.
 */
describe('the loop runs only while the figure is on screen', () => {
  it('stops turning when the loader fades', () => {
    mount()
    animateBootLoader()
    frames.splice(0).forEach(cb => cb(1200))
    hideBootLoader()
    /* The last frame asked for no successor, so nothing is left to run. */
    expect(frames).toHaveLength(0)
  })

  it('does not start on an element that is already faded', () => {
    mount()
    hideBootLoader()
    animateBootLoader()
    expect(frames).toHaveLength(0)
  })

  it('starts turning again when a gate re-shows it', () => {
    mount()
    animateBootLoader()
    frames.splice(0).forEach(cb => cb(1200))
    hideBootLoader()
    showBootLoader('Switching workspace…')
    expect(frames.length).toBeGreaterThan(0)
    expect(document.getElementById('tesseract-boot-loader-label')?.textContent)
      .toBe('Switching workspace…')
  })

  /* The phase is a function of the wall clock, not of when the loop started,
     so the figure a reader sees after a pause is the one they would have
     seen without it. This is the property that made pausing safe. */
  it('comes back in the phase it would have been in', () => {
    const svg = mount()
    animateBootLoader()
    frames.splice(0).forEach(cb => cb(1200))
    const paused = svg.querySelector('line')!.getAttribute('x1')
    hideBootLoader()
    showBootLoader()
    const resumed = frames.splice(0)
    /* Without this the case passes on a loop that never restarted, because
       nothing would have moved the figure off the frame it paused on. */
    expect(resumed.length).toBeGreaterThan(0)
    resumed.forEach(cb => cb(1200))
    expect(svg.querySelector('line')!.getAttribute('x1')).toBe(paused)
  })
})
