/**
 * The ranking, pinned against the three cases measured on the live corpus.
 *
 * These are not invented examples. Each `describe` below reproduces an
 * ordering observed in the browser against localhost:5191, where typing an
 * exact ticker did not select that instrument.
 */
import { describe, it, expect } from 'vitest'
import {
  rankInstruments,
  rankOf,
  RANK_EXACT_SYMBOL,
  RANK_SYMBOL_PREFIX,
  RANK_NAME_PREFIX,
  RANK_SYMBOL_CONTAINS,
  RANK_NAME_CONTAINS,
  RANK_NONE,
} from '../instrument-ranking'

const a = (symbol: string, company_name: string | null, id = symbol) =>
  ({ id, symbol, company_name })

/* ───────────────── the orderings actually observed ─────────────────────── */

describe('the exact ticker comes first', () => {
  it('"CAT": Caterpillar outranks a name containing "communiCATions"', () => {
    /* Observed: ZOOM first, Caterpillar second. */
    const rows = [
      a('ZOOM', 'Zoom Video Communications'),
      a('CAT', 'Caterpillar Inc.'),
      a('ZM', 'Zoom Video Communications', 'zm'),
      a('HCAT', 'Health Catalyst'),
      a('CHTR', 'Charter Communications, Inc.'),
      a('VZ', 'Verizon Communications Inc.'),
    ]
    expect(rankInstruments(rows, 'CAT')[0].symbol).toBe('CAT')
  })

  it('"MS": MSFT outranks a name containing "platforMS"', () => {
    /* Observed: META first, MSFT second. */
    const rows = [
      a('META', 'Meta Platforms, Inc.'),
      a('MSFT', 'Microsoft Corporation'),
      a('QS', 'QuantumScape Corporation'),
      a('CDNS', 'Cadence Design Systems, Inc.'),
      a('HIMS', 'Hims & Hers Health'),
    ]
    expect(rankInstruments(rows, 'MS')[0].symbol).toBe('MSFT')
  })

  it('"V": Visa outranks a cash placeholder containing "equiValents"', () => {
    /* Observed: CASH_USD first, Visa FIFTH. */
    const rows = [
      a('CASH_USD', 'Cash & Equivalents'),
      a('AVGO', 'Broadcom Inc.'),
      a('MNST', 'Monster Beverage Corporation'),
      a('PLAY', 'Dave & Busters Entertainment'),
      a('V', 'Visa Inc.'),
      a('NVO', 'Novo Nordisk A/S'),
    ]
    const ranked = rankInstruments(rows, 'V')
    expect(ranked[0].symbol).toBe('V')
    /* And the cash placeholder, which matched only inside a word, is no
       longer anywhere near the top. */
    expect(ranked.findIndex(r => r.symbol === 'CASH_USD')).toBeGreaterThan(0)
  })
})

/* ──────────────────────────── the tiers ────────────────────────────────── */

describe('the tiers themselves', () => {
  it('assigns each kind of match its tier', () => {
    expect(rankOf(a('AAPL', 'Apple Inc.'), 'AAPL')).toBe(RANK_EXACT_SYMBOL)
    expect(rankOf(a('AAPL', 'Apple Inc.'), 'AAP')).toBe(RANK_SYMBOL_PREFIX)
    expect(rankOf(a('XYZ', 'Apple Inc.'), 'App')).toBe(RANK_NAME_PREFIX)
    expect(rankOf(a('HCAT', 'Health Catalyst'), 'CAT')).toBe(RANK_SYMBOL_CONTAINS)
    expect(rankOf(a('ZOOM', 'Zoom Communications'), 'CAT')).toBe(RANK_NAME_CONTAINS)
    expect(rankOf(a('ZOOM', 'Zoom Communications'), 'qqq')).toBe(RANK_NONE)
  })

  it('is case-insensitive in both directions', () => {
    expect(rankOf(a('aapl', 'apple inc.'), 'AAPL')).toBe(RANK_EXACT_SYMBOL)
    expect(rankOf(a('AAPL', 'Apple Inc.'), 'aapl')).toBe(RANK_EXACT_SYMBOL)
  })

  it('ignores surrounding whitespace in the query', () => {
    expect(rankInstruments([a('ZOOM', 'Zoom'), a('CAT', 'Caterpillar')], '  CAT ')[0].symbol)
      .toBe('CAT')
  })

  it('prefers a name that OPENS with the query over a ticker containing it', () => {
    /* "Micro..." is a better guess for "micro" than a ticker with those
       letters buried in the middle. */
    const rows = [a('XMICROY', 'Unrelated Holdings'), a('MSFT', 'Microsoft Corporation')]
    expect(rankInstruments(rows, 'micro')[0].symbol).toBe('MSFT')
  })

  it('treats a null company name as unmatched rather than throwing', () => {
    expect(rankOf(a('XYZ', null), 'abc')).toBe(RANK_NONE)
    expect(() => rankInstruments([a('XYZ', null)], 'abc')).not.toThrow()
  })
})

/* ─────────────────────── merging and stability ─────────────────────────── */

describe('merging the prefix query with the broad one', () => {
  it('de-duplicates by id, keeping the first occurrence', () => {
    const prefix = [a('CAT', 'Caterpillar Inc.')]
    const broad = [a('CAT', 'Caterpillar Inc.'), a('HCAT', 'Health Catalyst')]
    const ranked = rankInstruments([...prefix, ...broad], 'CAT')
    expect(ranked.map(r => r.symbol)).toEqual(['CAT', 'HCAT'])
  })

  it('does not collapse two assets that share a ticker', () => {
    /* Same reason the recents list keys on the id: two organizations can
       hold different assets under one symbol. */
    const rows = [a('FB', 'Facebook', 'id-old'), a('FB', 'Fabled Co', 'id-new')]
    expect(rankInstruments(rows, 'FB')).toHaveLength(2)
  })

  it('drops rows with no id rather than ranking them', () => {
    const rows = [{ id: '', symbol: 'CAT', company_name: 'Caterpillar' }, a('HCAT', 'Health Catalyst')]
    expect(rankInstruments(rows, 'CAT').map(r => r.symbol)).toEqual(['HCAT'])
  })

  it('honours the limit', () => {
    const rows = Array.from({ length: 40 }, (_, i) => a(`SYM${i}`, `Company ${i}`))
    expect(rankInstruments(rows, 'SYM')).toHaveLength(10)
    expect(rankInstruments(rows, 'SYM', 3)).toHaveLength(3)
  })

  it('produces the same order for the same input, twice', () => {
    /* A sort that is not total reshuffles between keystrokes on a list the
       user has not changed, and the row under the pointer moves. */
    const rows = [
      a('AAA', 'Common Name'), a('BBB', 'Common Name'), a('CCC', 'Common Name'),
    ]
    const first = rankInstruments(rows, 'Common').map(r => r.symbol)
    const second = rankInstruments(rows, 'Common').map(r => r.symbol)
    expect(first).toEqual(second)
    expect(first).toEqual(['AAA', 'BBB', 'CCC'])
  })

  it('returns the input de-duplicated when there is no query to rank against', () => {
    const rows = [a('ZZZ', 'Zed'), a('AAA', 'Alpha'), a('ZZZ', 'Zed')]
    expect(rankInstruments(rows, '').map(r => r.symbol)).toEqual(['ZZZ', 'AAA'])
  })

  it('handles an empty result set', () => {
    expect(rankInstruments([], 'CAT')).toEqual([])
  })
})
