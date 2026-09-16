/**
 * The graduation celebration opens on graduation, and on nothing else.
 *
 * It used to open on `pending_graduation_modal`, a localStorage flag the
 * Outcomes banner wrote the moment its three browser-local step flags were set.
 * Three booleans in one browser are not graduation. The modal could say "the
 * full app is unlocked" to a reader whose every tab was still gated and whose
 * "Open the Dashboard" button dropped them back on the pilot mission home — and
 * it said nothing at all to a pilot who graduated on another machine.
 *
 * `hasGraduated` is the durable, per-org, server-backed answer, and it is the
 * same value that widens access and retires Pilot Home. These pin that the
 * modal cannot disagree with it in either direction.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const pilot = vi.hoisted(() => ({
  hasGraduated: false,
  hasCelebratedGraduation: false,
  mark: vi.fn(),
}))

vi.mock('../../../hooks/usePilotProgress', () => ({
  usePilotProgress: () => pilot,
}))

import { PilotGraduationModal } from '../PilotGraduationModal'

const USER = 'user-1'
const ORG = 'org-1'

/** The flag the old trigger used, and the one the old dismissal used. */
const legacyFlag = (suffix: string) =>
  `pilot_outcomes_intro_${suffix}_${USER}_${ORG}`

const mount = () =>
  render(
    <PilotGraduationModal userId={USER} orgId={ORG} onOpenDashboard={() => {}} onOpenAppLauncher={() => {}} />,
  )

const celebration = () => screen.queryByText('The full app is unlocked')

beforeEach(() => {
  localStorage.clear()
  pilot.hasGraduated = false
  pilot.hasCelebratedGraduation = false
  pilot.mark.mockClear()
})
afterEach(cleanup)

describe('before graduation is durable', () => {
  it('stays shut even with every local step flag and the old pending flag set', () => {
    localStorage.setItem(legacyFlag('inspected'), '1')
    localStorage.setItem(legacyFlag('next_action'), '1')
    localStorage.setItem(legacyFlag('research'), '1')
    localStorage.setItem(legacyFlag('pending_graduation_modal'), '1')
    mount()
    expect(celebration()).toBeNull()
  })

  it('stays shut for a pilot who has not finished', () => {
    mount()
    expect(celebration()).toBeNull()
  })
})

describe('once graduation is durable', () => {
  beforeEach(() => { pilot.hasGraduated = true })

  it('celebrates, with no local flag anywhere', () => {
    mount()
    expect(celebration()).not.toBeNull()
  })

  it('does not celebrate a pilot who already acknowledged it on another device', () => {
    pilot.hasCelebratedGraduation = true
    mount()
    expect(celebration()).toBeNull()
  })

  it('does not re-celebrate a pilot who acknowledged it before the durable flag existed', () => {
    localStorage.setItem(legacyFlag('graduation_dismissed'), '1')
    mount()
    expect(celebration()).toBeNull()
  })

  it('records the acknowledgement durably, and closes on the click', () => {
    mount()
    fireEvent.click(screen.getByText('Keep exploring on this page'))
    expect(pilot.mark).toHaveBeenCalledWith('graduation_celebrated')
    expect(celebration()).toBeNull()
    // ...and locally too, so a browser that has not synced still behaves.
    expect(localStorage.getItem(legacyFlag('graduation_dismissed'))).toBe('1')
  })

  it('still records it when the reader leaves through one of the two destinations', () => {
    mount()
    fireEvent.click(screen.getByText('Open the Dashboard'))
    expect(pilot.mark).toHaveBeenCalledWith('graduation_celebrated')
  })
})

describe('the Outcomes banner retires on the durable mark', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  /* The three step flags are per-browser. A pilot who finished the loop on
     their laptop opened Outcomes on a second device and was asked to finish it
     again, because only the local flags retired the strip. */
  it('hides when the stage is already marked, not only when locally dismissed', () => {
    const banner = src('components/pilot/PilotOutcomesGetStarted.tsx')
    expect(banner).toContain('if (dismissed || stageMarked) return null')
  })
})

describe('the old trigger is gone from both sides', () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

  it('the modal opens on graduation and reads no pending flag to decide it', () => {
    const modal = src('components/pilot/PilotGraduationModal.tsx')
    const open = modal.slice(modal.indexOf('const open ='))
    expect(open.slice(0, open.indexOf('\n'))).toContain('hasGraduated')
    // Nothing anywhere in the file may consult a pending flag.
    expect(modal).not.toMatch(/localStorage\.getItem\((?:(?!\)).)*pending/i)
  })

  it('the Outcomes banner no longer writes it or fires the trigger event', () => {
    const banner = src('components/pilot/PilotOutcomesGetStarted.tsx')
    expect(banner).not.toContain("writeFlag(userId, orgId, PENDING_GRAD)")
    expect(banner).not.toContain('pilot-graduation:trigger')
    // The one thing it does still write.
    expect(banner).toContain("mark('tutorial_outcome_reviewed')")
  })
})
