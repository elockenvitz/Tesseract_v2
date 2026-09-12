/**
 * The phone's mission shows all five steps, with one of them open.
 *
 * It showed the current step alone, on the argument that a reader has one move
 * to make. True, and it left them unable to see what they were being taught:
 * five steps is the shape of one decision, and a reader on step one who cannot
 * see step five does not know what the product is for. The home also looked
 * empty, which is its own kind of answer about how much is here.
 *
 * Four of the five are not being acted on, so they get a mark and a name. The
 * open one gets the hint and the control, which is the only place either is
 * any use.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import type { MissionStep, MissionStepId } from '../../../lib/pilot/mission'

const state = vi.hoisted(() => ({
  doneUpTo: 0,
  isLoading: false,
  complete: false,
  desktopOnly: false,
}))

const IDS: MissionStepId[] = [
  'idea_created', 'pipeline_advanced', 'simulation_completed',
  'decision_submitted', 'outcome_reviewed',
]
const LABELS = [
  'Capture an investment idea', 'Develop the thesis', 'Test the trade',
  'Make the decision', 'Close the loop',
]

vi.mock('../../../hooks/usePilotMission', () => ({
  usePilotMission: () => {
    const steps: MissionStep[] = IDS.map((id, i) => ({
      id,
      label: LABELS[i],
      hint: `Hint for ${LABELS[i]}`,
      cta: `Go ${i + 1}`,
      done: i < state.doneUpTo,
      available: i <= state.doneUpTo,
      blockedBy: i <= state.doneUpTo ? null : 'Do the previous one first.',
    }))
    return {
      steps,
      completedCount: state.doneUpTo,
      total: 5,
      currentStepId: IDS[Math.min(state.doneUpTo, 4)],
      complete: state.complete,
      tutorialIdeaId: 'idea-1',
      isLoading: state.isLoading,
      setTutorialIdea: vi.fn(),
      markOutcomeReviewed: vi.fn(),
    }
  },
}))

vi.mock('../../../lib/mobile/mobile-surfaces', () => ({
  isDesktopOnly: () => state.desktopOnly,
}))

import { PilotMissionStrip } from '../PilotMissionStrip'

beforeEach(() => {
  state.doneUpTo = 0
  state.isLoading = false
  state.complete = false
  state.desktopOnly = false
})
afterEach(cleanup)

const rows = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-slot="pilot-mission-step"]')]
const stateOf = (c: HTMLElement, i: number) => rows(c)[i].getAttribute('data-state')

describe('the roadmap', () => {
  it('shows the whole journey, not just the next move', () => {
    render(<PilotMissionStrip />)
    for (const label of LABELS) expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('opens exactly one step', () => {
    const { container } = render(<PilotMissionStrip />)
    state.doneUpTo = 2
    expect(rows(container).filter(r => r.getAttribute('data-state') === 'current')).toHaveLength(1)
  })

  it('marks what is done, what is open and what is ahead', () => {
    state.doneUpTo = 2
    const { container } = render(<PilotMissionStrip />)
    expect([0, 1].map(i => stateOf(container, i))).toEqual(['done', 'done'])
    expect(stateOf(container, 2)).toBe('current')
    expect([3, 4].map(i => stateOf(container, i))).toEqual(['future', 'future'])
  })

  /** The hint and the control exist only where either is any use. */
  it('gives the hint and the control to the open step alone', () => {
    state.doneUpTo = 1
    const { container } = render(<PilotMissionStrip />)
    expect(screen.getByText('Hint for Develop the thesis')).toBeInTheDocument()
    expect(screen.queryByText('Hint for Test the trade')).toBeNull()
    expect(container.querySelectorAll('[data-slot="pilot-mission-cta"]')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Go 2' })).toBeInTheDocument()
  })
})

describe('what a row will do', () => {
  /** `available` is the mission's own word for reachable; nothing here decides it. */
  it('leaves a step whose prerequisite is unmet inert', () => {
    state.doneUpTo = 1
    const { container } = render(<PilotMissionStrip />)
    for (const i of [3, 4]) expect(rows(container)[i].tagName).toBe('DIV')
  })

  /** Revisiting what a step taught is the one thing a finished step is for. */
  it('keeps a completed step reachable', () => {
    state.doneUpTo = 2
    const onNavigate = vi.fn()
    const { container } = render(<PilotMissionStrip onNavigate={onNavigate} />)
    const first = rows(container)[1]
    expect(first.tagName).toBe('BUTTON')
    fireEvent.click(first)
    expect(onNavigate).toHaveBeenCalledTimes(1)
  })

  it('routes the open step exactly where it did before', () => {
    state.doneUpTo = 4
    const onNavigate = vi.fn()
    render(<PilotMissionStrip onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Go 5' }))
    expect(onNavigate).toHaveBeenCalledWith(expect.objectContaining({ type: 'outcomes' }))
  })
})

describe('the surfaces a phone cannot reach', () => {
  /**
   * Trade Lab has no phone treatment. Saying so beats routing into something
   * that does not work, and beats faking the step complete.
   */
  it('says a desktop-only step needs a desktop, and offers no control', () => {
    state.doneUpTo = 2
    state.desktopOnly = true
    const { container } = render(<PilotMissionStrip />)
    expect(screen.getByText(/needs a desktop/)).toBeInTheDocument()
    expect(container.querySelectorAll('[data-slot="pilot-mission-cta"]')).toHaveLength(0)
  })
})

describe('what has not changed', () => {
  it('still retires itself when the mission is complete', () => {
    state.complete = true
    const { container } = render(<PilotMissionStrip />)
    expect(container.firstChild).toBeNull()
  })

  it('still holds its room while the mission loads', () => {
    state.isLoading = true
    const { container } = render(<PilotMissionStrip />)
    expect(container.querySelector('[data-slot="pilot-mission-strip-skeleton"]')).not.toBeNull()
  })

  it('still counts position, not completions', () => {
    state.doneUpTo = 2
    render(<PilotMissionStrip />)
    expect(screen.getByText(/step 3 of 5/)).toBeInTheDocument()
  })
})
