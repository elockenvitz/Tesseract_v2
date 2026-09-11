/**
 * The preview descriptor picks an object from data the pool ALREADY holds.
 *
 * These pin the two claims that matter: richer structured truth produces a
 * richer object, and absence produces nothing rather than a decorative
 * substitute.
 */

import { describe, it, expect } from 'vitest'
import { previewFor, previewSymbol } from '../feed-preview'
import type { SignalCard } from '../contract'

const card = (over: Record<string, unknown> = {}) => ({
  id: 'c1', type: 'crowding', headline: 'h', surface: 'risk',
  entity: { kind: 'asset', id: 'a1', name: 'A', ticker: 'AAA' },
  ...over,
} as unknown as SignalCard)

describe('previewFor', () => {
  it('turns a crowding count into the distribution behind it', () => {
    const p = previewFor('crowding', card(), {
      weightsByPortfolio: [
        { id: '1', name: 'Core', weightPct: 6.2, valueUsd: 1 },
        { id: '2', name: 'Growth', weightPct: 2.1, valueUsd: 1 },
        { id: '3', name: 'Income', weightPct: 0.9, valueUsd: 1 },
      ],
    }, undefined)
    expect(p?.kind).toBe('exposure')
    // Sorted heaviest first — "where is concentration greatest" is the question.
    expect(p && p.kind === 'exposure' && p.rows.map(r => r.label)).toEqual(['Core', 'Growth', 'Income'])
  })

  /** One book is not a distribution; the metric already says the count. */
  it('draws nothing for a single-book crowding row', () => {
    expect(previewFor('crowding', card(), {
      weightsByPortfolio: [{ id: '1', name: 'Core', weightPct: 6.2, valueUsd: 1 }],
    }, undefined)).toBeNull()
  })

  it('puts conviction against its benchmark so the divergence is visible', () => {
    const p = previewFor('conviction', card({ type: 'conviction_oversized' }), {
      weightPct: 5.4, benchmarkPct: 1.2, portfolioName: 'Core', conviction: 'low',
    }, undefined)
    expect(p?.kind).toBe('exposure')
    expect(p && p.kind === 'exposure' && p.rows.length).toBe(2)
  })

  /** A missing benchmark is not zero. Asserting an underweight nobody measured. */
  it('draws nothing for conviction with no benchmark', () => {
    expect(previewFor('conviction', card(), {
      weightPct: 5.4, benchmarkPct: null, portfolioName: 'Core',
    }, undefined)).toBeNull()
  })

  /** Dated closes, because the desktop chart reads out the date under the cursor. */
  const series = (...closes: number[]) =>
    closes.map((close, i) => ({ date: `2026-01-0${i + 1}`, close }))

  it('carries a declared target onto the price path', () => {
    const c = card({ type: 'target_hit', evidence: { kind: 'sparkline', data: { target: 310 } } })
    const p = previewFor('target_hit', c, null, series(100, 120, 140))
    expect(p).toEqual({ kind: 'price', series: series(100, 120, 140), reference: 310 })
  })

  it('draws no line from a single close', () => {
    const c = card({ type: 'trade_idea', evidence: { kind: 'sparkline', data: { symbol: 'AAA' } } })
    expect(previewFor('post', c, null, series(100))).toBeNull()
    expect(previewFor('post', c, null, undefined)).toBeNull()
  })

  it('leaves prose families alone', () => {
    for (const f of ['post', 'stale_target']) {
      expect(previewFor(f, card({ evidence: undefined }), null, undefined)).toBeNull()
    }
  })

  it('names the symbol a sparkline candidate needs history for', () => {
    expect(previewSymbol(card({ evidence: { kind: 'sparkline', data: { symbol: 'msft' } } }))).toBe('MSFT')
    // Falls back to the entity's own ticker when the builder named no symbol.
    expect(previewSymbol(card({ evidence: { kind: 'sparkline', data: {} } }))).toBe('AAA')
    expect(previewSymbol(card())).toBeNull()
  })
})
