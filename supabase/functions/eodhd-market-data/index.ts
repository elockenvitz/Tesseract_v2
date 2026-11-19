/**
 * EODHD market data, for one authorized seat.
 *
 * ── The order of operations is the security property ──────────────────────
 *
 *   1. verify identity from the caller's JWT, server-side
 *   2. read the entitlement allowlist from a function secret
 *   3. decide, default-deny
 *   4. ONLY THEN touch EODHD
 *
 * Nothing reaches step 4 without passing step 3. An unauthorized caller costs
 * zero provider requests, which matters because the subscription is metered
 * and single-seat.
 *
 * ── What this function will not do ────────────────────────────────────────
 *
 *  - It does not write to `price_history_cache`, or to any other table. That
 *    table has no `organization_id` and its only policy is
 *    `SELECT USING (auth.uid() IS NOT NULL)`, so one row would publish a
 *    per-seat subscription to every authenticated user in all 28
 *    organizations. There is no Supabase client here with write capability
 *    and no service-role key is read.
 *  - It does not fall back to Yahoo, or to anything else. A failure is
 *    returned as a typed failure.
 *  - It does not fabricate a price. No zero, no previous-close substitution,
 *    no `effectiveAt: now`.
 *  - It does not serve `anon`. `verify_jwt` is on by default and the
 *    entitlement check refuses a null identity regardless.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { authorizeVerifiedUser } from '../_shared/verified-user.ts'
import { requirePublishableKey } from '../_shared/publishable-key.ts'
import {
  decideMarketDataAccess,
  entitlementConfigFromEnv,
  EODHD_AUTHORIZED_USER_IDS_VAR,
} from '../_shared/market-data-entitlement.ts'
import {
  fetchDailyBars,
  fetchExchanges,
  fetchIntradayBars,
  fetchLatestQuote,
  fetchSplits,
  searchSymbols,
  type BarInterval,
  type EodhdFetchDeps,
} from '../_shared/eodhd.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })

type Operation =
  | 'entitlement' | 'exchanges' | 'resolve' | 'reference' | 'latest' | 'bars'
  /**
   * The split ratios for an instrument, so the client can restate a raw
   * series in current shares. Same entitlement gate as every other data
   * operation: it is provider data, and it is paid for.
   */
  | 'splits'

interface RequestBody {
  op?: unknown
  symbol?: unknown
  query?: unknown
  limit?: unknown
  from?: unknown
  to?: unknown
  interval?: unknown
  /*
   * There is deliberately no `currency` field.
   *
   * It used to exist and was passed through to the quote envelope, which made
   * a CALLER the source of a price's unit while the provenance still said
   * EODHD. A caller could label a London pence price `GBP` -- a hundredfold
   * overvaluation carrying a provider's name. The unit now comes only from
   * the provider's own payload, via the `reference` operation.
   */
}

const isIsoDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  /* ── 1. identity, verified server-side ───────────────────────────────── */

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  if (!supabaseUrl) {
    return json({ error: 'Function is misconfigured' }, 500)
  }

  /*
   * A publishable key, not `SUPABASE_ANON_KEY`.
   *
   * The legacy variable is being retired across this project — only
   * `attention` still reads it, and `edge-publishable-key.test.ts` sweeps the
   * whole function tree to keep that true. Reaching for the legacy key here
   * would have made this the fourth consumer of a key path that already
   * caused one ingestion outage.
   *
   * `requirePublishableKey` throws a message naming the variable when it is
   * absent or has no `default` entry, which surfaces as a configuration error
   * rather than as a confusing 401 later.
   */
  let publishableKey: string
  try {
    publishableKey = requirePublishableKey(n => Deno.env.get(n))
  } catch (err) {
    return json(
      {
        error: 'Function is misconfigured',
        detail: err instanceof Error ? err.message : 'publishable key unavailable',
      },
      500,
    )
  }

  /*
   * `authorizeVerifiedUser` calls `getUser(token)` with the token as an
   * ARGUMENT. That is load-bearing: `getUser()` with no argument reads a
   * stored session and would authenticate the wrong principal. See
   * `_shared/verified-user.ts`.
   */
  const userClient = createClient(supabaseUrl, publishableKey)
  const auth = await authorizeVerifiedUser(req.headers.get('Authorization'), userClient)
  if (!auth.ok) {
    return json({ error: auth.error }, auth.status)
  }

  /*
   * The body is read here, before entitlement, because the `entitlement`
   * operation has to be answerable by a caller who is NOT entitled -- that is
   * its entire purpose. Reading JSON costs no provider request, so nothing
   * about the ordering property below changes.
   */
  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }
  const op = body.op as Operation

  /* ── 2 + 3. entitlement, before any provider request ─────────────────── */

  const configResult = entitlementConfigFromEnv(k => Deno.env.get(k))

  /*
   * A missing allowlist is not an entitled caller. Expressing it as a denial
   * here, rather than returning early, means the `entitlement` probe can
   * report "no" with a reason instead of a 503 that a frontend would have to
   * interpret -- while the data operations below still get their 503.
   */
  const decision = configResult.ok
    ? decideMarketDataAccess(
      {
        subject: { verifiedUserId: auth.user.id },
        provider: 'eodhd',
        // Every operation here serves the requesting user, looking at it now.
        // No caller may ask this function to populate a shared cache, feed AI
        // retrieval, or stand in as a fallback: those uses are refused by
        // `decideMarketDataAccess` and are not reachable from this endpoint.
        use: 'interactive_read',
      },
      configResult.config,
    )
    : { allowed: false as const, reason: 'not_configured' as const }

  /*
   * The entitlement probe. It answers for EVERY verified caller, entitled or
   * not, and makes no provider request of any kind -- so an unentitled user
   * asking "may I?" costs nothing and leaks nothing: the reply names no
   * allowlist and no other account.
   *
   * This exists so the frontend can route on SERVER-VERIFIED state instead of
   * comparing a user id or an email in the browser. The browser is told only
   * yes or no, and the yes is still re-decided here on every data request.
   */
  if (op === 'entitlement') {
    return json({
      ok: true,
      data: {
        provider: 'eodhd',
        entitled: decision.allowed,
        reason: decision.allowed ? undefined : decision.reason,
      },
    })
  }

  if (!configResult.ok) {
    /*
     * 503, not 403. The caller is not at fault and retrying will not help —
     * the deployment is incomplete. Saying so plainly is the difference
     * between a five-minute fix and an afternoon of debugging a silent deny.
     */
    return json(
      {
        error: 'EODHD is not configured',
        reason: configResult.reason,
        detail: configResult.detail,
        required_secret: EODHD_AUTHORIZED_USER_IDS_VAR,
      },
      503,
    )
  }

  if (!decision.allowed) {
    // 403 with the reason, but never the allowlist and never who is on it.
    return json({ error: 'Not entitled to EODHD', reason: decision.reason }, 403)
  }

  const apiToken = Deno.env.get('EODHD_API_KEY')
  if (!apiToken) {
    return json(
      { error: 'EODHD is not configured', detail: 'EODHD_API_KEY is not set' },
      503,
    )
  }

  /* ── 4. the provider request ─────────────────────────────────────────── */

  const deps: EodhdFetchDeps = { apiToken }

  try {
    switch (op) {
      case 'exchanges':
        // Provider-supported venue discovery. One small response, and the
        // only authoritative answer to "what is this exchange's suffix".
        return json(await fetchExchanges(deps))

      case 'resolve': {
        const query = typeof body.query === 'string' ? body.query.trim() : ''
        if (!query) return json({ error: 'query is required' }, 400)
        const limit = typeof body.limit === 'number' ? body.limit : 10
        return json(await searchSymbols(query, limit, deps))
      }

      case 'reference': {
        const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
        if (!symbol) return json({ error: 'symbol is required' }, 400)
        /*
         * Reference data comes from the search endpoint, matched exactly,
         * rather than from `fundamentals`.
         *
         * `fundamentals` would answer this in one call and returns a very
         * large document per symbol, which on a metered single-seat plan is
         * the wrong default for a field we only need six values from.
         */
        const found = await searchSymbols(symbol, 10, deps)
        if (!found.ok) return json(found)
        const wanted = symbol.toUpperCase()
        const exact =
          found.data.find(r => r.symbol.toUpperCase() === wanted) ??
          found.data.find(r => r.symbol.toUpperCase().split('.')[0] === wanted.split('.')[0])
        if (!exact) {
          return json({ ok: false, failure: { kind: 'unknown_symbol', symbol } })
        }
        /*
         * A `Retrieved`, with NO `effectiveAt`.
         *
         * This previously returned `effectiveAt: now`, described as "the
         * honest instant ... because that is all the provider told us". That
         * was wrong, and the contract says why: `effectiveAt` is when the
         * value was TRUE, and `Observed.effectiveAt` forbids "now as a
         * convenience" in as many words. An exchange code and a currency have
         * a validity window the search endpoint never states, so claiming
         * they became true at the moment we asked is a fabricated fact that
         * any freshness check would then read as perfectly fresh.
         *
         * `observedAt` survives on its own and says the one true thing: this
         * is what the provider answered, and this is when we asked it.
         */
        return json({
          ok: true,
          data: {
            value: exact,
            source: { provider: 'eodhd', feed: 'search', via: 'live' },
            observedAt: new Date().toISOString(),
          },
        })
      }

      case 'latest': {
        const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
        if (!symbol) return json({ error: 'symbol is required' }, 400)
        return json(await fetchLatestQuote(symbol, deps))
      }

      case 'bars': {
        const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
        if (!symbol) return json({ error: 'symbol is required' }, 400)
        if (!isIsoDate(body.from) || !isIsoDate(body.to)) {
          return json({ error: 'from and to must be YYYY-MM-DD' }, 400)
        }
        const interval = (typeof body.interval === 'string' ? body.interval : '1d') as BarInterval

        if (interval === '1d') {
          return json(await fetchDailyBars(symbol, body.from, body.to, deps))
        }

        // Intraday takes UNIX seconds. `to` is pushed to the end of its day
        // so an inclusive date range stays inclusive.
        const fromUnix = Math.floor(Date.parse(`${body.from}T00:00:00Z`) / 1000)
        const toUnix = Math.floor(Date.parse(`${body.to}T23:59:59Z`) / 1000)
        return json(await fetchIntradayBars(symbol, interval, fromUnix, toUnix, deps))
      }

      case 'splits': {
        /*
         * The corporate actions behind the drawn window, so a raw series can
         * be restated in current shares. Without this the client has prices
         * and no factors, and a stock split draws as a price collapse.
         *
         * Reached only after the same entitlement decision as `bars` above;
         * it sits inside the same switch for exactly that reason.
         */
        const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
        if (!symbol) return json({ error: 'symbol is required' }, 400)
        if (!isIsoDate(body.from) || !isIsoDate(body.to)) {
          return json({ error: 'from and to must be YYYY-MM-DD' }, 400)
        }
        return json(await fetchSplits(symbol, body.from, body.to, deps))
      }

      default:
        return json({ error: `Unknown op: ${String(op)}` }, 400)
    }
  } catch (err) {
    /*
     * The message is never echoed. An exception raised inside fetch can carry
     * the request URL, and the request URL carries the API token.
     */
    console.error('eodhd-market-data failed', {
      op,
      name: err instanceof Error ? err.name : 'unknown',
    })
    return json(
      {
        ok: false,
        failure: { kind: 'unavailable', detail: 'EODHD request failed unexpectedly' },
      },
      502,
    )
  }
})
