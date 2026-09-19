/**
 * The first Pipeline step, earned wherever the stage actually changed.
 *
 * It used to be marked inside the desktop board's drop handler. That made two
 * bugs at once: a pilot who advanced the tutorial idea from the phone's stage
 * sheet never completed the step, and a drop the server went on to reject
 * completed it anyway.
 */

import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderHook, act, cleanup } from '@testing-library/react'

const pilotMode = vi.hoisted(() => ({ effectiveIsPilot: true }))
const progress = vi.hoisted(() => ({
  hasCompletedPipelineStepMoved: false,
  mark: vi.fn(),
}))

vi.mock('../usePilotMode', () => ({ usePilotMode: () => pilotMode }))
vi.mock('../usePilotProgress', () => ({ usePilotProgress: () => progress }))

import { usePipelineMoveMarker } from '../usePipelineMoveMarker'

beforeEach(() => {
  pilotMode.effectiveIsPilot = true
  progress.hasCompletedPipelineStepMoved = false
  progress.mark.mockClear()
})
afterEach(cleanup)

const fire = () => {
  const { result } = renderHook(() => usePipelineMoveMarker())
  act(() => result.current())
}

describe('usePipelineMoveMarker', () => {
  it('records the canonical stage for a pilot', () => {
    fire()
    expect(progress.mark).toHaveBeenCalledWith('pipeline_step_moved')
  })

  /** Every user in the product moves ideas; only pilots are being taught. */
  it('writes nothing for a non-pilot', () => {
    pilotMode.effectiveIsPilot = false
    fire()
    expect(progress.mark).not.toHaveBeenCalled()
  })

  /** Moving is a routine action — no reason to spend a write once it is done. */
  it('writes nothing once the step is already complete', () => {
    progress.hasCompletedPipelineStepMoved = true
    fire()
    expect(progress.mark).not.toHaveBeenCalled()
  })
})

/*
 * These read source rather than render, because the claim is about WHERE the
 * step is marked, which no render can observe.
 */
const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('both shells reach the marker through one move path', () => {
  const service = src('hooks/useTradeIdeaService.ts')

  it('marks from the shared service, not from either board', () => {
    expect(service).toContain('usePipelineMoveMarker')
    for (const shell of ['pages/TradeQueuePage.tsx', 'components/mobile/MobilePipeline.tsx']) {
      expect(src(shell)).not.toContain("markPilotStage('pipeline_step_moved')")
    }
  })

  /**
   * Single ideas and pair trades are separate mutations, and a phone commits
   * either one from the same sheet, so both have to mark.
   */
  it('marks on both move mutations', () => {
    const marks = service.match(/markPipelineMoved\(\)/g) ?? []
    expect(marks.length).toBe(2)
  })

  /** A rejected move must not complete the lesson. */
  it('marks only from a success path', () => {
    for (const call of service.split('markPipelineMoved()').slice(0, -1)) {
      const lastSuccess = call.lastIndexOf('onSuccess')
      const lastError = call.lastIndexOf('onError')
      const lastMutationFn = call.lastIndexOf('mutationFn')
      expect(lastSuccess).toBeGreaterThan(lastError)
      expect(lastSuccess).toBeGreaterThan(lastMutationFn)
    }
  })
})
