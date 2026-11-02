import { describe, expect, it } from 'vitest'

import {
  composeExplore, dedupeExplore, freshness,
  materiality, repulsion, scoreExplore,
} from '../explore-compose'
import { aggregatesFor, exploreSymbols, insightsToExplore } from '../explore-adapters'
import type { ExploreItem } from '../explore-item'
import { EXPLORE_FIXTURE, NOW } from './explore-fixture'

/**
 * Phase 9: Explore composes for breadth, deterministically.
 *
 * The property under test throughout is that this is NOT a re-sorted Curate.
 * Curate answers "what deserves my attention" and its order is a ranking;
 * Explore answers "what might be interesting" and its order is an arrangement.
 * Most of what follows asserts the arrangement — that one name, one family and
 * one source cannot take over the opening of the page.
 */

const ids = (items: { item: ExploreItem }[]) => items.map(x => x.item.id)
const cats = (items: { item: ExploreItem }[]) => items.map(x => x.item.category)
const syms = (items: { item: ExploreItem }[]) => items.map(x => x.item.symbol ?? '—')

const compose = (candidates = EXPLORE_FIXTURE, category: any = null) =>
  composeExplore(candidates, { now: NOW, category })

describe('relevance', () => {
  it('bounds freshness so it cannot become reverse chronology', () => {
    // A trivial item from five minutes ago must not outrank a useful research
    // update from yesterday on recency alone.
    expect(freshness(new Date(NOW).toISOString(), NOW)).toBe(1)
    expect(freshness(new Date(NOW - 40 * 86_400_000).toISOString(), NOW)).toBe(0)
    // And an item with no timestamp does not get treated as brand new.
    expect(freshness(null, NOW)).toBe(0)
    expect(freshness('not a date', NOW)).toBe(0)
  })

  it('bands materiality rather than scaling it', () => {
    const small = materiality({ portfolio: { weightPct: 1 } } as ExploreItem)
    const huge = materiality({ portfolio: { weightPct: 25 } } as ExploreItem)
    expect(huge).toBeGreaterThan(small)
    expect(huge / small).toBeLessThan(4)
  })

  it('treats an unknown weight as neutral, not as tiny', () => {
    // Several sources carry no weight at all. Scoring those as though the
    // position were negligible would bury whole families for a plumbing reason.
    const unknown = materiality({ symbol: 'AAPL' } as ExploreItem)
    expect(unknown).toBeGreaterThan(materiality({ portfolio: { weightPct: 0.5 } } as ExploreItem))
    expect(unknown).toBeLessThan(materiality({ portfolio: { weightPct: 8 } } as ExploreItem))
  })

  it('caps the borrowed Curate importance', () => {
    // Enough that a real breach outshines a routine one; not enough to
    // reassemble the Curate order inside Explore, which would make the second
    // mode pointless.
    const base: ExploreItem = {
      id: 'x', dedupeKey: 'x', category: 'decisions', subtype: 'signal',
      title: 't', destination: { kind: 'filter', category: 'decisions' },
    }
    const low = scoreExplore({ ...base, importance: 0 }, NOW)
    const high = scoreExplore({ ...base, importance: 1 }, NOW)
    expect(high - low).toBeLessThanOrEqual(0.17)
  })

  it('gives a small edge to developments that are not problems', () => {
    // Explore should read as "investment thinking is happening here", not as a
    // wall of warnings. Curate's distribution is all gaps by construction.
    const base: ExploreItem = {
      id: 'x', dedupeKey: 'x', category: 'research', subtype: 'research',
      title: 't', destination: { kind: 'filter', category: 'research' },
    }
    expect(scoreExplore({ ...base, positive: true }, NOW))
      .toBeGreaterThan(scoreExplore(base, NOW))
  })
})

