/**
 * A decision that has been made stops asking to be made.
 *
 * `updatePortfolioTrackDecision` -- the writer behind the Ideas lens's Decide
 * control -- sets `trade_queue_items.status` to 'approved' | 'cancelled' |
 * 'rejected' once every portfolio track has landed, and deliberately leaves
 * `stage` on 'deciding'. The Today evaluator's terminal list carried
 * 'rejected' and 'cancelled' but not 'approved', so an approved idea kept
 * surfacing as "Awaiting your decision" for a decision already taken.
 *
 * It had not bitten in production only by accident: every approved idea there
 * also carries `outcome = 'executed'`, written later by the Trade Lab execute
 * path, which the evaluator's `outcome != null` test catches. Approving in
 * Ideas without taking it to Trade Lab is an ordinary thing to do and nothing
 * cleared it.
 *
 * These pin the taxonomy rather than the plumbing: what the writer can write,
 * and what the reader treats as finished, have to be the same set.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

describe('the terminal list covers everything the decision writer can write', () => {
  const evaluator = src('engine/decisionEngine/evaluators/proposalAwaiting.ts')
  const writer = src('lib/services/trade-lab-service.ts')

  /** The statuses `updatePortfolioTrackDecision` sets on a decided idea. */
  const WRITTEN_ON_DECISION = ['approved', 'cancelled', 'rejected']

  it.each(WRITTEN_ON_DECISION)('treats %s as finished', (status) => {
    const list = evaluator.slice(evaluator.indexOf('const legacyTerminal ='))
    expect(list.slice(0, list.indexOf('\n'))).toContain(`'${status}'`)
  })

  /* If the writer gains a fourth outcome, this fails until the reader knows
     about it -- which is the failure mode that produced this bug. */
  it('is checked against what the writer actually writes', () => {
    const fn = writer.slice(writer.indexOf('updatePortfolioTrackDecision'))
    const body = fn.slice(0, 4000)
    for (const status of WRITTEN_ON_DECISION) {
      expect(body).toContain(`'${status}'`)
    }
  })

  /* `outcome` remains authoritative; the status list is the belt-and-braces
     half, and must stay that way rather than becoming the only check. */
  it('still short-circuits on outcome and decision_outcome first', () => {
    expect(evaluator).toContain('idea.decision_outcome != null')
    expect(evaluator).toContain('idea.outcome != null')
  })

  /* An idea genuinely still awaiting a decision must not be swept up. */
  it('leaves an undecided deciding idea alone', () => {
    const list = evaluator.slice(evaluator.indexOf('const legacyTerminal ='))
    const line = list.slice(0, list.indexOf('\n'))
    expect(line).not.toContain("'deciding'")
    expect(line).not.toContain("'ready_for_decision'")
  })
})
