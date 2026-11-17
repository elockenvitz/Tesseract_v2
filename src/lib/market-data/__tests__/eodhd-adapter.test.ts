/**
 * The EODHD adapter and its normalizers.
 *
 * Nothing here touches the network or EODHD. The adapter is constructed with
 * a stub invoker, and the server-side normalizers are pure functions over
 * recorded response shapes.
 *
 * IMPORTANT: these fixtures are written from EODHD's documented REST shapes
 * and have NOT been confirmed against the live API, because
 * `EODHD_AUTHORIZED_USER_IDS` is unset and the package's own gate stops the
 * live connection. They pin the adapter's REFUSALS — which are the safety
 * properties and are correct regardless of field names — and they pin the
 * happy path only as a hypothesis to be corrected by the first live run.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createEodhdAdapter, EODHD_CAPABILITIES, type EodhdInvoker } from '../eodhd-adapter'
import {
  toDailyBars,
  toIntradayBars,
  toQuote,
  toReferenceRecords,
  mapIntradayInterval,
  classifyDelivery,
  classifyQuotingCurrency,
  exchangeSuffix,
} from '../../../../supabase/functions/_shared/eodhd'
import { needsCurrencyConversion, toMajorUnits } from '../freshness'
import {
  decideMarketDataAccess,
  entitlementConfigFromEnv,
} from '../../../../supabase/functions/_shared/market-data-entitlement'

const OBSERVED_AT = '2026-11-16T20:00:00.000Z'

/** The two server files, read once, for the source-level guards below. */
const WIRE_SRC = readFileSync(
  resolve(__dirname, '../../../../supabase/functions/_shared/eodhd.ts'),
  'utf8',
)
const FN_SRC = readFileSync(
  resolve(__dirname, '../../../../supabase/functions/eodhd-market-data/index.ts'),
  'utf8',
)

const stub = (data: unknown, error: unknown = null): EodhdInvoker => async () => ({ data, error })

/* ───────────────────────────── normalizers ─────────────────────────────── */

describe('toDailyBars', () => {
  it('maps a documented EOD response and sorts ascending', () => {
    const bars = toDailyBars([
      { date: '2026-11-13', open: 330, high: 335, low: 329, close: 332.89, adjusted_close: 332.89, volume: 41_000_000 },
      { date: '2026-11-12', open: 325, high: 331, low: 324, close: 330.1, adjusted_close: 330.1, volume: 39_000_000 },
    ])
    expect(bars.map(b => b.date)).toEqual(['2026-11-12', '2026-11-13'])
    expect(bars[1].close).toBe(332.89)
    expect(bars[1].volume).toBe(41_000_000)
  })

  it('reads the RAW close, never adjusted_close', () => {
    // Mixing bases silently is how two series stop being comparable.
    const bars = toDailyBars([{ date: '2026-11-13', close: 100, adjusted_close: 50 }])
    expect(bars[0].close).toBe(100)
  })

  it('drops a bar with a zero or negative close rather than booking it', () => {
    const bars = toDailyBars([
      { date: '2026-11-13', close: 0 },
      { date: '2026-11-12', close: -5 },
      { date: '2026-11-11', close: 'NA' },
      { date: '2026-11-10', close: 101 },
    ])
    expect(bars).toHaveLength(1)
    expect(bars[0].close).toBe(101)
  })

  it('nulls an unusable open/high/low instead of zeroing it', () => {
    const bars = toDailyBars([{ date: '2026-11-13', open: 0, high: 'NA', low: null, close: 50 }])
    expect(bars[0].open).toBeNull()
    expect(bars[0].high).toBeNull()
    expect(bars[0].low).toBeNull()
    expect(bars[0].close).toBe(50)
  })

  it('returns nothing for a non-array or empty body', () => {
    for (const junk of [null, undefined, {}, '', 0, []]) {
      expect(toDailyBars(junk)).toEqual([])
    }
  })
})

