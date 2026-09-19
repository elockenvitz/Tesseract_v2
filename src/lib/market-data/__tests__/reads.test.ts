import { describe, it, expect } from 'vitest'

import { createAssetAccess, type AssetQuerySpec } from '../asset-access'
import { areComparable, assessFreshness, DAILY_CLOSE_POLICY } from '../freshness'
import { toSecurityRef, type SecurityRow } from '../identity'
import { createMarketDataReader, splitSource, type PriceCacheRow, type PriceQuerySpec } from '../reads'

const NOW = Date.parse('2026-09-08T21:00:00Z')

/**
 * `price_history_cache` as it actually is: keyed by the ticker the instrument
 * trades under TODAY, with a free-text `source` and a `fetched_at`.
 *
 * Block is `XYZ` here and `SQ` on the card. Both are correct; they answer
 * different questions, and every surface except the mobile chart currently
 * asks under the display ticker, gets nothing, and draws no chart.
 */
function cache(rows: PriceCacheRow[]) {
  const asked: PriceQuerySpec[] = []
  const source = async (spec: PriceQuerySpec) => {
    asked.push(spec)
    return rows
      .filter(r => r.symbol === spec.tradedSymbol)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, spec.limit)
  }
  return { source, asked }
}

const bar = (symbol: string, date: string, close: number | null): PriceCacheRow => ({
  symbol,
  date,
  open: close,
  high: close,
  low: close,
  close,
  volume: 1_000,
  source: 'yahoo_chart_v8',
  fetched_at: `${date}T22:00:00Z`,
})

/** Square became Block became XYZ. `symbol` is never overwritten. */
const blockRow: SecurityRow = {
  id: 'asset-block',
  symbol: 'SQ',
  current_symbol: 'XYZ',
  company_name: 'Block, Inc.',
  mic: 'XNYS',
  currency: 'USD',
  asset_type: 'stock',
  lifecycle_status: 'renamed',
}

describe('a renamed instrument stays one investment', () => {
  it('asks the cache under the traded ticker and reports the recorded one', async () => {
    const { source, asked } = cache([bar('XYZ', '2026-09-04', 71.2)])
    const result = await createMarketDataReader(source).latestClose(toSecurityRef(blockRow), NOW)

    expect(asked[0].tradedSymbol).toBe('XYZ')
    expect(result.displaySymbol).toBe('SQ')
    expect(result.observed?.value).toBe(71.2)
  })

  it('resolves to the same asset id under either ticker', async () => {
    // The property that stops SQ and XYZ becoming two investments: whichever
    // string a consumer holds, it lands on one canonical asset.
    const rows = [blockRow, { id: 'asset-other', symbol: 'AAPL' } as SecurityRow]
    const source = async (spec: AssetQuerySpec) => {
      const want = (spec.symbol ?? '').toUpperCase()
      return rows.filter(
        r => (r.symbol ?? '').toUpperCase() === want || (r.current_symbol ?? '').toUpperCase() === want,
      )
    }
    const access = createAssetAccess(source)

    const viaOld = await access.resolveSymbol('SQ')
    const viaNew = await access.resolveSymbol('XYZ')
    expect(viaOld.status).toBe('resolved')
    expect(viaNew.status).toBe('resolved')
    if (viaOld.status !== 'resolved' || viaNew.status !== 'resolved') throw new Error('unreachable')
    expect(viaOld.ref.assetId).toBe('asset-block')
    expect(viaNew.ref.assetId).toBe(viaOld.ref.assetId)
    // And both route to the same cache key, so one series serves both.
    expect(viaNew.ref.pricingSymbol).toBe('XYZ')
    expect(viaOld.ref.pricingSymbol).toBe('XYZ')
  })

  it('draws nothing rather than an empty chart when only the old ticker is cached', async () => {
    // The failure this replaces: an empty series renders as no chart, which
    // reads as missing data. Here it is reported as missing instead.
    const { source } = cache([bar('SQ', '2026-09-04', 71.2)])
    const result = await createMarketDataReader(source).latestClose(toSecurityRef(blockRow), NOW)
    expect(result.observed).toBeNull()
    expect(result.verdict.state).toBe('missing')
    expect(result.label).toBe('No price')
  })
})

