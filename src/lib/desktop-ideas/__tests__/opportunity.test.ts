/**
 * The opportunity set: Explore's candidates, narrowed to the idea-worthy ones.
 *
 * Desktop Ideas is the dashboard counterpart to mobile Explore, reading the
 * SAME candidates -- so what this module owns is membership and kind, never
 * generation and never order. These cases pin that boundary.
 */
import { describe, it, expect } from 'vitest'
import {
  opportunitiesFrom, opportunityKind, isIdeaWorthy, opportunitySize,
  withFeatureBudget, targetForOpportunity, OPPORTUNITY_LABEL,
} from '../opportunity'
import type { ComposedExploreItem, ExploreItem } from '../../mobile/explore-item'

const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
  id: 'x1', dedupeKey: 'k1', signalType: null,
  category: 'research' as never, subtype: 'signal',
  title: 'Something happened', symbol: 'AAA', assetId: 'a-1',
  destination: {} as never,
  ...over,
})

const composed = (
  over: Partial<ExploreItem> = {},
  emphasis: 'standard' | 'feature' = 'standard',
): ComposedExploreItem => ({ item: item(over), emphasis, score: 1 })

describe('which candidates carry an investment question', () => {
  it('keeps a candidate about a name', () => {
    expect(isIdeaWorthy(item({ symbol: 'AAA' }))).toBe(true)
  })

  it('drops news and aggregates, which belong to Explore', () => {
    /*
     * News may PROMPT an idea, but the item is a story to read and its action
     * is the article reader. An aggregate -- "4 new ideas this week" -- is a
     * navigation device resolving to a filtered list, with no single name to
     * think about, which is the premise of a card in this lens.
     */
    expect(isIdeaWorthy(item({ subtype: 'news' }))).toBe(false)
    expect(isIdeaWorthy(item({ subtype: 'aggregate' }))).toBe(false)
  })

  it('drops a candidate with no instrument behind it', () => {
    // Every kind is a question about an instrument. Without one there is
    // nothing for this lens to be about.
    expect(isIdeaWorthy(item({ symbol: null, assetId: null }))).toBe(false)
  })
})

describe('what kind of question it raises', () => {
  it('reads the signal type before the subtype, and never the prose', () => {
    // `signalType` is set precisely by the adapters; `subtype` is a coarse
    // family. Matching on the title text is how a rule silently stops working
    // the day somebody rewords a string.
    expect(opportunityKind(item({ signalType: 'price_move_since_review' }))).toBe('price_move')
    expect(opportunityKind(item({ signalType: 'active_weight_gap' }))).toBe('exposure')
    expect(opportunityKind(item({ signalType: 'scenario_ladder_stale' }))).toBe('framework')
    expect(opportunityKind(item({ signalType: 'no_thesis_on_position' }))).toBe('no_thesis')
  })

  it('falls back to the subtype family, and never to a type mobile cannot produce', () => {
    expect(opportunityKind(item({ subtype: 'research', signalType: null }))).toBe('new_evidence')
    expect(opportunityKind(item({ subtype: 'workflow', signalType: null }))).toBe('workflow')
    expect(opportunityKind(item({ subtype: 'idea', signalType: null }))).toBe('authored')
  })
})

describe('the set preserves the order it was given', () => {
  it('never re-ranks', () => {
    /*
     * `diversifyExplore` has already scored, deduped and applied repulsion
     * between neighbours of the same sort. A second ordering rule here is how
     * two surfaces begin disagreeing about the same desk.
     */
    const input = [
      composed({ id: 'a', symbol: 'AAA' }),
      composed({ id: 'b', subtype: 'news' }),      // dropped
      composed({ id: 'c', symbol: 'CCC' }),
      composed({ id: 'd', symbol: 'DDD' }),
    ]
    expect(opportunitiesFrom(input).map(o => o.item.id)).toEqual(['a', 'c', 'd'])
  })
})

