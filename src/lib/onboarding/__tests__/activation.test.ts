import { beforeEach, describe, expect, it, vi } from 'vitest'

const emitAuditEvent = vi.fn()

/**
 * Milestones already present in the stubbed audit log.
 *
 * Per-milestone rather than one flat row list: `evaluateActivation` asks about
 * three different milestones in one call — both halves, then `activated`
 * itself through `markActivationMilestone` — so a stub that answers the same
 * way for every action_type cannot express "both halves recorded, not yet
 * activated", which is the only state that test is about.
 */
const recorded = new Set<string>()

vi.mock('../../audit/audit-service', () => ({
  emitAuditEvent: (...args: any[]) => emitAuditEvent(...args),
}))

vi.mock('../../supabase', () => ({
  supabase: {
    from: () => {
      const filters: Record<string, unknown> = {}
      const builder: any = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters[col] = val
          return builder
        },
        limit: () =>
          Promise.resolve({
            data: recorded.has(String(filters.action_type)) ? [{ id: 'existing' }] : [],
            error: null,
          }),
      }
      return builder
    },
  },
}))

import {
  __resetActivationGuard,
  evaluateActivation,
  markActivationMilestone,
} from '../activation'

const ctx = { userId: 'user-1', orgId: 'org-1' }

beforeEach(() => {
  __resetActivationGuard()
  emitAuditEvent.mockReset()
  emitAuditEvent.mockResolvedValue('event-id')
  recorded.clear()
})

describe('markActivationMilestone', () => {
  it('writes a milestone against the user entity', async () => {
    const wrote = await markActivationMilestone('coverage_established', ctx)

    expect(wrote).toBe(true)
    expect(emitAuditEvent).toHaveBeenCalledTimes(1)

    const call = emitAuditEvent.mock.calls[0][0]
    expect(call.entity).toMatchObject({ type: 'user', id: 'user-1' })
    expect(call.action).toEqual({ type: 'coverage_established', category: 'system' })
    expect(call.orgId).toBe('org-1')
    expect(call.metadata.milestone).toBe('coverage_established')
  })

  /**
   * The lesson `usePilotProgress` paid for: milestone marks fire from effects,
   * effects re-fire, and an unguarded mark once put 10,000 rows into a
   * telemetry table. The guard is checked synchronously, so a burst issued in
   * one microtask coordinates rather than racing.
   */
  it('writes once per user and org even under a concurrent burst', async () => {
    const results = await Promise.all([
      markActivationMilestone('coverage_established', ctx),
      markActivationMilestone('coverage_established', ctx),
      markActivationMilestone('coverage_established', ctx),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(emitAuditEvent).toHaveBeenCalledTimes(1)
  })

  it('does not write again when the milestone is already in the audit log', async () => {
    recorded.add('coverage_established')

    expect(await markActivationMilestone('coverage_established', ctx)).toBe(false)
    expect(emitAuditEvent).not.toHaveBeenCalled()
  })

  /**
   * `audit_events.org_id` makes a tenant-less milestone unattributable, and an
   * unattributable milestone corrupts every per-org count it lands in — which
   * is the only way these numbers are ever read.
   */
  it('is a no-op without an organization', async () => {
    expect(
      await markActivationMilestone('coverage_established', {
        userId: 'user-1',
        orgId: null,
      }),
    ).toBe(false)
    expect(emitAuditEvent).not.toHaveBeenCalled()
  })

  it('releases the guard when the write fails, so a retry can succeed', async () => {
    emitAuditEvent.mockRejectedValueOnce(new Error('network'))
    expect(await markActivationMilestone('first_judgment', ctx)).toBe(false)

    emitAuditEvent.mockResolvedValueOnce('event-id')
    expect(await markActivationMilestone('first_judgment', ctx)).toBe(true)
  })

  it('never throws when the audit write rejects', async () => {
    emitAuditEvent.mockRejectedValue(new Error('boom'))
    await expect(
      markActivationMilestone('coverage_established', ctx),
    ).resolves.toBe(false)
  })
})

describe('evaluateActivation', () => {
  /**
   * Activation is BOTH halves. Coverage alone is the state 20 pilot workspaces
   * would be in the moment they answer the prompt, and calling that activated
   * is exactly the over-counting this definition exists to avoid.
   */
  it('does not activate on coverage alone', async () => {
    recorded.add('coverage_established')

    expect(await evaluateActivation(ctx)).toBe(false)
    expect(emitAuditEvent).not.toHaveBeenCalled()
  })

  it('does not activate on a judgment alone', async () => {
    recorded.add('first_judgment')

    expect(await evaluateActivation(ctx)).toBe(false)
    expect(emitAuditEvent).not.toHaveBeenCalled()
  })

  it('activates once both halves are recorded', async () => {
    recorded.add('coverage_established')
    recorded.add('first_judgment')

    expect(await evaluateActivation(ctx)).toBe(true)

    const call = emitAuditEvent.mock.calls[0][0]
    expect(call.action.type).toBe('activated')
    expect(call.metadata.basis).toBe('coverage_established + first_judgment')
  })

  it('is a no-op without an organization', async () => {
    recorded.add('coverage_established')
    recorded.add('first_judgment')
    expect(
      await evaluateActivation({ userId: 'user-1', orgId: null }),
    ).toBe(false)
  })
})
