import { describe, it, expect } from 'vitest'

import { tradedSymbol, type TickerAliases } from '../useTickerAliases'

/**
 * The resolver only. The query around it is one `select` and a filter; what is
 * worth pinning is the mapping's behaviour at the edges, because getting any of
 * these wrong shows up as a chart that silently does not draw.
 */

const ALIASES: TickerAliases = new Map([['SQ', 'XYZ'], ['ZOOM', 'ZM']])

describe('it asks the cache for the ticker the instrument trades under', () => {
  it('maps a renamed ticker to its current one', () => {
    // `price_history_cache` is keyed by what it trades as today; the card says
    // what the holdings file said. Both are right, and only one finds a series.
    expect(tradedSymbol('SQ', ALIASES)).toBe('XYZ')
    expect(tradedSymbol('ZOOM', ALIASES)).toBe('ZM')
  })

  it('leaves an unrenamed ticker alone', () => {
    expect(tradedSymbol('AAPL', ALIASES)).toBe('AAPL')
  })

  it('is idempotent, so resolving twice is the same as once', () => {
    // One call site already resolves before calling. Applying the map to its
    // own output must not undo or double-apply it.
    expect(tradedSymbol(tradedSymbol('SQ', ALIASES), ALIASES)).toBe('XYZ')
  })

  it('normalises case and whitespace the way the cache is keyed', () => {
    expect(tradedSymbol(' sq ', ALIASES)).toBe('XYZ')
    expect(tradedSymbol('aapl', ALIASES)).toBe('AAPL')
  })

  it('passes the symbol straight through before the map has loaded', () => {
    // The series query is deliberately not gated on the aliases: gating would
    // delay every chart in the app by a round trip to fix eight instruments.
    // The first render asks under the display ticker and the key changes once
    // the map arrives, so only a renamed name pays, and only once.
    expect(tradedSymbol('SQ', undefined)).toBe('SQ')
  })

  it('returns an empty string for no symbol at all', () => {
    // Which is what `useSymbolHistory` disables its query on.
    expect(tradedSymbol(null, ALIASES)).toBe('')
    expect(tradedSymbol(undefined, ALIASES)).toBe('')
    expect(tradedSymbol('   ', ALIASES)).toBe('')
  })
})
