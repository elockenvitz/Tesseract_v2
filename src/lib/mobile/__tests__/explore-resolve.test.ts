import { describe, it, expect } from 'vitest'

import { resolveExploreItem } from '../explore-resolve'
import { newsToExplore } from '../explore-adapters'
import type { ExploreItem } from '../explore-item'

/**
 * Explore had no resolver. A tap set `exploreFocus`, and the focus overlay then
 * tried to find a CURATE FEED ENTRY with the same type and asset and re-render
 * it — which works for whatever the feed happens to be carrying, and for
 * everything else fell through to a screen reading "This one lives on its own
 * surface."
 *
 * The fall-through was the tell: nothing DECIDED what a story or an idea should
 * open. The matcher failed and the copy apologised.
 */

const base = {
  id: 'x', dedupeKey: 'k', signalType: 'news', category: 'news' as const,
  subtype: 'news' as const, title: 'A headline',
}

describe('every kind of tile resolves to something deliberate', () => {
  it('sends an external story to the reader, not to the asset page', () => {
    // Opening the asset is a different thing from reading the story, and it is
    // what a story with a matched ticker used to do.
    const item = {
      ...base,
      destination: { kind: 'article' as const, url: 'https://x.test/a', title: 'A headline', source: 'Reuters' },
    } as ExploreItem
    const a = resolveExploreItem(item)
    expect(a.do).toBe('article')
    if (a.do === 'article') {
      expect(a.url).toBe('https://x.test/a')
      expect(a.source).toBe('Reuters')
    }
  })

  it('focuses anything the feed can render as a card', () => {
    const item = {
      ...base, signalType: 'no_target', category: 'decisions' as const, subtype: 'signal' as const,
      destination: { kind: 'action' as const, action: 'open_asset', assetId: 'a1', symbol: 'JNJ' },
    } as ExploreItem
    expect(resolveExploreItem(item).do).toBe('focus')
  })

  it('leaves category tiles to the grid, which owns that state', () => {
    const item = {
      ...base, subtype: 'aggregate' as const,
      destination: { kind: 'filter' as const, category: 'news' as const },
    } as ExploreItem
    expect(resolveExploreItem(item).do).toBe('filter')
  })

  it('navigates for an explicit tab destination', () => {
    const item = {
      ...base,
      destination: { kind: 'tab' as const, target: { id: 't', title: 'T', type: 'asset', data: {} } },
    } as ExploreItem
    expect(resolveExploreItem(item).do).toBe('navigate')
  })

  it('reports an item it cannot open rather than doing nothing', () => {
    // A tile that looks tappable and answers with silence is worse than one
    // that does not look tappable — the reader has already spent the tap.
    const item = { ...base, destination: undefined as any } as ExploreItem
    const a = resolveExploreItem(item)
    expect(a.do).toBe('unsupported')
    if (a.do === 'unsupported') expect(a.why).toContain('no destination')
  })

  it('reports an article with no url instead of opening a blank reader', () => {
    const item = {
      ...base, destination: { kind: 'article' as const, url: '', title: null, source: null },
    } as ExploreItem
    expect(resolveExploreItem(item).do).toBe('unsupported')
  })

  it('decides from the destination, never from the headline', () => {
    // Two items with identical text and different destinations must resolve
    // differently, or the resolver is reading the wrong thing.
    const asArticle = {
      ...base, destination: { kind: 'article' as const, url: 'https://x.test/a', title: null, source: null },
    } as ExploreItem
    const asSignal = {
      ...base, destination: { kind: 'action' as const, action: 'open_asset', assetId: 'a1', symbol: 'X' },
    } as ExploreItem
    expect(resolveExploreItem(asArticle).do).not.toBe(resolveExploreItem(asSignal).do)
  })
})

describe('a story keeps its identity through normalisation', () => {
  it('carries the url the adapter used to drop', () => {
    // Without it the destination fell back to `open_asset` where a ticker had
    // been matched and to a category filter where one had not — so a tap either
    // left Explore or silently re-filtered the grid already on screen.
    const [item] = newsToExplore([{
      id: 'n1', headline: 'Alphabet gains', url: 'https://x.test/g',
      source: 'GuruFocus', primarySymbol: 'GOOGL', assetId: 'a-googl',
      publishedAt: new Date().toISOString(),
    }])
    expect(item.destination.kind).toBe('article')
    const a = resolveExploreItem(item)
    expect(a.do).toBe('article')
    if (a.do === 'article') expect(a.url).toBe('https://x.test/g')
  })

  it('still reaches the asset when there is no url to open', () => {
    const [item] = newsToExplore([{
      id: 'n2', headline: 'No link', primarySymbol: 'GOOGL', assetId: 'a-googl',
    }])
    expect(item.destination.kind).toBe('action')
    expect(resolveExploreItem(item).do).toBe('focus')
  })

  it('falls back to the category when it has neither', () => {
    const [item] = newsToExplore([{ id: 'n3', headline: 'Orphan' }])
    expect(resolveExploreItem(item).do).toBe('filter')
  })

  it('files external stories under Research’s sibling, News', () => {
    // The filter taxonomy is unchanged by this pass; the point is that adding a
    // destination did not move the item out of its category.
    const [item] = newsToExplore([{
      id: 'n4', headline: 'H', url: 'https://x.test/h', primarySymbol: 'GOOGL', assetId: 'a1',
    }])
    expect(item.category).toBe('news')
    expect(item.signalType).toBe('news')
  })
})
