/**
 * The mapping layer between EODHD's envelopes and the charts.
 *
 * Every test here exists because the thing it checks is a way to put a wrong
 * number on a chart silently. A dropped bar is visible; a fabricated one is
 * not. A pence price labelled in pounds is off by a hundredfold and looks
 * entirely plausible.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  INTRADAY_MAX_SPAN_DAYS,
  deliveryLabel,
  displayPrice,
  failureMessage,
  providerLabel,
  sameUnit,
  toCandles,
  toSeriesPoints,
  windowForTimeframe,
} from '../eodhd-series'
import type { AdapterFailure } from '../contracts'

const ROOT = resolve(__dirname, '../../../..')
const WIRE_SRC = readFileSync(resolve(ROOT, 'supabase/functions/_shared/eodhd.ts'), 'utf8')
const FN_SRC = readFileSync(
  resolve(ROOT, 'supabase/functions/eodhd-market-data/index.ts'),
  'utf8',
)
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/* ───────────────────────────── request windows ─────────────────────────── */

describe('the window asked for is one the provider will actually serve', () => {
  it('matches the server-side caps exactly, so neither copy can drift', () => {
    /*
     * The caps are stated twice: once in the function (which enforces them)
     * and once in the browser (which narrows before asking). A drift between
     * them means the browser sends a request the server refuses, and the user
     * sees an empty chart with no reason given.
     */
    const serverTable = /export const INTRADAY_MAX_SPAN_DAYS[\s\S]*?\n\}/.exec(WIRE_SRC)?.[0] ?? ''
    expect(serverTable, 'the server cap table was not found').not.toBe('')

    for (const [interval, days] of Object.entries(INTRADAY_MAX_SPAN_DAYS)) {
      expect(serverTable, `${interval} is missing or differs on the server`).toContain(
        `'${interval}': ${days}`,
      )
    }
    // And no extra server entry the browser does not know about.
    const serverKeys = [...serverTable.matchAll(/'(\w+)':/g)].map(m => m[1]).sort()
    expect(serverKeys).toEqual(Object.keys(INTRADAY_MAX_SPAN_DAYS).sort())
  })

  it('never asks for more 5-minute history than EODHD serves', () => {
    // MAX over 5m would be 25 years of five-minute bars.
    for (const tf of ['1D', '5D'] as const) {
      const w = windowForTimeframe(tf)
      expect(w.interval).toBe('5m')
      expect(w.days).toBeLessThanOrEqual(INTRADAY_MAX_SPAN_DAYS['5m']!)
    }
  })

  it('asks for more than one day on the 1D timeframe', () => {
    /*
     * THE regression this prevents.
     *
     * A one-day window at 09:00 on a Monday ends before any bar exists, so
     * the provider returns an empty list and the chart is blank on exactly
     * the view a user opens most. Four days always spans a prior session.
     */
    expect(windowForTimeframe('1D').days).toBeGreaterThan(1)
  })

  it('produces an inclusive YYYY-MM-DD window, from before to', () => {
    const w = windowForTimeframe('1Y', new Date('2026-11-16T14:00:00.000Z'))
    expect(w.to).toBe('2026-11-16')
    expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(w.from < w.to).toBe(true)
    expect(w.interval).toBe('1d')
  })

  it('falls back to a daily month rather than throwing on an unknown timeframe', () => {
    const w = windowForTimeframe('nonsense' as never)
    expect(w.interval).toBe('1d')
    expect(w.days).toBe(31)
  })
})

/* ──────────────────────────────── candles ──────────────────────────────── */

const dailyBar = (over: Record<string, unknown> = {}) => ({
  date: '2026-11-13',
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 1000,
  ...over,
})

