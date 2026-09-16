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
