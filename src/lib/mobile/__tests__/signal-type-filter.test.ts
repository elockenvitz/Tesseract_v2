import { describe, it, expect } from 'vitest'

import { categoryOf, signalTypeOf } from '../feed-categories'
import { KIND_LABEL } from '../../../components/signals/card-identity'
import {
  RESEARCH_FILTER_OPTIONS, researchFramingFromFilterKey,
} from '../../research/case-state'
import { CONTENT_REGISTRY } from '../../signals/content-registry'
import { EMPTY_FILTER, filterCount, type FeedFilter } from '../../../hooks/mobile/useFeedFacets'

/**
 * Filtering by the word on the card's own pill.
 *
 * A category is five buckets over thirty card types, so "Research" answers
 * "no thesis", "unreviewed change" and "target expired" together — and the pill
 * is what the reader recognises and what they mean by "show me the no-thesis
 * ones". Nothing filtered on it.
 */

const entry = (kind: string, type?: string) =>
  ({ kind, card: type ? { type } : null })

/** The predicate the feed applies, in the same order. */
const matches = (f: FeedFilter, e: ReturnType<typeof entry>) => {
  if (f.kinds.length) {
    const c = categoryOf(e)
    if (!c || !f.kinds.includes(c)) return false
  }
  if (f.signalTypes.length) {
    const t = signalTypeOf(e)
    if (!t || !f.signalTypes.includes(t)) return false
  }
  return true
}

describe('the pill is read from the declared type only', () => {
  it('names the card type', () => {
    expect(signalTypeOf(entry('signal', 'no_research'))).toBe('no_research')
    expect(signalTypeOf(entry('lens', 'conviction_oversized'))).toBe('conviction_oversized')
  })

  it('refuses to guess from the entry kind', () => {
    // `categoryOf` may fall back to the kind because every member of a kind
    // shares a category. That does not carry here: a `lens` entry may be a
    // crowding card or an oversized one, and guessing would put a card under a
    // pill it does not wear.
    expect(signalTypeOf(entry('lens'))).toBeNull()
    expect(categoryOf(entry('lens'))).toBe('decisions')
  })

  it('rejects a type the registry does not know', () => {
    expect(signalTypeOf(entry('signal', 'invented_kind'))).toBeNull()
  })
})

describe('the pill filter narrows within a category', () => {
  const noThesis = entry('signal', 'no_research')
  const staleWork = entry('signal', 'research_stale')

  it('keeps only the chosen pill', () => {
    const f = { ...EMPTY_FILTER, signalTypes: ['no_research'] }
    expect(matches(f, noThesis)).toBe(true)
    expect(matches(f, staleWork)).toBe(false)
  })

  it('composes with the category rather than replacing it', () => {
    // Research + No thesis is a narrower question than either alone, which is
    // why the two are separate lists.
    const both = { ...EMPTY_FILTER, kinds: ['research'], signalTypes: ['no_research'] }
    expect(matches(both, noThesis)).toBe(true)

    const wrongCategory = { ...EMPTY_FILTER, kinds: ['news'], signalTypes: ['no_research'] }
    expect(matches(wrongCategory, noThesis)).toBe(false)
  })

  it('takes several pills at once', () => {
    const f = { ...EMPTY_FILTER, signalTypes: ['no_research', 'research_stale'] }
    expect(matches(f, noThesis)).toBe(true)
    expect(matches(f, staleWork)).toBe(true)
  })

  it('excludes an entry with no pill rather than assuming it qualifies', () => {
    // Same rule the asset facets use: a tile that cannot satisfy the filter is
    // excluded, not waved through.
    const f = { ...EMPTY_FILTER, signalTypes: ['no_research'] }
    expect(matches(f, entry('lens'))).toBe(false)
  })

  it('changes nothing when unset', () => {
    expect(matches(EMPTY_FILTER, entry('lens'))).toBe(true)
    expect(matches(EMPTY_FILTER, noThesis)).toBe(true)
  })
})

describe('it counts as an active filter', () => {
  it('is included in the badge count', () => {
    // Otherwise the header would say "no filters" over a narrowed feed.
    expect(filterCount(EMPTY_FILTER)).toBe(0)
    expect(filterCount({ ...EMPTY_FILTER, signalTypes: ['no_research'] })).toBe(1)
    expect(filterCount({
      ...EMPTY_FILTER, kinds: ['research'], signalTypes: ['no_research', 'target_expired'],
    })).toBe(3)
  })

  it('starts empty', () => {
    expect(EMPTY_FILTER.signalTypes).toEqual([])
  })
})

