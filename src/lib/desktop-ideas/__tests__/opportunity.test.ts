/**
 * The opportunity set: Explore's candidates, narrowed to the idea-worthy ones.
 *
 * Desktop Ideas is the dashboard counterpart to mobile Explore, reading the
 * SAME candidates -- so what this module owns is membership and kind, never
 * generation and never order. These cases pin that boundary.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  opportunitiesFrom, opportunityKind, isIdeaWorthy, opportunitySize,
  withFeatureBudget, withRunRhythm, targetForOpportunity, OPPORTUNITY_LABEL,
  pictureBudget, type OpportunitySize,
} from '../opportunity'
import { exploreVisualKind } from '../../mobile/explore-visual'
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

  it('reads the absence, not the subject it is an absence of', () => {
    /*
     * The type the derived-insight producer actually emits. `insightSignalType`
     * returns `no_research` for every documentation gap, and the family rule
     * for `evidence|research|note` used to claim it on the strength of the
     * word "research" alone -- so 41 of 90 tiles in this lens were chipped
     * "New research" above the sentence "MU has no investment thesis".
     *
     * Asserted through the LABEL as well as the kind, because the kind is an
     * internal name and the chip is the thing a reader sees contradict the
     * card.
     */
    expect(opportunityKind(item({ signalType: 'no_research' }))).toBe('no_thesis')
    expect(OPPORTUNITY_LABEL[opportunityKind(item({ signalType: 'no_research' }))])
      .toBe('No thesis')
    expect(opportunityKind(item({ signalType: 'missing_case' }))).toBe('no_thesis')

    /* And the negation is a word, not three letters. A note is a thing that
       exists; "notice" and "unknown" are not absences either. */
    expect(opportunityKind(item({ signalType: 'note_arrived' }))).toBe('new_evidence')
    expect(opportunityKind(item({ signalType: 'new_evidence_on_case' }))).toBe('new_evidence')
  })

  it('falls back to the subtype family, and never to a type mobile cannot produce', () => {
    expect(opportunityKind(item({ subtype: 'research', signalType: null }))).toBe('new_evidence')
    expect(opportunityKind(item({ subtype: 'workflow', signalType: null }))).toBe('workflow')
    expect(opportunityKind(item({ subtype: 'idea', signalType: null }))).toBe('authored')
  })
})

describe('no one picture takes over the field', () => {
  /*
   * Measured live at 1920x889: 43 of 90 tiles drew `question`, and 41 of
   * those printed the identical sentence "What best describes this
   * position?". `diversifyExplore` spaces near-duplicates but cannot reduce
   * them -- its five axes never look at what a card DRAWS -- so at 48% of
   * the pool the reader met it every other tile.
   *
   * A `question` is what `exploreVisualFor` returns for an item carrying a
   * producer's prompt and nothing else to draw, which is exactly the shape
   * of the real no-thesis candidates.
   */
  const asking = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({
    item: item({
      id: `q${from + i}`, symbol: `Q${from + i}`, subtype: 'research',
      visual: { question: 'What best describes this position?' },
    }),
  } as ComposedExploreItem))

  const held = (n: number) => Array.from({ length: n }, (_, i) => ({
    item: item({
      id: `w${i}`, symbol: `W${i}`, subtype: 'research',
      portfolio: { weightPct: 1 + i * 0.1, name: 'Core' },
    }),
  } as ComposedExploreItem))

  const drawn = (out: ReturnType<typeof opportunitiesFrom>) => {
    const counts = new Map<string, number>()
    for (const o of out) {
      const k = exploreVisualKind(o.item)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return counts
  }

  it('trims the flood to its share of what is left', () => {
    const out = opportunitiesFrom([...asking(43), ...held(15)])
    const counts = drawn(out)

    /*
     * The PROPERTY, not the number. A case pinning "12 questions" would go
     * quiet the day the candidate mix changes, which is exactly when it
     * should speak -- the share is of the field after trimming, and trimming
     * changes the field.
     */
    for (const [, n] of counts) {
      expect(n).toBeLessThanOrEqual(Math.max(5, Math.ceil(out.length / 5)))
    }
    expect(counts.get('question')!).toBeLessThan(43)
    expect(out.length).toBeLessThan(58)
  })

  it('keeps the ranker\'s own strongest, and never reorders', () => {
    /* Membership is the only thing this module decides. What survives is a
       PREFIX of each picture's run in the order it arrived, so nothing is
       promoted past anything. */
    const given = [...asking(40), ...held(10)]
    const out = opportunitiesFrom(given)
    const order = given.map(c => c.item.id)

    expect(out.map(o => o.item.id))
      .toEqual(out.map(o => o.item.id).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)))
    /* The first question admitted is the first question offered. */
    expect(out.find(o => o.item.id.startsWith('q'))!.item.id).toBe('q0')
  })

  it('never trims below the floor, however thin the field', () => {
    /*
     * The floor, not an exemption. On a page of twelve a fifth is two, and
     * cutting a desk's seven unexamined positions down to two would hide
     * real work -- five of the same problem is information at that size. So
     * the floor wins and the share does not hold there, which is deliberate
     * and is why the case above allows `Math.max(5, ...)` rather than the
     * share alone.
     */
    const out = opportunitiesFrom([...asking(4), ...held(7)])
    expect(drawn(out).get('question')).toBe(4)
    expect(drawn(out).get('exposure')).toBe(5)
  })

  it('leaves a field alone when nothing floods it', () => {
    const out = opportunitiesFrom([...asking(4), ...held(5)])
    expect(out).toHaveLength(9)
  })

  it('never empties a field that is entirely one picture', () => {
    expect(opportunitiesFrom(asking(60)).length).toBe(5)
    expect(opportunitiesFrom([]).length).toBe(0)
  })

  it('settles rather than spiralling, whatever the mix', () => {
    /* The cap is a fixed point: the share is of the field AFTER trimming, so
       each pass can lower it again. Bounded below, so it terminates -- these
       shapes are the ones that would spin if it were not. */
    expect(pictureBudget([])).toBe(0)
    expect(pictureBudget(Array(500).fill('question'))).toBe(5)
    expect(pictureBudget(Array.from({ length: 500 }, (_, i) => `k${i}`))).toBe(100)
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

  /*
   * ── A page's budget, and a field's ───────────────────────────────────────
   *
   * The case above is the PAGE shape and is unchanged: mobile's Explore is a
   * screenful, and a total is right for it. Desktop Explore is ninety tiles,
   * and measured there the same total spent all four features inside the
   * first nine and demoted every one after -- seventy-five consecutive
   * `medium`, four to a row, for the rest of the scroll.
   *
   * "Emphasis stops being emphasis past a handful" is a claim about what the
   * reader sees at once, not about what a list may contain, so a caller that
   * knows it is drawing a field asks for a window.
   */
  it('spends the budget again further down a long field', () => {
    const sizes = withFeatureBudget(Array(13).fill('large'), 2, 4)
    /* Window one holds indices 1-4 and affords two; window two holds 5-8 and
       affords two more. A total would have demoted everything from index 3. */
    expect(sizes.slice(0, 5)).toEqual(['large', 'large', 'large', 'medium', 'medium'])
    expect(sizes.slice(5, 9)).toEqual(['large', 'large', 'medium', 'medium'])
    /* The point of the whole change: a feature is still affordable at the
       bottom of the field. */
    expect(sizes.slice(9).includes('large')).toBe(true)
  })

  it('is unchanged for a caller that does not ask for a window', () => {
    /* `Infinity` by default. The mobile-shaped callers must not inherit a
       behaviour change from a desktop field's requirement. */
    const windowed = withFeatureBudget(Array(13).fill('large'), 2, Infinity)
    const plain = withFeatureBudget(Array(13).fill('large'), 2)
    expect(windowed).toEqual(plain)
    /* Three larges, not two: index 0 is the lead and is never counted against
       the budget, so two features sit behind it. */
    expect(plain.filter(s => s === 'large')).toHaveLength(3)
    expect(plain.slice(3).every(s => s === 'medium')).toBe(true)
  })
})

