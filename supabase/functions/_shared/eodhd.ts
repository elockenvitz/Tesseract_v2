/**
 * The EODHD HTTP client and its normalizers. Server-side only.
 *
 * ── Why the vendor's names stop in this file ──────────────────────────────
 *
 * `src/lib/market-data/contracts.ts` states the rule: a vendor's field names
 * stop at the adapter, and `__tests__/vendor-leak.test.ts` enforces it. So
 * `adjusted_close`, `api_token` and `previousClose` appear here and must
 * appear nowhere downstream. What crosses the wire to the browser is already
 * in our vocabulary.
 *
 * ── Why this is not in src/ ───────────────────────────────────────────────
 *
 * The API token. It is a function secret and must never reach the browser
 * bundle, so every EODHD request originates here. The client-side adapter
 * (`src/lib/market-data/eodhd-adapter.ts`) talks to the edge function, never
 * to EODHD.
 *
 * ── UNVERIFIED AGAINST THE LIVE API ───────────────────────────────────────
 *
 * As of 2026-11-16 this code has NEVER been run against EODHD, because
 * `EODHD_AUTHORIZED_USER_IDS` is not configured and the package's own gate
 * says to stop the live connection until it is. The endpoints and field names
 * below are written from EODHD's documented REST shapes; the response parsing
 * is deliberately defensive and every mapping is in one place, so the first
 * live call corrects a normalizer rather than a design.
 *
 * Treat the field mappings as a hypothesis until a live validation run
 * confirms them.
 */

/* ───────────────────────────── wire contract ─────────────────────────────
 *
 * Structurally identical to `src/lib/market-data/contracts.ts`, declared
 * locally rather than imported.
 *
 * The reason is mechanical, not stylistic: `contracts.ts` imports
 * `./freshness` and `./identity` without file extensions, which Deno cannot
 * resolve. Importing it here would break the function at deploy time. These
 * are types only, erased at runtime, and
 * `src/lib/market-data/__tests__/eodhd-adapter.test.ts` asserts the two
 * definitions still line up, so the duplication cannot drift silently.
 */

export type Delivery = 'realtime' | 'delayed' | 'eod' | 'unavailable'

export type Adjustment =
  | 'raw'
  | 'split_adjusted'
  | 'split_and_dividend_adjusted'
  | 'unknown'

export interface ValueSource {
  provider: string
  feed?: string
  via: 'live' | 'cache' | 'derived' | 'manual'
  delivery?: Delivery
}

export interface Observed<T> {
  value: T
  source: ValueSource
  observedAt: string
  effectiveAt: string
  adjustment?: Adjustment
  currency?: string
}

export interface PriceBar {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
}

export interface IntradayBar extends PriceBar {
  /**
   * The instant the bar OPENS, ISO 8601 UTC.
   *
   * `PriceBar.date` is a trading date, which is enough for a daily bar and
   * ambiguous for a five-minute one. `contracts.ts` says an adapter
   * supporting an intraday interval "owes an instant, not a date" — this is
   * that instant. `date` is still populated, as the session date, so a
   * consumer that only understands daily bars degrades to something true
   * rather than something wrong.
   */
  openedAt: string
}

export interface ReferenceRecord {
  symbol: string
  name?: string
  mic?: string
  exchangeLabel?: string
  currency?: string
  country?: string
  securityClass?: string
  isin?: string
  figi?: string
  sector?: string
  industry?: string
  listedByProvider?: boolean
}

export type AdapterFailure =
  | { kind: 'unknown_symbol'; symbol: string }
  | { kind: 'not_supported'; detail: string }
  | { kind: 'rate_limited'; retryAfterMs: number | null }
  | { kind: 'unavailable'; detail: string }

export type AdapterResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: AdapterFailure }

export type BarInterval = '1d' | '1h' | '15m' | '5m' | '1m'

/* ───────────────────────────── configuration ───────────────────────────── */

