/**
 * calendar-sync reads and writes calendar data with the service-role key, so the
 * only thing stopping user B from operating on user A's connection is that the
 * connection is loaded scoped to the VERIFIED caller's user id. That decision is
 * authorizeConnectionOwnership (calendar-sync/authorize.ts).
 *
 * Handler-level: drives the real decision with a fake connection store (the shape
 * the service-role query returns) and a mini handler flow, asserting a denied
 * caller never reaches the privileged sync step. A source assertion pins that the
 * handler passes the verified user.id (not a request value) into the scoped query.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { authorizeConnectionOwnership } from '../../../../supabase/functions/calendar-sync/authorize'

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const CONN_A = 'conn-a' // belongs to user A only

const store: Record<string, { id: string; user_id: string }> = {
  [CONN_A]: { id: CONN_A, user_id: USER_A },
}

// Fake service-role fetcher: returns a row only when BOTH id and user_id match,
// exactly like .from('calendar_connections').eq('id',id).eq('user_id',userId).single().
function makeFetcher() {
  const calls: Array<{ id: string; userId: string }> = []
  const fetch = async (id: string, userId: string) => {
    calls.push({ id, userId })
    const row = store[id]
    if (row && row.user_id === userId) return { data: row, error: null }
    return { data: null, error: { code: 'PGRST116', message: 'no rows' } }
  }
  return { fetch, calls }
}

// Mini handler tail: authorize ownership, and ONLY on ok run the privileged sync.
async function runOwnership(verifiedUserId: string, connectionId: string | undefined) {
  const f = makeFetcher()
  const sync = vi.fn(async () => 'synced')
  const owned = await authorizeConnectionOwnership(f.fetch, connectionId, verifiedUserId)
  if (owned.ok) await sync()
  return { owned, fetchCalls: f.calls, syncCalls: sync.mock.calls.length }
}

describe('calendar-sync cross-user authorization', () => {
  it('DENIES user B operating on user A\'s connection id (404, no sync)', async () => {
    const r = await runOwnership(USER_B, CONN_A)
    expect(r.owned).toMatchObject({ ok: false, status: 404 })
    expect(r.fetchCalls).toEqual([{ id: CONN_A, userId: USER_B }]) // scoped to B's verified id
    expect(r.syncCalls).toBe(0)                                    // never reaches sync
  })

  it('ALLOWS the owner (user A) to reach the sync for their own connection', async () => {
    const r = await runOwnership(USER_A, CONN_A)
    expect(r.owned.ok).toBe(true)
    expect(r.fetchCalls).toEqual([{ id: CONN_A, userId: USER_A }])
    expect(r.syncCalls).toBe(1)
  })

  it('a missing/unknown connection id is denied (no sync)', async () => {
    const r = await runOwnership(USER_A, undefined)
    expect(r.owned.ok).toBe(false)
    expect(r.syncCalls).toBe(0)
  })

  it('the decision uses the verified user id for ownership, never a client value', async () => {
    const r = await runOwnership(USER_B, CONN_A)
    expect(r.fetchCalls[0].userId).toBe(USER_B)
    expect(r.fetchCalls[0].userId).not.toBe(USER_A)
  })

  it('the handler wires the VERIFIED user.id (from getUser) into the scoped query, and gates before sync', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/calendar-sync/index.ts'), 'utf8')
    // JWT is verified, then the ownership decision runs with user.id.
    expect(src).toContain('userClient.auth.getUser()')
    expect(src).toMatch(/authorizeConnectionOwnership\([\s\S]*\.eq\('user_id', userId\)[\s\S]*user\.id,/)
    // Ownership gate precedes the sync calls.
    const gateAt = src.indexOf('authorizeConnectionOwnership(')
    const syncAt = src.indexOf('syncGoogleCalendar(')
    expect(gateAt).toBeGreaterThan(-1)
    expect(syncAt).toBeGreaterThan(gateAt)
  })
})