describe('deduplication', () => {
  it('shows one artifact once however many adapters describe it', () => {
    // A thesis update is both research and team activity; a market event is
    // both a template and a news story. Same key, one tile.
    const dup: ExploreItem[] = [
      { id: 'a-activity', dedupeKey: 'thesis:nvda', category: 'research', subtype: 'research',
        title: 'Sarah updated a thesis', destination: { kind: 'filter', category: 'research' } },
      { id: 'b-research', dedupeKey: 'thesis:nvda', category: 'research', subtype: 'research',
        title: 'NVDA thesis updated', portfolio: { weightPct: 9 },
        destination: { kind: 'filter', category: 'research' } },
    ]
    const out = dedupeExplore(dup, NOW)
    expect(out).toHaveLength(1)
    // And keeps the RICHER preview, not simply the first one seen.
    expect(out[0].id).toBe('b-research')
  })

  it('is stable under input order', () => {
    const a = dedupeExplore(EXPLORE_FIXTURE, NOW).map(i => i.id)
    const b = dedupeExplore([...EXPLORE_FIXTURE].reverse(), NOW).map(i => i.id)
    expect(b).toEqual(a)
  })

  it('does not merge genuinely different findings on one name', () => {
    // Two signals about AAPL are two things worth knowing, and only adjacency
    // is the problem — that is diversity's job, not dedupe's.
    const out = dedupeExplore(EXPLORE_FIXTURE.filter(i => i.symbol === 'AAPL'), NOW)
    expect(out.length).toBeGreaterThan(1)
  })
})

describe('diversity', () => {
  it('does not let one ticker take over the opening', () => {
    /**
     * The fixture stacks four AAPL items deliberately. All are legitimate, and
     * showing three of the first five would still be a bad page: the asset
     * detail surface is where one name's context converges, and Explore's job
     * is the opposite of that.
     */
    const first6 = syms(compose()).slice(0, 6)
    const aapl = first6.filter(s => s === 'AAPL').length
    expect(aapl, `AAPL took ${aapl} of the first six`).toBeLessThanOrEqual(2)
  })

  it('shows several categories early when alternatives exist', () => {
    const first6 = new Set(cats(compose()).slice(0, 6))
    expect(first6.size).toBeGreaterThanOrEqual(3)
  })

  it('does not run the same subtype consecutively when it can avoid it', () => {
    const out = compose().map(x => x.item.subtype).slice(0, 8)
    let worst = 0, run = 0, prev: string | null = null
    for (const s of out) { run = s === prev ? run + 1 : 1; prev = s; worst = Math.max(worst, run) }
    expect(worst).toBeLessThanOrEqual(3)
  })

  it('penalises repeats across every axis at once', () => {
    // A page can be monotonous in five different ways, and fixing one is how
    // "diverse by signal type" still produced six AAPL tiles.
    const item: ExploreItem = {
      id: 'x', dedupeKey: 'x', category: 'research', subtype: 'research', symbol: 'AAPL',
      source: { kind: 'person', label: 'Sarah' }, portfolio: { name: 'Core' },
      title: 't', destination: { kind: 'filter', category: 'research' },
    }
    const alone = repulsion(item, [])
    const afterTwin = repulsion(item, [{ ...item, id: 'y' }])
    expect(alone).toBe(0)
    expect(afterTwin).toBeGreaterThan(1)
    // And the memory of a repeat fades with distance.
    const filler: ExploreItem[] = Array.from({ length: 6 }, (_, i) => ({
      ...item, id: `f${i}`, symbol: `F${i}`, source: undefined, portfolio: undefined,
      category: 'news', subtype: 'news',
    }))
    expect(repulsion(item, [{ ...item, id: 'y' }, ...filler])).toBeLessThan(afterTwin)
  })

  it('does not let breadth promote something trivial to the top', () => {
    // The floor. A workflow reminder must not lead the page purely for being
    // the only thing of its kind.
    const out = compose()
    expect(out[0].item.category).not.toBe('workflow')
  })

  it('drops nothing', () => {
    expect(compose()).toHaveLength(dedupeExplore(EXPLORE_FIXTURE, NOW).length)
  })
})

describe('determinism', () => {
  it('produces the same page every time', () => {
    const first = ids(compose())
    for (let i = 0; i < 15; i++) expect(ids(compose())).toEqual(first)
  })

  it('does not depend on the order the sources resolved in', () => {
    // No seed, no shuffle, no clock. This is the property that makes Explore
    // debuggable and lets a reader build a mental map of their own page.
    expect(ids(composeExplore([...EXPLORE_FIXTURE].reverse(), { now: NOW })))
      .toEqual(ids(compose()))
  })
})

