/**
 * `yahoo-chart-proxy` stopped being a stateless proxy: it now persists the
 * daily closes it fetches into `price_history_cache` with the service-role
 * key, replacing two browser upserts that the RLS policy "Users can insert
 * price history" admitted on `auth.uid() IS NOT NULL` alone.
 *
 * That makes an unauthenticated route into it strictly worse than what it
 * replaced, and the gateway's `verify_jwt` is not enough on its own: it admits
 * the public anon key that ships in the browser bundle. So the function
 * applies the same gate as `market-events` and `market-news`
 * (`_shared/verified-user.ts`) before the Yahoo fetch and before the
 * service-role client exists.
 *
 * Handler-level: drives the real `authorizeVerifiedUser` with a fake user
 * client and asserts a denied caller reaches neither the upstream fetch nor
 * the cache write. The row-filtering half is covered separately in
 * `chart-closes.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import { authorizeVerifiedUser } from '../../../../supabase/functions/_shared/verified-user'

const USER = { id: '7b1d9d64-4b1a-4a0a-9a7e-2c6f0b1a5e31' }

function userClient(user: { id: string } | null, error: unknown = null) {
  return { auth: { getUser: async () => ({ data: { user }, error }) } }
}

/** Authorize, and ONLY on ok touch Yahoo / build the admin client / write. */
async function runHandler(opts: { authHeader: string | null; user: { id: string } | null; userError?: unknown }) {
  const yahooFetch = vi.fn(async () => ({ chart: { result: [] } }))
  const cacheWrite = vi.fn(async () => ({ error: null }))
  const adminClient = vi.fn(() => ({ upsert: cacheWrite }))

  const authz = await authorizeVerifiedUser(opts.authHeader, userClient(opts.user, opts.userError))
  if (authz.ok) {
    await yahooFetch()
    adminClient()
    await cacheWrite()
  }
  return {
    authz,
    fetchCalls: yahooFetch.mock.calls.length,
    adminClients: adminClient.mock.calls.length,
    writeCalls: cacheWrite.mock.calls.length,
  }
}

describe('yahoo-chart-proxy authorization', () => {
  it('rejects a missing Authorization header: no Yahoo call, no service_role client, no write', async () => {
    const r = await runHandler({ authHeader: null, user: USER })
    expect(r.authz).toMatchObject({ ok: false, status: 401 })
    expect(r.fetchCalls).toBe(0)
    expect(r.adminClients).toBe(0)
    expect(r.writeCalls).toBe(0)
  })

  it('rejects the bare anon key, which is a validly signed JWT that resolves to no user', async () => {
    const r = await runHandler({ authHeader: 'Bearer sb_publishable_anon', user: null })
    expect(r.authz).toMatchObject({ ok: false, status: 401 })
    expect(r.fetchCalls).toBe(0)
    expect(r.writeCalls).toBe(0)
  })

  it('rejects a getUser error the same way as no user', async () => {
    const r = await runHandler({ authHeader: 'Bearer x', user: null, userError: { message: 'jwt expired' } })
    expect(r.authz.ok).toBe(false)
    expect(r.fetchCalls).toBe(0)
    expect(r.writeCalls).toBe(0)
  })

  it('admits a verified signed-in user and reaches the fetch and the cache fill', async () => {
    const r = await runHandler({ authHeader: 'Bearer good', user: USER })
    expect(r.authz).toEqual({ ok: true, user: USER })
    expect(r.fetchCalls).toBe(1)
    expect(r.adminClients).toBe(1)
    expect(r.writeCalls).toBe(1)
  })
})

describe('the function source keeps the gate ahead of the privileged work', () => {
  it('authorizes before the Yahoo fetch and before the cache fill runs', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('supabase/functions/yahoo-chart-proxy/index.ts', 'utf8'))

    const gate = src.indexOf('authorizeVerifiedUser(authHeader')
    const fetchCall = src.indexOf('await fetch(targetUrl')
    const persistCall = src.indexOf('await persistDailyCloses(')

    expect(gate).toBeGreaterThan(-1)
    expect(fetchCall).toBeGreaterThan(-1)
    expect(persistCall).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(fetchCall)
    expect(gate).toBeLessThan(persistCall)
  })

  it('reads the service-role key only inside the cache-fill helper, which the gate precedes', async () => {
    /*
     * Textual order is not execution order: `persistDailyCloses` is declared
     * above the handler, so a naive "the gate's index is lower" assertion is
     * the wrong assertion and fails on correct code. What must hold is that
     * the service-role key is reachable only through that helper, and the
     * only call to it is after the gate (asserted above). Then a denied
     * caller cannot construct a privileged client.
     */
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('supabase/functions/yahoo-chart-proxy/index.ts', 'utf8'))

    const occurrences = src.match(/SUPABASE_SERVICE_ROLE_KEY/g) ?? []
    expect(occurrences).toHaveLength(1)

    const helperStart = src.indexOf('async function persistDailyCloses')
    const handlerStart = src.indexOf('serve(async (req)')
    const keyAt = src.indexOf('SUPABASE_SERVICE_ROLE_KEY')

    expect(helperStart).toBeGreaterThan(-1)
    expect(handlerStart).toBeGreaterThan(helperStart)
    expect(keyAt).toBeGreaterThan(helperStart)
    expect(keyAt).toBeLessThan(handlerStart)

    // And the helper is called from exactly one place.
    expect(src.match(/persistDailyCloses\(/g) ?? []).toHaveLength(2) // declaration + the one call
  })

  it('fills gaps only: the cache write never revises a stored close', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('supabase/functions/yahoo-chart-proxy/index.ts', 'utf8'))

    // `ignoreDuplicates: true` is the whole safety property. Without it this
    // path could overwrite the nightly job's canonical closes.
    expect(src).toMatch(/\.from\('price_history_cache'\)[\s\S]{0,200}ignoreDuplicates: true/)
  })
})

describe('the browser no longer writes price_history_cache', () => {
  it('has no upsert into the table anywhere in src/', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        const text = fs.readFileSync(full, 'utf8')
        // A write is an upsert/insert/update/delete within a short reach of
        // the table name on the same call chain.
        const re = /from\(['"]price_history_cache['"]\)[\s\S]{0,120}?\.(upsert|insert|update|delete)\(/g
        if (re.test(text)) offenders.push(full.replace(/\\/g, '/'))
      }
    }
    walk('src')

    expect(offenders).toEqual([])
  })
})