describe('a candle is never invented', () => {
  it('drops a bar with a null open rather than filling it from the close', () => {
    /*
     * THE regression. `lightweight-charts` draws a candle from NaN without
     * complaining, and patching open/high/low from the close would render a
     * doji — a bar saying the security opened and closed at the same price,
     * which nothing in the data says.
     */
    const out = toCandles([dailyBar(), dailyBar({ date: '2026-11-12', open: null })])
    expect(out).toHaveLength(1)
    expect(out[0].time).toBe('2026-11-13')
  })

  it('drops a bar with a null high or low too', () => {
    expect(toCandles([dailyBar({ high: null })])).toHaveLength(0)
    expect(toCandles([dailyBar({ low: null })])).toHaveLength(0)
  })

  it('keeps a daily bar keyed by its trading date', () => {
    const [candle] = toCandles([dailyBar()])
    expect(candle).toEqual({ time: '2026-11-13', open: 10, high: 12, low: 9, close: 11, volume: 1000 })
  })

  it('keys an intraday bar by its opening instant in unix seconds', () => {
    const [candle] = toCandles([dailyBar({ openedAt: '2026-11-13T14:35:00.000Z' })])
    expect(candle.time).toBe(String(Date.parse('2026-11-13T14:35:00.000Z') / 1000))
  })

  it('drops an intraday bar whose instant does not parse', () => {
    // Rather than emitting `time: 'NaN'`, which the chart would place at the
    // epoch and draw as a candle 56 years before the series.
    expect(toCandles([dailyBar({ openedAt: 'not a date' })])).toHaveLength(0)
  })

  it('reports a missing volume as zero, not as a fabricated figure', () => {
    expect(toCandles([dailyBar({ volume: null })])[0].volume).toBe(0)
  })
})

describe('a close series keeps every bar that has a close', () => {
  it('keeps a bar with a null open, because no open is drawn', () => {
    const out = toSeriesPoints([dailyBar({ open: null, high: null, low: null })])
    expect(out).toHaveLength(1)
    expect(out[0].value).toBe(11)
  })

  it('stamps a daily bar at midnight UTC, the same lower bound the server uses', () => {
    const [p] = toSeriesPoints([dailyBar()])
    expect(new Date(p.timestamp).toISOString()).toBe('2026-11-13T00:00:00.000Z')
    expect(p.date.getTime()).toBe(p.timestamp)
  })

  it('stamps an intraday bar at its actual instant', () => {
    const [p] = toSeriesPoints([dailyBar({ openedAt: '2026-11-13T14:35:00.000Z' })])
    expect(p.timestamp).toBe(Date.parse('2026-11-13T14:35:00.000Z'))
  })

  it('leaves volume undefined when the provider gave none', () => {
    expect(toSeriesPoints([dailyBar({ volume: null })])[0].volume).toBeUndefined()
  })

  it('returns an empty series for an empty window, and never a placeholder', () => {
    expect(toSeriesPoints([])).toEqual([])
    expect(toCandles([])).toEqual([])
  })
})

/* ──────────────────────────────── currency ─────────────────────────────── */

const GBX = { code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 }