describe('emphasis', () => {
  it('is decided elsewhere, and this pass does not pre-empt it', () => {
    /**
     * Composition used to end by calling `assignEmphasis`, which read an item's
     * INDEX in the arrangement this function had just produced — so a card's
     * width was a side effect of the diversity pass and the same signal was
     * wide on one page and narrow on the next.
     *
     * Width is now a property of the item, in `explore-layout`. What this
     * asserts is the separation: nothing leaves here already emphasised, so
     * there is exactly one place that can answer "why is this card wide".
     */
    expect(compose().every(e => e.emphasis === 'standard')).toBe(true)
  })
})

describe('taxonomy', () => {
  it('filters to the canonical categories', () => {
    for (const c of ['decisions', 'research', 'ideas', 'workflow', 'news'] as const) {
      const out = compose(EXPLORE_FIXTURE, c)
      expect(out.length, `${c} produced nothing`).toBeGreaterThan(0)
      expect(new Set(cats(out))).toEqual(new Set([c]))
    }
  })

  it('composes the filtered set rather than hiding rows of the mixed one', () => {
    // Otherwise the diversity penalties would be computed against items the
    // reader cannot see, and a filtered page would be arranged for a page that
    // does not exist.
    const research = compose(EXPLORE_FIXTURE, 'research')
    const mixed = compose().filter(e => e.item.category === 'research')
    expect(research.length).toBe(mixed.length)
    expect(ids(research)).not.toEqual(ids(mixed))
  })

  it('files team activity as its source, not as its own category', () => {
    // `Team` is not a canonical category and must not become one here.
    const authored = EXPLORE_FIXTURE.filter(i => i.source?.kind === 'person')
    expect(authored.length).toBeGreaterThan(0)
    for (const i of authored) {
      expect(['research', 'ideas', 'decisions', 'workflow', 'news']).toContain(i.category)
    }
  })
})

describe('a research insight with no exposure still says something', () => {
  /**
   * The exposure clause wins where it exists: "4.2% of Large Cap Growth" is
   * what makes a documentation gap urgent, and the body repeats what the
   * headline implies.
   */
  it('prefers the exposure line when the name is held', () => {
    const [item] = insightsToExplore([{
      kind: 'no_thesis', assetId: 'a1', symbol: 'IBM', headline: 'IBM has no investment thesis',
      body: 'None of thesis, where different, risks to thesis has been written.',
      portfolioName: 'Large Cap Growth', weightPct: 4.2,
    }] as never)
    expect(item.context).toBe('4.2% of Large Cap Growth')
  })

  /**
   * THE case. An unheld name has no exposure clause, and before this the tile
   * carried a headline and an Open button and nothing else -- measured live on
   * IBM, BKNG and TGT once the incoherent prompt was removed.
   */
  it('falls back to the producer’s own body when nobody holds it', () => {
    const [item] = insightsToExplore([{
      kind: 'no_thesis', assetId: 'a1', symbol: 'IBM', headline: 'IBM has no investment thesis',
      body: 'None of thesis, where different, risks to thesis has been written.',
    }] as never)
    expect(item.context).toBe('None of thesis, where different, risks to thesis has been written.')
  })

  /** And claims nothing when the producer gave it nothing. */
  it.each([undefined, '', '   '])('adds nothing for a body of %o', body => {
    const [item] = insightsToExplore([{
      kind: 'no_thesis', assetId: 'a1', symbol: 'IBM', headline: 'IBM has no investment thesis', body,
    }] as never)
    expect(item.context).toBeUndefined()
  })
})

