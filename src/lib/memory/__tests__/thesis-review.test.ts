/**
 * "I read this and nothing has changed" is now something the product can hear.
 *
 * Staleness was measured from `asset_contributions.updated_at` -- the last time
 * somebody changed the TEXT. So the only way to clear a stale flag was to edit
 * a thesis that did not need editing, the finding recurred every morning, and
 * "three people have read this and agreed" was indistinguishable from "nobody
 * has looked in 100 days".
 *
 * The rule under test: the attention clock runs from the later of written and
 * last-confirmed, while every DISPLAYED date stays the real written one. A
 * review is not an edit and must never be shown as one.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { effectiveThesisDate, thesisAgeDays, latestReviewByAsset } from '../thesis-review'
import { stateOf } from '../../desktop-research/model'
import { evaluateThesisStale } from '../../../engine/decisionEngine/evaluators/thesisStale'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')
const NOW = new Date('2026-09-16T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

describe('the effective date', () => {
  it('is the review when the review is newer', () => {
    expect(effectiveThesisDate(daysAgo(100), daysAgo(1))).toBe(daysAgo(1))
  })

  /* An edit is a stronger signal than a confirmation: somebody changed their
     mind about the words, which resets the clock on its own. */
  it('is the thesis when the edit is newer', () => {
    expect(effectiveThesisDate(daysAgo(2), daysAgo(40))).toBe(daysAgo(2))
  })

  it('tolerates either being absent', () => {
    expect(effectiveThesisDate(null, daysAgo(5))).toBe(daysAgo(5))
    expect(effectiveThesisDate(daysAgo(5), null)).toBe(daysAgo(5))
    expect(effectiveThesisDate(null, null)).toBeNull()
  })

  /* A subject with no thesis is not a stale one. */
  it('reports no age at all when there is no date', () => {
    expect(thesisAgeDays(null, null, NOW)).toBeNull()
  })
})

describe('newest review per asset', () => {
  it('keeps the latest and ignores the rest', () => {
    const m = latestReviewByAsset([
      { subject_id: 'a', occurred_at: daysAgo(10) },
      { subject_id: 'a', occurred_at: daysAgo(2) },
      { subject_id: 'b', occurred_at: daysAgo(30) },
    ])
    expect(m.get('a')).toBe(daysAgo(2))
    expect(m.get('b')).toBe(daysAgo(30))
  })
})

/**
 * The clock asks "does anyone still stand behind this?". Only one of the three
 * conclusions answers yes.
 *
 * This used to be true by accident: the query never read the payload, and
 * `holds` was the only outcome the interface could produce, so an
 * outcome-blind clock and a holds-only clock were the same clock. Offering the
 * other two separates them -- and without the rule below, a reader marking a
 * thesis BROKEN would clear the very flag telling everyone to look at it.
 */
describe('only "still holds" stops the staleness clock', () => {
  it('counts a holds review', () => {
    const m = latestReviewByAsset([
      { subject_id: 'a', occurred_at: daysAgo(1), payload: { outcome: 'holds' } },
    ])
    expect(m.get('a')).toBe(daysAgo(1))
  })

  it.each(['changed', 'needs_work'])('does not let %s clear the flag', (outcome) => {
    const m = latestReviewByAsset([
      { subject_id: 'a', occurred_at: daysAgo(1), payload: { outcome } },
    ])
    expect(m.has('a')).toBe(false)
  })

  /* A newer "changed" does not overwrite an older "holds" with silence, and it
     does not resurrect it either -- the clock simply keeps the last date
     anybody actually stood behind the case. */
  it('keeps the last holds when a later review says otherwise', () => {
    const m = latestReviewByAsset([
      { subject_id: 'a', occurred_at: daysAgo(10), payload: { outcome: 'holds' } },
      { subject_id: 'a', occurred_at: daysAgo(1), payload: { outcome: 'changed' } },
    ])
    expect(m.get('a')).toBe(daysAgo(10))
  })

  /* Every review written before outcomes were offered was a "still holds" --
     it was the only thing the button could say. Reclassifying those rows would
     rewrite a conclusion the reader never reached. */
  it('treats a review with no recorded outcome as holds', () => {
    const m = latestReviewByAsset([
      { subject_id: 'a', occurred_at: daysAgo(1) },
      { subject_id: 'b', occurred_at: daysAgo(1), payload: {} },
      { subject_id: 'c', occurred_at: daysAgo(1), payload: null },
    ])
    expect([...m.keys()].sort()).toEqual(['a', 'b', 'c'])
  })

  it('reads the outcome the query actually fetches', () => {
    // A rule that reads `payload` from rows the query never selected would be
    // a rule that always sees undefined, i.e. always "holds".
    expect(src('hooks/useThesisReview.ts')).toContain("select('subject_id, occurred_at, payload')")
  })
})

