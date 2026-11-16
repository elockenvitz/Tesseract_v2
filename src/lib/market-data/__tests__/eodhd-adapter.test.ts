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
  exchangeSuffix,
} from '../../../../supabase/functions/_shared/eodhd'
import {
  decideMarketDataAccess,
  entitlementConfigFromEnv,
} from '../../../../supabase/functions/_shared/market-data-entitlement'

const OBSERVED_AT = '2026-11-16T20:00:00.000Z'

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

describe('toQuote', () => {
  const ts = Math.floor(Date.parse('2026-11-16T19:55:00Z') / 1000)

  it('maps a quote and reports the provider instant, not now', () => {
    const r = toQuote({ code: 'AAPL.US', close: 332.89, previousClose: 330.1, timestamp: ts }, {
      delivery: 'delayed',
      currency: 'USD',
      observedAt: OBSERVED_AT,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.value).toBe(332.89)
    expect(r.data.effectiveAt).toBe('2026-11-16T19:55:00.000Z')
    expect(r.data.observedAt).toBe(OBSERVED_AT)
    expect(r.data.currency).toBe('USD')
    expect(r.data.source.delivery).toBe('delayed')
    expect(r.data.source.provider).toBe('eodhd')
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
    expect(r.currency).toBe('GBX')
    expect(r.securityClass).toBe('stock')
    expect(r.isin).toBe('GB00BP6MXD84')
    expect(r.listedByProvider).toBe(true)
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