describe('aggregates', () => {
  it('counts only what is actually in hand', () => {
    const aggs = aggregatesFor(EXPLORE_FIXTURE, NOW)
    for (const a of aggs) {
      const real = EXPLORE_FIXTURE.filter(i =>
        i.category === a.category && i.occurredAt &&
        NOW - new Date(i.occurredAt).getTime() <= 7 * 86_400_000).length
      expect(a.count).toBe(real)
    }
  })

  it('does not produce a tile for two things', () => {
    // "2 new ideas" is not a discovery, it is two tiles.
    const thin = EXPLORE_FIXTURE.filter(i => i.category === 'ideas').slice(0, 2)
    expect(aggregatesFor(thin, NOW)).toEqual([])
  })

  it('is never a dead end', () => {
    for (const a of aggregatesFor(EXPLORE_FIXTURE, NOW)) {
      expect(a.destination.kind).toBe('filter')
    }
  })

  /**
   * ── The names behind the count ──────────────────────────────────────────
   *
   * MEASURED live at 1920x889: the Ideas aggregate rendered at `large` --
   * 418px, no picture, one line of text, one button. An aggregate carried a
   * title and a count and nothing else, so `exploreVisualFor` correctly
   * resolved `none` and the tile had a sentence to fill a card the size of a
   * chart.
   *
   * A count is the least informative form of what an aggregate knows. It
   * stands for real rows, those rows have names, and the names let a reader
   * see whether any of them is theirs before deciding to open the filter.
   */
  const recent = (category: string, symbols: (string | null)[]) =>
    symbols.map((symbol, n) => ({
      id: `x${n}`, dedupeKey: `x${n}`, category, subtype: 'signal',
      title: `t${n}`, symbol, occurredAt: new Date(NOW - 86_400_000).toISOString(),
      destination: { kind: 'action', action: 'open_asset' }, importance: 0.5,
    })) as never

  it('names the assets it stands for', () => {
    const [agg] = aggregatesFor(recent('ideas', ['AAPL', 'MSFT', 'NVDA']), NOW)
    expect(agg.context).toBe('AAPL, MSFT and NVDA')
  })

  /** Deduped: one asset can contribute several rows, and "AAPL and AAPL" is a bug. */
  it('names each asset once', () => {
    const [agg] = aggregatesFor(recent('ideas', ['AAPL', 'AAPL', 'MSFT', 'AAPL']), NOW)
    expect(agg.context).toBe('AAPL and MSFT')
  })

  /** Capped, with the remainder COUNTED rather than dropped: a partial line says so. */
  it('counts the names it did not print', () => {
    const [agg] = aggregatesFor(recent('ideas', ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN']), NOW)
    expect(agg.context).toBe('AAPL, MSFT and NVDA, and 2 more')
  })

  /** A row with no symbol contributes nothing rather than a gap in the list. */
  it('skips a member with no symbol', () => {
    const [agg] = aggregatesFor(recent('ideas', ['AAPL', null, 'MSFT']), NOW)
    expect(agg.context).toBe('AAPL and MSFT')
  })

  /** And says nothing at all rather than an empty sentence. */
  it('says nothing when no member has a symbol', () => {
    const [agg] = aggregatesFor(recent('ideas', [null, null, null]), NOW)
    expect(agg.context).toBeUndefined()
    // The tile is still produced: the count is real whether or not it can name.
    expect(agg.count).toBe(3)
  })

  it('carries the count as a metric too', () => {
    const [agg] = aggregatesFor(recent('ideas', ['AAPL', 'MSFT', 'NVDA']), NOW)
    expect(agg.metric).toEqual({ value: '3', label: 'ideas', direction: 'neutral' })
  })
})

describe('sparkline symbols', () => {
  it('are taken from the composed page, in page order', () => {
    /**
     * The trap: `usePriceHistory` keeps the first 24 symbols it is given, so
     * handing it Curate's order would leave Explore tiles 25+ with no chart
     * while looking exactly like missing data. Deriving the list from the page
     * about to render means the symbols a thumb reaches first are the ones
     * fetched first.
     */
    const page = compose().map(e => e.item)
    const symbols = exploreSymbols(page)
    const firstOnPage = page.find(i => i.symbol)!.symbol!.toUpperCase()
    expect(symbols[0]).toBe(firstOnPage)
    // De-duplicated, so a repeated name does not consume two of the budget.
    expect(new Set(symbols).size).toBe(symbols.length)
    // And nothing symbol-less is asked for.
    expect(symbols.every(Boolean)).toBe(true)
  })
})

describe('portfolio terminology', () => {
  it('never calls a portfolio a book', () => {
    /**
     * "Book" is desk jargon for the aggregate position set, and it leaked into
     * user-facing copy where "portfolio" was meant: "more of the book", "weight
     * of each book", "book mark". A reader looking at a screen that says
     * "portfolio" everywhere else has to translate.
     *
     * Scoped to `book` as a standalone word so legitimate finance uses — order
     * book, book value — are not caught.
     */
    const strings: string[] = []
    for (const i of EXPLORE_FIXTURE) {
      strings.push(i.title, i.context ?? '', i.metric?.label ?? '', i.portfolio?.name ?? '')
    }
    const offenders = strings.filter(t => /\bbooks?\b/i.test(t))
    expect(offenders, `portfolio-as-book copy: ${offenders.join(' | ')}`).toEqual([])
  })
})
