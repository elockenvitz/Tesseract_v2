/**
 * Somebody said the case broke, and the capital is already out the door.
 *
 * Both halves are durable human acts -- a person committed a trade, a person
 * later concluded the written case no longer stands. No text is compared, no
 * history diffed, nothing generated.
 *
 * The suite guards three things that are easy to get quietly wrong:
 *
 *   1. `holds` must never qualify. It is the OPPOSITE claim, and surfacing it
 *      would teach people that recording agreement summons an alarm.
 *   2. One review on a name with many trades is one conclusion, not a wall of
 *      identical cards.
 *   3. The wording stays asset-level. Nothing links a trade to the
 *      contribution rows its decider actually read, so claiming the decision's
 *      own reason changed would outrun the data -- and it would outrun it
 *      exactly when somebody is deciding whether to unwind a position.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  thesisChangedAfterCommitCandidates,
  evaluateThesisChangedAfterCommit,
  THESIS_CHANGED_AFTER_COMMIT_KIND,
  type ThesisConcernReview,
  type CommittedTrade,
} from '../../../engine/decisionEngine/evaluators/thesisChangedAfterCommit'
import { runGlobalDecisionEngine } from '../../../engine/decisionEngine/globalDecisionEngine'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const COMMIT = '2026-09-01T12:00:00.000Z'
const OLDER_COMMIT = '2026-08-01T12:00:00.000Z'
const REVIEW = '2026-09-10T12:00:00.000Z'
const LATER_REVIEW = '2026-09-14T12:00:00.000Z'

const trade = (over: Partial<CommittedTrade> = {}): CommittedTrade => ({
  id: 't1',
  asset_id: 'asset-1',
  created_at: COMMIT,
  asset_symbol: 'AAPL',
  portfolio_name: 'Tech & Consumer Growth',
  ...over,
})

const review = (over: Partial<ThesisConcernReview> = {}): ThesisConcernReview => ({
  id: 'ev-1',
  subject_id: 'asset-1',
  occurred_at: REVIEW,
  outcome: 'changed',
  organization_id: 'org-1',
  ...over,
})

const run = (over: Parameters<typeof thesisChangedAfterCommitCandidates>[0] = {}) =>
  thesisChangedAfterCommitCandidates({
    committedTrades: [trade()],
    thesisConcernReviews: [review()],
    organizationId: 'org-1',
    ...over,
  })

describe('only a conclusion that the case broke qualifies', () => {
  it('produces a candidate when the thesis was marked changed after the commit', () => {
    const c = run()
    expect(c).toHaveLength(1)
    expect(c[0].kind).toBe(THESIS_CHANGED_AFTER_COMMIT_KIND)
    expect(c[0].subjectType).toBe('trade')
    expect(c[0].subjectId).toBe('t1')
    expect(c[0].organizationId).toBe('org-1')
  })

  it('produces a candidate for needs_work too', () => {
    const c = run({ thesisConcernReviews: [review({ outcome: 'needs_work' })] })
    expect(c).toHaveLength(1)
    expect(c[0].facts?.reviewOutcome).toBe('needs_work')
  })

  /* The opposite claim. A reader confirming the case still stands is the
     strongest evidence a committed trade is fine. */
  it('never qualifies on holds', () => {
    expect(run({ thesisConcernReviews: [review({ outcome: 'holds' })] })).toEqual([])
  })

  it('ignores an outcome it does not recognise', () => {
    expect(run({ thesisConcernReviews: [review({ outcome: 'whatever' })] })).toEqual([])
  })

  it('ignores a row with no recorded outcome', () => {
    expect(run({ thesisConcernReviews: [review({ outcome: '' })] })).toEqual([])
  })

  /* A conclusion recorded before the commit was available to the person
     committing. It is not news about that trade. */
  it('says nothing when the review predates the commit', () => {
    expect(run({ thesisConcernReviews: [review({ occurred_at: OLDER_COMMIT })] })).toEqual([])
  })

  it('says nothing when the review lands exactly at the commit', () => {
    expect(run({ thesisConcernReviews: [review({ occurred_at: COMMIT })] })).toEqual([])
  })

  it('says nothing about an asset with no committed trade', () => {
    expect(run({ thesisConcernReviews: [review({ subject_id: 'other-asset' })] })).toEqual([])
  })

  it('says nothing when there is nothing to compare', () => {
    expect(thesisChangedAfterCommitCandidates({})).toEqual([])
    expect(run({ committedTrades: [] })).toEqual([])
    expect(run({ thesisConcernReviews: [] })).toEqual([])
  })
})

