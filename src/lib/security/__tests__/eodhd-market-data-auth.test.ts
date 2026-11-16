/**
 * `eodhd-market-data`: authorization, ordering and data isolation.
 *
 * Registered in `supabase/functions/authz-registry.json` as
 * `serviceRole:false, authClass:user-jwt`, which requires a test on disk.
 * This is that test.
 *
 * ── Why the ORDER is the security property ────────────────────────────────
 *
 * EODHD is a single-seat subscription in a product with 28 organizations, and
 * the plan is metered. So the question is not only "is this caller allowed to
 * see the answer" but "can an unauthorized caller cause us to spend a request
 * at all". The handler must verify identity, then decide entitlement, and
 * only then touch the provider — and must not even read the API key before
 * the decision.
 *
 * ── Why this reads the source ─────────────────────────────────────────────
 *
 * `Deno.serve` cannot be invoked under vitest, and the property being
 * asserted is positional. Reading the source is the only way to check an
 * ordering without a Deno runtime.
 *
 * ── Two ways this gate was wrong before it was right ──────────────────────
 *
 * An injected `searchSymbols()` call placed BEFORE the entitlement check
 * passed this suite twice:
 *
 *   1. the ordering assertion used `lastIndexOf`, which proved only that
 *      SOME call follows authorization while the injected one sat above it;
 *   2. once that was fixed, the anchor `'decideMarketDataAccess'` matched the
 *      IMPORT statement at the top of the file, so every call site was
 *      trivially "after the decision".
 *
 * Both are fixed below: the anchor requires a `(` so it lands on the call
 * site, and EVERY occurrence must follow the decision rather than the last.
 * Re-injecting that call now fails these tests by byte offset.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const FN = resolve(
  __dirname,
  '../../../../supabase/functions/eodhd-market-data/index.ts',
)

/** Comment-stripped, so prose describing a rule cannot satisfy it. */
const code = readFileSync(FN, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '')

/** Always the CALL site, never the import. */
const at = (needle: string) => {
  const i = code.indexOf(needle)
  expect(i, `${needle} not found in the function source`).toBeGreaterThan(-1)
  return i
}

const DECISION = 'decideMarketDataAccess('

const PROVIDER_CALLS = [
  'searchSymbols(',
  'fetchLatestQuote(',
  'fetchDailyBars(',
  'fetchIntradayBars(',
]

describe('eodhd-market-data exists and is registered', () => {
  it('the function source is in the repo', () => {
    expect(existsSync(FN)).toBe(true)
    expect(code.length).toBeGreaterThan(500)
  })

  it('is registered in the authz registry with a matching posture', () => {
    const registry = JSON.parse(
      readFileSync(
        resolve(__dirname, '../../../../supabase/functions/authz-registry.json'),
        'utf8',
      ),
    ) as { functions: Record<string, { serviceRole: boolean; authClass: string; test: string | null }> }

    const entry = registry.functions['eodhd-market-data']
    expect(entry, 'eodhd-market-data must be registered').toBeTruthy()
    expect(entry.serviceRole).toBe(false)
    expect(entry.authClass).toBe('user-jwt')
    // The registry claims a test; it must be this file.
    expect(entry.test).toBe('src/lib/security/__tests__/eodhd-market-data-auth.test.ts')
  })

  it('the registry claim that it uses no service_role is TRUE in the source', () => {
    // The guard verifies this against source too; asserted here so the two
    // cannot disagree silently.
    expect(code).not.toMatch(/SERVICE_ROLE/)
  })
})

describe('identity is verified server-side', () => {
  it('uses the shared verified-user gate', () => {
    expect(at('authorizeVerifiedUser(')).toBeGreaterThan(-1)
  })

  it('does not read the retired SUPABASE_ANON_KEY', () => {
    /*
     * This function originally built its client with `SUPABASE_ANON_KEY` and
     * `edge-publishable-key.test.ts` caught it. That variable is being
     * retired across the project — only `attention` still reads it — and it
     * is the key path that already caused one ingestion outage.
     */
    expect(code).not.toContain('SUPABASE_ANON_KEY')
    expect(code).toContain('requirePublishableKey')
  })

  it('refuses a request with no verified identity before anything else', () => {
    expect(at('authorizeVerifiedUser(')).toBeLessThan(at(DECISION))
  })
})

describe('entitlement precedes every provider request', () => {
  it('decides after verifying identity', () => {
    expect(at(DECISION)).toBeGreaterThan(at('authorizeVerifiedUser('))
  })

  it('reads the API key only AFTER the decision', () => {
    // A refused caller never causes the credential to be materialised.
    expect(at("Deno.env.get('EODHD_API_KEY')")).toBeGreaterThan(at(DECISION))
  })

  it('places EVERY provider call after the decision, not merely the last one', () => {
    const decision = at(DECISION)
    for (const call of PROVIDER_CALLS) {
      const sites: number[] = []
      for (let i = code.indexOf(call); i !== -1; i = code.indexOf(call, i + 1)) sites.push(i)
      expect(sites.length, `${call} is never called`).toBeGreaterThan(0)
      const early = sites.filter(i => i < decision)
      expect(
        early,
        `${call} is invoked BEFORE the entitlement decision at offset ${early.join(', ')}`,
      ).toEqual([])
    }
  })

  it('refuses with 503 when the allowlist secret is missing', () => {
    // 503 rather than 403: the caller is not at fault and retrying will not
    // help. A silent deny would be indistinguishable from a licence refusal.
    expect(code).toContain('entitlementConfigFromEnv')
    expect(code).toMatch(/503/)
  })

  it('only ever requests interactive_read', () => {
    expect(code).toContain("use: 'interactive_read'")
    for (const forbidden of ['persisted_cache', 'shared_surface', 'ai_retrieval', 'fallback']) {
      expect(code, `${forbidden} must not be reachable from this endpoint`).not.toContain(
        `'${forbidden}'`,
      )
    }
  })
})

describe('data isolation', () => {
  it('writes to no table at all', () => {
    expect(code).not.toMatch(/\.from\(/)
    expect(code).not.toMatch(/upsert|\.insert\(/)
  })

  it('never names the global price cache', () => {
    /*
     * `price_history_cache` carries no `organization_id` and its only policy
     * is `SELECT USING (auth.uid() IS NOT NULL)`. One row written from a
     * per-seat provider would publish that subscription to every
     * authenticated user in all 28 organizations.
     */
    expect(code).not.toMatch(/price_history_cache/)
  })

  it('has no Yahoo fallback', () => {
    expect(code).not.toMatch(/yahoo/i)
  })

  it('never echoes an error message that could carry the API token', () => {
    // EODHD authenticates by query string, so a fetch error can contain the
    // token. The handler logs a name, never the message or the URL.
    const catchBlock = code.slice(code.lastIndexOf('catch (err)'))
    expect(catchBlock).not.toMatch(/err\.message/)
    expect(catchBlock).toMatch(/err\.name/)
  })
})
