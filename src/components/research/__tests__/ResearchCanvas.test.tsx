/**
 * ResearchCanvas (S0) — the Research Workspace scaffold.
 *
 * The one guarantee S0 must hold: when disabled it changes NOTHING, and when
 * enabled it is layout-transparent (a display:contents wrapper), so the Research
 * page renders identically today whether or not the flag is on.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ResearchCanvas } from '../ResearchCanvas'

describe('ResearchCanvas', () => {
  it('renders children with no wrapper when disabled', () => {
    const { container } = render(
      <ResearchCanvas enabled={false} mode="view"><p>case content</p></ResearchCanvas>
    )
    expect(screen.getByText('case content')).toBeInTheDocument()
    expect(container.querySelector('[data-research-canvas]')).toBeNull()
  })

  it('frames children in a layout-transparent canvas when enabled', () => {
    const { container } = render(
      <ResearchCanvas enabled mode="view"><p>case content</p></ResearchCanvas>
    )
    const frame = container.querySelector('[data-research-canvas]') as HTMLElement
    expect(frame).not.toBeNull()
    expect(frame.getAttribute('data-mode')).toBe('view')
    // display:contents => the wrapper generates no box, so sections lay out as before
    expect(frame.style.display).toBe('contents')
    expect(screen.getByText('case content')).toBeInTheDocument()
  })

  it('reflects the workspace mode', () => {
    const { container } = render(
      <ResearchCanvas enabled mode="customize"><p>x</p></ResearchCanvas>
    )
    expect(container.querySelector('[data-research-canvas]')!.getAttribute('data-mode')).toBe('customize')
  })
})
