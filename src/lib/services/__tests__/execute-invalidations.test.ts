/**
 * What has to be re-read after a commit, and that both execute paths ask for
 * all of it.
 *
 * Single-execute and bulk-execute run the same pipeline and change the same
 * rows, but each kept its own hand-written invalidation list, and the
 * single-trade one had drifted five keys behind. The visible consequence: a
 * pilot executes the one trade the mission asks for, opens Outcomes, and sees
 * pre-commit state — `decision-accountability` was only in the other list.
 *
 * The keys are asserted against the tables `executeSimVariants` actually
 * writes, so this fails if someone adds a key that nothing justifies as well as
 * if someone drops one that something does.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { EXECUTE_INVALIDATION_KEYS, invalidateAfterExecute } from '../execute-invalidations'
import { pilotCommittedTradeKey } from '../../pilot/pilot-unlocks'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('the list', () => {
  it('asks for every key exactly once, as a prefix', () => {
    const client = { invalidateQueries: vi.fn(), setQueryData: vi.fn() }
    invalidateAfterExecute(client)
    expect(client.invalidateQueries).toHaveBeenCalledTimes(EXECUTE_INVALIDATION_KEYS.length)
    const asked = client.invalidateQueries.mock.calls.map(c => c[0].queryKey)
    // One-element keys: a prefix, so portfolio-scoped variants underneath are
    // covered without naming each portfolio.
    for (const key of asked) expect(key).toHaveLength(1)
    expect(new Set(asked.map(k => k[0])).size).toBe(EXECUTE_INVALIDATION_KEYS.length)
  })

  it('covers what the destinations of the commit read', () => {
    // Trade Book, Outcomes, the mission's stage 3, and the holdings a paper
    // portfolio just had changed.
    for (const key of [
      'accepted-trades',
      'trade-batches',
      'decision-accountability',
      'pilot-mission',
      'portfolio-holdings',
      'desktop-portfolio',
    ]) {
      expect(EXECUTE_INVALIDATION_KEYS).toContain(key)
    }
  })

  /* Each of these is here because the pipeline writes the table behind it. If
     one stops being written, it should leave this list rather than linger. */
  it.each([
    ['decision-requests', "from('decision_requests')"],
    ['trade-queue-items', "from('trade_queue_items')"],
    ['trade-lab-proposals', "from('trade_proposals')"],
    ['trade-batches', "from('trade_batches')"],
    ['intent-variants', "from('simulation_trades')"],
    ['simulation', "from('simulations')"],
  ])('%s is justified by a write the pipeline makes', (key, write) => {
    expect(EXECUTE_INVALIDATION_KEYS).toContain(key)
    expect(src('lib/services/execute-sim-variants-service.ts')).toContain(write)
  })
})

/*
 * The gate that opens Trade Book asks whether this pilot has any committed
 * trade in this org. Before the execute that was honestly `false` and cached
 * as such; invalidating starts a refetch but leaves the old `false` standing
 * while it runs. So the reader pressed Execute, got the Decision Recorded
 * modal, clicked through, and Trade Book told them it "opens once you execute
 * a trade".
 */
describe('the pilot gate after a commit', () => {
  const client = () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() })

  it('is told the answer this callback already has', () => {
    const c = client()
    invalidateAfterExecute(c, { orgId: 'org-1', userId: 'user-1' })
    expect(c.setQueryData).toHaveBeenCalledTimes(1)
    const [key, value] = c.setQueryData.mock.calls[0]
    expect(value).toBe(true)
    expect(key).toEqual(pilotCommittedTradeKey('org-1', 'user-1'))
  })

  /* It is a seed, not a substitute: the refetch still runs and the server's
     own answer replaces it. */
  it('still re-reads everything alongside the seed', () => {
    const c = client()
    invalidateAfterExecute(c, { orgId: 'org-1', userId: 'user-1' })
    expect(c.invalidateQueries).toHaveBeenCalledTimes(EXECUTE_INVALIDATION_KEYS.length)
  })

  it.each([
    ['no identity at all', undefined],
    ['no org', { orgId: null, userId: 'user-1' }],
    ['no user', { orgId: 'org-1', userId: undefined }],
  ])('writes nothing when there is %s', (_name, pilot) => {
    const c = client()
    invalidateAfterExecute(c, pilot as never)
    expect(c.setQueryData).not.toHaveBeenCalled()
    expect(c.invalidateQueries).toHaveBeenCalledTimes(EXECUTE_INVALIDATION_KEYS.length)
  })
})

describe('both execute paths', () => {
  const page = src('pages/SimulationPage.tsx')

  it('use the shared list and keep no list of their own', () => {
    expect(page.match(/invalidateAfterExecute\(queryClient,/g)).toHaveLength(2)
  })

  /* The drift happened because the keys were written out by hand twice. A
     bare invalidate inside an execute handler is how that starts again. */
  it('leave no hand-written invalidate in either execute handler', () => {
    const single = page.slice(
      page.indexOf("setDecisionRecord(buildDecisionRecord({\n        trades: data.trades"),
      page.indexOf("toast.error('Execute failed', err.message)"),
    )
    expect(single).not.toContain('queryClient.invalidateQueries({ queryKey:')
  })
})
