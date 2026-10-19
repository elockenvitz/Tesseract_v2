/**
 * The Edge-function authorization guard (CLAUDE.md Rule 6) enforces that every
 * function is registered, the service_role flag matches source, service_role
 * functions are reviewed, and user-reachable privileged classes carry a runtime
 * test that (a) exists, (b) contains executable it()/expect() assertions — not an
 * empty placeholder — and (c) lives in the vitest unit scope so `npm test` runs it.
 * These are the decision-core cases, exercised directly.
 *
 * Also asserts the guard is non-vacuous: it FLAGS a deliberately-introduced
 * unregistered service_role function, a service_role/source drift, a missing
 * test, an empty-placeholder test, and a test outside CI scope.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs guard, no type decls
import { evaluateAuthz, sourceUsesServiceRole, sourceHasUnrecognizedClient, testIsExecutable, pathInCiScope } from '../../../../scripts/edge-authz-guard.mjs'

// A real, runnable test file under src/**/*.test.ts.
const good = () => ({ exists: true, executable: true, inCiScope: true })
const missing = () => ({ exists: false, executable: false, inCiScope: false })
const emptyPlaceholder = () => ({ exists: true, executable: false, inCiScope: true })
const outOfScope = () => ({ exists: true, executable: true, inCiScope: false })

describe('edge-authz guard — decision core', () => {
  it('passes a reviewed platform-admin service_role function with a real, in-scope test', () => {
    const r = evaluateAuthz(
      [{ name: 'seed', usesServiceRole: true }],
      { seed: { serviceRole: true, reviewed: true, authClass: 'platform-admin', test: 'src/x.test.ts' } },
      good,
    )
    expect(r.errors).toEqual([])
  })

  it('FAILS a new unregistered service_role function (regression: privileged fn added without review)', () => {
    const r = evaluateAuthz([{ name: 'rogue', usesServiceRole: true }], {}, good)
    expect(r.errors.some((e: string) => /rogue/.test(e) && /registry/.test(e))).toBe(true)
  })

  it('FAILS a service_role function that is registered but not yet reviewed', () => {
    const r = evaluateAuthz(
      [{ name: 'cron1', usesServiceRole: true }],
      { cron1: { serviceRole: true, reviewed: false, authClass: null, test: null } },
      good,
    )
    expect(r.errors.some((e: string) => /cron1/.test(e) && /pending authorization review/.test(e))).toBe(true)
  })

  it('FAILS when source uses service_role but the registry says it does not (drift)', () => {
    const r = evaluateAuthz(
      [{ name: 'drift', usesServiceRole: true }],
      { drift: { serviceRole: false, reviewed: true, authClass: 'user-jwt' } },
      good,
    )
    expect(r.errors.some((e: string) => /drift/.test(e) && /serviceRole/.test(e))).toBe(true)
  })

  it('FAILS a privileged (platform-admin) class whose referenced test is MISSING', () => {
    const r = evaluateAuthz(
      [{ name: 'seed', usesServiceRole: true }],
      { seed: { serviceRole: true, reviewed: true, authClass: 'platform-admin', test: 'src/missing.test.ts' } },
      missing,
    )
    expect(r.errors.some((e: string) => /seed/.test(e) && /does not exist/.test(e))).toBe(true)
  })

  it('FAILS a privileged class whose test is an EMPTY PLACEHOLDER (exists but no it()/expect())', () => {
    const r = evaluateAuthz(
      [{ name: 'seed', usesServiceRole: true }],
      { seed: { serviceRole: true, reviewed: true, authClass: 'platform-admin', test: 'src/empty.test.ts' } },
      emptyPlaceholder,
    )
    expect(r.errors.some((e: string) => /seed/.test(e) && /empty placeholder/.test(e))).toBe(true)
  })

  it('FAILS a privileged class whose test is outside src/**/*.test.ts (npm test would not run it)', () => {
    const r = evaluateAuthz(
      [{ name: 'seed', usesServiceRole: true }],
      { seed: { serviceRole: true, reviewed: true, authClass: 'user-jwt', test: 'supabase/functions/seed/test.ts' } },
      outOfScope,
    )
    expect(r.errors.some((e: string) => /seed/.test(e) && /npm test/.test(e))).toBe(true)
  })

  it('WARNS (does not error) on an api-key service_role function without a test', () => {
    const r = evaluateAuthz(
      [{ name: 'hk', usesServiceRole: true }],
      { hk: { serviceRole: true, reviewed: true, authClass: 'api-key', test: null } },
      missing,
    )
    expect(r.errors).toEqual([])
    expect(r.warnings.some((w: string) => /hk/.test(w))).toBe(true)
  })

  it('WARNS on a non-service_role function that builds a client with an unrecognized key source', () => {
    const r = evaluateAuthz(
      [{ name: 'odd', usesServiceRole: false, unrecognizedClient: true }],
      { odd: { serviceRole: false, reviewed: true, authClass: 'public-proxy', test: null } },
      missing,
    )
    expect(r.errors).toEqual([])
    expect(r.warnings.some((w: string) => /odd/.test(w) && /unrecognized key source/.test(w))).toBe(true)
  })

  it('does not require a test for non-service_role functions', () => {
    const r = evaluateAuthz(
      [{ name: 'proxy', usesServiceRole: false }],
      { proxy: { serviceRole: false, reviewed: true, authClass: 'public-proxy', test: null } },
      missing,
    )
    expect(r.errors).toEqual([])
  })

  it('sourceUsesServiceRole detects the service-role env var but not the publishable path', () => {
    expect(sourceUsesServiceRole("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")).toBe(true)
    expect(sourceUsesServiceRole("createClient(url, requirePublishableKey(req))")).toBe(false)
  })

  it('testIsExecutable rejects an empty placeholder and accepts a real test', () => {
    expect(testIsExecutable('// TODO: write tests')).toBe(false)
    expect(testIsExecutable('describe("x", () => {})')).toBe(false)
    expect(testIsExecutable('it("denies cross-org", () => { expect(x).toBe(1) })')).toBe(true)
  })

  it('pathInCiScope only accepts src/**/*.test.ts(x)', () => {
    expect(pathInCiScope('src/lib/security/__tests__/seed.test.ts')).toBe(true)
    expect(pathInCiScope('supabase/functions/seed/authz.test.ts')).toBe(false)
  })

  it('sourceHasUnrecognizedClient flags a bare createClient but not the publishable helper', () => {
    expect(sourceHasUnrecognizedClient("createClient(url, someMysteryKey)")).toBe(true)
    expect(sourceHasUnrecognizedClient("createClient(url, requirePublishableKey(req))")).toBe(false)
    expect(sourceHasUnrecognizedClient("const x = 1")).toBe(false)
  })
})