describe('the pill list covers lens and scenario cards too', () => {
  /**
   * The reported miss: Oversized, Target reached, Target expired and Case vs
   * price were absent from the Signal filter.
   *
   * Those entries build their card at RENDER time, so the entry itself has no
   * `.card` and `signalTypeOf` returned null for exactly them. The feed already
   * names every entry's type in one place — the ranker's input — and that is
   * what the filter reads now.
   */
  const rankType = (e: { kind: string; type?: string }) => e.type ?? null

  it('resolves a lens entry that carries no built card', () => {
    const lens = { kind: 'lens', type: 'conviction_oversized' }
    expect(signalTypeOf(lens as any)).toBeNull()
    expect(rankType(lens)).toBe('conviction_oversized')
  })

  it('offers every pill the pool contains, not just the rendered page', () => {
    // Deriving the options from what is on screen meant choosing one pill
    // removed every other option, and pills deeper than the current page never
    // appeared at all.
    const pool = [
      { kind: 'lens', type: 'conviction_oversized' },
      { kind: 'lens', type: 'target_hit' },
      { kind: 'lens', type: 'target_expired' },
      { kind: 'scenario', type: 'scenario_gap' },
      { kind: 'signal', type: 'no_research' },
    ]
    const present = new Set(pool.map(rankType).filter(Boolean))
    for (const t of ['conviction_oversized', 'target_hit', 'target_expired', 'scenario_gap']) {
      expect(present.has(t)).toBe(true)
    }
  })
})


describe('the Signal list is the whole vocabulary', () => {
  /**
   * It used to be derived from the rendered feed, so a type nobody had a card
   * for today was simply absent from the sheet. That surfaced as "there is no
   * target expired filter" — indistinguishable, from the outside, from a bug.
   *
   * The set of things Tesseract can tell you is fixed and knowable. A control
   * that changes shape with the data cannot be learned, and "none right now"
   * is a useful answer that a missing option cannot give.
   */
  it('offers every signal type, including ones with no card today', () => {
    const offered = Object.keys(KIND_LABEL)
    for (const t of Object.keys(CONTENT_REGISTRY)) {
      expect(offered, `${t} must be filterable`).toContain(t)
    }
    expect(offered).toContain('target_expired')
  })

  it('labels each one, and the label is the pill wherever a type means one thing', () => {
    expect(KIND_LABEL.target_expired).toBe('Target expired')
    for (const t of Object.keys(CONTENT_REGISTRY)) {
      expect(KIND_LABEL[t as keyof typeof KIND_LABEL]).toBeTruthy()
    }
  })

  it('offers Research by FRAMING, which is what a reader recognises', () => {
    /**
     * The five states the card pill names, selectable directly. They are
     * pseudo-keys rather than `SignalType`s: a type carries a tier, a base
     * score, a registry entry and a judgment scope, and none of those differ
     * between the framings — only the reason the card exists does.
     */
    const keys = RESEARCH_FILTER_OPTIONS.map(o => o.key)
    expect(keys).toEqual([
      'research:new_evidence', 'research:price_move', 'research:long_silence',
      'research:no_case', 'research:incomplete_case',
    ])
    expect(RESEARCH_FILTER_OPTIONS.map(o => o.label)).toEqual([
      'New research', 'Material move', 'Case not revisited',
      'No core thesis', 'Incomplete thesis',
    ])
  })

  it('adds no SignalType to do it', () => {
    // The contract is untouched: no framing key is a registered card type.
    for (const o of RESEARCH_FILTER_OPTIONS) {
      expect(Object.keys(CONTENT_REGISTRY)).not.toContain(o.key)
    }
    expect(researchFramingFromFilterKey('research:price_move')).toBe('price_move')
    expect(researchFramingFromFilterKey('target_expired')).toBeNull()
    expect(researchFramingFromFilterKey('research:not_a_framing')).toBeNull()
  })

  it('offers no two rows with the same words', () => {
    /**
     * The duplicate the phone review found, pinned. `research_stale`'s category
     * label is "Needs review" and so is `awaiting_review`'s — two identical
     * rows, one of which silently did something else. The Research types are
     * no longer offered at all; their framings are.
     */
    const { research_stale: _a, no_research: _b, ...rest } = KIND_LABEL
    const offered = [...Object.values(rest), ...RESEARCH_FILTER_OPTIONS.map(o => o.label)]
    expect(new Set(offered).size).toBe(offered.length)
  })

  it('selecting a type with no entries yields an empty feed, not an unfiltered one', () => {
    // The empty result is the answer. A filter that silently fell back to
    // showing everything would tell the reader the opposite of the truth.
    const f: FeedFilter = { ...EMPTY_FILTER, signalTypes: ['corporate_action'] }
    const entries = [entry('lens', 'target_expired'), entry('signal', 'no_thesis')]
    expect(entries.filter(e => matches(f, e))).toHaveLength(0)
  })
})
