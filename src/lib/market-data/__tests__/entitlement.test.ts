/**
 * The EODHD entitlement boundary.
 *
 * The licensing fact: the first EODHD subscription is a single-user plan for
 * one person's own development and testing, bought for a product that serves
 * 28 organizations in production. So these tests exist to prove that enabling
 * it for one account cannot enable it for anyone else, and in particular
 * cannot leak through the global `price_history_cache`.
 *
 * Every case is a call to a pure function, so none of it needs a database.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import {
  decideMarketDataAccess,
  mayPersistToSharedCache,
  type EntitlementConfig,
  type MarketDataUse,
} from '../../../../supabase/functions/_shared/market-data-entitlement'

const SUBSCRIBER = 'fa46cffc-dafb-4071-a3ea-5536240d462e'
const SOMEONE_ELSE = '6f54a3e1-6826-4e67-ab72-86c94bee1a94'

const config: EntitlementConfig = { eodhdAuthorizedUserIds: [SUBSCRIBER] }

const REDISTRIBUTING: MarketDataUse[] = [
  'persisted_cache',
  'shared_surface',
  'ai_retrieval',
  'fallback',
]

describe('decideMarketDataAccess', () => {
  it('refuses everything without a verified identity', () => {
    for (const provider of ['yahoo', 'eodhd'] as const) {
      const d = decideMarketDataAccess(
        { subject: { verifiedUserId: null }, provider, use: 'interactive_read' },
        config,
      )
      expect(d.allowed).toBe(false)
      expect(d.allowed === false && d.reason).toBe('unauthenticated')
    }
  })

  it('refuses an identity that is not a UUID, so a spoofed string cannot pass', () => {
    for (const bogus of ['', '  ', 'me', 'elockenvitz@gmail.com', 'admin', '*']) {
      const d = decideMarketDataAccess(
        { subject: { verifiedUserId: bogus }, provider: 'eodhd', use: 'interactive_read' },
        config,
      )
      expect(d.allowed, `"${bogus}" must not be an identity`).toBe(false)
    }
  })

  it('allows the subscriber to read EODHD interactively', () => {
    const d = decideMarketDataAccess(
      { subject: { verifiedUserId: SUBSCRIBER }, provider: 'eodhd', use: 'interactive_read' },
      config,
    )
    expect(d.allowed).toBe(true)
  })

  it('refuses EODHD to any other authenticated user', () => {
    const d = decideMarketDataAccess(
      { subject: { verifiedUserId: SOMEONE_ELSE }, provider: 'eodhd', use: 'interactive_read' },
      config,
    )
    expect(d.allowed).toBe(false)
    expect(d.allowed === false && d.reason).toBe('provider_not_entitled')
  })

  it('refuses every redistributing use of EODHD even for the subscriber', () => {
    for (const use of REDISTRIBUTING) {
      const d = decideMarketDataAccess(
        { subject: { verifiedUserId: SUBSCRIBER }, provider: 'eodhd', use },
        config,
      )
      expect(d.allowed, `${use} must not be allowed`).toBe(false)
      expect(d.allowed === false && d.reason).toBe('use_would_redistribute')
    }
  })

  it('refuses EODHD entirely when the allowlist is empty', () => {
    const d = decideMarketDataAccess(
      { subject: { verifiedUserId: SUBSCRIBER }, provider: 'eodhd', use: 'interactive_read' },
      { eodhdAuthorizedUserIds: [] },
    )
    expect(d.allowed).toBe(false)
  })

  it('does not let a junk allowlist entry authorize anybody', () => {
    // A misconfigured secret (empty strings, a wildcard, an email) must fail
    // closed rather than match.
    const junk: EntitlementConfig = {
      eodhdAuthorizedUserIds: ['', '*', 'all', 'elockenvitz@gmail.com'],
    }
    for (const who of [SUBSCRIBER, SOMEONE_ELSE, '']) {
      const d = decideMarketDataAccess(
        { subject: { verifiedUserId: who }, provider: 'eodhd', use: 'interactive_read' },
        junk,
      )
      expect(d.allowed).toBe(false)
    }
  })

  it('matches the subscriber UUID case-insensitively', () => {
    const d = decideMarketDataAccess(
      { subject: { verifiedUserId: SUBSCRIBER.toUpperCase() }, provider: 'eodhd', use: 'interactive_read' },
      config,
    )
    expect(d.allowed).toBe(true)
  })

  it('leaves Yahoo working for every authenticated user and use', () => {
    // Narrowing Yahoo would take the product down rather than make it
    // compliant; this pins that the boundary did not accidentally do that.
    for (const use of ['interactive_read', ...REDISTRIBUTING] as MarketDataUse[]) {
      const d = decideMarketDataAccess(
        { subject: { verifiedUserId: SOMEONE_ELSE }, provider: 'yahoo', use },
        config,
      )
      expect(d.allowed, `yahoo/${use} must stay allowed`).toBe(true)
    }
  })

  it('fails closed on an unrecognised provider', () => {
    const d = decideMarketDataAccess(
      // @ts-expect-error deliberately outside the union, which is the point
      { subject: { verifiedUserId: SUBSCRIBER }, provider: 'polygon', use: 'interactive_read' },
      config,
    )
    expect(d.allowed).toBe(false)
    expect(d.allowed === false && d.reason).toBe('unknown_provider')
  })
})

describe('mayPersistToSharedCache', () => {
  it('refuses EODHD, because price_history_cache is global and world-readable', () => {
    // The table carries no organization_id and its only policy is
    // SELECT USING (auth.uid() IS NOT NULL). One write would redistribute a
    // single-seat subscription to all 28 organizations.
    expect(mayPersistToSharedCache('eodhd')).toBe(false)
  })

  it('still allows Yahoo, which is what fills the cache today', () => {
    expect(mayPersistToSharedCache('yahoo')).toBe(true)
  })
})

/**
 * The boundary is structural, not just logical.
 *
 * Authorization that the authorized party can edit is not authorization. These
 * two tests pin the two ways that could happen here.
 */
