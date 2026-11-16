/**
 * EODHD as a `ProviderAdapter`.
 *
 * ── It never talks to EODHD ───────────────────────────────────────────────
 *
 * Every call goes to the `eodhd-market-data` edge function, which holds the
 * API token and performs the entitlement check. This file runs in the browser
 * bundle, so it must not know a credential and must not be the thing that
 * decides whether the caller is allowed — it cannot be trusted to, because
 * the party being authorized can edit it.
 *
 * A 403 from the function is therefore a normal, expected result for anyone
 * who is not the single authorized seat, and is mapped to `not_supported`
 * rather than thrown: an unentitled provider is not an outage, and must not
 * trigger a retry ladder.
 *
 * ── It is not wired to anything ───────────────────────────────────────────
 *
 * Package 1 builds and validates the adapter. No application consumer reads
 * from it yet: `browser-client.ts` and the `price_history_cache` readers are
 * untouched, and there is no fallback between them and this. Switching
 * consumers is Package 2 and needs the licensing question answered first,
 * because today exactly one user is entitled and the other 27 organizations
 * are not.
 */

import { supabase } from '../supabase'
import type {
  AdapterCapabilities,
  AdapterFailure,
  AdapterResult,
  BarsRequest,
  PriceQuote,
  PriceSeries,
  ProviderAdapter,
  ReferenceRecord,
} from './contracts'
import type { Retrieved } from './freshness'
import type { SecurityClass } from './identity'

/** The one function this adapter reaches. */
export const EODHD_FUNCTION = 'eodhd-market-data'

/**
 * How the edge function is called.
 *
 * Injected so tests exercise the mapping without a network or a session, and
 * so the live validation script can supply its own invoker.
 */
export type EodhdInvoker = (
  body: Record<string, unknown>,
) => Promise<{ data: unknown; error: unknown }>

const defaultInvoker: EodhdInvoker = async body => {
  const { data, error } = await supabase.functions.invoke(EODHD_FUNCTION, { body })
  return { data, error }
}

const SUPPORTED_CLASSES: readonly SecurityClass[] = [
  'stock',
  'etf',
  'mutual_fund',
  'index',
  'bond',
  'forex',
  'crypto',
  'commodity',
  'preferred',
]

export const EODHD_CAPABILITIES: AdapterCapabilities = {
  /*
   * Empty, and that is a statement.
   *
   * `AdapterCapabilities.venues` is a list of MICs, and "empty means the
   * adapter does not say, not 'all'". EODHD returns its own exchange codes
   * (`US`, `TO`, `LSE`, `XETRA`), which are not ISO 10383 — `LSE` is not
   * `XLON`. Mapping them would be a guess, and a wrong MIC is worse than no
   * MIC because joins trust it.
   */
  venues: [],
  securityClasses: SUPPORTED_CLASSES,
  referenceData: true,
  spotQuote: true,
  dailyBars: true,
  /*
   * EODHD's `eod` endpoint returns both `close` and `adjusted_close`. The
   * adapter reads the RAW close, so the series is raw. A consumer that wants
   * a split-adjusted series must ask for it explicitly rather than discover
   * that two series were on different bases.
   */
  barAdjustment: 'raw',
  identifiers: ['isin'],
  /*
   * A pacing budget, not a ceiling. EODHD's published limit is per-day with a
   * per-minute burst cap; this is the burst figure, which is what a scheduler
   * needs. UNVERIFIED against the live account until a validation run.
   */
  requestsPerMinute: 1000,
}

/**
 * Recognise the agreed wire shape, or return null.
 *
 * Null means "this is not an answer", which the caller turns into a failure.
 * It deliberately does not coerce: a 200 carrying something unexpected is a
 * failure, never an empty success.
 */
function asAdapterResult<T>(data: unknown): AdapterResult<T> | null {
  if (!data || typeof data !== 'object') return null
  const row = data as Record<string, unknown>
  if (row.ok === true && 'data' in row) return { ok: true, data: row.data as T }
  if (row.ok === false && row.failure && typeof row.failure === 'object') {
    return { ok: false, failure: row.failure as AdapterFailure }
  }
  return null
}

/**
 * Turn an invoke error into a typed failure.
 *
 * `functions.invoke` reports a non-2xx as an error with the body attached in
 * varying shapes depending on version, so the status is recovered defensively
 * and anything unrecognised becomes `unavailable` — never `ok`.
 */
function failureFromInvokeError(error: unknown): AdapterResult<never> {
  const err = (error ?? {}) as Record<string, unknown>
  const ctx = (err.context ?? {}) as Record<string, unknown>
  const status = Number(err.status ?? ctx.status ?? NaN)

  if (status === 403) {
    return {
      ok: false,
      failure: {
        kind: 'not_supported',
        detail: 'This account is not entitled to EODHD',
      },
    }
  }
  if (status === 503) {
    return {
      ok: false,
      failure: {
        kind: 'not_supported',
        detail: 'EODHD is not configured on the server',
      },
    }
  }
  if (status === 401) {
    return {
      ok: false,
      failure: { kind: 'unavailable', detail: 'Not signed in' },
    }
  }
  if (status === 429) {
    return { ok: false, failure: { kind: 'rate_limited', retryAfterMs: null } }
  }
  return {
    ok: false,
    failure: { kind: 'unavailable', detail: 'EODHD request did not complete' },
  }
}

export function createEodhdAdapter(invoke: EodhdInvoker = defaultInvoker): ProviderAdapter {
  async function call<T>(body: Record<string, unknown>): Promise<AdapterResult<T>> {
    let response: { data: unknown; error: unknown }
    try {
      response = await invoke(body)
    } catch {
      return {
        ok: false,
        failure: { kind: 'unavailable', detail: 'EODHD request threw' },
      }
    }

    if (response.error) return failureFromInvokeError(response.error)

    const parsed = asAdapterResult<T>(response.data)
    if (parsed) return parsed

    // A 200 whose body is not the agreed shape is a failure, not an empty
    // success. `data || []` faking an empty result is a documented defect
    // class in this codebase.
    return {
      ok: false,
      failure: {
        kind: 'unavailable',
        detail: 'EODHD returned an unrecognised response shape',
      },
    }
  }

  return {
    name: 'eodhd',
    capabilities: EODHD_CAPABILITIES,

    resolve(query: string, limit = 10) {
      return call<ReferenceRecord[]>({ op: 'resolve', query, limit })
    },

    reference(symbol: string) {
      // `Retrieved`, not `Observed`: a search payload states an exchange and a
      // currency but never says when they became true, so there is no honest
      // `effectiveAt` to return. See `ProviderAdapter.reference`.
      return call<Retrieved<ReferenceRecord>>({ op: 'reference', symbol })
    },

    latest(symbol: string) {
      return call<PriceQuote>({ op: 'latest', symbol })
    },

    bars(request: BarsRequest) {
      /*
       * `interval` is forwarded, including the ones EODHD does not offer.
       *
       * `15m` is in our `BarInterval` union and EODHD has no 15-minute bar.
       * The server returns `not_supported` for it rather than rounding to
       * `5m` or `1h`, because a silently substituted bar size produces a
       * chart that is wrong in a way nobody can see.
       */
      return call<PriceSeries>({
        op: 'bars',
        symbol: request.symbol,
        from: request.from,
        to: request.to,
        interval: request.interval ?? '1d',
      })
    },
  }
}
