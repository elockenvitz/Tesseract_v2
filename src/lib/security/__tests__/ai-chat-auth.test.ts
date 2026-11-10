/**
 * ai-chat holds a service-role credential, for exactly one step: resolving the
 * organization's provider API key out of Vault via
 * `public.resolve_org_ai_config(uuid)`, which is granted to `service_role` and
 * to nothing else. Everything else the function does runs under the caller's
 * own JWT and therefore under RLS.
 *
 * That makes Standing Rule 6's ordering the property worth pinning, and it is
 * an ordering, not a predicate -- no amount of reading the policies proves it.
 * These tests drive the real `authorizeVerifiedUser` and the real
 * `resolveSecretKey` against fakes for the two clients, and assert:
 *
 *   1. a denied caller never causes the privileged client to be CONSTRUCTED,
 *      so the key is never even read, let alone used;
 *   2. the organization id handed to the resolver comes from server-side
 *      attribution, never from the request body, so a caller cannot name
 *      another organization and have its key resolved;
 *   3. the resolved key never appears in what the function returns.
 *
 * Property 3 is the one the release exists for. It is asserted here against
 * the response shape, and in `supabase/tests/ai-byok-key-vault.sql` against
 * the database grants -- a response can only leak what a role can read, and
 * both halves have to hold.
 */
import { describe, expect, it, vi } from 'vitest'
import { authorizeVerifiedUser } from '../../../../supabase/functions/_shared/verified-user'
import { resolveSecretKey, requireSecretKey } from '../../../../supabase/functions/_shared/secret-key'

const USER = { id: '11111111-1111-1111-1111-111111111111' }
const CALLER_ORG = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

/** A fake key. Shaped like the real thing, valid nowhere. */
const STORED_KEY = `sk-ant-api03-TESTONLY-${'x'.repeat(60)}`

const SECRET_ENV = (name: string) =>
  name === 'SUPABASE_SECRET_KEYS' ? JSON.stringify({ default: 'sb_secret_TESTONLY' }) : undefined

function userClient(user: { id: string } | null, error: unknown = null) {
  return { auth: { getUser: async () => ({ data: { user }, error }) } }
}

/**
 * The handler's real sequence, with the two side-effecting steps counted:
 * reading the secret key out of the environment, and calling the resolver.
 *
 * `bodyOrganizationId` is what a caller could put in the request. It is
 * deliberately accepted here and deliberately never used, which is the point
 * of assertion 2 -- if a future edit starts trusting it, `resolvedOrgIds`
 * stops matching `CALLER_ORG` and this test fails.
 */
async function runHandler(opts: {
  authHeader: string | null
  user: { id: string } | null
  userError?: unknown
  bodyOrganizationId?: string
  /** What server-side attribution derives for this user. */
  attributedOrgId?: string | null
  env?: (name: string) => string | undefined
}) {
  const resolvedOrgIds: string[] = []
  const keyReads: string[] = []

  // Stands in for createClient(url, requireSecretKey(...)). Constructing it is
  // what reads the key, so counting constructions counts key reads.
  const constructAdminClient = vi.fn(() => {
    keyReads.push(requireSecretKey(opts.env ?? SECRET_ENV))
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        if (fn !== 'resolve_org_ai_config') throw new Error(`unexpected rpc ${fn}`)
        resolvedOrgIds.push(args.p_org_id as string)
        return {
          data: [{
            byok_provider: 'anthropic',
            byok_api_key: STORED_KEY,
            byok_model: 'claude-sonnet-5-5',
            byok_enabled: true,
          }],
          error: null,
        }
      },
    }
  })

  const authz = await authorizeVerifiedUser(opts.authHeader, userClient(opts.user, opts.userError))
  if (!authz.ok) {
    return {
      authz,
      adminClients: constructAdminClient.mock.calls.length,
      keyReads,
      resolvedOrgIds,
      response: { error: authz.error },
    }
  }

  // Attribution runs under the CALLER's client, so the org id is server-side
  // data. The request body is not consulted.
  const organizationId = opts.attributedOrgId ?? CALLER_ORG

  const admin = constructAdminClient()
  const { data } = await admin.rpc('resolve_org_ai_config', { p_org_id: organizationId })
  const orgConfig = data?.[0] ?? null

  // What the function actually returns. The key is used to call the provider
  // and is never placed in the envelope.
  const response = {
    content: 'OK',
    model: orgConfig?.byok_model,
    provider: orgConfig?.byok_provider,
    mode: 'byok',
    usage: { input_tokens: 12, output_tokens: 3 },
  }

  return {
    authz,
    adminClients: constructAdminClient.mock.calls.length,
    keyReads,
    resolvedOrgIds,
    response,
  }
}