/**
 * A review is a person changing their mind in public, and only the most recent
 * one is their position.
 *
 * The producer used to emit a candidate per qualifying event and leave Today's
 * post-processing to pick between them BY SEVERITY. Severity is not a clock:
 * a thesis marked `changed` on Monday and `needs_work` on Friday showed
 * Monday's louder card, and one marked `changed` and then `holds` kept the
 * alarm forever. Every case below is a chronology that the old rule got wrong.
 */
describe('the latest conclusion is the only one that speaks', () => {
  const MID = '2026-09-12T12:00:00.000Z'
  const chain = (...steps: Array<[string, string, string]>) =>
    run({ thesisConcernReviews: steps.map(([id, outcome, at]) => review({ id, outcome, occurred_at: at })) })

  it('changed, then needs_work, reports needs_work', () => {
    const c = chain(['ev-1', 'changed', REVIEW], ['ev-2', 'needs_work', LATER_REVIEW])
    expect(c).toHaveLength(1)
    expect(c[0].id).toBe('thesis-changed-ev-2')
    expect(c[0].facts?.reviewOutcome).toBe('needs_work')
  })

  /* The one the old rule could never get right: `changed` is louder than
     `needs_work`, so severity picked the stale conclusion. */
  it('needs_work, then changed, reports changed', () => {
    const c = chain(['ev-1', 'needs_work', REVIEW], ['ev-2', 'changed', LATER_REVIEW])
    expect(c).toHaveLength(1)
    expect(c[0].id).toBe('thesis-changed-ev-2')
    expect(c[0].facts?.reviewOutcome).toBe('changed')
  })

  /* Somebody looked again and concluded the case still stands. The concern is
     retired, not outvoted. */
  it('changed, then holds, reports nothing', () => {
    expect(chain(['ev-1', 'changed', REVIEW], ['ev-2', 'holds', LATER_REVIEW])).toEqual([])
  })

  it('needs_work, then holds, reports nothing', () => {
    expect(chain(['ev-1', 'needs_work', REVIEW], ['ev-2', 'holds', LATER_REVIEW])).toEqual([])
  })

  it('holds, then changed, reports changed', () => {
    const c = chain(['ev-1', 'holds', REVIEW], ['ev-2', 'changed', LATER_REVIEW])
    expect(c).toHaveLength(1)
    expect(c[0].id).toBe('thesis-changed-ev-2')
  })

  it('takes the last of three regardless of the order they arrive in', () => {
    const c = chain(
      ['ev-3', 'changed', LATER_REVIEW],
      ['ev-1', 'needs_work', REVIEW],
      ['ev-2', 'holds', MID],
    )
    expect(c).toHaveLength(1)
    expect(c[0].id).toBe('thesis-changed-ev-3')
  })

  it('retires the concern when the last of three is holds', () => {
    expect(chain(
      ['ev-1', 'changed', REVIEW],
      ['ev-3', 'holds', LATER_REVIEW],
      ['ev-2', 'needs_work', MID],
    )).toEqual([])
  })

  /* The latest word must be after a commit to be news about it, whatever it
     concluded. */
  it('says nothing when the latest review predates every commit', () => {
    expect(chain(['ev-1', 'changed', OLDER_COMMIT])).toEqual([])
  })

  it('resolves each asset on its own timeline', () => {
    const c = run({
      committedTrades: [trade(), trade({ id: 't2', asset_id: 'asset-2', asset_symbol: 'MSFT' })],
      thesisConcernReviews: [
        review({ id: 'a1-old', outcome: 'changed', occurred_at: REVIEW }),
        review({ id: 'a1-new', outcome: 'holds', occurred_at: LATER_REVIEW }),
        review({ id: 'a2-old', subject_id: 'asset-2', outcome: 'holds', occurred_at: REVIEW }),
        review({ id: 'a2-new', subject_id: 'asset-2', outcome: 'changed', occurred_at: LATER_REVIEW }),
      ],
    })
    expect(c).toHaveLength(1)
    expect(c[0].id).toBe('thesis-changed-a2-new')
    expect(c[0].subjectId).toBe('t2')
  })
})

