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
import {
  effectiveThesisDate, thesisAgeDays, latestReviewByAsset,
  latestConclusionByAsset, conclusionWords,
} from '../thesis-review'
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

  /*
   * ── Rewritten: a superseded hold is not an answer ───────────────────────
   *
   * This case used to be called "keeps the last holds when a later review
   * says otherwise", and asserted `m.get('a') === daysAgo(10)` -- the older
   * hold stayed as the clock's answer on the reasoning that it was "the last
   * date anybody actually stood behind the case".
   *
   * That reasoning does not survive the correction path. The producer
   * discarded every non-`holds` row BEFORE comparing dates, so a reader who
   * pressed "Still holds" by accident and immediately pressed "Changed" left
   * today's hold standing as the clock's answer and the case read `current`
   * against their own stated conclusion. No later word could overturn it.
   * With a 10-day-old hold the old assertion happened to be harmless; with a
   * one-minute-old one it made an accidental press permanent.
   *
   * The newest conclusion per asset is resolved first and then tested, which
   * is the order `thesisChangedAfterCommit` already used for the same
   * question. A superseded hold is absent, and absent is what brings the flag
   * back.
   */
  it('drops a hold the reader has since replaced', () => {
    const m = latestReviewByAsset([
      { subject_id: 'a', occurred_at: daysAgo(10), payload: { outcome: 'holds' } },
      { subject_id: 'a', occurred_at: daysAgo(1), payload: { outcome: 'changed' } },
    ])
    expect(m.has('a')).toBe(false)
  })

  /* The other direction, unchanged: a later hold overturns an earlier concern
     and the clock runs from the hold. Correction works both ways or it is not
     a correction. */
  it('lets a later hold overturn an earlier concern', () => {
    const m = latestReviewByAsset([
      { subject_id: 'a', occurred_at: daysAgo(10), payload: { outcome: 'changed' } },
      { subject_id: 'a', occurred_at: daysAgo(1), payload: { outcome: 'holds' } },
    ])
    expect(m.get('a')).toBe(daysAgo(1))
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

/*
 * ── RE-POINTED, and the reason kept ───────────────────────────────────────
 *
 * Every pin below read `components/research-v2/ResearchDetail.tsx`, because
 * that pane owned the three answers outright: its own `REVIEW_CHOICES`, its
 * own hooks, its own handler.
 *
 * The Asset workspace needed the same bar -- a reader who opened a name from
 * a finding could read the case and had no way to record what they concluded
 * about it, so the same case reached by a different door could or could not
 * be answered. Rather than a second copy of the three buttons, the bar became
 * `components/desktop/ThesisVerdictBar.tsx` and both surfaces render it.
 *
 * That is why these moved, and it is also why they still matter: ONE bar is
 * exactly the claim this file is making, and a pin on the pane that no longer
 * holds the markup would have gone quietly green against a second copy.
 */
describe('all three conclusions are reachable and write the same way', () => {
  const detail = src('components/desktop/ThesisVerdictBar.tsx')

  /**
   * THE case this block was missing, and the reason these pins went stale
   * without anyone noticing.
   *
   * When the bar moved out of `ResearchDetail`, nine pins went on reading a
   * file that no longer held the markup. They failed, which is the good
   * outcome -- but the failure said "ResearchDetail lost its review bar",
   * which is true and harmless, and NOT the thing worth guarding.
   *
   * The thing worth guarding is that there is exactly ONE bar. Two copies is
   * how "Still holds" comes to mean different things on two surfaces, and it
   * is the state this codebase was in before the bar moved. So: both surfaces
   * render the shared component, and neither spells the choices itself.
   */
  it('is one bar, rendered by both surfaces rather than copied into each', () => {
    for (const rel of [
      'components/research-v2/ResearchDetail.tsx',
      'components/asset-v2/AssetWorkspace.tsx',
    ]) {
      const body = src(rel)
      expect(body, rel).toContain('ThesisVerdictBar')
      // Not a second copy: the choices, the recorder and the standing slot
      // all belong to the bar.
      expect(body, rel).not.toContain('REVIEW_CHOICES')
      expect(body, rel).not.toContain('data-slot={`research-review-')
      expect(body, rel).not.toContain('useRecordThesisReview')
    }
  })

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

  /*
   * Secondary to actually fixing it.
   *
   * This compared two positions inside `ResearchDetail`: the primary's
   * `onClick={runPrimary}` had to appear before `research-thesis-review`.
   * The bar is its own component now, so there is no primary in the same file
   * to come before -- and the two surfaces that render it put it in different
   * places, which is a layout decision rather than this bar's business.
   *
   * What the case is FOR survives whole and is the half that could regress
   * silently: none of the three answers may be dressed as the thing to do.
   * The surfaces' own suites assert where the bar sits relative to their
   * primary; this one asserts that the bar never competes with it.
   */
  it('stays secondary to editing the thesis', () => {
    expect(detail).not.toMatch(/research-review-holds[\s\S]{0,400}bg-blue-7?0?0?/)
    /* No filled control at all: on both surfaces the one filled button in the
       band is the verb, and a second would be two primaries. */
    expect(detail).not.toMatch(/bg-blue-600/)
    /* And it is still the bar being looked at, not an empty file. */
    expect(detail).toContain('data-slot="research-thesis-review"')
  })
})

/**
 * ── A conclusion you can see, and therefore take back ────────────────────
 *
 * Pressing one of the three used to produce a "Recorded" that lived on the
 * mutation object, so it vanished with the component: by the next page load
 * the bar read as unanswered. An accidental press was invisible, a deliberate
 * one looked like it had done nothing, and all three buttons were disabled for
 * the life of the mount -- so the one moment a reader was certain to notice
 * the wrong answer was the one moment they could not fix it.
 *
 * Correction is an append, not an edit: the wrong conclusion stays on the
 * record and the newest one speaks. That is what `memory_events` is, and it
 * also means a reader's change of mind is itself auditable.
 */
describe('the standing conclusion is shown back, and can be replaced', () => {
  /* The shared bar, for the reason recorded above the previous block. */
  const detail = src('components/desktop/ThesisVerdictBar.tsx')
  const row = src('components/lists/ListRowExpansion.tsx')

  it('resolves the newest conclusion per asset, whatever it said', () => {
    const m = latestConclusionByAsset([
      { subject_id: 'a', occurred_at: daysAgo(1), outcome: 'changed', actor_id: 'u1' },
      { subject_id: 'a', occurred_at: daysAgo(9), outcome: 'holds', actor_id: 'u2' },
      { subject_id: 'b', occurred_at: daysAgo(3), outcome: 'needs_work', actor_id: null },
    ])
    expect(m.get('a')).toEqual({ outcome: 'changed', occurredAt: daysAgo(1), actorId: 'u1' })
    expect(m.get('b')?.outcome).toBe('needs_work')
  })

  /* A pre-outcome review has no verdict word to print. `resetsStaleClock`
     still counts it as a hold for the CLOCK, which is a different question
     from what to show on a button. */
  it('has nothing to display for a row that recorded no outcome', () => {
    expect(latestConclusionByAsset([
      { subject_id: 'a', occurred_at: daysAgo(1), outcome: null },
    ]).get('a')).toBeUndefined()
  })

  /* Whose conclusion it is decides whether pressing another button is a
     correction or an override of a colleague. */
  it('says whose conclusion is on the record, and how old it is', () => {
    expect(conclusionWords('changed', daysAgo(2), true, NOW)).toBe('You marked this Changed · 2d ago')
    expect(conclusionWords('holds', daysAgo(2), false, NOW)).toBe('Marked this Still holds · 2d ago')
    expect(conclusionWords('needs_work', daysAgo(0), true, NOW)).toBe('You marked this Needs work · today')
  })

  /* Clock skew between the browser and Postgres must not print "-1d ago". */
  it('reads a future timestamp as today rather than as negative age', () => {
    const ahead = new Date(NOW.getTime() + 60_000).toISOString()
    expect(conclusionWords('holds', ahead, true, NOW)).toContain('· today')
  })

  /*
   * The mount-scoped confirmation is gone from BOTH surfaces, by name. A
   * `not.toContain` on the word "Recorded" would be satisfied -- or broken --
   * by the comments that explain its removal, so these name the variable the
   * defect was spelled with.
   */
  it('no longer gates the choice on a mutation flag that dies with the mount', () => {
    expect(detail).not.toContain('reviewDone')
    expect(row).not.toMatch(/review\.isDone/)
  })

  /*
   * The non-vacuity pair for the case above: a surface could satisfy it by
   * dropping the review bar entirely. Each one must still read the record and
   * print it.
   */
  it('reads the standing conclusion from the record on both surfaces', () => {
    for (const body of [detail, row]) {
      expect(body).toContain('useCurrentThesisConclusion')
      expect(body).toContain('conclusionWords(')
    }
    expect(detail).toContain('data-slot="research-review-standing"')
    expect(row).toContain('data-slot="list-review-standing"')
  })

  /* The standing answer is the only one pressing cannot usefully do. Every
     other one stays live, which IS the correction path -- a bar that disabled
     all three after an answer is the defect. */
  it('leaves every answer but the standing one pressable', () => {
    expect(detail).toContain('disabled={reviewPending || standing}')
    expect(row).toContain('disabled={review.isPending || standing}')
    for (const body of [detail, row]) expect(body).toContain('aria-pressed={standing}')
  })

  /*
   * ── The press is acknowledged by the press ──────────────────────────────
   *
   * Selection was read only from the refetched record, so for the length of
   * an insert plus a refetch the bar still showed the PREVIOUS verdict as the
   * chosen one -- the click looked ignored, or looked like it had re-chosen
   * the thing being replaced, and then jumped. Both surfaces now prefer the
   * answer in flight.
   */
  it('selects the answer in flight before the record comes back', () => {
    expect(src('hooks/useThesisReview.ts')).toContain('pendingOutcome: mutation.isPending')
    for (const body of [detail, row]) {
      expect(body).toMatch(/standingOutcome = (review\.)?pendingOutcome \?\? reviewState\?\.outcome \?\? null/)
      expect(body).toContain('standingOutcome === ')
    }
  })

  /*
   * ── The buttons stop moving under the cursor ────────────────────────────
   *
   * The research bar is centred between two `flex-1` siblings, so its own
   * width positions the three buttons. The status text measured 272px and
   * appeared, changed and vanished within one click -- empty, "Recording…",
   * the sentence -- sliding the group about 140px sideways at 1920 each time.
   * The slot is fixed-width and always rendered now, so nothing it says can
   * move the thing the reader is aiming at.
   *
   * The class is asserted because this is the whole fix: a slot that sizes to
   * its content is the defect, and no behavioural assertion can see it --
   * jsdom does no layout.
   */
  it('reserves one fixed slot for whatever the status says', () => {
    expect(detail).toMatch(/data-slot="research-review-standing"[\s\S]{0,160}w-\[19rem\] shrink-0/)
    // Always rendered: the empty state says so rather than collapsing.
    expect(detail).toContain('Not reviewed yet')
    expect(detail).not.toMatch(/\) : reviewState \? \(\s*\n\s*<span\s*\n\s*data-slot="research-review-standing"/)
  })

  /* A correction writes a new event. Nothing deletes or rewrites the old one:
     the record of a reader changing their mind is the point. */
  it('corrects by appending, never by editing or deleting the old row', () => {
    const hook = src('hooks/useThesisReview.ts')
    expect(hook).toContain('.insert({')
    expect(hook).not.toContain('.delete(')
    expect(hook).not.toMatch(/from\('memory_events'\)\s*\n?\s*\.update\(/)
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

  /*
   * The in-flight guard, still both halves -- but the button's half no longer
   * latches.
   *
   * It asserted `disabled={reviewPending || reviewDone}`, which disabled all
   * three controls permanently once any answer was taken. That is what made
   * an accidental press unfixable inside the pane that had just accepted it.
   * The second clause is now the STANDING answer, so pressing is blocked only
   * where it would write a duplicate; the two alternatives stay live.
   */
  it('refuses a second submit while one is in flight', () => {
    expect(src('hooks/useThesisReview.ts')).toContain('if (mutation.isPending) return')
    /* The shared bar, for the reason recorded above `all three conclusions`. */
    expect(src('components/desktop/ThesisVerdictBar.tsx'))
      .toContain('disabled={reviewPending || standing}')
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
