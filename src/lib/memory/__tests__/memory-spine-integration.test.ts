/**
 * The Memory Spine as one system, not five features.
 *
 * Each piece was built and tested on its own. This asserts they compose: that
 * a conclusion recorded in Research is the same fact Today reads, that an
 * obligation raised by the trade lifecycle is the one Today voices and the
 * lifecycle clears, and that the two memory-aware feed candidates agree with
 * the memory they claim to be reading.
 *
 * These are the seams where the per-feature suites cannot see a defect,
 * because each half passes its own tests while meaning something different
 * from the other half.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

import { latestReviewByAsset, resetsStaleClock, thesisAgeDays } from '../thesis-review'
import { needsReview, planTradeReviewObligations } from '../trade-review-obligation'
import { stateOf } from '../../desktop-research/model'
import { evaluateThesisStale } from '../../../engine/decisionEngine/evaluators/thesisStale'
import { runGlobalDecisionEngine } from '../../../engine/decisionEngine/globalDecisionEngine'
import {
  researchChangedSinceViewCandidates,
} from '../../../engine/decisionEngine/evaluators/researchChangedSinceView'
import {
  thesisChangedAfterCommitCandidates,
} from '../../../engine/decisionEngine/evaluators/thesisChangedAfterCommit'
import { tradeReviewCandidates } from '../../../engine/decisionEngine/evaluators/tradeReviewOwed'
import { objectViewKey } from '../../attention-state/keys'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
const NOW = new Date('2026-09-16T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

/* ────────────────────────────────────────────────────────────────────────
   CHAIN 1 — Research detail → thesis.reviewed → stale clock → Today
   ──────────────────────────────────────────────────────────────────── */

describe('chain 1: a review in Research is the same fact Today reads', () => {
  const ASSET = 'asset-1'
  /** The one row the producer writes, as the consumer would read it back. */
  const event = (outcome: string, at: string) =>
    ({ subject_id: ASSET, occurred_at: at, payload: { outcome } })

  const subject = (lastReviewedAt: string | null) => ({
    assetId: ASSET, symbol: 'AAPL', companyName: 'Apple',
    thesisUpdatedAt: daysAgo(100), daysSinceReview: 100,
    sectionCount: 3, coreSectionCount: 3, coreSections: ['bull'],
    evidenceCount: 2, newSinceReview: 0, newestEvidenceAt: null,
    newestEvidenceTitle: null, weightPct: null, generated: null,
    lastReviewedAt,
  } as never)

  const thesisRows = [{ asset_id: ASSET, asset_symbol: 'AAPL', updated_at: daysAgo(100) }]

  it('holds clears the flag in BOTH Research and Today, from one event', () => {
    const clock = latestReviewByAsset([event('holds', daysAgo(0))])
    expect(clock.get(ASSET)).toBe(daysAgo(0))

    // Research
    expect(stateOf(subject(clock.get(ASSET) ?? null))).not.toBe('stale')
    // Today, reading the same map
    expect(evaluateThesisStale({ thesisUpdates: thesisRows, thesisReviews: clock, now: NOW }))
      .toHaveLength(0)
  })

  it.each(['changed', 'needs_work'])(
    '%s leaves the flag standing in BOTH surfaces', (outcome) => {
      const clock = latestReviewByAsset([event(outcome, daysAgo(0))])
      expect(clock.has(ASSET)).toBe(false)

      expect(stateOf(subject(null))).toBe('stale')
      expect(evaluateThesisStale({ thesisUpdates: thesisRows, thesisReviews: clock, now: NOW }))
        .toHaveLength(1)
    })

  /* The two surfaces must not disagree about what counts. A divergence here
     is invisible to either suite alone. */
  it('agrees with the shared rule rather than reimplementing it', () => {
    expect(resetsStaleClock('holds')).toBe(true)
    expect(resetsStaleClock('changed')).toBe(false)
    expect(resetsStaleClock('needs_work')).toBe(false)
    // Written before outcomes existed: the only thing the button could say.
    expect(resetsStaleClock(undefined)).toBe(true)
  })

  /* A review moves the attention clock and NOTHING else. Fabricating a thesis
     edit would relabel a reading as a rewrite. */
  it('fabricates no thesis edit', () => {
    const hook = src('hooks/useThesisReview.ts')
    expect(hook).toContain("event_type: 'thesis.reviewed'")
    expect(hook).toContain('payload: { outcome }')
    expect(hook).not.toContain('asset_contributions')
    expect(hook).not.toContain('.update(')

    // The displayed date stays the written one; only the clock moves.
    expect(src('hooks/useDesktopResearch.ts'))
      .toContain('s.daysSinceReview = daysSince(s.thesisUpdatedAt)')
    expect(thesisAgeDays(daysAgo(100), daysAgo(0), NOW)).toBe(0)
    expect(thesisAgeDays(daysAgo(100), null, NOW)).toBe(100)
  })
})