describe('toIntradayBars', () => {
  it('carries the instant each bar opens, not just a date', () => {
    const ts = Math.floor(Date.parse('2026-11-16T14:30:00Z') / 1000)
    const bars = toIntradayBars([{ timestamp: ts, open: 1, high: 2, low: 1, close: 1.5, volume: 10 }])
    expect(bars[0].openedAt).toBe('2026-11-16T14:30:00.000Z')
    expect(bars[0].date).toBe('2026-11-16')
  })

  it('reads a datetime fallback as UTC, not as host local time', () => {
    const bars = toIntradayBars([{ datetime: '2026-11-16 14:30:00', close: 5 }])
    expect(bars[0].openedAt).toBe('2026-11-16T14:30:00.000Z')
  })

  it('drops a bar it cannot place in time', () => {
    const bars = toIntradayBars([{ close: 5 }, { timestamp: 0, close: 5 }, { datetime: 'nonsense', close: 5 }])
    expect(bars).toEqual([])
  })

  it('sorts ascending by instant', () => {
    const t = (iso: string) => Math.floor(Date.parse(iso) / 1000)
    const bars = toIntradayBars([
      { timestamp: t('2026-11-16T15:00:00Z'), close: 2 },
      { timestamp: t('2026-11-16T14:30:00Z'), close: 1 },
    ])
    expect(bars.map(b => b.close)).toEqual([1, 2])
  })
})

describe('a daily bar never claims an instant it does not know', () => {
  /*
   * EODHD's EOD payload carries a DATE and no time, and this codebase has no
   * exchange calendar by deliberate decision. So the series is stamped at
   * midnight UTC of the last trading date and labelled `session_date`.
   *
   * The safety property is directional: midnight UTC must never be LATER
   * than the real closing bell, because a later `effectiveAt` would make the
   * data look fresher than it is. These are the actual closing bells in UTC.
   */
  const CLOSES_UTC: Array<[string, number]> = [
    ['New York (EST)', 21.0],
    ['New York (EDT)', 20.0],
    ['Toronto', 21.0],
    ['London (GMT)', 16.5],
    ['London (BST)', 15.5],
    ['Frankfurt/XETRA', 16.5],
    ['Tokyo', 6.0],
    ['Hong Kong', 8.0],
    ['Sydney', 6.0],
    ['Auckland', 4.0],
  ]

  it('midnight UTC of the trading date is at or before every real close', () => {
    for (const [venue, closeHourUtc] of CLOSES_UTC) {
      expect(closeHourUtc, `${venue} closes before 00:00Z, which would break the bound`)
        .toBeGreaterThan(0)
    }
  })

  it('so an age computed from effectiveAt can only OVER-state staleness', () => {
    const date = '2026-11-13'
    const stamped = Date.parse(`${date}T00:00:00.000Z`)
    const observed = Date.parse('2026-11-16T20:00:00.000Z')

    for (const [venue, closeHourUtc] of CLOSES_UTC) {
      const realClose = Date.parse(`${date}T00:00:00.000Z`) + closeHourUtc * 3_600_000
      const reportedAge = observed - stamped
      const trueAge = observed - realClose
      expect(reportedAge, `${venue}: reported age must not be younger than the truth`)
        .toBeGreaterThanOrEqual(trueAge)
    }
  })

  it('and the series says so, rather than leaving it to be assumed', () => {
    // Asserted against the source because fetchDailyBars needs a live fetch.
    expect(WIRE_SRC).toMatch(/effectiveAtPrecision: 'session_date'/)
    // The adjustment basis is stated too: raw closes, never adjusted_close.
    expect(WIRE_SRC).toMatch(/adjustment: 'raw'/)
    expect(WIRE_SRC).not.toMatch(/row\?\.adjusted_close|row\.adjusted_close/)
  })

  it('raw bars across a split are labelled raw, not silently comparable', () => {
    // 4-for-1: the close falls from ~600 to ~150 with no adjustment applied.
    const bars = toDailyBars([
      { date: '2026-11-12', open: 598, high: 604, low: 596, close: 600, volume: 1_000 },
      { date: '2026-11-13', open: 150, high: 152, low: 149, close: 151, volume: 4_000 },
    ])
    expect(bars.map(b => b.close)).toEqual([600, 151])
    // The bars themselves make no claim; the envelope's `adjustment: 'raw'`
    // is what tells a consumer these two numbers are not one series.
    expect(bars.every(b => !('adjustment' in b))).toBe(true)
  })
})

