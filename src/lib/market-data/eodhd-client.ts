/**
 * Browser-side calls to the EODHD edge function.
 *
 * Thin on purpose: it invokes the function through the standard Supabase
 * client, so the caller's session JWT is attached by supabase-js and no code
 * here ever touches a token. There is no API key in this file and none in the
 * bundle; the provider credential lives only as a function secret.
 *
 * ── The isolation rule this file is written to keep ───────────────────────
 *
 * Nothing here writes anywhere. No table, no `price_history_cache`, no
 * localStorage, no module-level cache shared between symbols or users. The
 * only place a response is held is the React Query cache of the one browser
 * tab that asked, under a key that includes the provider — so an unentitled
 * session cannot read an entitled session's answer even in the same tab after
 * a user switch.
 */
import { supabase } from '../supabase'
import type { AdapterFailure, BarInterval, ReferenceRecord } from './contracts'
import type {
  EodhdEnvelope,
  EodhdIntradayBar,
  EodhdPriceBar,
  EodhdResult,
} from './eodhd-series'

export const EODHD_FUNCTION = 'eodhd-market-data'

export interface ExchangeRecord {
  code: string
  name?: string
  country?: string
  currency?: string
  operatingMic?: string
}

/**
 * Normalise whatever came back into a result, or a typed failure.
 *
 * An unrecognised body is a FAILURE, never an empty success. Returning `[]`
 * for a response we could not read would show an empty chart that looks like
 * "this instrument has no history" instead of "we could not read the reply".
 */
function asResult<T>(data: unknown, error: unknown): EodhdResult<T> {
  if (error) {
    const status = (error as { context?: { status?: number } })?.context?.status
    return { ok: false, failure: failureForStatus(status) }
  }

  const row = data as { ok?: unknown; failure?: unknown; data?: unknown } | null
  if (row?.ok === true && 'data' in (row ?? {})) {
    return { ok: true, data: row!.data as T }
  }
  if (row?.ok === false && row.failure) {
    return { ok: false, failure: row.failure as AdapterFailure }
  }
  return {
    ok: false,
    failure: { kind: 'unavailable', detail: 'Unrecognised response from the market-data function' },
  }
}

/**
 * HTTP status to failure kind.
 *
 * 403 is `not_supported`, not `unavailable`: an unentitled seat is a
 * permanent answer for this session, and marking it retryable would have the
 * UI poll a licence boundary. 503 likewise — the deployment is incomplete and
 * retrying will not complete it.
 */
function failureForStatus(status: number | undefined): AdapterFailure {
  if (status === 403) {
    return { kind: 'not_supported', detail: 'This account is not entitled to EODHD' }
  }
  if (status === 503) {
    return { kind: 'not_supported', detail: 'EODHD is not configured for this deployment' }
  }
  if (status === 401) {
    return { kind: 'unavailable', detail: 'Not signed in' }
  }
  if (status === 429) {
    return { kind: 'rate_limited', retryAfterMs: null }
  }
  return { kind: 'unavailable', detail: 'The market-data function did not answer' }
}

async function call<T>(body: Record<string, unknown>): Promise<EodhdResult<T>> {
  const { data, error } = await supabase.functions.invoke(EODHD_FUNCTION, { body })
  return asResult<T>(data, error)
}

/** Candidate instruments for a query, best first. Never picks. */
export function eodhdResolve(query: string, limit = 10) {
  return call<ReferenceRecord[]>({ op: 'resolve', query, limit })
}

/** Reference data for one exact symbol. The only source of a trading unit. */
export function eodhdReference(symbol: string) {
  return call<{ value: ReferenceRecord; source: unknown; observedAt: string }>({
    op: 'reference',
    symbol,
  })
}

/** The latest delayed price. Carries no currency: see `eodhdReference`. */
export function eodhdLatest(symbol: string) {
  return call<EodhdEnvelope<number>>({ op: 'latest', symbol })
}

/** Daily or intraday bars over an inclusive date window. */
export function eodhdBars(args: {
  symbol: string
  from: string
  to: string
  interval: BarInterval
}) {
  return call<EodhdEnvelope<EodhdPriceBar[] | EodhdIntradayBar[]>>({
    op: 'bars',
    symbol: args.symbol,
    from: args.from,
    to: args.to,
    interval: args.interval,
  })
}

/** The venues the subscription can address. Used for symbol discovery. */
export function eodhdExchanges() {
  return call<ExchangeRecord[]>({ op: 'exchanges' })
}