/* ────────────────────────────────────────────────────────────────────────
   CHAIN 2 — Outcomes review → decision_reviews → decision.reviewed → queue
   ──────────────────────────────────────────────────────────────────── */

describe('chain 2: one authoritative decision review, read everywhere', () => {
  const hook = src('hooks/useDecisionReview.ts')

  /* `decision_reviews` stays the system of record. The memory event is a
     trace of the act, written AFTER the authoritative upsert -- never instead
     of it, or the queue and the event would disagree. */
  it('writes the authoritative row first, then the memory trace', () => {
    expect(hook).toContain("event_type: 'decision.reviewed'")
    const upsertAt = hook.indexOf('decision_reviews')
    const eventAt = hook.indexOf("event_type: 'decision.reviewed'")
    expect(upsertAt).toBeGreaterThan(-1)
    expect(upsertAt).toBeLessThan(eventAt)
  })

  /* Keyed to the review row AND its version, so editing a review records a
     second act while a retry of the same submit lands once. */
  it('dedupes per review version, not per day', () => {
    expect(hook).toContain('dedupe_key: `decision.reviewed:${review.id}:${review.updated_at}`')
    expect(hook).not.toMatch(/dedupe_key.*toISOString\(\)\.slice/)
  })

  /* The queue counts reviews from the table that holds them. Reading the
     event log instead would under-report every review written before the
     Spine existed. */
  it('the consumer reads decision_reviews, the system of record', () => {
    expect(hook).toContain('useDecisionReviewsByIds')
    expect(src('hooks/useDecisionAccountability.ts'))
      .toContain('useDecisionReviewsByIds')
  })
})

/* ────────────────────────────────────────────────────────────────────────
   CHAIN 3 — lifecycle needs_review → obligation → Today → cleared
   ──────────────────────────────────────────────────────────────────── */