describe('room is decided by the candidate, not by where it landed', () => {
  const opp = (over: Partial<ExploreItem> = {}) => {
    const c = composed(over)
    return { composed: c, item: c.item, kind: 'other' as const }
  }

  it('gives the strongest candidate the hero whatever its content', () => {
    // A page whose first cell is compact reads as having nothing to say.
    expect(opportunitySize(opp(), 0)).toBe('hero')
  })

  it('sizes the rest from the item, so the same card is the same size anywhere', () => {
    /*
     * The first version graded monotonically by index -- hero, large, medium,
     * compact -- so the page shrank as it scrolled, every wide card sat at the
     * top, and a card's size depended on what happened to rank above it.
     *
     * `exploreCardSize` asks the item instead. The same candidate therefore
     * gets the same room at position 3 and position 30, which is both
     * explainable and what scatters the wide cards down the page.
     */
    const rich = opp({ subtype: 'signal', metric: { value: '6.2%', label: 'weight' } })
    expect(opportunitySize(rich, 3)).toBe(opportunitySize(rich, 30))
  })
})

describe('the chip vocabulary names only stages this product has', () => {
  /*
   * A retired stage is worse than a vague word.
   *
   * The `authored` kind shipped as "Proposed" for one pass. Proposal is a
   * stage this product removed after pilot graduation -- the four maturities
   * are Researching, Thesis forming, Decision ready and Deciding -- so the
   * chip told the reader a post was somewhere it could not be. A label is
   * ontology the reader can see, and inventing one is the "flattening a typed
   * entity into free text" failure wearing different clothes.
   */
  const RETIRED = ['proposed', 'proposal', 'pilot', 'seeded', 'graduat']

  it('uses no word for a stage the ontology retired', () => {
    const offending = Object.entries(OPPORTUNITY_LABEL)
      .filter(([, label]) => RETIRED.some(d => label.toLowerCase().includes(d)))
      .map(([kind, label]) => `${kind}: "${label}"`)
    expect(offending).toEqual([])
  })

  it('names who raised an authored post, which is the real distinction', () => {
    // A person wrote it; Tesseract did not. That is the one thing this kind
    // knows and the only thing the chip should claim.
    expect(opportunityKind(item({ subtype: 'idea', signalType: null }))).toBe('authored')
    expect(OPPORTUNITY_LABEL.authored).toBe('Written by someone')
  })
})

describe('a thread raised from a candidate lands on the asset', () => {
  it('binds to the asset, never to an idea row nobody has staged', () => {
    /*
     * `model.targetFor` takes an IdeaRow -- a maturity, a conviction, a
     * thesis. A candidate has none of those, so handing one to that builder
     * would mean inventing a stage. Both builders return the same type and
     * both bind to the asset, so a thread raised here and a thread raised from
     * the idea it becomes point at the same object.
     */
    const c = composed({ symbol: 'NVDA', assetId: 'a-nvda', companyName: 'NVIDIA' })
    const t = targetForOpportunity({ composed: c, item: c.item, kind: 'price_move' })
    expect(t?.objectType).toBe('asset')
    expect(t?.objectId).toBe('a-nvda')
    expect(t?.assetId).toBe('a-nvda')
    expect(t?.origin?.surface).toBe('ideas')
  })

  it('refuses a candidate with no asset, rather than opening nothing', () => {
    // The lens shows the card and omits the actions. Same rule the authored
    // field applied through `discussable`.
    const c = composed({ symbol: 'ZZZ', assetId: null })
    expect(targetForOpportunity({ composed: c, item: c.item, kind: 'other' })).toBeNull()
  })
})

describe('the page cannot spend emphasis until it means nothing', () => {
  it('demotes wide cards past the budget, and never the lead', () => {
    /*
     * `MAX_FEATURES` is mobile's number and mobile's reasoning: past a handful,
     * emphasis stops being emphasis. Applied AFTER sizing, so a demotion is a
     * page constraint rather than something hidden inside the size rule -- and
     * it never changes what the candidate is.
     */
    const sizes = withFeatureBudget(
      ['hero', 'large', 'large', 'large', 'large', 'large', 'large'],
      2,
    )
    expect(sizes[0]).toBe('hero')            // the lead is not a feature
    expect(sizes.filter(s => s === 'large')).toHaveLength(2)
    expect(sizes.slice(3).every(s => s === 'medium')).toBe(true)
  })
})
