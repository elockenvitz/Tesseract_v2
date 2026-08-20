import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'

import { TesseractLogo } from '../TesseractLogo'
import { RESTING, project } from '../../../lib/brand/tesseract-geometry'

/**
 * The launcher is a logo first and an animation second.
 *
 * What matters is that it is STILL until a pointer arrives — chrome that moves
 * on its own is chrome people learn to tune out — and that when it does move it
 * is the same mark the loader draws rather than a second lookalike.
 */

describe('app launcher mark', () => {
  it('is still until hovered', () => {
    render(<TesseractLogo size={24} />)
    const el = screen.getByTestId('tesseract-logo')
    expect(el.getAttribute('data-animating')).toBe('false')
    fireEvent.mouseEnter(el)
    expect(el.getAttribute('data-animating')).toBe('true')
    fireEvent.mouseLeave(el)
    expect(el.getAttribute('data-animating')).toBe('false')
  })

  it('draws the resting projection at rest', () => {
    // The recognisable isometric hexagon, not an empty box waiting on a frame.
    const { container } = render(<TesseractLogo size={24} />)
    const first = container.querySelector('line')!
    // Two decimals, because that is the precision the renderer writes.
    expect(Number(first.getAttribute('x1'))).toBeCloseTo(RESTING[0].x, 2)
    expect(Number(first.getAttribute('y1'))).toBeCloseTo(RESTING[0].y, 2)
  })

  it('draws the same 32-edge mark the loader does', () => {
    // One geometry module, so the launcher and the loading state cannot drift
    // into being two different logos.
    const { container } = render(<TesseractLogo size={24} />)
    expect(container.querySelectorAll('line')).toHaveLength(32)
  })

  it('omits vertex nodes at launcher size', () => {
    // Sixteen dots on a 24px mark close the gaps between the lines and it reads
    // as a blob.
    const { container } = render(<TesseractLogo size={24} />)
    expect(container.querySelectorAll('circle')).toHaveLength(0)
  })

  it('turns far slower than the loader', () => {
    /**
     * Asserted on the projection rather than on wall-clock timing, which a unit
     * test cannot observe honestly. The launcher runs the same loop over 15s
     * against the loader's 4.5 — three times slower is the difference between
     * "this is alive" and "this is working", and a launcher inverting at
     * loading speed would imply something was happening when nothing was.
     */
    const travel = (p: typeof RESTING) =>
      p.reduce((n, v, i) => n + Math.hypot(v.x - RESTING[i].x, v.y - RESTING[i].y), 0)
    const loaderAt2s = project((2000 / 4500) * Math.PI * 2)
    const launcherAt2s = project((2000 / 15000) * Math.PI * 2)
    expect(travel(launcherAt2s)).toBeLessThan(travel(loaderAt2s))
  })
})