describe('a pence price cannot pass as a pound price', () => {
  it('converts a GBX figure to pounds and relabels it GBP', () => {
    /*
     * THE hundredfold error. SHEL.LSE quotes 2847.5 pence. Shown as £2,847.50
     * it overstates the position by a factor of 100, and it looks like a
     * perfectly ordinary number.
     */
    expect(displayPrice(2847.5, { currency: 'GBP', currencyUnit: GBX })).toEqual({
      value: 28.475,
      currency: 'GBP',
      converted: true,
    })
  })

  it('leaves a major-unit price alone and says it did not convert', () => {
    expect(displayPrice(241.3, { currency: 'USD' })).toEqual({
      value: 241.3,
      currency: 'USD',
      converted: false,
    })
  })

  it('shows a bare number rather than guessing a currency', () => {
    // No reference data means no unit is known. A default of USD here would
    // put a dollar sign on a Tokyo price.
    expect(displayPrice(3105, null)).toEqual({ value: 3105, converted: false })
    expect(displayPrice(3105, undefined).currency).toBeUndefined()
  })

  it('refuses to call a GBX instrument and a GBP fund the same unit', () => {
    expect(sameUnit({ currency: 'GBP', currencyUnit: GBX }, { currency: 'GBP' })).toBe(false)
  })

  it('treats two unknowns as incomparable, not as equal', () => {
    // `undefined === undefined` is the trap. Two instruments with no stated
    // currency must not be summed just because neither said anything.
    expect(sameUnit({}, {})).toBe(false)
    expect(sameUnit(null, null)).toBe(false)
    expect(sameUnit({ currency: 'USD' }, {})).toBe(false)
  })

  it('agrees only when the effective unit is identical', () => {
    expect(sameUnit({ currency: 'USD' }, { currency: 'USD' })).toBe(true)
    expect(
      sameUnit({ currency: 'GBP', currencyUnit: GBX }, { currency: 'GBP', currencyUnit: GBX }),
    ).toBe(true)
    expect(sameUnit({ currency: 'USD' }, { currency: 'EUR' })).toBe(false)
  })
})

/* ──────────────────────────── failures and labels ──────────────────────── */

describe('the four failure kinds say four different things', () => {
  const kinds: AdapterFailure[] = [
    { kind: 'unknown_symbol', symbol: 'ZZZZ.US' },
    { kind: 'no_data', detail: 'empty window' },
    { kind: 'not_supported', detail: 'no 15m bar' },
    { kind: 'rate_limited', retryAfterMs: null },
    { kind: 'unavailable', detail: 'timeout' },
  ]

  it('gives every kind its own message', () => {
    const messages = kinds.map(failureMessage)
    expect(new Set(messages).size).toBe(kinds.length)
    for (const m of messages) expect(m.length).toBeGreaterThan(10)
  })

  it('does not tell a user their symbol is unknown when the window was empty', () => {
    /*
     * THE regression, in the words a person reads. Before `no_data` existed,
     * asking for today's bar during an open session produced "not a symbol
     * this provider knows" about a perfectly good ticker.
     */
    expect(failureMessage({ kind: 'no_data', detail: '' })).not.toMatch(/not a symbol|unknown/i)
    expect(failureMessage({ kind: 'unknown_symbol', symbol: 'ZZZZ.US' })).toContain('ZZZZ.US')
  })
})

describe('delivery labels', () => {
  it('maps the provider vocabulary to short words', () => {
    expect(deliveryLabel('delayed')).toBe('Delayed')
    expect(deliveryLabel('eod')).toBe('EOD')
    expect(deliveryLabel('realtime')).toBe('Live')
  })

  it('says Unknown rather than Live when the provider stated nothing', () => {
    // Defaulting an unstated delivery to "Live" would be the most harmful
    // possible guess: it is the only label that invites a trade.
    expect(deliveryLabel(undefined)).toBe('Unknown')
    expect(deliveryLabel('something else')).toBe('Unknown')
  })

  it('names providers in our words, not a vendor schema', () => {
    expect(providerLabel('eodhd')).toBe('EODHD')
    expect(providerLabel('yahoo')).toBe('Yahoo')
  })
})

/* ──────────────────────── the server-side §3 corrections ───────────────── */

