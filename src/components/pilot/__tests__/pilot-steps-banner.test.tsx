/**
 * One shell, four banners, and a phone that can actually read them.
 *
 * The four per-surface pilot banners were four copies of the same markup that
 * had drifted into four densities. Each set `whitespace-nowrap` on both the
 * title and the hint inside a three-across row with `px-6`, which on a 390px
 * screen is three unbreakable columns in a container that holds one.
 */

import { afterEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { PilotStepsBanner, currentStep, type PilotStep } from '../PilotStepsBanner'

afterEach(cleanup)

const steps = (done: boolean[]): PilotStep[] =>
  done.map((d, i) => ({ n: i + 1, title: `Step ${i + 1}`, hint: `Hint ${i + 1}`, done: d }))

describe('currentStep', () => {
  it('leads with the first unfinished step', () => {
    expect(currentStep(steps([true, false, false]))?.n).toBe(2)
  })

  /** Callers retire their own banner; until they do, show the last step. */
  it('falls back to the last step when everything is done', () => {
    expect(currentStep(steps([true, true, true]))?.n).toBe(3)
  })

  it('has nothing to lead with for no steps', () => {
    expect(currentStep([])).toBeNull()
  })
})

describe('the phone treatment', () => {
  it('shows the current step and a count, not all three', () => {
    render(<PilotStepsBanner steps={steps([true, false, false])} />)
    // The phone half and the desktop half are both in the DOM; the assertion
    // that matters is the count, which only the phone half renders.
    expect(screen.getByText(/Get started · 1 of 3/)).toBeInTheDocument()
  })

  /**
   * The hint IS the instruction. Truncating it leaves a step nobody can
   * follow, which is what the nowrap in all four copies was doing.
   */
  it('lets the current step wrap rather than clip', () => {
    const { container } = render(<PilotStepsBanner steps={steps([false, false, false])} />)
    const phone = container.querySelector('.sm\\:hidden')!
    expect(phone.textContent).toContain('Hint 1')
    expect(phone.querySelector('.whitespace-nowrap')).toBeNull()
  })

  it('offers the action only when the current step has one', () => {
    const onClick = vi.fn()
    const withAction: PilotStep[] = [
      { n: 1, title: 'One', hint: 'H1', done: true },
      { n: 2, title: 'Two', hint: 'H2', onClick },
    ]
    const { container } = render(<PilotStepsBanner steps={withAction} />)
    const phone = container.querySelector('.sm\\:hidden')!
    const button = phone.querySelector('button')!
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})

describe('identity is preserved, density is shared', () => {
  /** Outcomes is the end of the loop and still says so, in its own colour. */
  it('keeps a caller s own label', () => {
    render(<PilotStepsBanner steps={steps([false, false, false])} label="Finish the loop" tone="emerald" />)
    expect(screen.getAllByText(/Finish the loop/)[0]).toBeInTheDocument()
  })

  it('still renders every step on a wide screen', () => {
    const { container } = render(<PilotStepsBanner steps={steps([false, false, false])} />)
    const wide = container.querySelector('.sm\\:flex')!
    for (const n of [1, 2, 3]) expect(wide.textContent).toContain(`Step ${n}`)
  })

  it('renders nothing at all without steps', () => {
    const { container } = render(<PilotStepsBanner steps={[]} />)
    expect(container.firstChild).toBeNull()
  })
})
