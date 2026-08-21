import { describe, expect, it } from 'vitest'

import { canChart, priceIdentity } from '../price-availability'
import { newsChartSymbol } from '../news-chart'

const series = (n: number) => Array.from({ length: n }, (_, i) => ({
  date: `2026-01-${String(i + 1).padStart(2, '0')}`, close: 100 + i,
}))

const table = (m: Record<string, number>) =>
  (sym: string) => (m[sym] != null ? series(m[sym]) : undefined)

describe('price availability is stated, never inferred', () => {
  it('draws when the symbol resolves and history exists', () => {
    const id = priceIdentity('aapl', table({ AAPL: 200 }))
    expect(id.symbol).toBe('AAPL')
    expect(id.availability).toBe('history')
    expect(canChart(id)).toBe(true)
  })

  it('separates "no symbol" from "no history"', () => {
    /**
     * These are genuinely different failures and components kept collapsing
     * them. One means we do not know what this card is about; the other means
     * we know exactly and have nothing cached — 777 of 912 assets today.
     */
    expect(priceIdentity(null, table({})).availability).toBe('unresolved')
    expect(priceIdentity('NVDA', table({})).availability).toBe('no_history')
  })

  it('refuses to chart a single close', () => {
    // One point is not a line. Deciding it here means the caller knows
    // whether a chart will appear before it composes a pane around one.
    const id = priceIdentity('NVDA', table({ NVDA: 1 }))
    expect(id.availability).toBe('no_history')
    expect(canChart(id)).toBe(false)
  })

  it('treats database placeholders as absences, not tickers', () => {
    /**
     * 506 of 912 assets carry `exchange = 'Unknown'` — the placeholder habit
     * is real in this data and reaches symbols too. Sending one to a lookup is
     * harmless; putting it in a chart title is not.
     */
    for (const bad of ['Unknown', 'N/A', '-', '   ']) {
      expect(priceIdentity(bad, table({ UNKNOWN: 200 })).availability, bad).toBe('unresolved')
    }
  })

  it('explains itself for triage', () => {
    // "The chart is missing" becomes a specific answer.
    expect(priceIdentity('NVDA', table({})).reason).toContain('NVDA')
    expect(priceIdentity(null, table({})).reason).toContain('no symbol')
  })

  it('never hands back a series it told the caller not to draw', () => {
    // The type guard is the contract; this is the runtime half of it.
    expect(priceIdentity('NVDA', table({ NVDA: 1 })).series).toBeNull()
    expect(priceIdentity(null, table({})).series).toBeNull()
  })
})

describe('which symbol a news story may chart', () => {
  it('uses the subject the provider declared', () => {
    expect(newsChartSymbol({ primarySymbol: 'nvda', symbols: ['AAPL', 'NVDA'] }))
      .toEqual({ symbol: 'NVDA', reason: 'declared_primary' })
  })

  it('uses a sole tagged symbol, which is unambiguous', () => {
    expect(newsChartSymbol({ symbols: ['CAT'] }))
      .toEqual({ symbol: 'CAT', reason: 'sole_symbol' })
  })

  it('draws nothing for a story about several companies', () => {
    /**
     * The MSFT bug, at its root.
     *
     * The feed took the first tagged symbol that existed in our asset table —
     * not the story's subject, but an artefact of the provider's ordering
     * intersected with what this desk happens to own. Large-cap tech is tagged
     * on everything, is held here, and is one of the few names with cached
     * history, so it won that race twice over.
     *
     * A story about six companies gets no chart. No chart is a perfectly good
     * news card; a chart of the wrong company is a false statement.
     */
    expect(newsChartSymbol({ symbols: ['MSFT', 'AAPL', 'GOOGL', 'AMZN'] }))
      .toEqual({ symbol: null, reason: 'ambiguous' })
  })

  it('draws nothing for a macro story', () => {
    expect(newsChartSymbol({ symbols: [] }).symbol).toBeNull()
    expect(newsChartSymbol({}).reason).toBe('no_symbols')
  })

  it('cannot be influenced by what the desk holds', () => {
    /**
     * The signature of the original defect: the answer changed depending on
     * our own holdings. This module takes no lookup and no portfolio, so that
     * class of bug is structurally impossible rather than merely fixed.
     */
    const story = { symbols: ['MSFT', 'AAPL'] }
    expect(newsChartSymbol(story)).toEqual(newsChartSymbol({ ...story }))
    expect(newsChartSymbol(story).symbol).toBeNull()
  })

  it('ignores placeholders when counting how many symbols a story has', () => {
    // One real name plus a placeholder is a single-asset story, not ambiguous.
    expect(newsChartSymbol({ symbols: ['CAT', 'Unknown'] }).reason).toBe('sole_symbol')
  })

  it('does not treat a repeated tag as two names', () => {
    expect(newsChartSymbol({ symbols: ['CAT', 'cat', 'CAT'] }).symbol).toBe('CAT')
  })
})
