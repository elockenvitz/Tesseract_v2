/**
 * A framing asks a question only where it has one worth asking.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * MEASURED live at 1920x889: every Research tile in the no-thesis or
 * incomplete-thesis state drew the SAME sentence as its picture -- "What best
 * describes this position?" on LLY, MU, HD, CSCO and the rest.
 *
 * `exploreVisualFor` takes `question` as its last resort, deliberately: it
 * claims only the cards that were drawing nothing at all. So a prompt left on
 * a framing became that framing's picture everywhere.
 *
 * ── Why the question is the thing that was wrong ──────────────────────────
 *
 * `framingWantsJudgment` already returns false for both framings, and records
 * why: the four answers it offered were on four different axes -- an
 * investment state, a portfolio history, a coverage assignment and a work
 * status -- so no single question was being asked and no answer meant anything
 * consistent. The Respond pane was removed from both on that reasoning. The
 * prompt string simply outlived it.
 *
 * A missing thesis is not a claim to agree or disagree with. It is work nobody
 * has done, and the primary action already says so.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *
 * Not a removal of prompts generally. The three framings that DO want a
 * judgment keep theirs, and are asserted here so this change cannot creep into
 * them: a card that has a coherent question should still ask it.
 */
import { describe, it, expect } from 'vitest'
import { researchCopy, framingWantsJudgment } from '../case-state'
import type { ResearchFraming } from '../case-state'

const copy = (framing: ResearchFraming) => researchCopy({
  symbol: 'MU',
  issue: {
    framing,
    daysSinceReview: 192,
    daysSinceWritten: 192,
    anchoredOn: 'reviewed',
    movePct: 12,
    evidence: [{ kind: 'note', at: '2026-10-01T00:00:00Z', label: 'A note' }],
    present: ['thesis'],
    missing: ['where_different', 'risks_to_thesis'],
    supporting: [],
  },
  portfolioName: 'Large Cap Growth',
  weightPct: 4.2,
  held: true,
} as never)

describe('the two framings with no coherent question ask none', () => {
  it.each(['no_case', 'incomplete_case'] as const)('%s emits no prompt', framing => {
    expect(copy(framing).prompt).toBeUndefined()
  })

  /**
   * THE anti-vacuity tie: the prompt and the Respond pane now agree. A framing
   * that wants no judgment asks no question, and the two are read from the
   * same place rather than kept in step by hand.
   */
  it.each(['no_case', 'incomplete_case'] as const)(
    '%s already wanted no judgment, which is why',
    framing => {
      expect(framingWantsJudgment(framing)).toBe(false)
    },
  )

  /** And both still say what they say in words. The headline is untouched. */
  it.each(['no_case', 'incomplete_case'] as const)('%s keeps its headline and body', framing => {
    const c = copy(framing)
    expect(c.headline).toContain('MU')
    expect(c.body.length).toBeGreaterThan(10)
  })
})

describe('what the removed question is replaced by', () => {
  /**
   * The question was filling a real hole -- `exploreVisualFor` takes it last,
   * for cards that were drawing nothing at all. Removing it without replacing
   * it would leave a headline and an Open button, which is what IBM, BKNG and
   * TGT showed when this change was first measured.
   *
   * The body is what belongs there: it names exactly which sections are
   * missing, it differs per name, and the producer already computes it.
   */
  it.each(['no_case', 'incomplete_case'] as const)(
    '%s still says which sections are missing, in its body',
    framing => {
      const c = copy(framing)
      expect(c.body).toMatch(/where different|risks to thesis/i)
      // And the body is not the headline restated, or it would be dropped.
      expect(c.body).not.toBe(c.headline)
    },
  )
})

describe('a framing that has a question still asks it', () => {
  it.each(['new_evidence', 'price_move', 'long_silence'] as const)(
    '%s keeps its prompt',
    framing => {
      expect(copy(framing).prompt).toBeTruthy()
      expect(framingWantsJudgment(framing)).toBe(true)
    },
  )

  /** Each one asks something specific to its own situation, not a shared line. */
  it('does not ask all three the same thing', () => {
    const prompts = (['new_evidence', 'price_move', 'long_silence'] as const)
      .map(f => copy(f).prompt)
    expect(new Set(prompts).size).toBe(prompts.length)
  })
})