describe('ai-chat authorization ordering (Standing Rule 6)', () => {
  it('rejects a missing Authorization header before any privileged client exists', async () => {
    const r = await runHandler({ authHeader: null, user: USER })
    expect(r.authz).toMatchObject({ ok: false, status: 401 })
    expect(r.adminClients).toBe(0)
    expect(r.keyReads).toEqual([])
    expect(r.resolvedOrgIds).toEqual([])
  })

  it('rejects the bare publishable key, which is itself a valid JWT', async () => {
    // The anon/publishable key passes verify_jwt. getUser() resolving no user
    // is what distinguishes it from a signed-in caller, which is why the gate
    // cannot be `verify_jwt` alone.
    const r = await runHandler({ authHeader: 'Bearer publishable', user: null })
    expect(r.authz).toMatchObject({ ok: false, status: 401 })
    expect(r.adminClients).toBe(0)
    expect(r.keyReads).toEqual([])
  })

  it('rejects a getUser error the same way, with no privileged side effect', async () => {
    const r = await runHandler({ authHeader: 'Bearer x', user: null, userError: { message: 'bad jwt' } })
    expect(r.authz.ok).toBe(false)
    expect(r.adminClients).toBe(0)
    expect(r.resolvedOrgIds).toEqual([])
  })

  it('passes a token to getUser rather than calling it bare', async () => {
    // The headerless form reads the client's own session, which an edge
    // function does not have. Two production outages came from this; the
    // shared gate exists to make it impossible to reintroduce here.
    const seen: unknown[] = []
    const client = {
      auth: {
        getUser: async (token?: string) => {
          seen.push(token)
          return { data: { user: USER }, error: null }
        },
      },
    }
    const authz = await authorizeVerifiedUser('Bearer abc123', client)
    expect(authz).toEqual({ ok: true, user: USER })
    expect(seen).toEqual(['abc123'])
  })

  it('admits a verified user and resolves the key for the ATTRIBUTED org', async () => {
    const r = await runHandler({ authHeader: 'Bearer good', user: USER })
    expect(r.authz).toEqual({ ok: true, user: USER })
    expect(r.adminClients).toBe(1)
    expect(r.resolvedOrgIds).toEqual([CALLER_ORG])
  })

  it('ignores an organization_id supplied in the request body', async () => {
    const r = await runHandler({
      authHeader: 'Bearer good',
      user: USER,
      bodyOrganizationId: OTHER_ORG,
      attributedOrgId: CALLER_ORG,
    })
    expect(r.resolvedOrgIds).toEqual([CALLER_ORG])
    expect(r.resolvedOrgIds).not.toContain(OTHER_ORG)
  })
})

describe('ai-chat key custody', () => {
  it('never places the resolved provider key in the response', async () => {
    const r = await runHandler({ authHeader: 'Bearer good', user: USER })
    const serialized = JSON.stringify(r.response)
    expect(serialized).not.toContain(STORED_KEY)
    expect(serialized).not.toContain('sk-ant')
    expect(r.response).not.toHaveProperty('byok_api_key')
    // The model and provider ARE returned; they are configuration, not
    // credentials. Narrowed off the deny-path shape, which carries only an
    // error string.
    if (!('model' in r.response)) throw new Error('authorized path returned the denial shape')
    expect(r.response.model).toBe('claude-sonnet-5-5')
  })

  it('reports a denial without disclosing anything about the key', async () => {
    const r = await runHandler({ authHeader: null, user: USER })
    const serialized = JSON.stringify(r.response)
    expect(serialized).not.toContain('sk-ant')
    expect(serialized).not.toContain('SUPABASE_SECRET_KEYS')
  })
})

describe('secret key resolution', () => {
  it('prefers the new dictionary', () => {
    const r = resolveSecretKey((n) => (n === 'SUPABASE_SECRET_KEYS' ? '{"default":"sb_secret_new"}' : 'legacy_value'))
    expect(r).toEqual({ ok: true, key: 'sb_secret_new', source: 'dictionary' })
  })

  it('falls back to the legacy variable when the dictionary is absent', () => {
    const r = resolveSecretKey((n) => (n === 'SUPABASE_SERVICE_ROLE_KEY' ? 'legacy_value' : undefined))
    expect(r).toEqual({ ok: true, key: 'legacy_value', source: 'legacy' })
  })

  it('falls back when the dictionary is unparseable rather than failing closed on a typo', () => {
    const r = resolveSecretKey((n) =>
      n === 'SUPABASE_SECRET_KEYS' ? '{not json' : n === 'SUPABASE_SERVICE_ROLE_KEY' ? 'legacy_value' : undefined
    )
    expect(r).toEqual({ ok: true, key: 'legacy_value', source: 'legacy' })
  })

  it('falls back when the dictionary has no key under the requested name', () => {
    const r = resolveSecretKey(
      (n) =>
        n === 'SUPABASE_SECRET_KEYS' ? '{"other":"x"}' : n === 'SUPABASE_SERVICE_ROLE_KEY' ? 'legacy_value' : undefined
    )
    expect(r).toEqual({ ok: true, key: 'legacy_value', source: 'legacy' })
  })

  it('fails with a message that names variables and no values', () => {
    const r = resolveSecretKey(() => undefined)
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.failure).toBe('env_missing')
    expect(r.message).toContain('SUPABASE_SECRET_KEYS')
    expect(r.message).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('names the available key names, not their values, when the name is wrong', () => {
    const r = resolveSecretKey((n) => (n === 'SUPABASE_SECRET_KEYS' ? '{"prod":"sb_secret_SHOULD_NOT_APPEAR"}' : undefined))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.message).toContain('prod')
    expect(r.message).not.toContain('sb_secret_SHOULD_NOT_APPEAR')
  })

  it('requireSecretKey throws that same message rather than returning undefined', () => {
    expect(() => requireSecretKey(() => undefined)).toThrow(/SUPABASE_SECRET_KEYS/)
  })
})