describe('all three conclusions are reachable and write the same way', () => {
  const detail = src('components/research-v2/ResearchDetail.tsx')

  it('offers exactly the three outcomes, in order', () => {
    expect(detail).toContain("{ outcome: 'holds', label: 'Still holds' }")
    expect(detail).toContain("{ outcome: 'changed', label: 'Changed' }")
    expect(detail).toContain("{ outcome: 'needs_work', label: 'Needs work' }")
  })

  /* One control per outcome, each addressable. The slot is derived from the
     outcome so a fourth conclusion cannot be added without a handle on it. */
  it('gives each outcome its own addressable control', () => {
    expect(detail).toContain('data-slot={`research-review-${choice.outcome}`}')
    expect(detail).toContain('REVIEW_CHOICES.map(choice =>')
  })

  /* One handler, one payload shape. Three write paths would be three places
     for the event to drift. */
  it('routes every outcome through the one recorder', () => {
    expect(detail).toContain('onClick={() => recordReview(choice.outcome)}')
    expect(detail.match(/recordReview\(/g)).toHaveLength(1)
  })

  /* The conclusion is about the document; it is not an edit to it. */
  it('records a conclusion without touching the thesis', () => {
    const hook = src('hooks/useThesisReview.ts')
    expect(hook).toContain('payload: { outcome }')
    expect(hook).not.toContain('asset_contributions')
    expect(hook).not.toContain('.update(')
    expect(detail).not.toMatch(/recordReview\([^)]*\).*(update|upsert)/)
  })

  /* Secondary to actually fixing it: the primary action still comes first in
     the row, and these stay quiet. */
  it('stays secondary to editing the thesis', () => {
    expect(detail.indexOf('onClick={runPrimary}')).toBeLessThan(
      detail.indexOf('research-thesis-review'),
    )
    expect(detail).not.toMatch(/research-review-holds[\s\S]{0,400}bg-blue-700/)
  })
})

/** A scan subject old enough to be stale on the written date alone. */
const subject = (over: Partial<Record<string, unknown>> = {}) => ({
  assetId: 'asset-1', symbol: 'AAPL', companyName: 'Apple',
  thesisUpdatedAt: daysAgo(100), daysSinceReview: 100,
  sectionCount: 3, coreSectionCount: 3, coreSections: ['bull'],
  evidenceCount: 2, newSinceReview: 0, newestEvidenceAt: null,
  newestEvidenceTitle: null, weightPct: null, generated: null,
  ...over,
} as never)

describe('Research staleness respects a review', () => {
  it('a 100-day thesis reviewed today is not stale', () => {
    expect(stateOf(subject({ lastReviewedAt: daysAgo(0) }))).not.toBe('stale')
  })

  it('a 100-day thesis reviewed 95 days ago is still stale', () => {
    expect(stateOf(subject({ lastReviewedAt: daysAgo(95) }))).toBe('stale')
  })

  it('a recent edit beats an older review', () => {
    expect(stateOf(subject({ thesisUpdatedAt: daysAgo(3), lastReviewedAt: daysAgo(50) })))
      .not.toBe('stale')
  })

  it('is unchanged when no review exists', () => {
    expect(stateOf(subject())).toBe('stale')
  })
})

