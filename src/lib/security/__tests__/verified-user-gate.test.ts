/**
 * The shared Edge Function authorization gate, against a client that behaves
 * like the gotrue actually bundled into production.
 *
 * ── Why this file exists ─────────────────────────────────────────────────
 *
 * The three functions that use `_shared/verified-user.ts` already have tests,
 * and every one of them passed while production was refusing every real user.
 * They passed because their fake client is written
 *
 *     { auth: { getUser: async () => ({ data: { user }, error }) } }
 *
 * which ignores its arguments. A fake that answers the same way whether or not
 * it was given the token cannot see whether the token was given, and that was
 * the entire defect.
 *
 * What happened on 2026-11-08: `yahoo-chart-proxy` version 10 deployed and
 * returned `{"error":"Unauthorized"}` to everyone, signed-in users included,
 * while `market-events` and `market-news` accepted the very same token and
 * GoTrue's own `/auth/v1/user` returned `role: authenticated` for it. The code
 * of all three gates was identical. The difference was the bundle date:
 * `supabase-js@2.39.0` declares `@supabase/gotrue-js@^2.56.0`, a RANGE, and
 * esm.sh resolved it to 2.119.0 for the new deploy, where
 *
 *     !(session?.access_token) && !this.hasCustomAuthorizationHeader
 *       ? { data: { user: null }, error: new AuthSessionMissingError() }
 *       : request(...)
 *
 * decides the headerless `getUser()` call. Server-side there is no session,
 * and `hasCustomAuthorizationHeader` is false because supabase-js 2.39.0 never
 * sets it. The older functions were one redeploy from the same outage.
 *
 * So the fake below is modelled on 2.119.0 rather than on convenience: it
 * refuses a call that arrives without a token, exactly as the real library
 * does. Every assertion here fails if the gate goes back to `getUser()`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  authorizeVerifiedUser,
  bearerToken,
} from '../../../../supabase/functions/_shared/verified-user'

const USER = { id: '7b1d9d64-4b1a-4a0a-9a7e-2c6f0b1a5e31' }
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.realsessionjwt.sig'

/**
 * A client that behaves like gotrue-js 2.119.0 on a server with
 * `persistSession: false` and no `hasCustomAuthorizationHeader`:
 *
 *  - `getUser(jwt)`  -> resolves the user the token belongs to
 *  - `getUser()`     -> AuthSessionMissingError, never a user
 *
 * `calls` records what it was actually handed.
 */
function gotrue2119({ validToken = TOKEN, user = USER }: { validToken?: string; user?: typeof USER | null } = {}) {
  const calls: Array<string | undefined> = []
  return {
    calls,
    client: {
      auth: {
        async getUser(jwt?: string) {
          calls.push(jwt)
          if (jwt === undefined) {
            return { data: { user: null }, error: { name: 'AuthSessionMissingError', message: 'Auth session missing!' } }
          }
          if (jwt !== validToken) {
            return { data: { user: null }, error: null }
          }
          return { data: { user }, error: null }
        },
      },
    },
  }
}

describe('the gate admits a real user through the library production actually bundles', () => {
  it('authorizes a verified signed-in user', async () => {
    const { client, calls } = gotrue2119()
    const r = await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)
    expect(
      r,
      'the gate refused a valid session: this is the production outage of 2026-11-08, where the headerless getUser() could only return AuthSessionMissingError'
    ).toEqual({ ok: true, user: USER })
    expect(calls, 'getUser was called without the token').toEqual([TOKEN])
  })

  it('hands getUser the token itself, with the scheme stripped', async () => {
    const { client, calls } = gotrue2119()
    await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)
    expect(calls[0]).toBe(TOKEN)
    expect(calls[0], 'the Bearer prefix was forwarded as part of the token').not.toMatch(/Bearer/i)
  })

  it('tolerates the header casing and spacing a proxy may hand it', async () => {
    for (const header of [`bearer ${TOKEN}`, `BEARER ${TOKEN}`, `Bearer  ${TOKEN}`, ` Bearer ${TOKEN} `]) {
      const { client } = gotrue2119()
      expect(await authorizeVerifiedUser(header, client), header).toEqual({ ok: true, user: USER })
    }
  })
})

describe('the gate still refuses everything it refused before', () => {
  it('refuses a missing header without asking the auth server at all', async () => {
    const { client, calls } = gotrue2119()
    expect(await authorizeVerifiedUser(null, client)).toEqual({
      ok: false, status: 401, error: 'Missing authorization header',
    })
    expect(calls, 'a denied caller reached the auth server').toEqual([])
  })

  it('refuses the bare publishable key, which resolves to no user', async () => {
    // The gateway's verify_jwt admits it; this gate is what does not.
    const { client } = gotrue2119()
    const r = await authorizeVerifiedUser('Bearer sb_publishable_not_a_session', client)
    expect(r).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
  })

  it('refuses a header carrying no bearer token, without a round trip', async () => {
    for (const header of ['Bearer', 'Bearer   ', 'Basic abc123', 'garbage']) {
      const { client, calls } = gotrue2119()
      expect(await authorizeVerifiedUser(header, client), header).toEqual({
        ok: false, status: 401, error: 'Unauthorized',
      })
      expect(calls, header).toEqual([])
    }
  })

  it('refuses when the auth server reports an error', async () => {
    const client = { auth: { async getUser() { return { data: { user: null }, error: { message: 'jwt expired' } } } } }
    expect(await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)).toEqual({
      ok: false, status: 401, error: 'Unauthorized',
    })
  })
})

describe('bearerToken', () => {
  it('returns null for anything that is not a bearer token', () => {
    for (const h of [null, '', '   ', 'Bearer', 'Bearer ', 'Basic xyz', 'xyz']) {
      expect(bearerToken(h), JSON.stringify(h)).toBeNull()
    }
  })

  it('returns the token for a bearer header', () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN)
    expect(bearerToken(`  bearer\t${TOKEN}  `)).toBe(TOKEN)
  })
})

/*
 * The source-level half. The unit tests above are driven through the module's
 * own export, so they would follow it anywhere; this pins the one line that
 * the next person is most likely to "simplify" back into the outage.
 */
describe('the shared gate never calls getUser without a token', () => {
  const src = readFileSync(
    join(process.cwd(), 'supabase', 'functions', '_shared', 'verified-user.ts'),
    'utf8'
  )

  it('passes a token to getUser', () => {
    expect(src, 'the gate no longer calls getUser at all').toMatch(/getUser\(\s*token\s*\)/)
  })

  it('has no headerless getUser() call left in it', () => {
    // Comments are stripped first: this module's own header discusses
    // `auth.getUser()` by name, and prose must not have to dodge a regex.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    const headerless = code.match(/\.getUser\(\s*\)/g) ?? []
    expect(
      headerless,
      'a headerless getUser() returns AuthSessionMissingError under gotrue-js >= 2.119 with no stored session'
    ).toEqual([])
  })
})