describe('reference data makes no claim about when it was true', () => {
  it('the handler returns observedAt and NO effectiveAt', () => {
    /*
     * This returned `effectiveAt: now`, commented as "the honest instant ...
     * because that is all the provider told us". That was backwards:
     * `effectiveAt` means when the value was TRUE, and its own doc comment
     * forbids "now as a convenience". An exchange code has a validity window
     * the search endpoint never states, so `now` was a fabricated fact that
     * any freshness check would read as perfectly fresh.
     */
    // Comments stripped: the branch now carries a comment explaining why
    // effectiveAt is gone, and prose must not satisfy or break the check.
    const code = FN_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    const ref = /case 'reference': \{[\s\S]*?\n {6}\}/.exec(code)?.[0] ?? ''
    expect(ref, 'the reference branch anchor no longer matches').not.toBe('')
    expect(ref.length).toBeGreaterThan(100)
    expect(ref).toContain('observedAt')
    expect(ref).not.toMatch(/effectiveAt/)
  })

  it('and the contract types it as Retrieved, so a consumer cannot read one', () => {
    const contracts = readFileSync(resolve(__dirname, '../contracts.ts'), 'utf8')
    expect(contracts).toMatch(/reference\(symbol: string\): Promise<AdapterResult<Retrieved<ReferenceRecord>>>/)
    const freshness = readFileSync(resolve(__dirname, '../freshness.ts'), 'utf8')
    expect(freshness).toMatch(/export interface Retrieved<T>/)
    // Observed still has effectiveAt; Retrieved must not gain one.
    const retrieved = /export interface Retrieved<T> \{[\s\S]*?\n\}/.exec(freshness)?.[0] ?? ''
    expect(retrieved).not.toMatch(/effectiveAt/)
  })
})

