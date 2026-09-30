/**
 * A refused stage move is a detour, not a wall.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * Tapping Ready to Recommend on an idea with no thesis raised
 * "Cannot move to Ready to Recommend — missing: Trade thesis" as a toast, and
 * that was the end of it. The toast named the field and then vanished; the
 * reader had to find it themselves.
 *
 * Worse, on an idea at Exploring or Researching the field was not on screen to
 * find. `TradeIdeaDetailModal` only renders the Trade Thesis block from
 * Developing onward, so jumping two stages asked for something the surface was
 * actively hiding. That is the loop this closes.
 *
 * ── What replaces it ─────────────────────────────────────────────────────
 *
 * The move is parked rather than thrown away, the blocking field is revealed
 * and opened, and the save that satisfies the last requirement carries the
 * move with it — under a button that says so. Nothing advances a stage as a
 * side effect of typing: stage is the whole desk's shared state.
 *
 * The gate itself does not move. `missingForStage` is unchanged and the
 * service still refuses, which is what protects callers that never render this
 * component.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { missingForStage } from '../../../lib/ideas/stage-model'
import { BlockedMoveNotice } from '../TradeIdeaDetailModal'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
const modal = src('components/trading/TradeIdeaDetailModal.tsx')
const service = src('lib/services/trade-idea-service.ts')

describe('the gate is unchanged', () => {
  it('still requires a rationale and a thesis for the final stage', () => {
    expect(missingForStage({ rationale: null, thesis_text: null }, 'ready_to_recommend'))
      .toEqual(['Why now (rationale)', 'Trade thesis'])
    expect(missingForStage({ rationale: 'why', thesis_text: null }, 'ready_to_recommend'))
      .toEqual(['Trade thesis'])
    expect(missingForStage({ rationale: 'why', thesis_text: 'thesis' }, 'ready_to_recommend'))
      .toEqual([])
  })

  it('still gates nothing before the final stage', () => {
    expect(missingForStage({ rationale: null, thesis_text: null }, 'developing')).toEqual([])
  })

  /**
   * The UI check is a courtesy, not the rule. A bulk move, an import, or a
   * surface written next year never renders this component and must still be
   * refused.
   */
  it('is still enforced by the service, not only by the modal', () => {
    expect(service).toContain('throw new Error(gateErrorMessage(target.stage, missing))')
    expect(service).toMatch(/Cannot move pair trade to \$\{stageLabel\(target\.stage\)\}/)
  })
})

describe('every stage tap is checked before it is sent', () => {
  it('routes both ladders through requestStageMove', () => {
    expect([...modal.matchAll(/canClick && requestStageMove\(stage\)/g)]).toHaveLength(2)
    // No ladder button queues a move without asking the gate first.
    expect(modal).not.toContain('canClick && setPendingStageMove(stage)')
  })

  it('parks the move instead of discarding it, and opens the details tab', () => {
    const fn = modal.slice(modal.indexOf('const requestStageMove ='))
    const body = fn.slice(0, fn.indexOf('\n  const clearBlockedMove'))
    expect(body).toContain('missingForStage(gateSubject, stage)')
    expect(body).toContain('setBlockedMove({ stage, missing })')
    expect(body).toContain("setActiveTab('details')")
    expect(body).toContain('openFirstBlocker(missing)')
  })

  /**
   * The trap the user hit: told to write a thesis on a surface that does not
   * render the thesis editor until a later stage.
   */
  it('reveals the thesis editor while a move is waiting on it, in both trees', () => {
    expect([...modal.matchAll(/!!blockedMove\?\.missing\.includes\('Trade thesis'\)/g)])
      .toHaveLength(2)
  })
})

describe('the save that completes the move', () => {
  it('re-runs the gate against the saved value rather than assuming', () => {
    const fn = modal.slice(modal.indexOf('const saveGatedField ='))
    const body = fn.slice(0, fn.indexOf('\n  /** The move completes'))
    expect(body).toContain('const text = value.trim()')
    expect(body).toContain('missingForStage(next, blockedMove.stage)')
    // Still short of the bar: re-park, do not move.
    expect(body).toContain('setBlockedMove({ stage: blockedMove.stage, missing: stillMissing })')
  })

  it('only promises the move when nothing else is outstanding', () => {
    const fn = modal.slice(modal.indexOf('const isLastBlocker ='))
    expect(fn.slice(0, 400)).toContain('blockedMove.missing.length === 1')
  })

  it('names the destination on the button that performs it', () => {
    expect(modal).toContain('`Save & move to ${')
    expect([...modal.matchAll(/gatedSaveLabel\('rationale'\)/g)]).toHaveLength(2)
    expect([...modal.matchAll(/gatedSaveLabel\('thesis'\)/g)]).toHaveLength(2)
  })
})

describe('the notice', () => {
  const blocked = { stage: 'ready_to_recommend', missing: ['Trade thesis'] }

  it('renders nothing when no move is parked', () => {
    const { container } = render(
      <BlockedMoveNotice blocked={null} canEdit onCancel={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('names the stage and what it is waiting for', () => {
    const { container } = render(
      <BlockedMoveNotice blocked={blocked} canEdit onCancel={vi.fn()} />,
    )
    expect(container.textContent).toContain('Ready to Recommend')
    expect(container.textContent).toContain('trade thesis')
  })

  /** Two requirements read as a sentence, not a comma-separated dump. */
  it('lists every outstanding requirement, not just the first', () => {
    const { container } = render(
      <BlockedMoveNotice
        blocked={{ stage: 'ready_to_recommend', missing: ['Why now (rationale)', 'Trade thesis'] }}
        canEdit
        onCancel={vi.fn()}
      />,
    )
    expect(container.textContent).toContain('why now (rationale) and trade thesis')
  })

  /**
   * The stage gate and the edit permission are different rules — a
   * collaborator may advance an idea they cannot rewrite — so the notice has
   * to say something useful to a reader who cannot fix it.
   */
  it('tells a reader who cannot edit why it is stuck, without offering the field', () => {
    const { container } = render(
      <BlockedMoveNotice blocked={blocked} canEdit={false} onCancel={vi.fn()} />,
    )
    expect(container.textContent).toContain('Its creator can add this.')
    expect(container.textContent).not.toContain('Fill it in below')
  })

  it('can be dismissed, which abandons the parked move', () => {
    const onCancel = vi.fn()
    const { getByText } = render(
      <BlockedMoveNotice blocked={blocked} canEdit onCancel={onCancel} />,
    )
    fireEvent.click(getByText('Cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
