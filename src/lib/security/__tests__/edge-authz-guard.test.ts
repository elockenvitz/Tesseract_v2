/**
 * The Edge-function authorization guard (CLAUDE.md Rule 6) enforces that every
 * function is registered, the service_role flag matches source, service_role
 * functions are reviewed, and user-reachable privileged classes carry a runtime
 * test that exists. These are the decision-core cases, exercised directly.
 *
 * Also asserts the guard is non-vacuous: it FLAGS a deliberately-introduced
 * unregistered service_role function and a privileged class whose test is missing.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs guard, no type decls
import { evaluateAuthz, sourceUsesServiceRole } from '../../../../scripts/edge-authz-guard.mjs'

const present = () => true
const absent = () => false

describe('edge-authz guard — decision core', () => {
  it('passes a reviewed platform-admin service_role function with an existing test', () => {
    const r = evaluateAuthz(
      [{ name: 'seed', usesServiceRole: true }],
      { seed: { serviceRole: true, reviewed: true, authClass: 'platform-admin', test: 't.ts' } },
      present,
    )
    expect(r.errors).toEqual([])
  })

  it('FAILS a new unregistered service_role function (regression: privileged fn added without review)', () => {
    const r = evaluateAuthz(
      [{ name: 'rogue', usesServiceRole: true }],
      {}, // not in registry
      present,
    )
    expect(r.errors.some((e) => /rogue/.test(e) && /registry/.test(e))).toBe(true)
  })

  it('FAILS a service_role function that is registered but not yet reviewed', () => {
    const r = evaluateAuthz(
      [{ name: 'cron1', usesServiceRole: true }],
      { cron1: { serviceRole: true, reviewed: false, authClass: null, test: null } },
      present,
    )
    expect(r.errors.some((e) => /cron1/.test(e) && /pending authorization review/.test(e))).toBe(true)
  })

  it('FAILS when source uses service_role but the registry says it does not (and vice versa)', () => {
    const r = evaluateAuthz(
      [{ name: 'drift', usesServiceRole: true }],
      { drift: { serviceRole: false, reviewed: true, authClass: 'user-jwt-rls' } },
      present,
    )
    expect(r.errors.some((e) => /drift/.test(e) && /serviceRole/.test(e))).toBe(true)
  })

  it('FAILS a privileged (platform-admin) class whose referenced test is MISSING', () => {
    const r = evaluateAuthz(
      [{ name: 'seed', usesServiceRole: true }],
      { seed: { serviceRole: true, reviewed: true, authClass: 'platform-admin', test: 'missing.ts' } },
      absent, // test file not on disk
    )
    expect(r.errors.some((e) => /seed/.test(e) && /requires a runtime authorization test/.test(e))).toBe(true)
  })

  it('WARNS (does not error) on an api-key service_role function without a test', () => {
    const r = evaluateAuthz(
      [{ name: 'hk', usesServiceRole: true }],
      { hk: { serviceRole: true, reviewed: true, authClass: 'api-key', test: null } },
      absent,
    )
    expect(r.errors).toEqual([])
    expect(r.warnings.some((w) => /hk/.test(w))).toBe(true)
  })

  it('does not require a test for non-service_role functions', () => {
    const r = evaluateAuthz(
      [{ name: 'proxy', usesServiceRole: false }],
      { proxy: { serviceRole: false, reviewed: true, authClass: 'public-proxy', test: null } },
      absent,
    )
    expect(r.errors).toEqual([])
  })

  it('sourceUsesServiceRole detects the service-role env var', () => {
    expect(sourceUsesServiceRole("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')")).toBe(true)
    expect(sourceUsesServiceRole("createClient(url, requirePublishableKey(...))")).toBe(false)
  })
})