describe('the decision cannot be made by the client', () => {
  const REPO = resolve(__dirname, '../../../..')

  const walk = (dir: string): string[] => {
    const out: string[] = []
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) out.push(...walk(full))
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
    }
    return out
  }

  /*
   * Test files are exempt, as a class.
   *
   * They are not part of the production build, so importing the decision in a
   * test cannot put it in the browser bundle — and two suites legitimately do
   * (this one and `price-safety.test.ts`, which pins the shared-cache rule
   * alongside the price rules). The guard is about shipped code.
   *
   * It is `.test.ts` that is exempt, not a named file: exempting the one path
   * that happened to trip it would have left the next one to be discovered in
   * review.
   */
  const isTestFile = (f: string) => /\.test\.tsx?$/.test(f)

  it('no shipped file under src/ imports the entitlement module', () => {
    const shipped = walk(resolve(REPO, 'src')).filter(f => !isTestFile(f))
    const offenders = shipped.filter(f =>
      /market-data-entitlement/.test(readFileSync(f, 'utf8')),
    )
    expect(
      offenders.map(f => f.replace(REPO, '')),
      'the entitlement decision must not be reachable from the browser bundle',
    ).toEqual([])
  })

  it('that guard actually scanned the tree, rather than an empty list', () => {
    // A walk that silently returned nothing would make the assertion above
    // pass forever. src/ is large; assert it is being read.
    const shipped = walk(resolve(REPO, 'src')).filter(f => !isTestFile(f))
    expect(shipped.length).toBeGreaterThan(500)
    // And the exemption is narrow: the suites that DO import it are tests.
    const importers = walk(resolve(REPO, 'src')).filter(f =>
      /market-data-entitlement/.test(readFileSync(f, 'utf8')),
    )
    expect(importers.length).toBeGreaterThan(0)
    expect(importers.every(isTestFile)).toBe(true)
  })

  it('the decision never consults an email or a client-supplied id', () => {
    /*
     * Scoped to `decideMarketDataAccess`'s own body, not the whole file.
     *
     * Checking the file failed once `entitlementConfigFromEnv` gained the
     * diagnostic "An email address or a username is not an identity here" —
     * a string that exists to tell an operator email is NOT accepted. The
     * property worth guarding is that the DECISION does not branch on an
     * email, a header or a request body, so that is what is read.
     */
    const src = readFileSync(
      resolve(REPO, 'supabase/functions/_shared/market-data-entitlement.ts'),
      'utf8',
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

    const start = code.indexOf('export function decideMarketDataAccess')
    expect(start, 'decideMarketDataAccess not found').toBeGreaterThan(-1)
    const after = code.slice(start)
    const end = after.indexOf('\nexport ', 1)
    const body = end === -1 ? after : after.slice(0, end)

    expect(body.length).toBeGreaterThan(200)
    expect(body).not.toMatch(/\bemail\b/)
    expect(body).not.toMatch(/\bheaders?\b/)
    expect(body).not.toMatch(/\bbody\b/)
    // And it does reference the one identity that is verified server-side.
    expect(body).toMatch(/verifiedUserId/)
  })
})
