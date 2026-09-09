import { describe, it, expect } from 'vitest'

import {
  buildSymbolIndex,
  foldSymbol,
  isTradable,
  pricingSymbolOf,
  resolveSecurity,
  securityKey,
  toSecurityRef,
  type SecurityRow,
} from '../identity'

/**
 * The cases are the ones the schema already proves are real, not invented ones:
 * the eight renames and thirty-four delistings `resolve-instrument-lifecycle
 * .mjs` classified, the Zoom search that returns three German venues first, and
 * the `BRK.B` spelling that `backfill-price-history.mjs` rewrites by hand.
 */

const row = (over: Partial<SecurityRow> & { id: string }): SecurityRow => ({
  symbol: null,
  ...over,
})

describe('pricing symbol', () => {
  it('prefers the ticker the instrument trades under now', () => {
    // SQ on the card, XYZ in the cache. Both correct, different questions.
    expect(pricingSymbolOf(row({ id: '1', symbol: 'SQ', current_symbol: 'XYZ' }))).toBe('XYZ')
  })

  it('falls back to the recorded symbol when there was no rename', () => {
    expect(pricingSymbolOf(row({ id: '1', symbol: 'aapl' }))).toBe('AAPL')
  })

  it('is idempotent, so a caller that already resolved is not double-resolved', () => {
    const resolved = row({ id: '1', symbol: 'XYZ', current_symbol: 'XYZ' })
    expect(pricingSymbolOf(resolved)).toBe('XYZ')
  })
})

describe('canonical key', () => {
  const base = { id: '1', symbol: 'TSLA', mic: 'XNAS', currency: 'USD' }

  it('uses FIGI when present and marks the key unambiguous', () => {
    const k = securityKey(toSecurityRef(row({ ...base, figi: 'BBG000N9MNX3', isin: 'US88160R1014' })))
    expect(k).toEqual({ key: 'figi:BBG000N9MNX3', basis: 'figi', ambiguousByConstruction: false })
  })

  it('falls to ISIN plus venue, never ISIN alone', () => {
    const k = securityKey(toSecurityRef(row({ ...base, isin: 'US88160R1014' })))
    expect(k.basis).toBe('isin_mic')
    expect(k.key).toBe('isin:US88160R1014@XNAS')
  })

  it('does not key on ISIN when the venue is unknown', () => {
    // An ISIN spans venues. Keying on it alone would merge a Nasdaq line and a
    // Frankfurt line into one instrument carrying two currencies.
    const k = securityKey(toSecurityRef(row({ id: '1', symbol: 'TSLA', isin: 'US88160R1014' })))
    expect(k.basis).toBe('symbol')
    expect(k.key).toBe('sym:TSLA')
  })

  it('marks a bare-symbol key as ambiguous by construction', () => {
    expect(securityKey(toSecurityRef(row({ id: '1', symbol: 'TSLA' }))).ambiguousByConstruction).toBe(true)
  })

  it('separates the same ticker on two venues', () => {
    const nasdaq = securityKey(toSecurityRef(row({ id: '1', symbol: 'TSLA', mic: 'XNAS' })))
    const frankfurt = securityKey(toSecurityRef(row({ id: '2', symbol: 'TSLA', mic: 'XFRA' })))
    expect(nasdaq.key).not.toBe(frankfurt.key)
    expect(nasdaq.ambiguousByConstruction).toBe(false)
  })
})

describe('lifecycle', () => {
  it('treats only delisted as untradable', () => {
    expect(isTradable(toSecurityRef(row({ id: '1', symbol: 'A', lifecycle_status: 'delisted' })))).toBe(false)
    expect(isTradable(toSecurityRef(row({ id: '1', symbol: 'A', lifecycle_status: 'active' })))).toBe(true)
  })

  it('does not treat unresolved as a verdict either way', () => {
    // `unresolved` means a person still has to decide. Folding it into
    // "delisted" would hide a live position; into "active" would price one
    // that may not exist.
    expect(isTradable(toSecurityRef(row({ id: '1', symbol: 'A', lifecycle_status: 'unresolved' })))).toBe(true)
    expect(toSecurityRef(row({ id: '1', symbol: 'A', lifecycle_status: 'unresolved' })).lifecycle).toBe('unresolved')
  })

  it('keeps NULL distinct from a verdict', () => {
    expect(toSecurityRef(row({ id: '1', symbol: 'A' })).lifecycle).toBeNull()
  })
})

