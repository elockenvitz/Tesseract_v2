/**
 * `market-news` must admit a signed-in reader and nobody else.
 *
 * ── The outage this file exists to make unrepeatable ─────────────────────
 *
 * The gate shipped on 2026-10-19 and rejected EVERY caller, including a valid
 * unexpired session, for two weeks. Measured over 24h: 45 POSTs, 45 of them
 * 401. The news feed was dark and the only thing the app could learn from the
 * response was the word "Unauthorized", which is also what a signed-out
 * stranger gets, so the failure looked like correct behaviour.
 *
 * Two separate defects, and this file pins both:
 *
 * 1. `getUser()` WITH NO ARGUMENT. In `@supabase/supabase-js@2` that resolves
 *    through the forwarded `Authorization` header and works -- `ai-chat` runs
 *    the identical gate and admitted the same token (400 "Message is
 *    required", i.e. past the gate). In the `@2.39.0` that `market-news` and
 *    `market-events` alone were pinned to, the older bundled auth client goes
 *    through its own session store instead, and an Edge Function has no
 *    session. Passing the token explicitly removes the version from the
 *    question entirely.
 *
 * 2. ONE STATUS FOR TWO DIFFERENT FACTS. "You are not signed in" and "this
 *    function's own API key is disabled" were both `401 Unauthorized`. This
 *    project's legacy `anon` and `service_role` keys WERE disabled, on
 *    2026-10-03, so that was not hypothetical. A gate that cannot say which
 *    of those happened cannot be debugged from the outside, which is exactly
 *    what two weeks of silence bought.
 *
 * The last block reads the function source, because the behaviour above is
 * only as good as the call site that uses it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  authorizeVerifiedUser,
  bearerToken,
  type UserClient,
  type VerifiedUser,
} from '../../../../supabase/functions/_shared/verified-user'

const USER: VerifiedUser = { id: 'fa46cffc-dafb-4071-a3ea-5536240d462e' }
const TOKEN = 'header.payload.signature'

/** A fake auth client recording what the gate asked it. */
function clientOf(
  reply: (jwt?: string) => { data: { user: VerifiedUser | null }; error: unknown } | Promise<never>,
): { client: UserClient; seen: (string | undefined)[] } {
  const seen: (string | undefined)[] = []
  return {
    seen,
    client: {
      auth: {
        getUser: async (jwt?: string) => {
          seen.push(jwt)
          return reply(jwt) as { data: { user: VerifiedUser | null }; error: unknown }
        },
      },
    },
  }
}

const admits = (jwt?: string) =>
  jwt === TOKEN
    ? { data: { user: USER }, error: null }
    : { data: { user: null }, error: { message: 'invalid claim: missing sub claim' } }

describe('a signed-in reader', () => {
  it('is admitted', async () => {
    const { client } = clientOf(admits)
    const r = await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.user.id).toBe(USER.id)
  })

  it('is identified by the token in the header, not by a session', async () => {
    // The whole first defect. A client in an Edge Function has no session, so
    // a no-argument call has nothing to resolve and the version of the auth
    // library decides whether that is an error or a fall-through.
    const { client, seen } = clientOf(admits)
    await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)
    expect(seen).toEqual([TOKEN])
  })

  it('is admitted whatever case the scheme is written in', async () => {
    for (const header of [`Bearer ${TOKEN}`, `bearer ${TOKEN}`, `BEARER ${TOKEN}`, TOKEN]) {
      const { client } = clientOf(admits)
      const r = await authorizeVerifiedUser(header, client)
      expect(r.ok, header).toBe(true)
    }
  })
})

describe('a caller who is not a signed-in user', () => {
  it('is refused when there is no header at all', async () => {
    const { client, seen } = clientOf(admits)
    const r = await authorizeVerifiedUser(null, client)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(401)
      expect(r.error).toBe('Missing authorization header')
    }
    // And the auth server is never asked, so an unauthenticated flood costs
    // nothing upstream.
    expect(seen).toEqual([])
  })

  it('is refused when the header carries no token', async () => {
    for (const header of ['', '   ', 'Bearer', 'Bearer    ']) {
      const { client, seen } = clientOf(admits)
      const r = await authorizeVerifiedUser(header, client)
      expect(r.ok, JSON.stringify(header)).toBe(false)
      if (!r.ok) expect(r.status).toBe(401)
      expect(seen, JSON.stringify(header)).toEqual([])
    }
  })

  it('is refused when the token resolves to no user', async () => {
    // This is the publishable key that ships in the browser bundle: a validly
    // signed project JWT that is nobody.
    const { client } = clientOf(() => ({ data: { user: null }, error: null }))
    const r = await authorizeVerifiedUser('Bearer sb_publishable_anyone', client)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(401)
      expect(r.error).toBe('Unauthorized')
    }
  })

  it('is refused when the token is rejected outright', async () => {
    const { client } = clientOf(() => ({
      data: { user: null },
      error: { message: 'invalid JWT: unable to parse or verify signature' },
    }))
    const r = await authorizeVerifiedUser('Bearer forged', client)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.status).toBe(401)
  })
})