describe('toQuote', () => {
  const ts = Math.floor(Date.parse('2026-11-16T19:55:00Z') / 1000)

  it('maps a quote and reports the provider instant, not now', () => {
    const r = toQuote({ code: 'AAPL.US', close: 332.89, previousClose: 330.1, timestamp: ts }, {
      delivery: 'delayed',
      observedAt: OBSERVED_AT,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.value).toBe(332.89)
    expect(r.data.effectiveAt).toBe('2026-11-16T19:55:00.000Z')
    expect(r.data.observedAt).toBe(OBSERVED_AT)
    expect(r.data.source.delivery).toBe('delayed')
    expect(r.data.source.provider).toBe('eodhd')
  })

  it('carries NO currency, because the real-time payload states none', () => {
    /*
     * `toQuote` used to accept a `currency` that the edge function read
     * straight out of the REQUEST BODY. EODHD's real-time endpoint returns no
     * currency field at all, so that value came from the CALLER while the
     * provenance still named EODHD: a caller could label a London pence price
     * `GBP` and produce a hundredfold overvaluation carrying a provider's
     * name. The unit now comes only from `reference`, which reads it from the
     * provider's own payload.
     */
    const r = toQuote({ close: 2847.5, timestamp: ts }, {
      delivery: 'delayed',
      observedAt: OBSERVED_AT,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.currency).toBeUndefined()
    expect(r.data.currencyUnit).toBeUndefined()

    // And neither the signature nor the body can take one again.
    expect(toQuote.length).toBe(2)
    expect(WIRE_SRC).not.toMatch(/currency: opts\.currency/)
    expect(FN_SRC).not.toMatch(/body\.currency/)
  })

  it('effectiveAt is the last TRADE, which is not the feed delay', () => {
    /*
     * SHOP.TO came back ~31 minutes old on a feed documented at 15-20
     * minutes, which looks like a fault and is not one. EODHD's `timestamp`
     * is the instant of the last trade. On a delayed feed a thinly traded
     * name reports a last trade from well beyond the feed's own delay simply
     * because nothing has traded since.
     *
     * So the gap between `effectiveAt` and `observedAt` measures delay PLUS
     * trade sparsity, and nothing may present it as the delay alone. This
     * test pins the arithmetic: a 31-minute-old trade yields a 31-minute gap,
     * and the envelope still says only `delayed`, with no delay figure.
     */
    const stale = Math.floor(Date.parse('2026-11-16T19:29:00Z') / 1000)
    const r = toQuote({ close: 184.2, timestamp: stale }, {
      delivery: 'delayed',
      observedAt: '2026-11-16T20:00:00.000Z',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const gapMinutes =
      (Date.parse(r.data.observedAt) - Date.parse(r.data.effectiveAt)) / 60_000
    expect(gapMinutes).toBe(31)
    expect(r.data.source.delivery).toBe('delayed')
    // No delayMinutes claim anywhere: we have not demonstrated one.
    expect((r.data.source as { delayMinutes?: number }).delayMinutes).toBeUndefined()
    expect(WIRE_SRC).not.toMatch(/delayMinutes/)
  })

  it('NEVER substitutes previousClose for a missing price', () => {
    // This is the exact defect the retired fetch-stock-prices shipped:
    // `regularMarketPrice || previousClose`, published as a current quote.
    for (const close of [null, undefined, 0, -1, 'NA', '']) {
      const r = toQuote({ close, previousClose: 330.1, timestamp: ts }, {
        delivery: 'delayed',
        observedAt: OBSERVED_AT,
      })
      expect(r.ok, `close=${String(close)} must be refused`).toBe(false)
    }
  })

  it('refuses a price with no timestamp rather than stamping it with now', () => {
    for (const timestamp of [null, undefined, 0, -1, 'NA']) {
      const r = toQuote({ close: 332.89, timestamp }, { delivery: 'delayed', observedAt: OBSERVED_AT })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.failure.kind).toBe('unavailable')
    }
  })

  it('never reports a quote as realtime on this plan', () => {
    // Labelling a delayed feed "live" is a claim the subscription does not
    // support. Until a live run establishes it per venue, everything is
    // delayed — and the classifier takes no symbol precisely because it has
    // no per-venue knowledge to apply yet.
    expect(classifyDelivery()).toBe('delayed')
    expect(classifyDelivery.length).toBe(0)
  })
})

describe('toReferenceRecords', () => {
  it('builds a provider symbol and keeps the venue as a label', () => {
    const [r] = toReferenceRecords([
      { Code: 'SHEL', Exchange: 'LSE', Name: 'Shell PLC', Type: 'Common Stock', Currency: 'GBX', Country: 'UK', ISIN: 'GB00BP6MXD84' },
    ])
    expect(r.symbol).toBe('SHEL.LSE')
    expect(r.exchangeLabel).toBe('LSE')
    expect(r.securityClass).toBe('stock')
    expect(r.isin).toBe('GB00BP6MXD84')
    expect(r.listedByProvider).toBe(true)

    /*
     * GBX does NOT survive as a currency code.
     *
     * `currency` is documented as ISO 4217 and GBX is not in ISO 4217 -- it
     * is the vendor's code for pence. This used to pass `GBX` straight
     * through, so anything summing a UK holding against a GBP cash balance
     * would have been out by a factor of one hundred with no warning.
     */
    expect(r.currency).toBe('GBP')
    expect(r.currencyUnit).toEqual({ code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 })
  })

  it('a GBX price and a GBP price are never silently comparable', () => {
    const [uk] = toReferenceRecords([{ Code: 'SHEL', Exchange: 'LSE', Currency: 'GBX' }])
    const [us] = toReferenceRecords([{ Code: 'AAPL', Exchange: 'US', Currency: 'USD' }])
    const [gbpFund] = toReferenceRecords([{ Code: 'VMID', Exchange: 'LSE', Currency: 'GBP' }])

    // 2847.5 pence is £28.475, not £2,847.50.
    expect(toMajorUnits(2847.5, uk.currencyUnit, uk.currency))
      .toEqual({ value: 28.475, currency: 'GBP' })

    // A major-unit figure passes through untouched.
    expect(toMajorUnits(332.89, us.currencyUnit, us.currency))
      .toEqual({ value: 332.89, currency: 'USD' })

    // Same nominal currency, different unit: still needs conversion.
    expect(needsCurrencyConversion(uk, gbpFund)).toBe(true)
    expect(needsCurrencyConversion(uk, uk)).toBe(false)
    expect(needsCurrencyConversion(uk, us)).toBe(true)

    // An unknown unit is incompatible with everything, including itself.
    expect(needsCurrencyConversion({}, {})).toBe(true)
    expect(needsCurrencyConversion(us, {})).toBe(true)
  })

  it('refuses to convert on a nonsensical scale rather than dividing by it', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => toMajorUnits(100, { code: 'XXX', majorCode: 'YYY', minorPerMajor: bad }))
        .toThrow(/Refusing to convert XXX/)
    }
  })

  it('GBp is pence and GBP is pounds, and case is the ONLY difference', () => {
    /*
     * The trap that nearly shipped. A case-insensitive lookup collapses `GBp`
     * into `GBP`, which is a hundredfold error in whichever direction it
     * lands. Nothing else in the payload distinguishes them.
     */
    const pence = classifyQuotingCurrency('GBp')
    expect(pence.currency).toBe('GBP')
    expect(pence.currencyUnit?.minorPerMajor).toBe(100)

    const pounds = classifyQuotingCurrency('GBP')
    expect(pounds.currency).toBe('GBP')
    expect(pounds.currencyUnit).toBeUndefined()

    // 2847.5 of each is £28.475 and £2847.50 -- a factor of 100 apart.
    expect(toMajorUnits(2847.5, pence.currencyUnit, pence.currency).value).toBe(28.475)
    expect(toMajorUnits(2847.5, pounds.currencyUnit, pounds.currency).value).toBe(2847.5)
  })

  it('classifies unambiguous minor units in any case, and guesses at nothing', () => {
    // GBX, ZAC and ILA are not ISO 4217 spellings, so case cannot mislead.
    expect(classifyQuotingCurrency('GBX').currencyUnit?.minorPerMajor).toBe(100)
    expect(classifyQuotingCurrency('gbx').currencyUnit?.code).toBe('GBX')
    expect(classifyQuotingCurrency(' gbx ').currency).toBe('GBP')
    expect(classifyQuotingCurrency('ILA').currencyUnit?.majorCode).toBe('ILS')
    expect(classifyQuotingCurrency('ZAc').currencyUnit?.majorCode).toBe('ZAR')

    // An unrecognised code is NOT guessed at: a wrong minorPerMajor is worse
    // than an absent one, because a consumer will divide by it.
    expect(classifyQuotingCurrency('QQQ')).toEqual({ currency: 'QQQ' })
    expect(classifyQuotingCurrency('ILS')).toEqual({ currency: 'ILS' })
    expect(classifyQuotingCurrency(undefined)).toEqual({})
    expect(classifyQuotingCurrency('')).toEqual({})
    expect(classifyQuotingCurrency(42)).toEqual({})
  })

  it('leaves mic UNSET, because an EODHD exchange code is not a MIC', () => {
    // `LSE` is not `XLON`. A wrong MIC is worse than no MIC: joins trust it.
    const [r] = toReferenceRecords([{ Code: 'SHEL', Exchange: 'LSE' }])
    expect(r.mic).toBeUndefined()
  })

  it('maps an ETF and falls back to unknown for an unrecognised type', () => {
    const rows = toReferenceRecords([
      { Code: 'SPY', Exchange: 'US', Type: 'ETF' },
      { Code: 'X', Exchange: 'US', Type: 'Something New' },
    ])
    expect(rows[0].securityClass).toBe('etf')
    expect(rows[1].securityClass).toBe('unknown')
  })

  it('skips a hit with no code', () => {
    expect(toReferenceRecords([{ Exchange: 'US' }, { Code: '  ' }])).toEqual([])
  })
})