describe('a wall of identical cells is not a layout', () => {
  it('breaks a run once it is longer than the cap', () => {
    const out = withRunRhythm(Array(10).fill('medium'), 3)
    /* Four in a row is a wall at the stated cap; the fifth gets a step more
       room and the count restarts from it. */
    expect(out.slice(0, 4).every(s => s === 'medium')).toBe(true)
    expect(out[4]).toBe('large')
    expect(out.filter(s => s === 'large').length).toBeGreaterThan(1)
  })

  it('leaves a varied field exactly as it found it', () => {
    /*
     * Self-limiting, and this is what makes the rule defensible: it cannot
     * add emphasis to a page that already has some. It fires only where a run
     * has already reached the cap, so it is breaking a wall rather than
     * claiming anything about the item it promotes.
     */
    const varied: OpportunitySize[] = ['hero', 'large', 'medium', 'compact', 'medium', 'large', 'medium']
    expect(withRunRhythm(varied, 3)).toEqual(varied)
  })

  it('promotes one step, never two', () => {
    const out = withRunRhythm(Array(6).fill('compact'), 2)
    /* A run of compacts is the quietest part of the field. Jumping it to
       `large` would put a feature in the middle of it. */
    expect(out).not.toContain('large')
    expect(out).toContain('medium')
  })

  it('never touches the lead', () => {
    const out = withRunRhythm(['hero', 'hero', 'hero', 'hero'], 1)
    expect(out[0]).toBe('hero')
  })
})

describe('Explore asks for both, because it draws a field', () => {
  const code = readFileSync(
    join(process.cwd(), 'src/components/ideas-app/IdeasExploreBrowse.tsx'),
    'utf8',
  )

  it('windows the budget and breaks runs, in that order', () => {
    /*
     * Order matters and is not interchangeable. The budget decides how much
     * emphasis the CONTENT may have; the rhythm then decides that whatever
     * wall survives is not a layout. Run the rhythm first and the budget
     * would demote the very cells the rhythm promoted to break the wall.
     */
    const call = code.match(/withRunRhythm\([\s\S]*?\[shown\]/)?.[0]
    expect(call, 'Explore must break runs').toBeTruthy()
    /* Nested, so the budget runs first. Two sibling statements would compile
       and could be reordered without anything noticing. */
    expect(call).toContain('withFeatureBudget')
    expect(call).toContain('FEATURE_WINDOW')
    expect(call).toContain('MAX_RUN')
    expect(call!.indexOf('withFeatureBudget')).toBeLessThan(call!.indexOf('MAX_RUN'))
  })
})