export const EODHD_BASE = 'https://eodhd.com/api'
export const EODHD_PROVIDER = 'eodhd'

/** A request budget to pace against, not a hard ceiling. */
export const EODHD_REQUESTS_PER_MINUTE = 1000

const REQUEST_TIMEOUT_MS = 12_000

/**
 * Intervals EODHD's intraday endpoint accepts.
 *
 * `15m` is in our `BarInterval` union and EODHD does NOT offer it, so asking
 * for it must return `not_supported` rather than being silently rounded to
 * `5m` or `1h`. Rounding a bar size is the kind of substitution that makes a
 * chart wrong in a way nobody can see.
 */
const INTRADAY_INTERVALS: Record<string, string | null> = {
  '1m': '1m',
  '5m': '5m',
  '1h': '1h',
  '15m': null,
  '1d': null,
}

export function mapIntradayInterval(interval: BarInterval): string | null {
  return INTRADAY_INTERVALS[interval] ?? null
}

/* ───────────────────────────── HTTP plumbing ───────────────────────────── */

export interface EodhdFetchDeps {
  apiToken: string
  /** Injected so tests never reach the network. */
  fetchImpl?: typeof fetch
  now?: () => Date
}

/**
 * One GET against EODHD, with the token added here and nowhere else.
 *
 * The token goes in the query string because that is the only authentication
 * EODHD's REST API accepts. Consequences, handled deliberately:
 *   - the URL is never logged, returned, or included in an error message;
 *   - `redactUrl` exists for the one place a path is useful in a log.
 */
async function eodhdGet(
  path: string,
  params: Record<string, string>,
  deps: EodhdFetchDeps,
): Promise<AdapterResult<unknown>> {
  const doFetch = deps.fetchImpl ?? fetch
  const url = new URL(`${EODHD_BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('api_token', deps.apiToken)
  url.searchParams.set('fmt', 'json')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let response: Response
  try {
    response = await doFetch(url.toString(), { signal: controller.signal })
  } catch (err) {
    // Never include `err` verbatim: a fetch error can echo the request URL,
    // and the request URL carries the token.
    const aborted = err instanceof Error && err.name === 'AbortError'
    return {
      ok: false,
      failure: {
        kind: 'unavailable',
        detail: aborted
          ? `EODHD request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : 'EODHD request failed at the network layer',
      },
    }
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 404) {
    return { ok: false, failure: { kind: 'unknown_symbol', symbol: params.s ?? path } }
  }
  if (response.status === 429) {
    const header = response.headers.get('retry-after')
    const seconds = header ? Number(header) : NaN
    return {
      ok: false,
      failure: {
        kind: 'rate_limited',
        retryAfterMs: Number.isFinite(seconds) ? seconds * 1000 : null,
      },
    }
  }
  if (response.status === 401 || response.status === 403) {
    // Deliberately does not say which, and never echoes the body: a 402 or
    // 403 from EODHD can name the plan and the token.
    return {
      ok: false,
      failure: {
        kind: 'not_supported',
        detail: 'EODHD rejected the request as unauthorized for this plan or token',
      },
    }
  }
  if (!response.ok) {
    return {
      ok: false,
      failure: { kind: 'unavailable', detail: `EODHD responded ${response.status}` },
    }
  }

  try {
    return { ok: true, data: await response.json() }
  } catch {
    return {
      ok: false,
      failure: { kind: 'unavailable', detail: 'EODHD returned a body that is not JSON' },
    }
  }
}

/* ───────────────────────────── normalizers ─────────────────────────────── */

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * A positive number or null. Never zero.
 *
 * Zero is the shape a failed price takes, and this product has already booked
 * eleven trades against a fabricated price. A zero close is dropped as if the
 * bar were absent, because a bar with no close is not a bar.
 */
const positive = (v: unknown): number | null => {
  const n = num(v)
  return n !== null && n > 0 ? n : null
}

interface RawEodBar {
  date?: string
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  adjusted_close?: unknown
  volume?: unknown
}

