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
  fetchIntradayBars,
  fetchLatestQuote,
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

type Operation = 'resolve' | 'reference' | 'latest' | 'bars'

interface RequestBody {
  op?: unknown
  symbol?: unknown
  query?: unknown
  limit?: unknown
  from?: unknown
  to?: unknown
  interval?: unknown
  currency?: unknown
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

  /* ── 2 + 3. entitlement, before any provider request ─────────────────── */

  const configResult = entitlementConfigFromEnv(k => Deno.env.get(k))
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

  const decision = decideMarketDataAccess(
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

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Body must be JSON' }, 400)
  }

  const op = body.op as Operation
  const deps: EodhdFetchDeps = { apiToken }

  try {
    switch (op) {
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
        return json({
          ok: true,
          data: {
            value: exact,
            source: { provider: 'eodhd', feed: 'search', via: 'live' },
            observedAt: new Date().toISOString(),
            // Reference data has no provider timestamp. The honest instant is
            // when we asked, because that is all the provider told us.
            effectiveAt: new Date().toISOString(),
          },
        })
      }

      case 'latest': {
        const symbol = typeof body.symbol === 'string' ? body.symbol.trim() : ''
        if (!symbol) return json({ error: 'symbol is required' }, 400)
        const currency = typeof body.currency === 'string' ? body.currency : undefined
        return json(await fetchLatestQuote(symbol, deps, currency))
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