describe("the function's own key being wrong", () => {
  /** The three wordings the auth server actually uses. */
  const KEY_FAILURES = [
    'No API key found in request',
    'Invalid API key',
    'Legacy API keys are disabled',
  ]

  it('is never reported as 401', async () => {
    // The second defect. A 401 sends the reader to check their own session for
    // a fault that is entirely server-side.
    for (const message of KEY_FAILURES) {
      const { client } = clientOf(() => ({ data: { user: null }, error: { message } }))
      const r = await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)
      expect(r.ok, message).toBe(false)
      if (!r.ok) expect(r.status, message).toBe(503)
    }
  })

  it("carries the auth server's own words, so it can be acted on", async () => {
    const { client } = clientOf(() => ({
      data: { user: null },
      error: { message: 'Legacy API keys are disabled' },
    }))
    const r = await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)
    if (!r.ok && r.status === 503) {
      expect(r.reason).toContain('Legacy API keys')
      expect(r.error).toContain('misconfigured')
    }
  })

  it('still grants nothing', async () => {
    for (const message of KEY_FAILURES) {
      const { client } = clientOf(() => ({ data: { user: USER }, error: { message } }))
      const r = await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)
      expect(r.ok, message).toBe(false)
    }
  })

  it('reports a thrown auth call as unavailable rather than unauthorized', async () => {
    const { client } = clientOf(() => Promise.reject(new Error('fetch failed')))
    const r = await authorizeVerifiedUser(`Bearer ${TOKEN}`, client)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.status).toBe(503)
      if (r.status === 503) expect(r.reason).toContain('fetch failed')
    }
  })
})

describe('bearerToken', () => {
  it('returns the token without the scheme', () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN)
  })

  it('returns null for nothing to verify', () => {
    for (const v of [null, undefined, '', '   ', 'Bearer', 'Bearer  ']) {
      expect(bearerToken(v), JSON.stringify(v)).toBeNull()
    }
  })

  it('does not split a token that contains spaces after the first', () => {
    // Defensive: a malformed token must reach the auth server intact and be
    // rejected there, not be silently truncated into a different token here.
    expect(bearerToken('Bearer a b')).toBe('a b')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The function itself
// ───────────────────────────────────────────────────────────────────────────

const FN = (slug: string) => path.join(process.cwd(), 'supabase', 'functions', slug, 'index.ts')

/** Source with comments stripped, so prose about the outage cannot satisfy or
 *  break an assertion about code. */
const codeOf = (slug: string) =>
  readFileSync(FN(slug), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')

describe('market-news gates its provider calls on a real user', () => {
  const src = () => codeOf('market-news')

  it('runs the shared gate', () => {
    const s = src()
    expect(s).toContain('authorizeVerifiedUser')
    expect(s).toContain('_shared/verified-user.ts')
  })

  it('gates BEFORE reading the body, so an anonymous flood costs no provider calls', () => {
    const s = src()
    const gate = s.indexOf('authorizeVerifiedUser(authHeader')
    const parse = s.indexOf('await req.json()')
    expect(gate).toBeGreaterThan(-1)
    expect(parse).toBeGreaterThan(-1)
    expect(gate).toBeLessThan(parse)
  })

  it('builds its client from the publishable key, never the legacy anon key', () => {
    const s = src()
    expect(s).toContain('requirePublishableKey')
    expect(s).not.toContain('SUPABASE_ANON_KEY')
  })

  it('returns the status the gate chose, not a flat 401', () => {
    // The gate distinguishing 401 from 503 is worthless if the call site
    // hardcodes one of them.
    const s = src()
    expect(s).toContain('status: authz.status')
    expect(s).not.toMatch(/authz\.ok[\s\S]{0,400}status:\s*401/)
  })

  it('passes the 503 reason through to the caller', () => {
    expect(src()).toContain('reason: authz.reason')
  })

  it('does not pin an auth library version that breaks the gate', () => {
    // 2.39.0 is the version the two broken functions alone carried. Every
    // other function in this project tracks `@2`.
    expect(src()).not.toContain('supabase-js@2.39.0')
    expect(src()).toContain('supabase-js@2')
  })
})