/**
 * Daily bars, ascending, with unusable rows dropped rather than defaulted.
 *
 * `close` takes the RAW close, not `adjusted_close`. The adjustment basis is
 * declared once on the series (`Observed.adjustment`), and mixing a raw and
 * an adjusted close in one array is how two series stop being comparable.
 */
export function toDailyBars(raw: unknown): PriceBar[] {
  if (!Array.isArray(raw)) return []
  const bars: PriceBar[] = []
  for (const row of raw as RawEodBar[]) {
    const date = typeof row?.date === 'string' ? row.date.slice(0, 10) : null
    const close = positive(row?.close)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || close === null) continue
    bars.push({
      date,
      open: positive(row?.open),
      high: positive(row?.high),
      low: positive(row?.low),
      close,
      volume: num(row?.volume),
    })
  }
  bars.sort((a, b) => a.date.localeCompare(b.date))
  return bars
}

interface RawIntradayBar {
  timestamp?: unknown
  datetime?: unknown
  open?: unknown
  high?: unknown
  low?: unknown
  close?: unknown
  volume?: unknown
}

/**
 * Intraday bars, ascending, each carrying the instant it opens.
 *
 * EODHD returns both a UNIX `timestamp` and a `datetime` string. The
 * timestamp is preferred because it is unambiguous; `datetime` is documented
 * as UTC but is a formatted string, so it is only a fallback and is read as
 * UTC explicitly rather than letting the host time zone decide.
 */
export function toIntradayBars(raw: unknown): IntradayBar[] {
  if (!Array.isArray(raw)) return []
  const bars: IntradayBar[] = []
  for (const row of raw as RawIntradayBar[]) {
    const close = positive(row?.close)
    if (close === null) continue

    let openedAt: string | null = null
    const ts = num(row?.timestamp)
    if (ts !== null && ts > 0) {
      openedAt = new Date(ts * 1000).toISOString()
    } else if (typeof row?.datetime === 'string' && row.datetime.trim()) {
      const iso = row.datetime.trim().replace(' ', 'T')
      const parsed = new Date(iso.endsWith('Z') ? iso : `${iso}Z`)
      if (!Number.isNaN(parsed.getTime())) openedAt = parsed.toISOString()
    }
    if (!openedAt) continue

    bars.push({
      date: openedAt.slice(0, 10),
      openedAt,
      open: positive(row?.open),
      high: positive(row?.high),
      low: positive(row?.low),
      close,
      volume: num(row?.volume),
    })
  }
  bars.sort((a, b) => a.openedAt.localeCompare(b.openedAt))
  return bars
}

interface RawRealTime {
  code?: unknown
  close?: unknown
  previousClose?: unknown
  timestamp?: unknown
}

/**
 * The latest quote, and the instant it was actually true.
 *
 * Two refusals are deliberate:
 *
 *   1. `previousClose` is NEVER used as the price. EODHD returns it alongside
 *      `close`, and the retired `fetch-stock-prices` function did exactly
 *      `regularMarketPrice || previousClose` and published the result as a
 *      current quote. If `close` is absent or non-positive this returns a
 *      failure.
 *   2. `effectiveAt` is never "now". Without a provider timestamp there is no
 *      honest instant to report, so the quote is refused rather than stamped.
 *      `Observed.effectiveAt` says exactly this: never "now" as a convenience.
 *
 * EODHD uses the string `'NA'` for absent numerics, which `positive` rejects.
 */
