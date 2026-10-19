/**
 * market-news fetches global news from a paid external API (Alpha Vantage) and
 * caches it with the service-role key. Same exposure as market-events: verify_jwt
 * admits the public anon key, so the function's own gate (../_shared/verified-user)
 * must require a JWT that resolves to a real user via getUser().
 *
 * Handler-level: drives the real authorizeVerifiedUser with a fake user client and
 * asserts a denied caller never reaches the external fetch or the cache write.
 */
import { describe, expect, it, vi } from 'vitest'
import { authorizeVerifiedUser } from '../../../../supabase/functions/_shared/verified-user'

const USER = { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd' }

function userClient(user: { id: string } | null, error: unknown = null) {
  return { auth: { getUser: async () => ({ data: { user }, error }) } }
}

async function runHandler(opts: { authHeader: string | null; user: { id: string } | null; userError?: unknown }) {
  const externalFetch = vi.fn(async () => ({ items: [] }))
  const cacheWrite = vi.fn(async () => undefined)
  const authz = await authorizeVerifiedUser(opts.authHeader, userClient(opts.user, opts.userError))
  if (authz.ok) { await externalFetch(); await cacheWrite() }
  return { authz, externalCalls: externalFetch.mock.calls.length, cacheCalls: cacheWrite.mock.calls.length }
}

describe('market-news authorization', () => {
  it('rejects a missing Authorization header; no external call, no cache write', async () => {
    const r = await runHandler({ authHeader: null, user: USER })
    expect(r.authz).toMatchObject({ ok: false, status: 401 })
    expect(r.externalCalls).toBe(0)
    expect(r.cacheCalls).toBe(0)
  })

  it('rejects the bare anon key / invalid JWT (getUser resolves no user)', async () => {
    const r = await runHandler({ authHeader: 'Bearer anon', user: null })
    expect(r.authz).toMatchObject({ ok: false, status: 401 })
    expect(r.externalCalls).toBe(0)
    expect(r.cacheCalls).toBe(0)
  })

  it('rejects a getUser error the same way', async () => {
    const r = await runHandler({ authHeader: 'Bearer x', user: null, userError: { message: 'bad' } })
    expect(r.authz.ok).toBe(false)
    expect(r.externalCalls).toBe(0)
  })

  it('admits a verified signed-in user and reaches the fetch + cache', async () => {
    const r = await runHandler({ authHeader: 'Bearer good', user: USER })
    expect(r.authz).toEqual({ ok: true, user: USER })
    expect(r.externalCalls).toBe(1)
    expect(r.cacheCalls).toBe(1)
  })
})
