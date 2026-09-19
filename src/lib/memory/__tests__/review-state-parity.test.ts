/**
 * One asset, two surfaces, one answer.
 *
 * ── The defect this exists to prevent ─────────────────────────────────────
 *
 * `stateOf` decides staleness from the LATER of when a thesis was written and
 * when someone last confirmed it still holds, so that recording "Reviewed —
 * no change" clears the flag without anyone editing a document that did not
 * need editing. The Research lens joins that confirmation in
 * (`useDesktopResearch`: `lastReviewedAt: reviews.get(s.assetId)`).
 *
 * `AssetWorkspace` built the same `ResearchSubject` and never set the field.
 * It was permanently undefined there, so the age fell back to the written date
 * alone — and a reader who recorded "Reviewed — no change" saw the Research
 * tile read Current, clicked it, and landed on a page reading Review due. The
 * comment above that construction promised the two "cannot disagree".
 *
 * ── Why this suite is here and not in a component test ────────────────────
 *
 * The disagreement was never about rendering. Both surfaces call the same
 * `stateOf` with the same shape; one of them populated a field and the other
 * did not. Asserted at this layer the test fails for exactly that reason, and
 * it cannot be made to pass by mocking a hook.
 *
 * What each surface SUPPLIES is pinned separately, by reading both files: the
 * parity only holds if both read the same canonical map, and that is the part
 * a future edit could silently break.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { stateOf, type ResearchSubject } from '../../desktop-research'
import { latestReviewByAsset } from '../thesis-review'

const DAY = 86_400_000

/**
 * The clock is frozen for this suite.
 *
 * ── Why, and why not a looser assertion ───────────────────────────────────
 *
 * `daysAgo` reads `Date.now()` on every call, and two cases build a timestamp
 * and then assert against the same expression a moment later -- "the newest
 * hold is the one at `daysAgo(400)`". On a fast machine those two reads land
 * in the same millisecond and the suite passes; on CI they straddle a tick and
 * the ISO strings differ by 1ms (`...609Z` vs `...610Z`).
 *
 * That is a flaky FIXTURE, not a loose contract: `latestReviewByAsset` really
 * does return the exact string it was given, and the assertion asking for
 * exact equality is the right one. So the fix is to make `Date.now()` stand
 * still rather than to compare timestamps approximately -- an assertion that
 * tolerated a millisecond of drift would also tolerate the producer returning
 * a timestamp it invented.
 *
 * Freezing also settles `stateOf`, which reads `new Date()` internally for the
 * age comparison. Nothing here is time-dependent in any other way.
 */
const FROZEN = new Date('2026-09-19T12:00:00.000Z')
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(FROZEN) })
afterAll(() => { vi.useRealTimers() })

/*
 * Measured from the frozen instant, not from `Date.now()`.
 *
 * Module-level fixtures (`WRITTEN`, the evidence date) are evaluated at import
 * time -- before `beforeAll` runs -- so a `Date.now()`-based helper would give
 * them the real clock while the cases got the frozen one, and the two would
 * disagree by however far apart the two instants happen to be. Anchoring the
 * helper itself removes the question: every timestamp in this file, whenever
 * it is built, is relative to the same moment.
 */
const daysAgo = (n: number) => new Date(FROZEN.getTime() - n * DAY).toISOString()
const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

const ASSET = 'a-amzn'

/** A case written long enough ago to be stale on the written date alone. */
const WRITTEN = daysAgo(200)

/**
 * The subject each surface builds, with only the field they differed on.
 *
 * Everything else is held identical on purpose: if the two surfaces disagree
 * about anything ELSE, that is a different bug and this suite should not be
 * the thing that reports it.
 */
const subject = (lastReviewedAt: string | null): ResearchSubject => ({
  assetId: ASSET, symbol: 'AMZN', companyName: 'Amazon.com',
  thesisUpdatedAt: WRITTEN,
  lastReviewedAt,
  daysSinceReview: 200,
  sectionCount: 3, coreSectionCount: 3,
  coreSections: ['thesis', 'where_different', 'risks_to_thesis'],
  /* Evidence on file and none of it new. A case with no evidence resolves to
     `thin` before the clock is ever consulted, which would make every
     assertion below pass or fail for the wrong reason. */
  evidenceCount: 4, newestEvidenceAt: daysAgo(400), newSinceReview: 0,
})

/** The rows the memory log holds, as the query returns them. */
const event = (outcome: string | null, at: string) => ({
  subject_id: ASSET, occurred_at: at, payload: outcome ? { outcome } : null,
})

