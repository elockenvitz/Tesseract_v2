/**
 * A decided idea must stop presenting itself as awaiting a decision.
 *
 * The production SHOP idea sat at `stage='ready_to_recommend'`,
 * `status='deciding'`, `outcome=NULL` AFTER the PM had approved it — which
 * is the maximally-active state on every surface. It was offering the PM a
 * decision they had already made.
 *
 * These pin the membership rules the fan-in relies on: writing `outcome`
 * is what removes an idea, `stage` is irrelevant to liveness, and all three
 * surfaces agree. If any one of them stopped honouring `outcome`, a
 * concluded idea would reappear on that surface alone.
 */
import { describe, it, expect } from 'vitest'
import { isTerminalIdea, isLiveIdea, TERMINAL_STATUSES } from '../../trade-status-semantics'
import { isOpenProposal, OPEN_PROPOSAL_STATUSES } from '../open-proposal'
import { COMMITTED_PIPELINE_STATUSES, ARCHIVED_PIPELINE_STATUSES } from '../../mobile/pipeline-rows'

/** The state the production idea was stranded in. */
const AWAITING = { status: 'deciding', stage: 'ready_to_recommend', outcome: null } as never

/** The same idea after an approval concludes it. */
const APPROVED = { status: 'executed', stage: 'ready_to_recommend', outcome: 'executed' } as never

/** The same idea after every portfolio rejected it. */
const REJECTED = { status: 'rejected', stage: 'ready_to_recommend', outcome: 'rejected' } as never

describe('before the decision is recorded', () => {
  it('the idea is live and open — correctly, while it still awaits a PM', () => {
    expect(isLiveIdea(AWAITING)).toBe(true)
    expect(isTerminalIdea(AWAITING)).toBe(false)
    expect(isOpenProposal(AWAITING)).toBe(true)
  })

  it('this is exactly the state production was stuck in after an approval', () => {
    // Documenting the bug in the one place someone will look when it
    // recurs: approval had happened, and nothing about the row said so.
    expect(AWAITING).toMatchObject({ status: 'deciding', outcome: null })
  })
})

describe('after the fan-in concludes it', () => {
  for (const [label, row] of [['approved', APPROVED], ['rejected', REJECTED]] as const) {
    it(`an ${label} idea is terminal`, () => {
      expect(isTerminalIdea(row)).toBe(true)
      expect(isLiveIdea(row)).toBe(false)
    })

    it(`an ${label} idea is no longer an open proposal`, () => {
      expect(isOpenProposal(row)).toBe(false)
    })

    it(`an ${label} idea leaves the mobile pipeline`, () => {
      const status = (row as unknown as { status: string }).status
      const hidden =
        COMMITTED_PIPELINE_STATUSES.includes(status) || ARCHIVED_PIPELINE_STATUSES.includes(status)
      expect(hidden).toBe(true)
    })

    it(`an ${label} idea's status is terminal on the desktop board`, () => {
      expect(TERMINAL_STATUSES).toContain((row as unknown as { status: string }).status)
    })
  }
})

describe('the axes stay separate', () => {
  it('stage alone never removes an idea', () => {
    // Reaching the last research stage is maturity, not a decision. An idea
    // can sit at ready_to_recommend indefinitely and must stay live.
    expect(isLiveIdea({ status: 'idea', stage: 'ready_to_recommend', outcome: null } as never)).toBe(true)
  })

  it('an outcome removes an idea regardless of stage', () => {
    // Which is why the fan-in writes `outcome` and leaves `stage` alone.
    expect(isTerminalIdea({ status: 'executed', stage: 'exploring', outcome: 'executed' } as never)).toBe(true)
  })

  it('deciding is an OPEN status, so it can never be the terminal state', () => {
    // `stageToLegacyStatus` derives 'deciding' from ready_to_recommend with
    // no outcome. If a decision left the row there, it would stay open.
    expect(OPEN_PROPOSAL_STATUSES).toContain('deciding')
    expect(TERMINAL_STATUSES).not.toContain('deciding')
  })
})
