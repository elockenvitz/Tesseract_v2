/**
 * What `yahoo-chart-proxy` is allowed to write into `price_history_cache`.
 *
 * The write moved from the browser into the edge function so that no logged-in
 * user can plant a close. But moving a write server-side does not make its
 * contents true: the function forwards whatever `query1.finance.yahoo.com`
 * returns for a caller-chosen symbol, and `price_history_cache` is the
 * trade-price gate's trust anchor. These are the rules that keep an untrusted
 * upstream payload from producing a row the gate would believe.
 *
 * The future-date case is the one that matters most: a close dated after every
 * real one reads as the most current price in the table, and that is exactly
 * the shape of the hole being closed.
 */
import { describe, expect, it } from 'vitest'
import {
  CHART_PROXY_SOURCE,
  MAX_ROWS,
  dailyClosesFromYahooChart,
} from '../../../../supabase/functions/_shared/chart-closes'

const TODAY = '2026-11-07'

/** Unix seconds for midnight UTC on a YYYY-MM-DD. */
const ts = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000)

const chart = (bars: Array<[string, number | null]>) => ({
  chart: {
    result: [{
      timestamp: bars.map(([d]) => ts(d)),
      indicators: { quote: [{ close: bars.map(([, c]) => c) }] },
    }],
  },
})

describe('dailyClosesFromYahooChart', () => {
  it('maps daily bars to rows keyed on symbol and UTC date', () => {
    const rows = dailyClosesFromYahooChart('aapl', '1d', chart([
      ['2026-11-05', 341.1],
      ['2026-11-06', 342.37],
    ]), TODAY)

    expect(rows).toEqual([
      { symbol: 'AAPL', date: '2026-11-05', close: 341.1, source: CHART_PROXY_SOURCE },
      { symbol: 'AAPL', date: '2026-11-06', close: 342.37, source: CHART_PROXY_SOURCE },
    ])
  })

  it('records a source distinct from the nightly job and from the old browser writes', () => {
    // Provenance has to stay answerable: `yahoo_chart_v8` is the nightly job,
    // `yahoo_finance` is the 600 legacy rows the browser wrote.
    expect(CHART_PROXY_SOURCE).toBe('yahoo_chart_v8_edge')
    expect(CHART_PROXY_SOURCE).not.toBe('yahoo_chart_v8')
    expect(CHART_PROXY_SOURCE).not.toBe('yahoo_finance')
  })

  it('REFUSES a bar dated after today, which is the hole being closed', () => {
    const rows = dailyClosesFromYahooChart('AAPL', '1d', chart([
      ['2026-11-06', 342.37],
      ['2026-11-08', 999.99],
      ['2027-01-02', 1.0],
    ]), TODAY)

    expect(rows.map((r) => r.date)).toEqual(['2026-11-06'])
  })

  it('keeps a bar dated exactly today', () => {
    const rows = dailyClosesFromYahooChart('AAPL', '1d', chart([[TODAY, 350]]), TODAY)
    expect(rows).toHaveLength(1)
    expect(rows[0].date).toBe(TODAY)
  })

  it('writes nothing for an intraday interval, whatever the payload says', () => {
    for (const interval of ['1m', '5m', '30m', '60m', '1h', '1wk', '1mo']) {
      expect(dailyClosesFromYahooChart('AAPL', interval, chart([['2026-11-06', 342]]), TODAY)).toEqual([])
    }
  })

  it('drops a null close, which Yahoo uses to pad non-trading slots', () => {
    const rows = dailyClosesFromYahooChart('AAPL', '1d', chart([
      ['2026-11-04', null],
      ['2026-11-05', 341.1],
    ]), TODAY)

    expect(rows.map((r) => r.date)).toEqual(['2026-11-05'])
  })

  it('drops a zero, a negative and a non-finite close', () => {
    const payload = {
      chart: {
        result: [{
          timestamp: [ts('2026-11-02'), ts('2026-11-03'), ts('2026-11-04'), ts('2026-11-05')],
          indicators: { quote: [{ close: [0, -12, Number.NaN, 341.1] }] },
        }],
      },
    }
    const rows = dailyClosesFromYahooChart('AAPL', '1d', payload, TODAY)
    expect(rows).toEqual([
      { symbol: 'AAPL', date: '2026-11-05', close: 341.1, source: CHART_PROXY_SOURCE },
    ])
  })

  it('keeps one row per date, the last reading of a repeated day', () => {
    const rows = dailyClosesFromYahooChart('AAPL', '1d', chart([
      ['2026-11-06', 100],
      ['2026-11-06', 342.37],
    ]), TODAY)

    expect(rows).toEqual([
      { symbol: 'AAPL', date: '2026-11-06', close: 342.37, source: CHART_PROXY_SOURCE },
    ])
  })

  it('returns nothing for a malformed, empty or hostile payload rather than throwing', () => {
    for (const payload of [
      null,
      undefined,
      {},
      { chart: {} },
      { chart: { result: [] } },
      { chart: { result: [{}] } },
      { chart: { result: [{ timestamp: 'not-an-array', indicators: { quote: [{ close: [1] }] } }] } },
      { chart: { result: [{ timestamp: [ts('2026-11-06')], indicators: { quote: [] } }] } },
      { chart: { error: 'Not Found' } },
    ]) {
      expect(dailyClosesFromYahooChart('AAPL', '1d', payload, TODAY)).toEqual([])
    }
  })

  it('writes nothing for an empty symbol', () => {
    expect(dailyClosesFromYahooChart('   ', '1d', chart([['2026-11-06', 342]]), TODAY)).toEqual([])
  })

  it('caps the row count', () => {
    const bars: Array<[string, number]> = []
    for (let i = 0; i < MAX_ROWS + 50; i += 1) {
      const d = new Date(Date.parse('2010-01-01T00:00:00Z') + i * 86_400_000)
      bars.push([d.toISOString().slice(0, 10), 10 + i])
    }
    expect(dailyClosesFromYahooChart('AAPL', '1d', chart(bars), TODAY)).toHaveLength(MAX_ROWS)
  })
})