describe('interval handling', () => {
  it('supports only the intervals EODHD actually offers', () => {
    expect(mapIntradayInterval('1m')).toBe('1m')
    expect(mapIntradayInterval('5m')).toBe('5m')
    expect(mapIntradayInterval('1h')).toBe('1h')
  })

  it('refuses 15m rather than rounding it to 5m or 1h', () => {
    // A silently substituted bar size is wrong in a way nobody can see.
    expect(mapIntradayInterval('15m')).toBeNull()
    expect(mapIntradayInterval('1d')).toBeNull()
  })
})

describe('exchangeSuffix', () => {
  it('reads the venue suffix', () => {
    expect(exchangeSuffix('AAPL.US')).toBe('US')
    expect(exchangeSuffix('SHOP.TO')).toBe('TO')
    expect(exchangeSuffix('7203.TSE')).toBe('TSE')
  })

  it('returns null when there is no suffix to read', () => {
    for (const s of ['AAPL', '.US', 'AAPL.', '']) expect(exchangeSuffix(s)).toBeNull()
  })
})

/* ───────────────────────── entitlement, server-side ────────────────────── */

describe('entitlementConfigFromEnv', () => {
  const SUBSCRIBER = 'fa46cffc-dafb-4071-a3ea-5536240d462e'

  it('reports not_configured when the secret is absent, which is today', () => {
    const r = entitlementConfigFromEnv(() => undefined)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('not_configured')
    expect(r.detail).toContain('EODHD_AUTHORIZED_USER_IDS')
  })

  it('treats an empty or whitespace secret as not configured', () => {
    for (const raw of ['', '   ', '\n']) {
      expect(entitlementConfigFromEnv(() => raw).ok).toBe(false)
    }
  })

  it('parses a comma, space or semicolon separated list', () => {
    const other = '6f54a3e1-6826-4e67-ab72-86c94bee1a94'
    for (const sep of [',', ' ', ';', ', ']) {
      const r = entitlementConfigFromEnv(() => `${SUBSCRIBER}${sep}${other}`)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.config.eodhdAuthorizedUserIds).toEqual([SUBSCRIBER, other])
    }
  })

  it('rejects entries that are not UUIDs and reports not_configured if none survive', () => {
    const r = entitlementConfigFromEnv(() => 'elockenvitz@gmail.com, *, admin')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('not_configured')
    expect(r.detail).toContain('3 entries rejected')
  })

  it('keeps the valid ids when the list is partly junk', () => {
    const r = entitlementConfigFromEnv(() => `*, ${SUBSCRIBER}`)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.config.eodhdAuthorizedUserIds).toEqual([SUBSCRIBER])
  })

  it('composes with the decision: configured but not the caller is still a deny', () => {
    const r = entitlementConfigFromEnv(() => SUBSCRIBER)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const denied = decideMarketDataAccess(
      { subject: { verifiedUserId: '6f54a3e1-6826-4e67-ab72-86c94bee1a94' }, provider: 'eodhd', use: 'interactive_read' },
      r.config,
    )
    expect(denied.allowed).toBe(false)
    const allowed = decideMarketDataAccess(
      { subject: { verifiedUserId: SUBSCRIBER }, provider: 'eodhd', use: 'interactive_read' },
      r.config,
    )
    expect(allowed.allowed).toBe(true)
  })
})

