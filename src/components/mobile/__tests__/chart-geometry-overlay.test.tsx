import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'

import { ChartGeometryOverlay } from '../ChartGeometryOverlay'

/**
 * The diagnostic must not become the bug.
 *
 * It exists because every measurement of this chart so far was taken somewhere
 * the reported problem does not live. An instrument that changed the geometry
 * it was reading, or that shipped, would be worse than no instrument — so the
 * two properties worth pinning are that it is inert by default and that it
 * only ever reads.
 */

describe('the chart geometry overlay', () => {
  it('renders nothing without the flag', () => {
    const { container } = render(<ChartGeometryOverlay />)
    expect(container.innerHTML).toBe('')
    expect(document.querySelector('.pointer-events-none')).toBeNull()
  })

  it('is gated on a dev build as well as the flag', () => {
    // The URL flag alone is `OverflowAuditOverlay`'s convention and works
    // against any build. This one is temporary evidence collection, so it also
    // cannot exist in production.
    const src = readFileSync(resolve(__dirname, '../ChartGeometryOverlay.tsx'), 'utf8')
    expect(src).toContain('import.meta.env.DEV')
    expect(src).toContain("get('chartgeom') === '1'")
  })

  it('takes no layout space and no gestures', () => {
    const src = readFileSync(resolve(__dirname, '../ChartGeometryOverlay.tsx'), 'utf8')
    expect(src).toContain('pointer-events-none fixed inset-0')
    expect(src).toContain('createPortal')
  })

  it('reads the DOM and never writes to it', () => {
    /**
     * The audit module may call `getBoundingClientRect` and `getComputedStyle`
     * and nothing else. No assignment to `.style`, no class mutation, no
     * observer — an observer feeding a measurement back toward layout is the
     * exact shape of the jitter this codebase has fixed twice.
     */
    const src = readFileSync(
      resolve(__dirname, '../../../lib/mobile/chart-geometry-audit.ts'), 'utf8',
    )
    expect(src).toContain('getBoundingClientRect')
    expect(src).toContain('getComputedStyle')
    expect(src).not.toMatch(/\.style\s*\./)
    expect(src).not.toMatch(/\.style\s*=/)
    expect(src).not.toContain('classList')
    expect(src).not.toContain('setAttribute')
    expect(src).not.toContain('ResizeObserver')
    expect(src).not.toContain('MutationObserver')
  })

  it('does not poll', () => {
    // A bounded read after layout settles, plus a debounced re-read on the
    // events that change which chart is on screen.
    const src = readFileSync(resolve(__dirname, '../ChartGeometryOverlay.tsx'), 'utf8')
    expect(src).not.toContain('setInterval')
    expect(src).toContain('setTimeout')
  })
})