describe('a reviewed thesis reads the same on both surfaces', () => {
  it('is stale when nobody has confirmed it', () => {
    /*
     * The baseline, and the non-vacuity guard for everything below: without a
     * review this subject MUST be stale, or the cases that follow prove
     * nothing by returning 'current'.
     */
    expect(stateOf(subject(null))).toBe('stale')
  })

  it('reads current on both surfaces after Reviewed — no change', () => {
    const reviews = latestReviewByAsset([event('holds', daysAgo(2))])
    const reviewedAt = reviews.get(ASSET) ?? null
    expect(reviewedAt).toBe(daysAgo(2))

    /*
     * The same map, read the same way, by each surface in turn. Research does
     * `reviews.get(s.assetId) ?? null`; AssetWorkspace now does
     * `reviews.get(asset.id) ?? null`. Same key, same fallback, same answer.
     */
    const researchTile = stateOf(subject(reviewedAt))
    const assetPage = stateOf(subject(reviewedAt))

    expect(researchTile).toBe('current')
    expect(assetPage).toBe('current')
    expect(assetPage).toBe(researchTile)
  })

  it('an unreviewed asset stays Review due on both', () => {
    // A review on a DIFFERENT asset must not clear this one's clock.
    const reviews = latestReviewByAsset([
      { subject_id: 'a-other', occurred_at: daysAgo(1), payload: { outcome: 'holds' } },
    ])
    const reviewedAt = reviews.get(ASSET) ?? null
    expect(reviewedAt).toBeNull()
    expect(stateOf(subject(reviewedAt))).toBe('stale')
  })
})

describe('only a conclusion that the case holds resets the clock', () => {
  it('does not let changed or needs_work validate a thesis nobody fixed', () => {
    /*
     * Both are durable recorded facts and both are fetched -- the query does
     * not filter them out, because a later `holds` has to be able to overturn
     * an earlier `changed`. What they must never do is say the document is
     * current when the reader said the opposite.
     */
    for (const outcome of ['changed', 'needs_work']) {
      const reviews = latestReviewByAsset([event(outcome, daysAgo(1))])
      expect(reviews.get(ASSET)).toBeUndefined()
      expect(stateOf(subject(reviews.get(ASSET) ?? null))).toBe('stale')
    }
  })

  it('lets the latest valid review win over an earlier concern', () => {
    // Marked `changed` on Monday, `holds` on Friday: the reader changed their
    // mind, and the later conclusion is the one that speaks.
    const reviews = latestReviewByAsset([
      event('holds', daysAgo(1)),
      event('changed', daysAgo(9)),
    ])
    expect(stateOf(subject(reviews.get(ASSET) ?? null))).toBe('current')
  })

  it('does not let an earlier hold outlive a later concern', () => {
    /*
     * The inverse, which the "newest wins" rule alone does not give you: a
     * `changed` recorded AFTER a `holds` must leave the clock where the older
     * hold put it rather than reset it forward, and the case must not read as
     * current on the strength of a conclusion the reader has since replaced.
     */
    const reviews = latestReviewByAsset([
      event('changed', daysAgo(1)),
      event('holds', daysAgo(400)),
    ])
    expect(reviews.get(ASSET)).toBe(daysAgo(400))
    expect(stateOf(subject(reviews.get(ASSET) ?? null))).toBe('stale')
  })
})

describe('both surfaces read the one canonical map', () => {
  /*
   * The parity above only holds while both files feed `stateOf` from
   * `useThesisReviews`. A second calculation, or a surface that stops
   * supplying the field, reintroduces exactly the bug this suite exists for --
   * and would not fail any of the cases above, because those build the
   * subject themselves.
   */
  it.each([
    ['hooks/useDesktopResearch.ts', 'the Research lens'],
    ['components/asset-v2/AssetWorkspace.tsx', 'the asset page'],
  ])('%s supplies lastReviewedAt from useThesisReviews', file => {
    const body = src(file)
    expect(body).toContain('useThesisReviews')
    expect(body).toMatch(/lastReviewedAt: reviews\.get\([^)]+\) \?\? null/)
  })

  it('neither surface recomputes what counts as a valid review', () => {
    // `resetsStaleClock` and the newest-wins rule live in one place. A surface
    // filtering outcomes itself is a second source of truth.
    for (const f of ['hooks/useDesktopResearch.ts', 'components/asset-v2/AssetWorkspace.tsx']) {
      expect(src(f)).not.toContain('resetsStaleClock')
      expect(src(f)).not.toContain("outcome === 'holds'")
    }
  })
})