describe('the daily empty-window defect is fixed at the source', () => {
  it('no longer maps an empty daily list to unknown_symbol', () => {
    /*
     * THE regression, asserted against the function source because the
     * function runs on Deno and is not importable here.
     *
     * `fetchDailyBars` returned `{ kind: 'unknown_symbol', symbol }` for an
     * empty list. EODHD answers 404 for a symbol it does not know — which
     * `eodhdGet` already maps — so a 200 with no rows means the symbol EXISTS
     * and the window is empty.
     */
    const code = stripComments(WIRE_SRC)
    const fn = /export async function fetchDailyBars[\s\S]*?\n\}/.exec(code)?.[0] ?? ''
    expect(fn, 'fetchDailyBars was not found').not.toBe('')
    expect(fn.length).toBeGreaterThan(200)

    // The empty branch exists, and it is no_data.
    expect(fn).toMatch(/bars\.length === 0/)
    const emptyBranch = /bars\.length === 0\s*\)\s*\{[\s\S]*?\n {2}\}/.exec(fn)?.[0] ?? ''
    expect(emptyBranch, 'the empty-list branch was not found').not.toBe('')
    expect(emptyBranch).toContain("'no_data'")
    expect(emptyBranch).not.toContain('unknown_symbol')
  })

  it('still reports a genuinely unknown symbol as unknown_symbol', () => {
    // The fix must not have removed the real case. `eodhdGet` owns it.
    const code = stripComments(WIRE_SRC)
    expect(code).toMatch(/unknown_symbol/)
    const get = /async function eodhdGet[\s\S]*?\n\}/.exec(code)?.[0] ?? ''
    expect(get).not.toBe('')
    expect(get).toContain('unknown_symbol')
  })

  it('enforces the intraday span cap before calling the provider', () => {
    const code = stripComments(WIRE_SRC)
    const fn = /export async function fetchIntradayBars[\s\S]*?\n\}/.exec(code)?.[0] ?? ''
    expect(fn, 'fetchIntradayBars was not found').not.toBe('')

    const capCheck = fn.indexOf('INTRADAY_MAX_SPAN_DAYS')
    const providerCall = fn.indexOf('eodhdGet(')
    expect(capCheck, 'the cap is never consulted').toBeGreaterThan(-1)
    expect(providerCall, 'the provider is never called').toBeGreaterThan(-1)
    // The cap is checked BEFORE the request, so an over-wide window costs no
    // metered provider call.
    expect(capCheck).toBeLessThan(providerCall)
  })
})

describe('the entitlement probe answers without touching the provider', () => {
  const code = stripComments(FN_SRC)

  it('exists as an operation', () => {
    expect(code).toMatch(/'entitlement'/)
    expect(code).toMatch(/op === 'entitlement'/)
  })

  it('answers before the 403, so an unentitled caller gets a yes/no not an error', () => {
    /*
     * The whole point. If the probe sat after the `!decision.allowed` return,
     * an unentitled frontend would have to infer entitlement from a 403 —
     * which is indistinguishable from a bug.
     */
    const probe = code.indexOf("op === 'entitlement'")
    const deny = code.indexOf('!decision.allowed')
    expect(probe).toBeGreaterThan(-1)
    expect(deny).toBeGreaterThan(-1)
    expect(probe).toBeLessThan(deny)
  })

  it('still makes the entitlement decision before any provider call', () => {
    // The ordering property from Package 1 is unchanged by the restructure.
    // `eodhd-market-data-auth.test.ts` owns the exhaustive version; this is
    // the cheap check that the restructure did not invert it.
    const decision = code.indexOf('decideMarketDataAccess(')
    const key = code.indexOf("Deno.env.get('EODHD_API_KEY')")
    expect(decision).toBeGreaterThan(-1)
    expect(key).toBeGreaterThan(-1)
    expect(decision).toBeLessThan(key)
  })

  it('reports a missing allowlist as not entitled rather than as a 503', () => {
    // So a deployment without the secret degrades to the default provider
    // instead of leaving every chart broken on an unreadable error.
    expect(code).toMatch(/not_configured/)
  })

  it('never returns the allowlist or any other account in the probe', () => {
    const branch = /if \(op === 'entitlement'\) \{[\s\S]*?\n {2}\}/.exec(code)?.[0] ?? ''
    expect(branch, 'the probe branch was not found').not.toBe('')
    expect(branch.length).toBeGreaterThan(80)
    expect(branch).not.toMatch(/allowlist|authorizedUserIds|config\.users/)
    expect(branch).toMatch(/entitled/)
  })
})
