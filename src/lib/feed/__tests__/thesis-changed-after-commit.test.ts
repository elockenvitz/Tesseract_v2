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

  /* A second person concluding the same thing a week later is a second
     durable act, so it earns its own candidate rather than silently
     replacing the first. */
  it('gives a later qualifying review its own candidate', () => {
    const c = run({
      thesisConcernReviews: [review(), review({ id: 'ev-2', occurred_at: LATER_REVIEW })],
    })
    expect(c).toHaveLength(2)
    expect(c.map(x => x.id).sort()).toEqual(['thesis-changed-ev-1', 'thesis-changed-ev-2'])
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

  it('adds nothing when no conclusion has been recorded', () => {
    const result = runGlobalDecisionEngine({
      ...engineArgs,
      data: { committedTrades: [trade()], thesisConcernReviews: [] },
    })
    expect(result.actionItems).toEqual([])
  })
})
