/**
 * A completed decision review must record when it was completed.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `useDecisionReview` stamped `reviewed_at` only when `decision_quality` was
 * supplied:
 *
 *     reviewed_at: patch.decision_quality ? new Date().toISOString() : null
 *
 * That field was retired from the Outcomes UI -- it "remains in the schema
 * for future system-derived use but is no longer exposed as a user input"
 * -- so nothing a reviewer can type sets it, and the ternary wrote NULL
 * every time.
 *
 * Measured in the QA org, 2026-11-20: a review recorded through the UI,
 * displayed as REVIEWED and surviving a reload, had `reviewed_at = NULL`.
 * The row said the decision had been reviewed; the record could not say when.
 *
 * Because this is an UPSERT payload, the old expression did not merely fail
 * to set the timestamp -- it overwrote an existing one with NULL on every
 * later edit.
 *
 * ── What is asserted ─────────────────────────────────────────────────────
 *
 * `hasReviewContent` is the extracted predicate. The draft case is asserted
 * alongside the completed ones, so a fixture of only-populated patches could
 * not reproduce the blind spot in reverse.
 */
import { describe, it, expect } from 'vitest'
import { hasReviewContent } from '../useDecisionReview'

describe('a review with an answer is stamped', () => {
  // THE DEFECT: the exact patch the Outcomes UI sends.
  it('counts a thesis verdict on its own', () => {
    expect(hasReviewContent({ thesis_played_out: 'yes' })).toBe(true)
  })

  it('counts "Too early", which stores as unknown', () => {
    // Choosing it is an answer, not an absence. This is the value the
    // segmented control wrote in the QA org.
    expect(hasReviewContent({ thesis_played_out: 'unknown' })).toBe(true)
  })

  it('counts a process note on its own', () => {
    expect(hasReviewContent({ process_note: 'Sized too large for the conviction.' })).toBe(true)
  })

  it('counts sizing quality on its own', () => {
    expect(hasReviewContent({ sizing_quality: 'too_small' })).toBe(true)
  })

  it('still counts a quality call, if one is ever supplied again', () => {
    expect(hasReviewContent({ decision_quality: 'good' })).toBe(true)
  })
})

describe('a draft review is not stamped', () => {
  it('does not count an empty patch', () => {
    expect(hasReviewContent({})).toBe(false)
  })

  it('does not count explicit nulls', () => {
    expect(hasReviewContent({
      decision_quality: null,
      thesis_played_out: null,
      sizing_quality: null,
      process_note: null,
    })).toBe(false)
  })

  it('does not count a whitespace-only note', () => {
    expect(hasReviewContent({ process_note: '   \n  ' })).toBe(false)
  })

  it('does not count an unrated quality call', () => {
    // 'unrated' is the absence of a verdict wearing a value's clothes.
    expect(hasReviewContent({ decision_quality: 'unrated' })).toBe(false)
  })

  it('counts a real answer even beside an unrated quality call', () => {
    expect(hasReviewContent({
      decision_quality: 'unrated',
      thesis_played_out: 'partial',
    })).toBe(true)
  })
})