describe('one conclusion is one candidate, not a wall of them', () => {
  const three = [
    trade({ id: 't-old', created_at: OLDER_COMMIT }),
    trade({ id: 't-new', created_at: COMMIT }),
    trade({ id: 't-mid', created_at: '2026-08-15T12:00:00.000Z' }),
  ]

  it('collapses to the newest committed trade that predates the review', () => {
    const c = run({ committedTrades: three })
    expect(c).toHaveLength(1)
    expect(c[0].subjectId).toBe('t-new')
  })

  /* The collapse is presentational. The older trades are on the same name and
     the same conclusion bears on them identically -- so the count is carried
     rather than the fact being hidden. */
  it('states how many other trades the conclusion also bears on', () => {
    expect(run({ committedTrades: three })[0].facts?.olderTradesOnAsset).toBe(2)
    expect(run()[0].facts?.olderTradesOnAsset).toBe(0)
  })

  it('ignores trades committed after the review when choosing', () => {
    const c = run({
      committedTrades: [
        trade({ id: 't-before', created_at: COMMIT }),
        trade({ id: 't-after', created_at: LATER_REVIEW }),
      ],
    })
    expect(c).toHaveLength(1)
    expect(c[0].subjectId).toBe('t-before')
    expect(c[0].facts?.olderTradesOnAsset).toBe(0)
  })

  it('keeps assets apart', () => {
    const c = run({
      committedTrades: [trade(), trade({ id: 't2', asset_id: 'asset-2', asset_symbol: 'MSFT' })],
      thesisConcernReviews: [review(), review({ id: 'ev-2', subject_id: 'asset-2' })],
    })
    expect(c.map(x => x.subjectId).sort()).toEqual(['t1', 't2'])
  })
})

describe('identity comes from the conclusion, not the trade', () => {
  it('keys on the review event', () => {
    expect(run()[0].id).toBe('thesis-changed-ev-1')
  })

  it('is stable across regeneration', () => {
    expect(run()).toEqual(run())
  })

  /* A later conclusion replaces the earlier one rather than joining it: the
     id moves to the newest event, so the finding is about what the reader
     currently thinks. */
  it('moves to the latest qualifying review', () => {
    const c = run({
      thesisConcernReviews: [review(), review({ id: 'ev-2', occurred_at: LATER_REVIEW })],
    })
    expect(c).toHaveLength(1)
    expect(c[0].id).toBe('thesis-changed-ev-2')
  })

  it('dates the claim from the conclusion', () => {
    expect(run()[0].occurredAt).toBe(REVIEW)
  })

  it('points provenance and the memory ref at the event row', () => {
    const c = run()[0]
    expect(c.provenance.producer).toBe('evaluator:thesisChangedAfterCommit')
    expect(c.provenance.sourceType).toBe('memory_events')
    expect(c.provenance.sourceId).toBe('ev-1')
    expect(c.memoryRefs).toEqual([{ kind: 'event', id: 'ev-1' }])
  })

  it('carries both dates and the outcome as facts', () => {
    const f = run()[0].facts!
    expect(f.assetId).toBe('asset-1')
    expect(f.assetSymbol).toBe('AAPL')
    expect(f.committedAt).toBe(COMMIT)
    expect(f.reviewedAt).toBe(REVIEW)
    expect(f.reviewOutcome).toBe('changed')
  })
})

