/**
 * What can happen to a requirement.
 *
 * The defect under test: one handler cycled
 * `unchecked → completed → na → unchecked`, so "Reopen" on a completed
 * requirement marked it Not Applicable — and because N/A satisfies a stage,
 * the progress count did not move either, leaving the reader no signal that
 * anything unexpected had happened.
 *
 * So the rules are asserted as a table of every state and every action,
 * including the eight combinations that must be refused. An exhaustive
 * table is the only honest shape here: a transition map is exactly the kind
 * of thing that grows a wrong edge later.
 */
import { describe, it, expect } from 'vitest'
import {
  statusOf, isSatisfied, primaryAction, secondaryActions,
  resolveTransition, completionMetadata, describe as describeStatus,
  ACTION_LABEL,
  type RequirementStatus, type RequirementAction,
} from '../requirement-status'

const STATES: RequirementStatus[] = ['unchecked', 'completed', 'na']
const ACTIONS: RequirementAction[] = ['complete', 'reopen', 'mark_na', 'restore']

/** The whole truth table. `null` means the action must be refused. */
const EXPECTED: Record<RequirementStatus, Record<RequirementAction, RequirementStatus | null>> = {
  unchecked: { complete: 'completed', reopen: null,        mark_na: 'na', restore: null },
  completed: { complete: null,        reopen: 'unchecked', mark_na: null, restore: null },
  na:        { complete: null,        reopen: null,        mark_na: null, restore: 'unchecked' },
}

describe('the four supported transitions', () => {
  it('Open → Mark complete → Completed', () => {
    expect(resolveTransition('unchecked', 'complete')).toEqual({ ok: true, to: 'completed' })
  })
  it('Completed → Reopen → Open', () => {
    expect(resolveTransition('completed', 'reopen')).toEqual({ ok: true, to: 'unchecked' })
  })
  it('Open → Mark not applicable → N/A', () => {
    expect(resolveTransition('unchecked', 'mark_na')).toEqual({ ok: true, to: 'na' })
  })
  it('N/A → Restore → Open', () => {
    expect(resolveTransition('na', 'restore')).toEqual({ ok: true, to: 'unchecked' })
  })
})

describe('every other combination is refused', () => {
  for (const from of STATES) {
    for (const action of ACTIONS) {
      const to = EXPECTED[from][action]
      if (to) continue
      it(`${from} cannot be ${action}`, () => {
        const r = resolveTransition(from, action)
        expect(r.ok).toBe(false)
        expect(r.to).toBeUndefined()
        // Refusal carries a reason, so the surface can say what happened
        // rather than throwing or silently doing nothing.
        expect(r.reason).toBeTruthy()
      })
    }
  }

  it('never offers the old shortcut from completed to not applicable', () => {
    const r = resolveTransition('completed', 'mark_na')
    expect(r.ok).toBe(false)
    // And it says what to do instead, because this is the one refusal a
    // reader will actually hit.
    expect(r.reason).toMatch(/reopen/i)
  })

  it('rejects an action that does not exist', () => {
    expect(resolveTransition('unchecked', 'detonate' as RequirementAction).ok).toBe(false)
  })
})

describe('the control a single affordance should perform', () => {
  it('is complete when open, reopen when complete, restore when n/a', () => {
    expect(primaryAction('unchecked')).toBe('complete')
    expect(primaryAction('completed')).toBe('reopen')
    expect(primaryAction('na')).toBe('restore')
  })

  it('always names a transition that is legal from that state', () => {
    for (const from of STATES) {
      expect(resolveTransition(from, primaryAction(from)).ok).toBe(true)
    }
  })

  it('offers mark_na only where the requirement is open', () => {
    expect(secondaryActions('unchecked')).toEqual(['mark_na'])
    expect(secondaryActions('completed')).toEqual([])
    expect(secondaryActions('na')).toEqual([])
  })

  it('offers no action that is illegal from its own state', () => {
    for (const from of STATES) {
      for (const a of secondaryActions(from)) {
        expect(resolveTransition(from, a).ok).toBe(true)
      }
    }
  })

  it('labels every action', () => {
    for (const a of ACTIONS) expect(ACTION_LABEL[a]).toBeTruthy()
  })
})

describe('reading the stored status', () => {
  it('prefers `status` and falls back to the older `completed` column', () => {
    expect(statusOf({ status: 'na', completed: false })).toBe('na')
    expect(statusOf({ status: 'completed' })).toBe('completed')
    expect(statusOf({ completed: true })).toBe('completed')
    expect(statusOf({ completed: false })).toBe('unchecked')
    expect(statusOf({})).toBe('unchecked')
  })

  it('does not trust an unrecognised status value', () => {
    // A row written by something that does not share this vocabulary must
    // not become a fourth state.
    expect(statusOf({ status: 'archived', completed: true })).toBe('completed')
    expect(statusOf({ status: null, completed: false })).toBe('unchecked')
  })
})

describe('N/A still satisfies a stage', () => {
  it('counts completed and n/a alike, and open not at all', () => {
    // The established rule. Changing it would silently alter the meaning
    // of every historical stage that was advanced over an N/A item.
    expect(isSatisfied('completed')).toBe(true)
    expect(isSatisfied('na')).toBe(true)
    expect(isSatisfied('unchecked')).toBe(false)
  })
})

describe('completion metadata follows the destination', () => {
  const NOW = () => '2026-10-22T12:00:00.000Z'

  it('stamps an actor and a time when the requirement becomes satisfied', () => {
    expect(completionMetadata('completed', 'user-1', NOW)).toEqual({
      completed: true, status: 'completed',
      completedAt: '2026-10-22T12:00:00.000Z', completedBy: 'user-1',
    })
    // N/A is a decision with an author too.
    expect(completionMetadata('na', 'user-1', NOW)).toEqual({
      completed: false, status: 'na',
      completedAt: '2026-10-22T12:00:00.000Z', completedBy: 'user-1',
    })
  })

  it('clears both when the requirement returns to open', () => {
    // `undefined` is how the existing mutation writes NULL — it sends
    // `completedAt || null` — so reopening drops the stamp and the actor.
    // A requirement that is open again was not completed by anybody.
    expect(completionMetadata('unchecked', 'user-1', NOW)).toEqual({
      completed: false, status: 'unchecked',
      completedAt: undefined, completedBy: undefined,
    })
  })

  it('keeps `completed` false for n/a, so the boolean never lies', () => {
    expect(completionMetadata('na', 'user-1', NOW).completed).toBe(false)
  })

  it('tolerates a missing actor without inventing one', () => {
    expect(completionMetadata('completed', undefined, NOW).completedBy).toBeUndefined()
  })
})

describe('wording', () => {
  it('describes each state the way the UI says it', () => {
    expect(describeStatus('unchecked')).toBe('open')
    expect(describeStatus('completed')).toBe('complete')
    expect(describeStatus('na')).toBe('not applicable')
  })
})
