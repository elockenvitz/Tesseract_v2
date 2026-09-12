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
import { render, screen, cleanup } from '@testing-library/react'
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

const tracker = (done: boolean[]) => render(<PilotCaptureTracker done={done} />)

describe('the capture tracker', () => {
  it('names the step the reader is on, not both', () => {
    tracker([false, false])
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument()
    expect(screen.getByText('Pick a ticker')).toBeInTheDocument()
    expect(screen.queryByText('Submit the idea')).toBeNull()
  })

  /**
   * There were three. The middle one asked for a thesis and a portfolio, and
   * the form requires neither — so rewriting it as "the form is ready to
   * send" made it truthful and made it redundant: picking the ticker is what
   * makes a single-name idea ready, and the tracker ticked two steps on one
   * action. Inventing a third required action to keep the shape would be the
   * tracker teaching a chore the product does not have.
   */
  it('is the journey the form actually requires', () => {
    tracker([true, false])
    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument()
    expect(screen.getByText('Submit the idea')).toBeInTheDocument()
  })

  it('never asks for a field the form calls optional', () => {
    for (const done of [[false, false], [true, false]]) {
      cleanup()
      const { container } = tracker(done)
      expect(container.textContent).not.toMatch(/thesis|portfolio|context/i)
    }
  })

  /** Completion is unchanged; only how much of it is drawn. */
  it('says so when every step is done', () => {
    tracker([true, true])
    expect(screen.getByText(/done/i)).toBeInTheDocument()
  })

  /**
   * It is already the size a collapsed tracker would be, so it is pinned
   * rather than made to shrink — a card that shrinks as you scroll moves
   * everything under it at the moment you start reading.
   */
  it('stays put without a second, larger state to shrink from', () => {
    const { container } = tracker([false, false])
    const el = container.querySelector('[data-slot="pilot-capture-tracker"]')!
    expect(el.className).toContain('sticky')
    expect(el.className).toContain('top-0')
    // One row: no stacked list of steps left in it.
    expect(el.querySelector('ol')).toBeNull()
  })

  /**
   * These three steps are how a first-time pilot learns what the form is for,
   * so a control that hides them is a control that removes the instructions.
   * It retires itself on the first successful submit, which is the only
   * moment hiding it is the right answer.
   */
  it('offers no way to hide the instructions', () => {
    const { container } = tracker([false, false])
    expect(screen.queryByLabelText('Dismiss capture intro')).toBeNull()
    expect(container.querySelectorAll('button')).toHaveLength(0)
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

/*
 * ── Which durable flag the row reads ───────────────────────────────────────
 *
 * Flag 1 is "a ticker was picked", which fires on the FIRST leg of a pair:
 * true, and not yet enough to submit. Flag 2 is "the form is ready to send" —
 * one asset for a single idea, both legs for a pair — which is the condition
 * the row describes for either shape.
 *
 * All three keys and all three events keep their names and keep being
 * written. A pilot part-way through does not lose progress because the
 * presentation changed.
 */
describe('the two steps are drawn from existing state', () => {
  const thoughts = () => readFileSync(
    path.join(process.cwd(), 'src/components/communication/ThoughtsSection.tsx'), 'utf8')

  it('reads readiness, not the first ticker', () => {
    expect(thoughts()).toContain('<PilotCaptureTracker done={[captureStep2Done, captureStep3Done]} />')
  })

  it('keeps writing every durable flag', () => {
    const s = thoughts()
    for (const n of [1, 2, 3]) expect(s).toContain(`writeCaptureStep(${n})`)
  })

  /**
   * Checked at both ends. The listener subscribes and unsubscribes by name,
   * and the form dispatches by name, so a rename that misses any one of the
   * three leaves a step that can never tick.
   */
  it('renames no event a stored flag is keyed on', () => {
    const listener = thoughts()
    const form = readFileSync(
      path.join(process.cwd(), 'src/components/thoughts/QuickTradeIdeaCapture.tsx'), 'utf8')
    for (const e of [
      'pilot-capture:ticker-picked',
      'pilot-capture:thesis-portfolio-set',
    ]) {
      expect(listener).toContain(`addEventListener('${e}'`)
      expect(listener).toContain(`removeEventListener('${e}'`)
      expect(form).toContain(e)
    }
    // Submit is announced by the pane itself, not by the form.
    expect(listener).toContain("addEventListener('pilot-capture:submitted'")
    expect(listener).toContain("removeEventListener('pilot-capture:submitted'")
    expect(listener).toContain("CustomEvent('pilot-capture:submitted')")
  })
})