/* ───────────────────────────── the adapter ─────────────────────────────── */

describe('createEodhdAdapter', () => {
  it('declares itself as eodhd with a raw bar basis', () => {
    const a = createEodhdAdapter(stub(null))
    expect(a.name).toBe('eodhd')
    expect(a.capabilities.barAdjustment).toBe('raw')
  })

  it('leaves venues empty rather than guessing MICs', () => {
    expect(EODHD_CAPABILITIES.venues).toEqual([])
  })

  it('passes a typed success through unchanged', async () => {
    const payload = { ok: true, data: [{ symbol: 'AAPL.US' }] }
    const r = await createEodhdAdapter(stub(payload)).resolve('apple')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data).toEqual([{ symbol: 'AAPL.US' }])
  })

  it('passes a typed failure through unchanged', async () => {
    const payload = { ok: false, failure: { kind: 'unknown_symbol', symbol: 'NOPE.US' } }
    const r = await createEodhdAdapter(stub(payload)).latest('NOPE.US')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.kind).toBe('unknown_symbol')
  })

  it('maps a 403 to not_supported, so an unentitled seat is not retried', async () => {
    const r = await createEodhdAdapter(stub(null, { status: 403 })).latest('AAPL.US')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.kind).toBe('not_supported')
  })

  it('maps a 503 to not_supported — the server is unconfigured, not throttled', async () => {
    const r = await createEodhdAdapter(stub(null, { status: 503 })).latest('AAPL.US')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.kind).toBe('not_supported')
  })

  it('maps a 429 to rate_limited, which IS retryable', async () => {
    const r = await createEodhdAdapter(stub(null, { context: { status: 429 } })).latest('AAPL.US')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.failure.kind).toBe('rate_limited')
  })

  it('treats an unrecognised 200 body as a failure, never an empty success', async () => {
    // `data || []` faking an empty result is a documented defect class here.
    for (const junk of [null, undefined, {}, [], 'ok', { ok: 'yes' }, { data: [] }]) {
      const r = await createEodhdAdapter(stub(junk)).resolve('x')
      expect(r.ok, `${JSON.stringify(junk)} must not read as success`).toBe(false)
    }
  })

  it('returns a failure when the invoker throws', async () => {
    const thrower: EodhdInvoker = async () => {
      throw new Error('boom')
    }
    const r = await createEodhdAdapter(thrower).latest('AAPL.US')
    expect(r.ok).toBe(false)
  })

  it('defaults bars to a daily interval and forwards an explicit one', async () => {
    const seen: Record<string, unknown>[] = []
    const spy: EodhdInvoker = async body => {
      seen.push(body)
      return { data: { ok: true, data: { value: [] } }, error: null }
    }
    const a = createEodhdAdapter(spy)
    await a.bars({ symbol: 'AAPL.US', from: '2026-11-01', to: '2026-11-16' })
    await a.bars({ symbol: 'AAPL.US', from: '2026-11-01', to: '2026-11-16', interval: '5m' })
    expect(seen[0].interval).toBe('1d')
    expect(seen[1].interval).toBe('5m')
  })

  it('never sends a credential in a request body', async () => {
    const seen: Record<string, unknown>[] = []
    const spy: EodhdInvoker = async body => {
      seen.push(body)
      return { data: { ok: true, data: [] }, error: null }
    }
    const a = createEodhdAdapter(spy)
    await a.resolve('apple')
    await a.latest('AAPL.US')
    await a.reference('AAPL.US')
    await a.bars({ symbol: 'AAPL.US', from: '2026-11-01', to: '2026-11-16' })
    for (const body of seen) {
      const keys = Object.keys(body).join(',').toLowerCase()
      expect(keys).not.toMatch(/token|key|secret|api_token|apikey/)
    }
  })
})

