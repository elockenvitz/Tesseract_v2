/**
 * The Ideas rail's second band: what the system noticed, and what the desk put up.
 *
 * Every lens above the rule selects a POST TYPE. For as long as that was the
 * whole rail, a machine-derived candidate appeared under All and under
 * nothing else -- which was honest then and is not now that four of the chips
 * are findings.
 *
 * These pin what each chip admits, because both ways of getting it wrong are
 * SILENT. A lens that admits the wrong candidates reads as a thin feed; a
 * lens that admits none reads as an honest empty state. The author half of
 * `inLens` shipped in this session reading `item.user_id`, a column that
 * never reaches this layer -- so "From the team" returned nothing for every
 * reader, and nothing about that looked wrong on screen.
 */

import { describe, it, expect } from 'vitest'
import { inLens } from '../useDesktopAttentionFeed'
import type { AttentionEntry } from '../useDesktopAttentionFeed'
import type { SignalCard, SignalType } from '../../lib/signals/contract'

const ME = 'viewer-1'

/** A machine-derived candidate: a card, no post behind it. */
const signal = (type: SignalType, family: AttentionEntry['family']): AttentionEntry => ({
  key: `k-${type}`,
  card: { id: `c-${type}`, type } as unknown as SignalCard,
  item: null,
  input: null,
  family,
  source: null,
})

/** A post, by whoever. */
const post = (itemType: string, authorId: string, over: Record<string, unknown> = {}): AttentionEntry => ({
  key: `p-${itemType}-${authorId}`,
  card: { id: `pc-${itemType}`, type: 'trade_idea' } as unknown as SignalCard,
  item: { id: 'i1', type: itemType, author: { id: authorId }, ...over } as never,
  input: null,
  family: 'post',
  source: null,
})

describe('the signal band', () => {
  /*
   * One chip, one card type, and the chip's own words are the card's own
   * words -- these labels are copied from `KIND_LABEL`, not invented for the
   * rail, so a reader can see that the filter did what they asked.
   */
  const cases: [string, SignalType, AttentionEntry['family']][] = [
    ['decisions', 'recommendation', 'recommendation'],
    ['case_vs_price', 'scenario_gap', 'scenario_gap'],
    ['case_gaps', 'no_research', 'research'],
    ['needs_review', 'research_stale', 'research'],
  ]

  for (const [lens, type, family] of cases) {
    it(`${lens} admits ${type} and nothing else`, () => {
      expect(inLens(signal(type, family), lens as never, ME)).toBe(true)
      for (const [, otherType, otherFamily] of cases) {
        if (otherType === type) continue
        expect(
          inLens(signal(otherType, otherFamily), lens as never, ME),
          `${lens} admitted ${otherType}`,
        ).toBe(false)
      }
      // And no post falls into a lens about findings.
      expect(inLens(post('trade_idea', ME), lens as never, ME)).toBe(false)
    })
  }

  /*
   * `case_gaps` and `needs_review` come from ONE family and must still be two
   * lenses. This is the reason the spec matches on card type rather than on
   * `entry.family`: the research family emits both, and a chip keyed on the
   * family would return one pile under two different names.
   */
  it('splits the one research family by what its cards actually say', () => {
    const gap = signal('no_research', 'research')
    const stale = signal('research_stale', 'research')
    expect(inLens(gap, 'case_gaps', ME)).toBe(true)
    expect(inLens(stale, 'case_gaps', ME)).toBe(false)
    expect(inLens(stale, 'needs_review', ME)).toBe(true)
    expect(inLens(gap, 'needs_review', ME)).toBe(false)
  })
})

describe('from the team', () => {
  it("returns other people's posts and never the reader's own", () => {
    expect(inLens(post('trade_idea', 'someone-else'), 'from_the_team', ME)).toBe(true)
    expect(inLens(post('quick_thought', 'someone-else'), 'from_the_team', ME)).toBe(true)
    expect(inLens(post('trade_idea', ME), 'from_the_team', ME)).toBe(false)
  })

  /*
   * The bug this file was written for. The author is on `item.author.id` --
   * the joined profile the Ideas hooks return -- and NOT on a `user_id`
   * column, which does not reach this layer. Reading the wrong one yields
   * undefined on every post and the lens answers empty for everyone, which
   * on screen is indistinguishable from nobody having posted.
   */
  it('reads the author off the joined profile, not off a row column', () => {
    const noProfile = post('trade_idea', 'someone-else')
    ;(noProfile.item as unknown as { author: unknown }).author = undefined
    expect(inLens(noProfile, 'from_the_team', ME)).toBe(false)
    // While the same post WITH its profile is admitted -- so the case above
    // cannot pass by the lens simply refusing everything.
    expect(inLens(post('trade_idea', 'someone-else'), 'from_the_team', ME)).toBe(true)
  })

  /*
   * An unresolved reader answers NOTHING, not everything. For the half second
   * before auth lands, showing the reader their own posts under a chip that
   * says "from the team" is a wrong answer; an empty lens that fills in is a
   * slow one.
   */
  it('admits nobody while the reader is unknown', () => {
    expect(inLens(post('trade_idea', 'someone-else'), 'from_the_team', null)).toBe(false)
  })

  /* It is a lens over POSTS, so a finding is not "from the team". */
  it('is not a second All', () => {
    expect(inLens(signal('scenario_gap', 'scenario_gap'), 'from_the_team', ME)).toBe(false)
  })
})

describe('the post band is unchanged', () => {
  it('still selects by item type, and All still takes everything', () => {
    expect(inLens(post('trade_idea', ME), 'trade_ideas', ME)).toBe(true)
    expect(inLens(post('note', ME), 'trade_ideas', ME)).toBe(false)
    expect(inLens(post('note', ME), 'thoughts', ME)).toBe(true)
    expect(inLens(signal('scenario_gap', 'scenario_gap'), 'trade_ideas', ME)).toBe(false)
    expect(inLens(signal('scenario_gap', 'scenario_gap'), 'all', ME)).toBe(true)
    expect(inLens(post('trade_idea', 'someone-else'), 'all', ME)).toBe(true)
  })

  /* A prompt is a `quick_thought` with an idea_type, which is why Thoughts
     and Prompts cannot both be a plain type list. */
  it('still tells a prompt from a thought', () => {
    const prompt = post('quick_thought', ME, { idea_type: 'prompt' })
    const thought = post('quick_thought', ME)
    expect(inLens(prompt, 'prompts', ME)).toBe(true)
    expect(inLens(prompt, 'thoughts', ME)).toBe(false)
    expect(inLens(thought, 'thoughts', ME)).toBe(true)
    expect(inLens(thought, 'prompts', ME)).toBe(false)
  })
})