export function toQuote(
  raw: unknown,
  opts: { delivery: Delivery; currency?: string; observedAt: string },
): AdapterResult<Observed<number>> {
  const row = (raw ?? {}) as RawRealTime
  const price = positive(row.close)
  if (price === null) {
    return {
      ok: false,
      failure: {
        kind: 'unavailable',
        detail: 'EODHD returned no usable last price; previous close is not a substitute',
      },
    }
  }

  const ts = num(row.timestamp)
  if (ts === null || ts <= 0) {
    return {
      ok: false,
      failure: {
        kind: 'unavailable',
        detail: 'EODHD returned a price with no timestamp; refusing to stamp it with now',
      },
    }
  }

  return {
    ok: true,
    data: {
      value: price,
      source: {
        provider: EODHD_PROVIDER,
        feed: 'real-time',
        via: 'live',
        delivery: opts.delivery,
      },
      observedAt: opts.observedAt,
      effectiveAt: new Date(ts * 1000).toISOString(),
      currency: opts.currency,
    },
  }
}

interface RawSearchHit {
  Code?: unknown
  Exchange?: unknown
  Name?: unknown
  Type?: unknown
  Currency?: unknown
  Country?: unknown
  ISIN?: unknown
  previousClose?: unknown
}

const SECURITY_CLASS_BY_TYPE: Record<string, string> = {
  'common stock': 'stock',
  'preferred stock': 'preferred',
  stock: 'stock',
  etf: 'etf',
  fund: 'mutual_fund',
  'mutual fund': 'mutual_fund',
  index: 'index',
  bond: 'bond',
  currency: 'forex',
  crypto: 'crypto',
  commodity: 'commodity',
}

/**
 * Search hits as reference records, best first, order preserved.
 *
 * `mic` is deliberately NOT populated. EODHD returns its own exchange code
 * (`US`, `TO`, `LSE`, `XETRA`), which is not ISO 10383 — `LSE` is not
 * `XLON`. `contracts.ts` reserves `mic` for a real MIC and says free-text
 * venue names belong in `exchangeLabel`, explicitly untrusted for identity.
 * Putting a vendor code in `mic` would poison the one field joins rely on.
 */
export function toReferenceRecords(raw: unknown): ReferenceRecord[] {
  if (!Array.isArray(raw)) return []
  const out: ReferenceRecord[] = []
  for (const hit of raw as RawSearchHit[]) {
    const code = typeof hit?.Code === 'string' ? hit.Code.trim() : ''
    if (!code) continue
    const exchange = typeof hit?.Exchange === 'string' ? hit.Exchange.trim() : ''
    const type = typeof hit?.Type === 'string' ? hit.Type.trim().toLowerCase() : ''
    const isin = typeof hit?.ISIN === 'string' ? hit.ISIN.trim() : ''

    out.push({
      symbol: exchange ? `${code}.${exchange}` : code,
      name: typeof hit?.Name === 'string' ? hit.Name : undefined,
      exchangeLabel: exchange || undefined,
      currency: typeof hit?.Currency === 'string' ? hit.Currency : undefined,
      country: typeof hit?.Country === 'string' ? hit.Country : undefined,
      securityClass: SECURITY_CLASS_BY_TYPE[type] ?? (type ? 'unknown' : undefined),
      isin: isin || undefined,
      listedByProvider: true,
    })
  }
  return out
}

/**
 * How EODHD delivers a quote for a given symbol.
 *
 * Conservative by construction: `delayed` unless proven otherwise. The
 * ALL-IN-ONE plan's `real-time` endpoint is documented as delayed for most
 * venues, and whether any given exchange is genuinely real-time depends on
 * per-exchange licensing that a response body does not state. Labelling a
 * delayed feed "live" would be a claim the subscription does not support, and
 * `ValueSource.delivery` exists precisely so that claim is explicit.
 *
 * This returns `'delayed'` for everything until a live validation run
 * establishes otherwise per venue.
 *
 * It takes NO argument on purpose. An earlier version accepted `symbol` and
 * ignored it, which advertised per-venue classification that does not exist.
 * When the live run establishes which exchanges are genuinely real-time, the
 * parameter comes back and the lookup goes here — and every caller will have
 * to be revisited anyway, because that is a licensing change.
 */
export function classifyDelivery(): Delivery {
  return 'delayed'
}