describe('resolution', () => {
  const nasdaqTsla = row({ id: 'us', symbol: 'TSLA', mic: 'XNAS', currency: 'USD', lifecycle_status: 'active' })
  const frankfurtTsla = row({ id: 'de', symbol: 'TSLA', mic: 'XFRA', currency: 'EUR', lifecycle_status: 'active' })

  it('refuses to choose between two live venues sharing a ticker', () => {
    const r = resolveSecurity([nasdaqTsla, frankfurtTsla], { by: 'symbol', value: 'TSLA' })
    expect(r.status).toBe('ambiguous')
    if (r.status !== 'ambiguous') throw new Error('unreachable')
    expect(r.candidates.map(c => c.mic).sort()).toEqual(['XFRA', 'XNAS'])
    expect(r.reason).toMatch(/more than one venue/)
  })

  it('resolves once the caller names the venue', () => {
    const r = resolveSecurity([nasdaqTsla, frankfurtTsla], { by: 'symbol', value: 'TSLA', mic: 'XNAS' })
    expect(r.status).toBe('resolved')
    if (r.status !== 'resolved') throw new Error('unreachable')
    expect(r.ref.currency).toBe('USD')
  })

  it('prefers the live line when the other is delisted', () => {
    // A ticker is reissued after a delisting. A bare lookup means the one that
    // still trades; the retired line stays reachable by id.
    const dead = row({ id: 'old', symbol: 'FUN', mic: 'XNYS', lifecycle_status: 'delisted' })
    const live = row({ id: 'new', symbol: 'FUN', mic: 'XNYS', lifecycle_status: 'active' })
    const r = resolveSecurity([dead, live], { by: 'symbol', value: 'FUN' })
    expect(r.status).toBe('resolved')
    if (r.status !== 'resolved') throw new Error('unreachable')
    expect(r.ref.assetId).toBe('new')
  })

  it('still finds a delisted instrument when it is the only match', () => {
    // A 2023 holdings file references instruments that no longer trade.
    // Dropping them here turns a reconcilable position into an unresolved one.
    const dead = row({ id: 'old', symbol: 'SIVB', lifecycle_status: 'delisted' })
    const r = resolveSecurity([dead], { by: 'symbol', value: 'SIVB' })
    expect(r.status).toBe('resolved')
    if (r.status !== 'resolved') throw new Error('unreachable')
    expect(isTradable(r.ref)).toBe(false)
  })

  it('resolves a renamed instrument under both its tickers', () => {
    const block = row({ id: 'sq', symbol: 'SQ', current_symbol: 'XYZ', lifecycle_status: 'renamed' })
    for (const ticker of ['SQ', 'XYZ']) {
      const r = resolveSecurity([block], { by: 'symbol', value: ticker })
      expect(r.status).toBe('resolved')
      if (r.status !== 'resolved') throw new Error('unreachable')
      expect(r.ref.assetId).toBe('sq')
      expect(r.ref.pricingSymbol).toBe('XYZ')
      expect(r.ref.recordedSymbol).toBe('SQ')
    }
  })

  it('matches a separator spelling only as a fallback, and says so', () => {
    const brk = row({ id: 'brk', symbol: 'BRK.B' })
    const exact = resolveSecurity([brk], { by: 'symbol', value: 'BRK.B' })
    expect(exact.status === 'resolved' && exact.viaFold).toBe(false)

    const folded = resolveSecurity([brk], { by: 'symbol', value: 'BRK-B' })
    expect(folded.status === 'resolved' && folded.viaFold).toBe(true)
  })

  it('does not let a fold silently merge two instruments', () => {
    const a = row({ id: 'a', symbol: 'ABC-D', lifecycle_status: 'active' })
    const b = row({ id: 'b', symbol: 'ABCD', lifecycle_status: 'active' })
    // Neither spelling exists exactly, so the fold pass runs and finds both.
    const r = resolveSecurity([a, b], { by: 'symbol', value: 'ABC.D' })
    expect(r.status).toBe('ambiguous')
  })

  it('reports a cross-listed ISIN rather than picking a venue', () => {
    const us = row({ id: 'us', symbol: 'TSLA', isin: 'US88160R1014', mic: 'XNAS' })
    const de = row({ id: 'de', symbol: 'TL0', isin: 'US88160R1014', mic: 'XFRA' })
    const r = resolveSecurity([us, de], { by: 'isin', value: 'US88160R1014' })
    expect(r.status).toBe('ambiguous')
    if (r.status !== 'ambiguous') throw new Error('unreachable')
    expect(r.reason).toMatch(/mic/)
  })

  it('returns not_found rather than an empty-ish success', () => {
    expect(resolveSecurity([nasdaqTsla], { by: 'symbol', value: 'NOPE' }).status).toBe('not_found')
    expect(resolveSecurity([nasdaqTsla], { by: 'symbol', value: '   ' }).status).toBe('not_found')
  })
})

