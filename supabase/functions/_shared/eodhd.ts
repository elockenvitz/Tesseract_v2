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

export type EffectivePrecision = 'instant' | 'session_date'

export interface CurrencyUnit {
  code: string
  majorCode: string
  minorPerMajor: number
}

/** No claim about when the value was true. Reference data is the case. */
export interface Retrieved<T> {
  value: T
  source: ValueSource
  observedAt: string
}

export interface Observed<T> extends Retrieved<T> {
  effectiveAt: string
  effectiveAtPrecision?: EffectivePrecision
  adjustment?: Adjustment
  currency?: string
  currencyUnit?: CurrencyUnit
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
  /** ISO 4217 only. A minor unit goes in `currencyUnit`. */
  currency?: string
  currencyUnit?: CurrencyUnit
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
  | { kind: 'no_data'; detail: string }
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

/**
 * The widest from-to window EODHD serves per intraday interval, in days.
 *
 * Documented per interval rather than per plan. Keyed by the PROVIDER's
 * interval string, so it is looked up after `mapIntradayInterval`.
 */
export const INTRADAY_MAX_SPAN_DAYS: Record<string, number> = {
  '1m': 120,
  '5m': 600,
  '1h': 7200,
}

/** The widest window a caller may ask for, in our own interval vocabulary. */
export function maxIntradaySpanDays(interval: BarInterval): number | null {
  const mapped = mapIntradayInterval(interval)
  return mapped ? (INTRADAY_MAX_SPAN_DAYS[mapped] ?? null) : null
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
  opts: { delivery: Delivery; observedAt: string },
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
      /*
       * EODHD's `timestamp` is the instant of the LAST TRADE, not the instant
       * the snapshot was generated. Those differ, and the difference is not a
       * fault: on a delayed feed a thinly traded name can legitimately report
       * a last trade from well beyond the feed's own delay, because no trade
       * has happened since. So this is the honest `effectiveAt` -- the price
       * really was true then -- but the gap between it and `observedAt`
       * measures feed delay PLUS trade sparsity, and must not be read as the
       * feed's delay alone.
       */
      effectiveAt: new Date(ts * 1000).toISOString(),
      /*
       * No currency. The provider did not say, and the caller is not a
       * source. See `fetchLatestQuote`.
       */
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

/**
 * Vendor quoting codes that are MINOR units, not ISO 4217 currencies.
 *
 * EODHD's own corporate-actions documentation is explicit that London tickers
 * are quoted in pence and reported as `GBX`, while the dividends it returns
 * for those same tickers are in POUNDS. So a single instrument carries two
 * units inside one provider, and nothing in the payload warns you. That is
 * the misvaluation path: pence prices and pound dividends summed together, or
 * a pence price shown as £.
 *
 * Keyed lowercase because vendors are inconsistent about case (`GBX`, `GBp`).
 */
const PENCE: CurrencyUnit = { code: 'GBX', majorCode: 'GBP', minorPerMajor: 100 }

/**
 * Codes whose MEANING depends on their case, matched exactly.
 *
 * `GBp` is pence and `GBP` is pounds, and the only thing separating them is
 * one lowercase letter. Any case-insensitive lookup collapses the two, which
 * is a hundredfold error in whichever direction it lands. So these are
 * compared case-sensitively, before the case-insensitive table.
 */
const MINOR_UNIT_EXACT: Record<string, CurrencyUnit> = {
  GBp: PENCE,
  ZAc: { code: 'ZAc', majorCode: 'ZAR', minorPerMajor: 100 },
}

/**
 * Codes that are unambiguous whatever their case, because the uppercase
 * spelling is not itself an ISO 4217 currency: there is no `GBX`, `ZAC` or
 * `ILA` to be confused with.
 */
const MINOR_UNIT_ANY_CASE: Record<string, CurrencyUnit> = {
  gbx: PENCE,
  zac: { code: 'ZAc', majorCode: 'ZAR', minorPerMajor: 100 },
  ila: { code: 'ILA', majorCode: 'ILS', minorPerMajor: 100 },
}

/**
 * Split a vendor currency string into an ISO 4217 code and, if the vendor
 * quotes in a minor unit, the unit that says so.
 *
 * An unrecognised code is returned as-is with no unit rather than guessed at:
 * a wrong `minorPerMajor` is worse than an unknown one, because a consumer
 * will divide by it.
 */
export function classifyQuotingCurrency(
  raw: unknown,
): { currency?: string; currencyUnit?: CurrencyUnit } {
  if (typeof raw !== 'string') return {}
  const code = raw.trim()
  if (!code) return {}
  // Case-sensitive first: GBp is pence, GBP is pounds.
  const exact = MINOR_UNIT_EXACT[code]
  if (exact) return { currency: exact.majorCode, currencyUnit: exact }

  const anyCase = MINOR_UNIT_ANY_CASE[code.toLowerCase()]
  if (anyCase) return { currency: anyCase.majorCode, currencyUnit: anyCase }

  return { currency: code.toUpperCase() }
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
      // GBX becomes GBP + a pence unit here, rather than travelling onward as
      // a currency code that is not in ISO 4217.
      ...classifyQuotingCurrency(hit?.Currency),
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
    /*
     * Empty is NOT a bad ticker.
     *
     * This returned `unknown_symbol`, and that was wrong in a way that showed
     * up the moment anyone asked for today's bar during an open session:
     * EODHD has not published it yet, so the list comes back empty and a
     * perfectly good ticker was reported as unknown. A weekend, a holiday or
     * any window before a listing's first trade does the same thing.
     *
     * EODHD answers 404 for a symbol it does not know, and `eodhdGet` already
     * maps that to `unknown_symbol`. So reaching here with a 200 means the
     * symbol EXISTS and the window is empty, which is `no_data` -- a distinct
     * kind, carrying the window, so a caller can widen it rather than
     * concluding the instrument is wrong.
     */
    return {
      ok: false,
      failure: {
        kind: 'no_data',
        detail:
          `EODHD published no daily bars for ${symbol} between ${from} and ${to}. `
          + 'The symbol resolved, so this is an empty window: today before '
          + 'publication, a non-trading day, or a period before first trade.',
      },
    }
  }

  return {
    ok: true,
    data: {
      value: bars,
      source: { provider: EODHD_PROVIDER, feed: 'eod', via: 'live', delivery: 'eod' },
      observedAt: now.toISOString(),
      /*
       * Midnight UTC of the last bar's trading date -- a LOWER BOUND, not the
       * closing bell.
       *
       * We do not know when that session closed: EODHD's EOD payload carries
       * a date and no time, and this codebase deliberately has no exchange
       * calendar to ask. Midnight UTC of the trading date is safe in one
       * specific direction. Every venue's closing bell falls later in the UTC
       * day than 00:00Z -- New York closes 21:00Z, London 16:30Z, Tokyo
       * 06:00Z, Auckland 04:00Z -- so an age measured from here is always an
       * OVER-estimate and a freshness check can only fail safe. It is
       * labelled `session_date` so nothing mistakes it for the real instant.
       */
      effectiveAt: `${bars[bars.length - 1].date}T00:00:00.000Z`,
      effectiveAtPrecision: 'session_date',
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

  /*
   * EODHD caps the from-to window per interval, and exceeding it is refused
   * at the provider -- which would surface here as a vague `unavailable`
   * instead of the real reason. Saying it plainly costs nothing and saves the
   * caller guessing.
   *
   * The caps are documented per interval, not per plan: 1m 120 days, 5m 600
   * days, 1h 7200 days.
   */
  const spanDays = (toUnix - fromUnix) / 86_400
  const cap = INTRADAY_MAX_SPAN_DAYS[mapped]
  if (cap && spanDays > cap) {
    return {
      ok: false,
      failure: {
        kind: 'not_supported',
        detail:
          `EODHD serves at most ${cap} days of ${mapped} bars per request; `
          + `${Math.ceil(spanDays)} were asked for. Narrow the window or page it.`,
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

/**
 * The latest price. It carries NO currency, and that is deliberate.
 *
 * This took a `currency?: string` argument, fed straight from the request
 * body. EODHD's `real-time` endpoint returns no currency field at all, so the
 * value being stamped onto the price as provenance came from the CALLER —
 * which means a caller could label a London pence price `GBP` and the
 * envelope would carry that claim as though the provider had said it. For
 * SHEL.LSE that is a hundredfold overvaluation with a provenance trail
 * pointing at EODHD.
 *
 * The provider does not say, so we do not say. A consumer that needs the unit
 * asks `reference`, which reads it from the provider's own search payload and
 * returns `currency` plus `currencyUnit`.
 */
export async function fetchLatestQuote(
  symbol: string,
  deps: EodhdFetchDeps,
): Promise<AdapterResult<Observed<number>>> {
  const now = (deps.now ?? (() => new Date()))()
  const res = await eodhdGet(`real-time/${encodeURIComponent(symbol)}`, {}, deps)
  if (!res.ok) return res
  return toQuote(res.data, {
    delivery: classifyDelivery(),
    observedAt: now.toISOString(),
  })
}

interface RawExchange {
  Name?: unknown
  Code?: unknown
  OperatingMIC?: unknown
  Country?: unknown
  Currency?: unknown
  CountryISO2?: unknown
}

export interface ExchangeRecord {
  /** The code to suffix a ticker with, e.g. `LSE` in `SHEL.LSE`. */
  code: string
  name?: string
  country?: string
  /** ISO 4217 after minor-unit splitting. */
  currency?: string
  currencyUnit?: CurrencyUnit
  /**
   * The operating MIC as the provider reports it.
   *
   * Carried separately from `code` and NOT copied into `ReferenceRecord.mic`,
   * because EODHD returns comma-separated lists here for some venues and a
   * half-parsed MIC is worse than none.
   */
  operatingMic?: string
}

/**
 * The venues the subscription can actually address.
 *
 * This exists because guessing a suffix is how you conclude a market is not
 * covered when the ticker was simply spelled wrong. `7203.TSE` returning
 * `unknown_symbol` does not distinguish "Tokyo is not in this plan" from
 * "Tokyo is not called TSE here", and only the provider can say which.
 */
export async function fetchExchanges(
  deps: EodhdFetchDeps,
): Promise<AdapterResult<ExchangeRecord[]>> {
  const res = await eodhdGet('exchanges-list/', {}, deps)
  if (!res.ok) return res
  if (!Array.isArray(res.data)) {
    return { ok: false, failure: { kind: 'unavailable', detail: 'exchange list was not a list' } }
  }
  const out: ExchangeRecord[] = []
  for (const row of res.data as RawExchange[]) {
    const code = typeof row?.Code === 'string' ? row.Code.trim() : ''
    if (!code) continue
    out.push({
      code,
      name: typeof row?.Name === 'string' ? row.Name : undefined,
      country: typeof row?.Country === 'string' ? row.Country : undefined,
      operatingMic: typeof row?.OperatingMIC === 'string' ? row.OperatingMIC : undefined,
      ...classifyQuotingCurrency(row?.Currency),
    })
  }
  out.sort((a, b) => a.code.localeCompare(b.code))
  return { ok: true, data: out }
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