describe('a price arrives with its provenance', () => {
  const ref = toSecurityRef(blockRow)

  it('carries currency, both timestamps and the source', async () => {
    const { source } = cache([bar('XYZ', '2026-09-04', 71.2)])
    const { observed } = await createMarketDataReader(source).latestClose(ref, NOW)
    expect(observed).toMatchObject({
      value: 71.2,
      currency: 'USD',
      effectiveAt: '2026-09-04',
      observedAt: '2026-09-04T22:00:00Z',
      source: { provider: 'yahoo', feed: 'chart_v8', via: 'cache' },
    })
  })

  it('reports the adjustment basis as unknown, because the table does not record it', async () => {
    /**
     * Deliberate, and a finding rather than an omission. Inventing `raw` or
     * `split_adjusted` here would let two closes spanning a 4-for-1 split be
     * compared as if they were the same series — a 4x error that renders as a
     * price move. `areComparable` refuses instead, which is the honest answer
     * until the column exists.
     */
    const { source } = cache([bar('XYZ', '2026-09-04', 71.2)])
    const reader = createMarketDataReader(source)
    const a = await reader.latestClose(ref, NOW)
    const b = await reader.latestClose(ref, NOW)
    expect(a.observed?.adjustment).toBe('unknown')
    expect(areComparable(a.observed, b.observed)).toBe(false)
  })

  it('never calls a close "Current price"', async () => {
    const { source } = cache([bar('XYZ', '2026-09-04', 71.2)])
    const { label } = await createMarketDataReader(source).latestClose(ref, NOW)
    expect(label).toBe('Last close')
  })

  it('judges freshness from the close date, not the fetch time', async () => {
    // Fetched moments ago, true in March. The request is fresh; the fact is not.
    const stale: PriceCacheRow = {
      ...bar('XYZ', '2026-03-02', 60),
      fetched_at: '2026-09-08T20:59:00Z',
    }
    const { source } = cache([stale])
    const { verdict } = await createMarketDataReader(source).latestClose(ref, NOW)
    expect(verdict.state).toBe('stale')
    expect(verdict.dataClass).toBe('daily_close')
  })
})

describe('a close is a number', () => {
  const ref = toSecurityRef(blockRow)

  it('drops a zero close rather than pricing a card at nothing', async () => {
    // Zero standing in for unknown is the defect class this codebase keeps
    // meeting. A deviation against it renders as -100%.
    const { source } = cache([bar('XYZ', '2026-09-04', 0), bar('XYZ', '2026-09-03', 70)])
    const { observed } = await createMarketDataReader(source).latestClose(ref, NOW)
    expect(observed).toBeNull()
  })

  it('drops a null close from the middle of a series without shifting the rest', async () => {
    const { source } = cache([
      bar('XYZ', '2026-09-02', 68),
      bar('XYZ', '2026-09-03', null),
      bar('XYZ', '2026-09-04', 71),
    ])
    const { observed } = await createMarketDataReader(source).closeSeries(ref, { now: NOW })
    expect(observed?.value.map(b => b.date)).toEqual(['2026-09-02', '2026-09-04'])
  })

  it('returns the series ascending, however the cache ordered it', async () => {
    const { source } = cache([
      bar('XYZ', '2026-09-04', 71),
      bar('XYZ', '2026-09-02', 68),
      bar('XYZ', '2026-09-03', 70),
    ])
    const { observed } = await createMarketDataReader(source).closeSeries(ref, { now: NOW })
    expect(observed?.value.map(b => b.close)).toEqual([68, 70, 71])
  })

  it('dates a series by its newest bar, which is what a reader is asking about', async () => {
    const { source } = cache([bar('XYZ', '2026-01-02', 60), bar('XYZ', '2026-09-04', 71)])
    const { observed, verdict } = await createMarketDataReader(source).closeSeries(ref, { now: NOW })
    expect(observed?.effectiveAt).toBe('2026-09-04')
    expect(verdict.state).toBe('fresh')
  })

  it('reports an empty series as missing rather than as an empty chart', async () => {
    const { source } = cache([])
    const { observed, verdict } = await createMarketDataReader(source).closeSeries(ref, { now: NOW })
    expect(observed).toBeNull()
    expect(verdict.state).toBe('missing')
  })
})

describe('source strings', () => {
  it('splits a stored token into provider and feed', () => {
    expect(splitSource('yahoo_chart_v8')).toEqual({ provider: 'yahoo', feed: 'chart_v8' })
    expect(splitSource('yahoo')).toEqual({ provider: 'yahoo' })
  })

  it('says unknown rather than guessing Yahoo for an unsourced row', () => {
    // Some rows predate the nightly job and were seeded by hand. Attributing
    // them to a provider we did not use is a fabrication in the audit trail.
    expect(splitSource(null)).toEqual({ provider: 'unknown' })
    expect(splitSource('  ')).toEqual({ provider: 'unknown' })
  })
})

describe('the daily-close policy applies to what this reader returns', () => {
  it('agrees with a direct assessment of the same value', async () => {
    const { source } = cache([bar('XYZ', '2026-09-04', 71.2)])
    const { observed, verdict } = await createMarketDataReader(source).latestClose(
      toSecurityRef(blockRow),
      NOW,
    )
    expect(verdict).toEqual(assessFreshness(observed, DAILY_CLOSE_POLICY, NOW))
  })
})