/* ──────────────────── the duplicated types must not drift ──────────────── */

/*
 * The edge function's authorization ordering and data isolation are asserted
 * in `src/lib/security/__tests__/eodhd-market-data-auth.test.ts`, which is
 * the file `supabase/functions/authz-registry.json` names as this function's
 * review artifact. They lived here first; they belong where a reviewer looks.
 */

/*
 * `_shared/eodhd.ts` re-declares `Delivery`, `BarInterval`, `PriceBar`,
 * `Observed` and `AdapterFailure` instead of importing them, because
 * `contracts.ts` imports `./freshness` with no file extension and Deno cannot
 * resolve that. The duplication is deliberate and documented there — these
 * tests are what stop it drifting silently.
 */
describe('the edge function wire types still match the contract', () => {
  const MD = resolve(__dirname, '..')
  const WIRE = resolve(MD, '../../../supabase/functions/_shared/eodhd.ts')
  const read = (p: string) => readFileSync(p, 'utf8')

  const members = (src: string, typeName: string) => {
    const decl = new RegExp(`export type ${typeName} =([^=]*?)(?=\\n\\n|\\nexport|\\ninterface)`, 's')
    const body = decl.exec(src)?.[1] ?? ''
    return [...body.matchAll(/'([a-z0-9_]+)'/gi)].map(m => m[1]).sort()
  }

  it('agrees on the Delivery members', () => {
    const fromFreshness = members(read(resolve(MD, 'freshness.ts')), 'Delivery')
    const fromWire = members(read(WIRE), 'Delivery')
    expect(fromFreshness).toEqual(['delayed', 'eod', 'realtime', 'unavailable'])
    expect(fromWire).toEqual(fromFreshness)
  })

  it('agrees on the BarInterval members', () => {
    const fromContracts = members(read(resolve(MD, 'contracts.ts')), 'BarInterval')
    const fromWire = members(read(WIRE), 'BarInterval')
    expect(fromContracts.length).toBeGreaterThan(0)
    expect(fromWire).toEqual(fromContracts)
  })

  it('agrees on the AdapterFailure kinds', () => {
    const kinds = (src: string) =>
      [...src.matchAll(/kind:\s*'([a-z_]+)'/g)].map(m => m[1])
    const fromContracts = [...new Set(kinds(read(resolve(MD, 'contracts.ts'))))].sort()
    const fromWire = [...new Set(kinds(read(WIRE)))].sort()
    expect(fromContracts).toEqual([
      /*
       * `no_data` joined the union when the daily empty-window defect was
       * fixed. An unpublished daily bar used to come back as
       * `unknown_symbol`, so a perfectly good ticker read as a bad one every
       * time anyone asked for today's bar during an open session.
       */
      'no_data',
      'not_supported',
      'rate_limited',
      'unavailable',
      'unknown_symbol',
    ])
    // The wire file may USE a subset in its code, but its type must declare all.
    for (const kind of fromContracts) {
      expect(fromWire, `eodhd.ts never produces ${kind}`).toContain(kind)
    }
  })
})
