/**
 * Which organization does an `ai-chat` request act for?
 *
 * This is the property that broke BYOK on production. `ai-chat` resolved the
 * acting org as "the membership with the newest `joined_at`", while Settings
 * and `set_org_ai_api_key` both use `current_org_id()`. For a user in one
 * organization the two agree. For a user in two they disagree, and the user
 * is told to configure a key they already configured -- in the other org.
 *
 * The old test harness (`ai-chat-auth.test.ts`) takes the attributed org as
 * an INPUT, which is why it could pass while this was broken. These tests
 * drive the real `resolveOrgForRequest` against fake clients instead, so the
 * resolution itself is the subject.
 *
 * The first test is the regression: it reproduces the exact production shape
 * (current org = the one holding the key, newest membership = a different
 * org with no config) and fails against the old newest-membership rule.
 */
import { describe, expect, it } from 'vitest'
import { resolveOrgForRequest } from '../../../../supabase/functions/_shared/attribution-org'

const USER = 'fa46cffc-dafb-4071-a3ea-5536240d462e'

/** The org whose Vault row holds the key, and the user's current org. */
const KEY_ORG = '4b4713e8-d5da-4dc9-a465-c06a71248a12'
/** The org joined more recently, with no AI config at all. */
const NEWER_ORG = '779243a4-0fa1-4d3e-8af8-c9af6ed634d8'

/**
 * The fluent subset of the postgrest builder this code path uses. Declaring it
 * keeps the fakes honest: adding a call to the resolver that the real builder
 * supports but this interface omits is a type error here, not a silent pass.
 */
interface FakeChain {
  select: () => FakeChain
  eq: (col: string, val: unknown) => FakeChain
  is: () => FakeChain
  order: () => FakeChain
  limit: () => FakeChain
  maybeSingle: () => Promise<{ data: unknown; error: unknown }>
}

/**
 * A fake caller-scoped client.
 *
 * `currentOrg` is what `current_org_id()` returns -- NULL when the user has
 * no current org set, or when the caller is not a user at all. `memberships`
 * is what the fallback table query would return, newest first.
 */
function fakeClient(opts: {
  currentOrg?: string | null
  currentOrgError?: unknown
  currentOrgThrows?: boolean
  memberships?: Array<{ organization_id: string; joined_at: string }>
}) {
  const calls = { rpc: [] as string[], from: [] as string[] }
  const rows = opts.memberships ?? []

  const client = {
    rpc: async (fn: string) => {
      calls.rpc.push(fn)
      if (opts.currentOrgThrows) throw new Error('transport failed')
      return { data: opts.currentOrg ?? null, error: opts.currentOrgError ?? null }
    },
    from: (table: string) => {
      calls.from.push(table)
      const chain: FakeChain = {
        select: () => chain,
        eq: () => chain,
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      }
      return chain
    },
  }
  return { client, calls }
}

describe('ai-chat attribution: which org a request acts for', () => {
  it('REGRESSION: a user in two orgs resolves their CURRENT org, not the newest one', async () => {
    // The production shape, 2026-11-11. Tesseract holds the key and is the
    // user's current org; Tails Cap was joined 10 months later and has no
    // organization_ai_config row whatsoever.
    const { client, calls } = fakeClient({
      currentOrg: KEY_ORG,
      memberships: [
        { organization_id: NEWER_ORG, joined_at: '2026-10-05T21:37:11Z' },
        { organization_id: KEY_ORG, joined_at: '2025-12-05T00:31:18Z' },
      ],
    })

    const org = await resolveOrgForRequest(client, USER)

    expect(org).toBe(KEY_ORG)
    // The precise failure being prevented: resolving NEWER_ORG asks Vault for
    // a key that org never had, and the user sees "AI not configured".
    expect(org).not.toBe(NEWER_ORG)
    // current_org_id() is consulted, and the table is not touched at all when
    // it answers -- so the newest-membership rule cannot win a disagreement.
    expect(calls.rpc).toContain('current_org_id')
    expect(calls.from).not.toContain('organization_memberships')
  })

  it('falls back to the newest active membership when no current org is set', async () => {
    // A fresh signup: current_organization_id is still NULL. Behaviour here is
    // deliberately unchanged, so the fix cannot remove AI from anyone it
    // already works for.
    const { client, calls } = fakeClient({
      currentOrg: null,
      memberships: [{ organization_id: NEWER_ORG, joined_at: '2026-10-05T21:37:11Z' }],
    })

    expect(await resolveOrgForRequest(client, USER)).toBe(NEWER_ORG)
    expect(calls.from).toContain('organization_memberships')
  })

  it('falls back when current_org_id() errors, rather than stranding the request', async () => {
    const { client } = fakeClient({
      currentOrgError: { message: 'boom' },
      memberships: [{ organization_id: NEWER_ORG, joined_at: '2026-10-05T21:37:11Z' }],
    })
    expect(await resolveOrgForRequest(client, USER)).toBe(NEWER_ORG)
  })

  it('falls back when the rpc throws', async () => {
    const { client } = fakeClient({
      currentOrgThrows: true,
      memberships: [{ organization_id: KEY_ORG, joined_at: '2025-12-05T00:31:18Z' }],
    })
    expect(await resolveOrgForRequest(client, USER)).toBe(KEY_ORG)
  })

  it('returns null when the user has no current org and no membership', async () => {
    // No org means no BYOK lookup and no usage attribution. The caller treats
    // null as "skip the resolver", which is the unconfigured branch -- correct,
    // because there is genuinely no tenant to resolve a key for.
    const { client } = fakeClient({ currentOrg: null, memberships: [] })
    expect(await resolveOrgForRequest(client, USER)).toBeNull()
  })

  it('never passes an organization id INTO current_org_id()', async () => {
    // The whole point of that helper: it takes no argument, so a caller cannot
    // name a tenant. If a future edit starts passing one, this fails.
    const seen: unknown[] = []
    const client = {
      rpc: async (_fn: string, args?: Record<string, unknown>) => {
        seen.push(args)
        return { data: KEY_ORG, error: null }
      },
      from: () => { throw new Error('should not be reached') },
    }
    await resolveOrgForRequest(client, USER)
    expect(seen).toEqual([undefined])
  })

  it('pins the user id on the fallback query, so it cannot read another account', async () => {
    const eqArgs: Array<[string, unknown]> = []
    const client = {
      rpc: async () => ({ data: null, error: null }),
      from: () => {
        const chain: FakeChain = {
          select: () => chain,
          eq: (col: string, val: unknown) => { eqArgs.push([col, val]); return chain },
          is: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: null, error: null }),
        }
        return chain
      },
    }
    await resolveOrgForRequest(client, USER)
    expect(eqArgs).toEqual([['user_id', USER]])
  })
})
