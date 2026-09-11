/**
 * Explore's route grammar, on a surface that has a workspace.
 *
 * The claim that matters is the first one: the same object reached from Ideas
 * and from Explore produces the SAME selection, because Explore builds it with
 * the feed's own function rather than an equivalent of its own.
 */

import { describe, it, expect } from 'vitest'
import { exploreOpen } from '../explore-open'
import { selectionFor } from '../selection'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'
import type { ExploreItem } from '../../mobile/explore-item'

const entry = (over: Partial<AttentionEntry> & { card: Record<string, unknown> }): AttentionEntry =>
  ({ key: String(over.card.id), item: null, input: null, family: 'post', source: null, ...over } as unknown as AttentionEntry)

const tradeIdeaEntry = entry({
  family: 'post',
  item: { id: 'row-9', type: 'trade_idea' } as never,
  card: {
    id: 'idea:trade_idea:row-9', type: 'trade_idea', headline: 'Add to NVDA',
    entity: { kind: 'asset', id: 'asset-nvda', name: 'Nvidia', ticker: 'NVDA' },
  },
})

const staleEntry = entry({
  family: 'stale_target',
  card: {
    id: 'lens:stale:asset-aapl', type: 'stale_target', headline: 'AAPL target is 18 months old',
    entity: { kind: 'asset', id: 'asset-aapl', name: 'Apple', ticker: 'AAPL' },
  },
})

const pool = [tradeIdeaEntry, staleEntry]

const item = (over: Partial<ExploreItem>): ExploreItem => ({
  id: 'x1', dedupeKey: 'k1', signalType: null, category: 'research', subtype: 'signal',
  title: 'A preview', destination: { kind: 'action', assetId: null } as never, ...over,
} as ExploreItem)

describe('exploreOpen', () => {
  it('produces the identical selection the Ideas feed would, for the same object', () => {
    const open = exploreOpen(item({
      dedupeKey: 'post:row-9', objectId: 'row-9', signalType: 'trade_idea',
      assetId: 'asset-nvda', symbol: 'NVDA',
    }), pool)

    expect(open.do).toBe('work')
    const fromIdeas = selectionFor(tradeIdeaEntry)
    // Everything but the origin, which is the ONE thing the entry path may change.
    expect(open.do === 'work' && open.selection).toEqual({ ...fromIdeas, origin: 'explore' })
    // Including the feed row the trade-idea workspace needs — the field an
    // independently-built selection could not have supplied.
    expect(open.do === 'work' && open.selection.item?.id).toBe('row-9')
  })

  it('reaches the same asset workspace for a machine finding', () => {
    const open = exploreOpen(item({
      dedupeKey: 'stale:asset-aapl', signalType: 'stale_target',
      assetId: 'asset-aapl', symbol: 'AAPL',
    }), pool)
    expect(open.do === 'work' && open.selection.family).toBe('stale_target')
    expect(open.do === 'work' && open.selection.assetId).toBe('asset-aapl')
  })

  /** An aggregate is a count, and showing the four IS opening it. */
  it('keeps an aggregate filtering Explore', () => {
    const open = exploreOpen(item({
      subtype: 'aggregate', destination: { kind: 'filter', category: 'research' } as never,
    }), pool)
    expect(open).toEqual({ do: 'filter', category: 'research' })
  })

  it('sends a story to the reader, not to the workspace', () => {
    const open = exploreOpen(item({
      destination: { kind: 'article', url: 'https://x.test/a', title: 'T', source: 'S' } as never,
      symbol: 'MSFT',
    }), pool)
    expect(open.do).toBe('article')
    expect(open.do === 'article' && open.url).toBe('https://x.test/a')
  })

  it('passes a tab destination through as navigation', () => {
    const target = { id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue', data: {} }
    const open = exploreOpen(item({ destination: { kind: 'tab', target } as never }), pool)
    expect(open).toEqual({ do: 'navigate', target })
  })

  /**
   * The defect this refuses to reintroduce: answering a question about one
   * colleague's post with a page about the company.
   */
  it('opens nothing when a preview names a row the pool does not hold', () => {
    const open = exploreOpen(item({
      dedupeKey: 'post:row-404', objectId: 'row-404', signalType: 'trade_idea',
      assetId: 'asset-nvda', symbol: 'NVDA',
    }), pool)
    expect(open.do).toBe('none')
  })

  /** No row named, but a name is: the asset is what the preview is about. */
  it('falls back to the asset when the preview names only a name', () => {
    const open = exploreOpen(item({
      dedupeKey: 'economic:cpi', signalType: 'macro_print',
      assetId: 'asset-tsla', symbol: 'TSLA', title: 'TSLA in the CPI print',
    }), pool)
    expect(open.do === 'work' && open.selection.family).toBe('explore')
    expect(open.do === 'work' && open.selection.assetId).toBe('asset-tsla')
    expect(open.do === 'work' && open.selection.origin).toBe('explore')
  })

  it('opens nothing when there is neither a candidate nor an asset', () => {
    const open = exploreOpen(item({ dedupeKey: 'macro:cpi', signalType: 'macro_print' }), pool)
    expect(open.do).toBe('none')
  })

  it('reports an item with no destination rather than guessing', () => {
    const open = exploreOpen(item({ destination: undefined as never }), pool)
    expect(open.do).toBe('none')
    expect(open.do === 'none' && open.why).toContain('no destination')
  })

  /** Every selection Explore makes says where it came from, for reconciliation. */
  it('marks every selection it makes as coming from Explore', () => {
    for (const i of [
      item({ dedupeKey: 'post:row-9', objectId: 'row-9', signalType: 'trade_idea', assetId: 'asset-nvda', symbol: 'NVDA' }),
      item({ dedupeKey: 'e:1', signalType: 'macro_print', assetId: 'asset-tsla', symbol: 'TSLA' }),
    ]) {
      const open = exploreOpen(i, pool)
      expect(open.do === 'work' && open.selection.origin).toBe('explore')
    }
  })
})