describe('symbol index at universe scale', () => {
  /**
   * Five thousand instruments, which is five times the current table and past
   * the thousand-name target this lane exists to reach. The point is not speed:
   * it is that the index gives the SAME answers as the linear resolver,
   * including the refusals, so adopting it cannot quietly change behaviour.
   */
  const universe: SecurityRow[] = []
  for (let i = 0; i < 5000; i++) {
    universe.push(row({ id: `id-${i}`, symbol: `T${i}`, mic: 'XNAS', lifecycle_status: 'active' }))
  }
  universe.push(row({ id: 'sq', symbol: 'SQ', current_symbol: 'XYZ', lifecycle_status: 'renamed' }))
  universe.push(row({ id: 'us', symbol: 'TSLA', mic: 'XNAS', lifecycle_status: 'active' }))
  universe.push(row({ id: 'de', symbol: 'TSLA', mic: 'XFRA', lifecycle_status: 'active' }))
  universe.push(row({ id: 'brk', symbol: 'BRK.B', mic: 'XNYS' }))

  const index = buildSymbolIndex(universe)

  it('holds the whole universe, not a truncated prefix', () => {
    expect(index.size).toBe(5004)
    expect(index.lookup('T4999').status).toBe('resolved')
  })

  it('agrees with the linear resolver on every interesting case', () => {
    const cases: Array<[string, string | undefined]> = [
      ['T0', undefined],
      ['T4999', undefined],
      ['SQ', undefined],
      ['XYZ', undefined],
      ['TSLA', undefined],
      ['TSLA', 'XNAS'],
      ['BRK-B', undefined],
      ['MISSING', undefined],
    ]
    for (const [symbol, mic] of cases) {
      expect(index.lookup(symbol, mic).status, `${symbol}/${mic ?? '-'}`).toBe(
        resolveSecurity(universe, { by: 'symbol', value: symbol, mic }).status,
      )
    }
  })

  it('still refuses the two-venue ticker at scale', () => {
    expect(index.lookup('TSLA').status).toBe('ambiguous')
  })

  it('does not treat one row as a collision with itself', () => {
    // A row whose `current_symbol` equals its `symbol` is indexed under one key
    // twice. Counting it twice would report a single instrument as ambiguous.
    const same = row({ id: 'one', symbol: 'AAPL', current_symbol: 'AAPL', lifecycle_status: 'active' })
    expect(buildSymbolIndex([same]).lookup('AAPL').status).toBe('resolved')
  })
})

describe('fold', () => {
  it('collapses every separator spelling of one ticker', () => {
    expect(new Set(['BRK.B', 'BRK-B', 'BRK/B', 'brk b'].map(foldSymbol)).size).toBe(1)
  })

  it('is empty for nothing, so an empty fold never matches everything', () => {
    expect(foldSymbol(null)).toBe('')
    expect(foldSymbol('  ')).toBe('')
  })
})