describe('Today THESIS_STALE respects the same review', () => {
  const thesis = [{ asset_id: 'asset-1', asset_symbol: 'AAPL', updated_at: daysAgo(100) }]

  it('drops the finding when the thesis was confirmed today', () => {
    const items = evaluateThesisStale({
      thesisUpdates: thesis,
      thesisReviews: new Map([['asset-1', daysAgo(0)]]),
      now: NOW,
    })
    expect(items).toHaveLength(0)
  })

  it('keeps it when the review is as old as the thesis', () => {
    const items = evaluateThesisStale({
      thesisUpdates: thesis,
      thesisReviews: new Map([['asset-1', daysAgo(99)]]),
      now: NOW,
    })
    expect(items).toHaveLength(1)
  })

  it('keeps it when there is no review', () => {
    expect(evaluateThesisStale({ thesisUpdates: thesis, now: NOW })).toHaveLength(1)
  })
})

describe('a review is recorded, not disguised as an edit', () => {
  it('writes one event and touches no thesis table', () => {
    const hook = src('hooks/useThesisReview.ts')
    expect(hook).toContain("event_type: 'thesis.reviewed'")
    expect(hook).toContain("provenance: 'ui:research'")
    // The conclusion only. No thesis text, no prose.
    expect(hook).toContain('payload: { outcome }')
    expect(hook).not.toContain('asset_contributions')
    expect(hook).not.toContain('thesis_text')
  })

  /* One id per submit, not per day: two genuine reviews in one afternoon are
     two events. The id makes a RETRY of the same submit land once. */
  it('dedupes per user action', () => {
    const hook = src('hooks/useThesisReview.ts')
    expect(hook).toContain('dedupe_key: `thesis.reviewed:${requestId}`')
    expect(hook).toContain('crypto.randomUUID()')
    expect(hook).not.toMatch(/dedupe_key.*toISOString\(\)\.slice/)
    // The id is held across retries, so resubmitting the SAME intent collides
    // server-side and lands once...
    expect(hook).toMatch(/duplicate key\|unique constraint/)
    // ...and a NEW submit gets a new id, so two genuine reviews on the same
    // afternoon are two events rather than one swallowed by a calendar key.
    expect(hook).toContain('setRequestId(crypto.randomUUID())')
  })

  /* The outcome does not vary the write path: one insert, one shape, whichever
     of the three the reader chose. */
  it('writes every outcome through the same insert', () => {
    const hook = src('hooks/useThesisReview.ts')
    expect(hook.match(/\.insert\(/g)).toHaveLength(1)
    expect(hook).toContain('mutationFn: async (outcome: ThesisReviewOutcome)')
  })

  it('refuses a second submit while one is in flight', () => {
    expect(src('hooks/useThesisReview.ts')).toContain('if (mutation.isPending) return')
    expect(src('components/research-v2/ResearchDetail.tsx'))
      .toContain('disabled={reviewPending || reviewDone}')
  })

  /* The displayed date must stay the real one. `daysSinceReview` drives every
     chip and sentence; only `stateOf` consults the review. */
  it('leaves the visible thesis date alone', () => {
    const scan = src('hooks/useDesktopResearch.ts')
    expect(scan).toContain('s.daysSinceReview = daysSince(s.thesisUpdatedAt)')
    const model = src('lib/desktop-research/model.ts')
    expect(model).toContain('thesisAgeDays(s.thesisUpdatedAt, s.lastReviewedAt, new Date())')
    // The copy helpers still read the written date, not the effective one.
    expect(model).toContain('Thesis last ${w.verb} ${s.daysSinceReview} days ago')
  })
})