describe('the wording does not outrun the data', () => {
  /* Asset-level linkage, asset-level language. Nothing ties a trade to the
     contribution rows its decider actually read. */
  it('says the thesis was marked changed, not that this decision is invalid', () => {
    expect(run()[0].reason)
      .toBe('The AAPL thesis was marked changed after this trade was committed.')
  })

  it('uses the needs_work phrasing for needs_work', () => {
    expect(run({ thesisConcernReviews: [review({ outcome: 'needs_work' })] })[0].reason)
      .toBe('The AAPL thesis now needs work after this trade was committed.')
  })

  it('never claims the decision reason itself changed', () => {
    const producer = src('engine/decisionEngine/evaluators/thesisChangedAfterCommit.ts')
    const strings = producer.match(/reason: `[^`]*`/g)?.join(' ') ?? ''
    expect(strings).not.toMatch(/your reason|the reason for this decision|rationale/i)
  })

  it('falls back when the symbol is missing', () => {
    expect(run({ committedTrades: [trade({ asset_symbol: null })] })[0].reason)
      .toContain('this asset')
  })

  /* No AI, no diffing. The trigger is a button a person pressed. */
  it('compares no text', () => {
    const body = src('engine/decisionEngine/evaluators/thesisChangedAfterCommit.ts')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    for (const smell of ['contribution_history', 'old_content', 'new_content', 'summar', 'openai']) {
      expect(body.toLowerCase()).not.toContain(smell)
    }
  })
})

describe('clicking it opens the thesis that was questioned', () => {
  const action = run()[0].actions![0]

  it('opens Research on the reviewed asset', () => {
    expect(action.actionKey).toBe('OPEN_RESEARCH_SUBJECT')
    expect(action.payload?.assetId).toBe('asset-1')
    expect(action.payload?.focus).toBe('thesis')
  })

  it('carries why the reader was sent', () => {
    expect(action.payload?.issue).toBe('Thesis marked changed after a trade was committed')
    expect(action.payload?.origin).toBe('today')
  })

  it('distinguishes the two conclusions in that context', () => {
    const c = run({ thesisConcernReviews: [review({ outcome: 'needs_work' })] })[0]
    expect(c.actions![0].payload?.issue)
      .toBe('Thesis marked needs work after a trade was committed')
  })

  it('is routed through the typed research handoff', () => {
    expect(src('engine/decisionEngine/dispatchDecisionAction.ts'))
      .toContain("case 'OPEN_RESEARCH_SUBJECT':")
  })
})

describe('the data layer hands over every conclusion', () => {
  /* Guarding the guard. "Latest wins" is only true if the query returns the
     latest -- filtering `holds` out at the database would make a reader's
     change of mind invisible and leave the old alarm standing forever, and
     every chronology test above would still pass. */
  it('does not drop holds before the producer can see it', () => {
    const hook = src('hooks/useThesisReview.ts')
    const fn = hook.slice(hook.indexOf('export function useThesisReviewConclusions'))
    expect(fn).toContain('filter(r => !!r.payload?.outcome)')
    expect(fn).not.toContain("!== 'holds'")
  })
})

describe('Today renders it without a new ranking system', () => {
  const engineArgs = {
    userId: 'u1',
    role: 'analyst',
    coverage: { assetIds: [], portfolioIds: [] },
    now: new Date('2026-09-16T12:00:00Z'),
  }
  const overdueObligation = {
    id: 'o1', subject_id: 'trade-x', organization_id: 'org-1', owner_id: 'pm-1',
    raised_at: '2026-08-01T12:00:00Z', due_at: '2026-08-05T12:00:00Z',
  }

  it('is an action item, conservatively coloured', () => {
    const items = evaluateThesisChangedAfterCommit({
      committedTrades: [trade()], thesisConcernReviews: [review()], organizationId: 'org-1',
    })
    expect(items).toHaveLength(1)
    expect(items[0].id).toBe('thesis-changed-ev-1')
    expect(items[0].titleKey).toBe(THESIS_CHANGED_AFTER_COMMIT_KIND)
    expect(items[0].title).toBe('Thesis Changed After Commit')
    expect(items[0].severity).toBe('orange')
  })

  /* `needs_work` says the DOCUMENT cannot be judged, which is a weaker
     statement about the world than "the case broke". Neither is red: red is
     reserved by existing rules for age and missed deadlines. */
  it('is quieter for needs_work, and never red', () => {
    const items = evaluateThesisChangedAfterCommit({
      committedTrades: [trade()],
      thesisConcernReviews: [review({ outcome: 'needs_work' })],
      organizationId: 'org-1',
    })
    expect(items[0].severity).toBe('yellow')
    expect(items[0].title).toBe('Thesis Needs Work After Commit')
  })

  /* Load-bearing: post-processing dedupes BY asset. Without an assetId on the
     item, findings on different names collide under the empty key. */
  it('keeps one finding per asset through post-processing', () => {
    const result = runGlobalDecisionEngine({
      ...engineArgs,
      data: {
        committedTrades: [
          trade(),
          trade({ id: 't2', asset_id: 'asset-2', asset_symbol: 'MSFT' }),
        ],
        thesisConcernReviews: [review(), review({ id: 'ev-2', subject_id: 'asset-2' })],
        organizationId: 'org-1',
      },
    })
    expect(result.actionItems.map(i => i.id).sort())
      .toEqual(['thesis-changed-ev-1', 'thesis-changed-ev-2'])
  })

  /* Existing urgent work keeps its place and its order. */
  it('does not disturb the existing items or their ranking', () => {
    const without = runGlobalDecisionEngine({
      ...engineArgs, data: { tradeReviewObligations: [overdueObligation] },
    })
    const with_ = runGlobalDecisionEngine({
      ...engineArgs,
      data: {
        tradeReviewObligations: [overdueObligation],
        committedTrades: [trade()],
        thesisConcernReviews: [review()],
        organizationId: 'org-1',
      },
    })

    const existing = with_.actionItems.filter(i => i.id === 'trade-review-o1')
    expect(existing).toHaveLength(1)
    // The overdue obligation is red; this is orange, so it stays on top.
    expect(with_.actionItems[0].id).toBe('trade-review-o1')
    expect(without.actionItems[0].id).toBe('trade-review-o1')
    expect(with_.intelItems).toEqual(without.intelItems)
  })

  /**
   * Today is never asked to choose between two conclusions about one thesis,
   * because only one ever reaches it.
   *
   * This is the regression that matters. Post-processing dedupes by asset and
   * keeps the HIGHER SEVERITY, so when the producer emitted every qualifying
   * event, a stale `changed` (orange) beat a current `needs_work` (yellow) and
   * Today showed the wrong one. Asserted through the real engine, and the
   * post-processing rule itself is untouched.
   */
  it('never leaves Today to pick the current conclusion by severity', () => {
    const result = runGlobalDecisionEngine({
      ...engineArgs,
      data: {
        committedTrades: [trade()],
        thesisConcernReviews: [
          review({ id: 'ev-loud', outcome: 'changed', occurred_at: REVIEW }),
          review({ id: 'ev-current', outcome: 'needs_work', occurred_at: LATER_REVIEW }),
        ],
        organizationId: 'org-1',
      },
    })
    expect(result.actionItems).toHaveLength(1)
    // The newer, quieter conclusion -- which severity-based dedupe would have
    // discarded in favour of the older orange one.
    expect(result.actionItems[0].id).toBe('thesis-changed-ev-current')
    expect(result.actionItems[0].severity).toBe('yellow')
  })

  it('shows nothing once a later review says the case holds', () => {
    const result = runGlobalDecisionEngine({
      ...engineArgs,
      data: {
        committedTrades: [trade()],
        thesisConcernReviews: [
          review({ id: 'ev-1', outcome: 'changed', occurred_at: REVIEW }),
          review({ id: 'ev-2', outcome: 'holds', occurred_at: LATER_REVIEW }),
        ],
        organizationId: 'org-1',
      },
    })
    expect(result.actionItems).toEqual([])
  })

  it('adds nothing when no conclusion has been recorded', () => {
    const result = runGlobalDecisionEngine({
      ...engineArgs,
      data: { committedTrades: [trade()], thesisConcernReviews: [] },
    })
    expect(result.actionItems).toEqual([])
  })
})
