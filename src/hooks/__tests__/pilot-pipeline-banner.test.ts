/**
 * One definition of the Pipeline lesson, for two shells.
 *
 * The banner lived inline in `TradeQueuePage`, and a phone renders
 * `MobilePipeline` instead — so it had simply never appeared there. Copying the
 * steps across would have made two definitions of one lesson, and the first
 * copy edit would have made them disagree.
 *
 * These read the source rather than rendering, because the claim is about
 * WHERE the steps are defined, which a render cannot see.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const hook = src('hooks/usePilotPipelineBanner.ts')
const desktop = src('pages/TradeQueuePage.tsx')
const mobile = src('components/mobile/MobilePipeline.tsx')

describe('the Pipeline banner is defined once', () => {
  it('holds all three steps in the hook', () => {
    for (const title of [
      'Drag ideas through the pipeline',
      'Open the Decision Inbox',
      'Open Trade Lab',
    ]) {
      expect(hook).toContain(title)
    }
  })

  it('leaves no copy of the step copy in either shell', () => {
    for (const page of [desktop, mobile]) {
      expect(page).not.toContain('Drag ideas through the pipeline')
      expect(page).not.toContain('Open the Decision Inbox')
    }
  })

  it('derives the same completion flags both shells already used', () => {
    for (const flag of [
      'hasCompletedPipelineStepMoved',
      'hasCompletedPipelineStepInbox',
      'hasCompletedPipelineStepTradeLab',
      'hasDismissedPipelineBanner',
    ]) {
      expect(hook).toContain(flag)
    }
  })

  /** Reading is shared; writing is not. A step is completed by a surface. */
  it('does not write progress from the shared hook', () => {
    expect(hook).not.toContain('markPilotStage')
    expect(hook).not.toContain("mark(")
    // The markers stay with the board, where the actions happen.
    expect(desktop).toContain("markPilotStage('pipeline_step_moved')")
  })
})

describe('both shells render it through the shared shell', () => {
  it.each([
    ['desktop', 'pages/TradeQueuePage.tsx'],
    ['mobile', 'components/mobile/MobilePipeline.tsx'],
  ])('%s uses PilotStepsBanner and the hook', (_name, file) => {
    const page = src(file)
    expect(page).toContain('usePilotPipelineBanner')
    expect(page).toContain('<PilotStepsBanner steps={pilotBanner.steps} />')
    expect(page).toContain('pilotBanner.show')
  })

  /**
   * The board is the subject, so the banner belongs to it: only the pipeline
   * view shows it, not the committed or archived tabs.
   */
  it('shows it on the mobile pipeline view only', () => {
    expect(mobile).toContain("pilotBanner.show && view === 'pipeline'")
  })
})