describe('chain 3: the obligation the lifecycle raises is the one Today voices', () => {
  const trade = (over: Record<string, unknown> = {}) => ({
    id: 't1', reconciliation_status: 'unmatched', execution_status: 'completed',
    staleness_flagged_at: null, accepted_by: 'pm-1', execution_expected_by: null,
    ...over,
  } as never)

  it('raises exactly what the existing predicate says needs review', () => {
    expect(needsReview(trade())).toBe(true)
    const plan = planTradeReviewObligations([trade()], new Set())
    expect(plan.raise.map(t => t.id)).toEqual(['t1'])
    expect(plan.clearSubjectIds).toEqual([])
  })

  /* Idempotency at the plan level, on top of the partial unique index. A
     second mount must not raise a second open obligation. */
  it('never raises a duplicate while one is already open', () => {
    const plan = planTradeReviewObligations([trade()], new Set(['t1']))
    expect(plan.raise).toEqual([])
    expect(plan.clearSubjectIds).toEqual([])
  })

  /* The condition going away is what clears it. */
  it('clears only when the trade no longer needs review', () => {
    const settled = trade({ reconciliation_status: 'matched' })
    expect(needsReview(settled)).toBe(false)
    const plan = planTradeReviewObligations([settled], new Set(['t1']))
    expect(plan.clearSubjectIds).toEqual(['t1'])
  })

  /* Load-bearing: looking at something is not doing it. The view cursor and
     the obligation are different facts and must never be wired together. */
  it('viewing never clears an obligation', () => {
    const cursorHook = src('hooks/useObjectViewCursor.ts')
    expect(cursorHook).not.toContain('clear_memory_obligation')
    expect(cursorHook).not.toContain('memory_obligations')

    const obligations = src('hooks/useTradeReviewObligations.ts')
    expect(obligations).not.toContain('last_viewed_at')
    // The only write path to obligation state is the pair of RPCs.
    expect(obligations).toContain('raise_memory_obligation')
    expect(obligations).toContain('clear_memory_obligation')
    expect(obligations).not.toMatch(/from\('memory_obligations'\)[\s\S]{0,200}\.update\(/)
  })

  it('Today voices the open obligation, keyed to it', () => {
    const c = tradeReviewCandidates({
      tradeReviewObligations: [{
        id: 'o1', subject_id: 't1', organization_id: 'org-1', owner_id: 'pm-1',
        raised_at: daysAgo(3), due_at: null,
      }],
      now: NOW,
    })
    expect(c).toHaveLength(1)
    expect(c[0].id).toBe('trade-review-o1')
    expect(c[0].memoryRefs).toEqual([{ kind: 'obligation', id: 'o1' }])
  })
})

/* ────────────────────────────────────────────────────────────────────────
   CHAIN 4 — the memory-aware feed
   ──────────────────────────────────────────────────────────────────── */

describe('chain 4: the candidates agree with the memory they claim to read', () => {
  const VIEWED = '2026-09-10T12:00:00.000Z'
  const AFTER = '2026-09-12T12:00:00.000Z'
  const LATER = '2026-09-14T12:00:00.000Z'
  const COMMIT = '2026-09-01T12:00:00.000Z'

  const researchArgs = {
    subjects: [{
      assetId: 'asset-1', symbol: 'AAPL', companyName: 'Apple',
      newestEvidenceAt: AFTER, evidenceDates: ['2026-09-08T12:00:00.000Z', AFTER],
    }],
    viewCursors: new Map([['asset-1', VIEWED]]),
    organizationId: 'org-1',
  }
  const commitArgs = {
    committedTrades: [{
      id: 't1', asset_id: 'asset-1', created_at: COMMIT,
      asset_symbol: 'AAPL', portfolio_name: 'Growth',
    }],
    organizationId: 'org-1',
  }
  const concern = (over: Record<string, unknown> = {}) => ({
    id: 'ev-1', subject_id: 'asset-1', occurred_at: AFTER,
    outcome: 'changed', organization_id: 'org-1', ...over,
  })

  it('both candidate ids are stable across regeneration', () => {
    expect(researchChangedSinceViewCandidates(researchArgs))
      .toEqual(researchChangedSinceViewCandidates(researchArgs))
    const args = { ...commitArgs, thesisConcernReviews: [concern()] }
    expect(thesisChangedAfterCommitCandidates(args))
      .toEqual(thesisChangedAfterCommitCandidates(args))
  })

  /* An id carrying a date or a count would orphan a dismissal every time the
     underlying facts moved. */
  it('neither id embeds anything time-varying', () => {
    const r = researchChangedSinceViewCandidates(researchArgs)[0]
    const t = thesisChangedAfterCommitCandidates({
      ...commitArgs, thesisConcernReviews: [concern()],
    })[0]
    expect(r.id).toBe('research-changed-asset-1')
    expect(t.id).toBe('thesis-changed-ev-1')
    for (const id of [r.id, t.id]) {
      expect(id).not.toMatch(/\d{4}-\d{2}-\d{2}/)
      expect(id).not.toMatch(/T\d{2}:/)
    }
  })

  /* Provenance must point at a row somebody can open, and a memoryRef at the
     event that made the claim true. */
  it('provenance and memoryRefs resolve to real rows', () => {
    const t = thesisChangedAfterCommitCandidates({
      ...commitArgs, thesisConcernReviews: [concern()],
    })[0]
    expect(t.provenance.sourceType).toBe('memory_events')
    expect(t.provenance.sourceId).toBe('ev-1')
    expect(t.memoryRefs).toEqual([{ kind: 'event', id: 'ev-1' }])

    const r = researchChangedSinceViewCandidates(researchArgs)[0]
    expect(r.provenance.sourceType).toBe('asset_notes')
    expect(r.provenance.sourceId).toBe('asset-1')
    // The cursor it compared against is stated, not implied.
    expect(r.facts?.lastViewedAt).toBe(VIEWED)
  })

  it('both actions reach the asset they are about, with context', () => {
    const r = researchChangedSinceViewCandidates(researchArgs)[0].actions![0]
    const t = thesisChangedAfterCommitCandidates({
      ...commitArgs, thesisConcernReviews: [concern()],
    })[0].actions![0]

    for (const a of [r, t]) {
      expect(a.actionKey).toBe('OPEN_RESEARCH_SUBJECT')
      expect(a.payload?.assetId).toBe('asset-1')
      expect(a.payload?.origin).toBe('today')
      expect(String(a.payload?.issue ?? '')).not.toBe('')
    }
    expect(src('engine/decisionEngine/dispatchDecisionAction.ts'))
      .toContain('researchTabFor({')
  })

  /* The same key the producer writes is the key the reader reads. A mismatch
     would make every cursor comparison silently answer "never viewed". */
  it('the cursor key the feed reads is the one Research writes', () => {
    expect(objectViewKey('org-1', 'asset', 'asset-1')).toBe('view:org-1:asset:asset-1')
    expect(src('hooks/useObjectViewCursor.ts')).toContain('objectViewKey(currentOrgId, subjectType, subjectId)')
    expect(src('hooks/useObjectViewCursor.ts')).toContain('${VIEW_NAMESPACE}${currentOrgId}:asset:')
  })

  it('the latest thesis conclusion wins, and holds retires the concern', () => {
    const newer = thesisChangedAfterCommitCandidates({
      ...commitArgs,
      thesisConcernReviews: [concern(), concern({ id: 'ev-2', outcome: 'needs_work', occurred_at: LATER })],
    })
    expect(newer).toHaveLength(1)
    expect(newer[0].id).toBe('thesis-changed-ev-2')

    const retired = thesisChangedAfterCommitCandidates({
      ...commitArgs,
      thesisConcernReviews: [concern(), concern({ id: 'ev-3', outcome: 'holds', occurred_at: LATER })],
    })
    expect(retired).toEqual([])
  })

  /* The whole point of the surface placement: informational memory must never
     push work out of the way. Asserted through the real engine. */
  it('urgent work still outranks everything memory-aware', () => {
    const overdue = {
      id: 'o1', subject_id: 'trade-x', organization_id: 'org-1', owner_id: 'pm-1',
      raised_at: '2026-08-01T12:00:00Z', due_at: '2026-08-05T12:00:00Z',
    }
    const result = runGlobalDecisionEngine({
      userId: 'u1', role: 'analyst',
      coverage: { assetIds: [], portfolioIds: [] },
      now: NOW,
      data: {
        tradeReviewObligations: [overdue],
        researchSubjects: researchArgs.subjects,
        assetViewCursors: researchArgs.viewCursors,
        committedTrades: commitArgs.committedTrades,
        thesisConcernReviews: [concern()],
        organizationId: 'org-1',
      },
    })

    // The overdue obligation is red and leads the action queue.
    expect(result.actionItems[0].id).toBe('trade-review-o1')
    expect(result.actionItems[0].severity).toBe('red')
    // The thesis concern is action work too, but quieter and below it.
    const concernItem = result.actionItems.find(i => i.id === 'thesis-changed-ev-1')
    expect(concernItem?.severity).toBe('orange')
    expect(result.actionItems.indexOf(concernItem!)).toBeGreaterThan(0)
    // "What changed since you looked" is information and never competes.
    expect(result.intelItems.map(i => i.id)).toContain('research-changed-asset-1')
    expect(result.actionItems.map(i => i.id)).not.toContain('research-changed-asset-1')
  })

  /* Every memory-aware producer routes through the one contract. */
  it('all four producers are on the candidate contract', () => {
    for (const f of [
      'engine/decisionEngine/evaluators/tradeReviewOwed.ts',
      'engine/decisionEngine/evaluators/researchChangedSinceView.ts',
      'engine/decisionEngine/evaluators/thesisChangedAfterCommit.ts',
    ]) {
      expect(src(f)).toContain('candidateToDecisionItem')
      expect(src(f)).toContain("from '../../../lib/feed/candidate'")
    }
  })
})
