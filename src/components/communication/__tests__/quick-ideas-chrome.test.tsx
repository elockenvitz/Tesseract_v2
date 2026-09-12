/**
 * Quick Ideas on a phone: one row of chrome, then the form.
 *
 * At 390px the capture form opened under four things it did not need: the pane
 * header naming where you are, a full-width Back row offering the way out, a
 * hundred-pixel Get Started card, and the form's own guidance. Two of those
 * were navigation and instruction about navigation.
 *
 * Back now leads the header it sat beneath, and the three capture steps are
 * one pinned row that names the step you are on. Nothing about what a step
 * means, when it completes, or what back does has changed.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const env = vi.hoisted(() => ({ isMobile: true }))
vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => env.isMobile,
  useKeyboardInset: () => 0,
  useViewportHeight: () => 800,
}))

import { PilotCaptureTracker } from '../ThoughtsSection'

beforeEach(() => { env.isMobile = true })
afterEach(cleanup)

const tracker = (done: boolean[], onDismiss = vi.fn()) =>
  render(<PilotCaptureTracker done={done} onDismiss={onDismiss} />)

describe('the capture tracker', () => {
  it('names the step the reader is on, not all three', () => {
    tracker([false, false, false])
    expect(screen.getByText(/Step 1 of 3/)).toBeInTheDocument()
    expect(screen.getByText('Pick a ticker')).toBeInTheDocument()
    expect(screen.queryByText('Submit')).toBeNull()
  })

  it('follows the form forward', () => {
    tracker([true, false, false])
    expect(screen.getByText(/Step 2 of 3/)).toBeInTheDocument()
    expect(screen.getByText('Add a thesis and portfolio')).toBeInTheDocument()
  })

  /** Completion is unchanged; only how much of it is drawn. */
  it('says so when every step is done', () => {
    tracker([true, true, true])
    expect(screen.getByText(/done/i)).toBeInTheDocument()
  })

  /**
   * It is already the size a collapsed tracker would be, so it is pinned
   * rather than made to shrink — a card that shrinks as you scroll moves
   * everything under it at the moment you start reading.
   */
  it('stays put without a second, larger state to shrink from', () => {
    const { container } = tracker([false, false, false])
    const el = container.querySelector('[data-slot="pilot-capture-tracker"]')!
    expect(el.className).toContain('sticky')
    expect(el.className).toContain('top-0')
    // One row: no stacked list of steps left in it.
    expect(el.querySelector('ol')).toBeNull()
  })

  it('keeps its dismiss', () => {
    const onDismiss = vi.fn()
    tracker([false, false, false], onDismiss)
    fireEvent.click(screen.getByLabelText('Dismiss capture intro'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

/*
 * ── Back joins the header ──────────────────────────────────────────────────
 *
 * The pane owns the header and the view owns the mode that decides whether
 * there is anywhere to go back to, so the view reports the action and the pane
 * decides where the control sits.
 */
describe('where back lives', () => {
  const pane = () => readFileSync(
    path.join(process.cwd(), 'src/components/communication/CommunicationPane.tsx'), 'utf8')
  const thoughts = () => readFileSync(
    path.join(process.cwd(), 'src/components/communication/ThoughtsSection.tsx'), 'utf8')

  it('is drawn by the header, leading the row', () => {
    expect(pane()).toContain('data-slot="pane-back"')
    expect(pane()).toContain('isMobile && backAction')
  })

  it('is decided by the view, and withdrawn when it stops applying', () => {
    const s = thoughts()
    expect(s).toContain('onBackActionChange')
    expect(s).toContain("const active = isMobileViewport && captureMode !== 'collapsed'")
    expect(s).toContain('return () => onBackActionChange(null)')
  })

  /**
   * A new function every render would report a new action every render, and
   * the pane storing it would re-render this component to produce the next.
   */
  it('reports a stable handler', () => {
    expect(thoughts()).toMatch(/const handleCaptureCancel = useCallback\(/)
  })

  /** The desktop rail has the room, and keeps the row it had. */
  it('leaves the desktop row alone', () => {
    expect(thoughts()).toContain("captureMode !== 'collapsed' && !isMobileViewport && (")
  })
})