/** The EODHD exchange suffix, e.g. `AAPL.US` -> `US`. */
export function exchangeSuffix(symbol: string): string | null {
  const idx = symbol.lastIndexOf('.')
  if (idx <= 0 || idx === symbol.length - 1) return null
  return symbol.slice(idx + 1).toUpperCase()
}

/* ───────────────────────────── operations ─────────────────────────────── */

export async function fetchDailyBars(
  symbol: string,
  from: string,
  to: string,
  deps: EodhdFetchDeps,
): Promise<AdapterResult<Observed<PriceBar[]>>> {
  const now = (deps.now ?? (() => new Date()))()
  const res = await eodhdGet(`eod/${encodeURIComponent(symbol)}`, { from, to, period: 'd' }, deps)
  if (!res.ok) return res

  const bars = toDailyBars(res.data)
  if (bars.length === 0) {
    return {
      ok: false,
      failure: { kind: 'unknown_symbol', symbol },
    }
  }

  return {
    ok: true,
    data: {
      value: bars,
      source: { provider: EODHD_PROVIDER, feed: 'eod', via: 'live', delivery: 'eod' },
      observedAt: now.toISOString(),
      // The last bar's trading date is the instant the series is true as of.
      effectiveAt: `${bars[bars.length - 1].date}T00:00:00.000Z`,
      // EODHD's `close` is the raw close; `adjusted_close` is a separate
      // field this adapter deliberately does not read.
      adjustment: 'raw',
    },
  }
}

export async function fetchIntradayBars(
  symbol: string,
  interval: BarInterval,
  fromUnix: number,
  toUnix: number,
  deps: EodhdFetchDeps,
): Promise<AdapterResult<Observed<IntradayBar[]>>> {
  const mapped = mapIntradayInterval(interval)
  if (!mapped) {
    return {
      ok: false,
      failure: {
        kind: 'not_supported',
        detail: `EODHD does not offer a ${interval} intraday bar (supported: 1m, 5m, 1h)`,
      },
    }
  }

  const now = (deps.now ?? (() => new Date()))()
  const res = await eodhdGet(
    `intraday/${encodeURIComponent(symbol)}`,
    { interval: mapped, from: String(fromUnix), to: String(toUnix) },
    deps,
  )
  if (!res.ok) return res

  const bars = toIntradayBars(res.data)
  if (bars.length === 0) {
    // Not `unknown_symbol`: intraday coverage varies by venue, and an empty
    // intraday response for a symbol whose daily history exists means the
    // VENUE is not covered, which must not read as a bad ticker.
    return {
      ok: false,
      failure: {
        kind: 'not_supported',
        detail: `EODHD returned no ${interval} intraday bars for ${symbol}; intraday coverage is per-exchange`,
      },
    }
  }

  return {
    ok: true,
    data: {
      value: bars,
      source: {
        provider: EODHD_PROVIDER,
        feed: `intraday-${mapped}`,
        via: 'live',
        delivery: 'delayed',
      },
      observedAt: now.toISOString(),
      effectiveAt: bars[bars.length - 1].openedAt,
      adjustment: 'raw',
    },
  }
}

export async function fetchLatestQuote(
  symbol: string,
  deps: EodhdFetchDeps,
  currency?: string,
): Promise<AdapterResult<Observed<number>>> {
  const now = (deps.now ?? (() => new Date()))()
  const res = await eodhdGet(`real-time/${encodeURIComponent(symbol)}`, {}, deps)
  if (!res.ok) return res
  return toQuote(res.data, {
    delivery: classifyDelivery(),
    currency,
    observedAt: now.toISOString(),
  })
}

export async function searchSymbols(
  query: string,
  limit: number,
  deps: EodhdFetchDeps,
): Promise<AdapterResult<ReferenceRecord[]>> {
  const res = await eodhdGet(
    `search/${encodeURIComponent(query)}`,
    { limit: String(Math.max(1, Math.min(limit, 50))) },
    deps,
  )
  if (!res.ok) return res
  return { ok: true, data: toReferenceRecords(res.data) }
}
