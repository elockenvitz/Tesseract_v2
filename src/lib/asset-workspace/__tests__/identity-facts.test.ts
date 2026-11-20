import { describe, it, expect } from 'vitest'
import { referenceFact, securityTypeLabel, identityFacts } from '../identity-facts'

/**
 * The header's metadata line, and the placeholder it must never print.
 *
 * Every security in this database carries `exchange = 'Unknown'`. The first
 * draft of the header printed the column verbatim, which read
 *
 *     AAPL · Unknown · USD · Equity
 *
 * and that "Unknown" is indistinguishable, to a reader, from a venue we
 * looked up and failed to recognise. It is neither: nobody ever filled the
 * column in.
 */

describe('a placeholder is not a fact', () => {
  it('drops the exact value this database holds', () => {
    expect(referenceFact('Unknown')).toBeNull()
  })

  it('drops it whatever the casing or padding', () => {
    for (const v of ['unknown', 'UNKNOWN', '  Unknown  ', 'uNkNoWn']) {
      expect(referenceFact(v), v).toBeNull()
    }
  })

  it('drops the other spellings this kind of column collects', () => {
    for (const v of ['N/A', 'n/a', 'na', '-', '--', 'none', 'null', 'TBD', 'Other', 'unspecified']) {
      expect(referenceFact(v), v).toBeNull()
    }
  })

  it('drops empty and whitespace', () => {
    expect(referenceFact('')).toBeNull()
    expect(referenceFact('   ')).toBeNull()
    expect(referenceFact(null)).toBeNull()
    expect(referenceFact(undefined)).toBeNull()
  })

  it('keeps a real venue, trimmed', () => {
    expect(referenceFact(' NASDAQ ')).toBe('NASDAQ')
    expect(referenceFact('XLON')).toBe('XLON')
    expect(referenceFact('NYSE Arca')).toBe('NYSE Arca')
  })

  /**
   * Non-vacuity: a normaliser that returned null for everything would pass
   * every assertion above. Something must survive it.
   */
  it('is not simply rejecting everything', () => {
    expect(referenceFact('NASDAQ')).toBeTruthy()
    expect(referenceFact('USD')).toBeTruthy()
  })
})

describe('a security type we could not map is not Equity', () => {
  it('labels the types we do map', () => {
    expect(securityTypeLabel('stock')).toBe('Equity')
    expect(securityTypeLabel('etf')).toBe('ETF')
    expect(securityTypeLabel('mutual_fund')).toBe('Fund')
    expect(securityTypeLabel('bond')).toBe('Bond')
  })

  it('returns null for the unknown member of the union', () => {
    // `AssetType` carries `unknown` on purpose. It must not acquire a label.
    expect(securityTypeLabel('unknown')).toBeNull()
  })

  it('returns null for a provider code we have no mapping for', () => {
    expect(securityTypeLabel('structured_note')).toBeNull()
    expect(securityTypeLabel('')).toBeNull()
    expect(securityTypeLabel(null)).toBeNull()
  })
})

describe('the metadata line', () => {
  it('shows nothing at all for the rows this database actually has', () => {
    // AAPL as stored today: exchange 'Unknown', currency USD, type stock.
    // Two facts, not three, and specifically not "Unknown".
    const facts = identityFacts({
      exchange: 'Unknown',
      assetCurrency: 'USD',
      assetType: 'stock',
    })
    expect(facts).toEqual(['USD', 'Equity'])
    expect(facts.join(' · ')).not.toContain('Unknown')
  })

  it('keeps a fixed order so a column of securities can be scanned', () => {
    expect(identityFacts({
      exchange: 'NASDAQ', assetCurrency: 'USD', assetType: 'etf',
    })).toEqual(['NASDAQ', 'USD', 'ETF'])
  })

  it('prefers the quote currency over the stored column', () => {
    // The quote describes THIS observation; the column describes the
    // instrument. On a disagreement the observation wins, as in
    // `resolveDisplayUnit`.
    expect(identityFacts({ quoteCurrency: 'GBP', assetCurrency: 'USD' })).toEqual(['GBP'])
  })

  it('falls back to the column when the quote is silent', () => {
    expect(identityFacts({ quoteCurrency: null, assetCurrency: 'JPY' })).toEqual(['JPY'])
  })

  it('falls back past a placeholder in the quote currency too', () => {
    expect(identityFacts({ quoteCurrency: 'unknown', assetCurrency: 'EUR' })).toEqual(['EUR'])
  })

  it('is empty rather than apologetic when nothing is known', () => {
    // No "Exchange unavailable", no em dash row. The line simply is not
    // drawn, which is what the caller checks `length` for.
    expect(identityFacts({})).toEqual([])
    expect(identityFacts({ exchange: 'Unknown', assetType: 'unknown' })).toEqual([])
  })
})
