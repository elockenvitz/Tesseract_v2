/**
 * seed-pilot-data runs with the service-role key and provisions auth users,
 * organization memberships and sample content into a caller-named
 * organization_id (POST), or deletes an org's demo data (DELETE). The gateway's
 * verify_jwt admits any signed-in user's JWT (and the publishable key itself),
 * so the function's own gate is the only thing stopping an ordinary user from
 * provisioning/wiping an arbitrary tenant.
 *
 * The gate module is pure, so it is exercised directly. The handler is Deno, so
 * its ordering is asserted on the source: no service_role client may be
 * constructed before the gate has returned ok.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { authorizeSeedRequest } from '../../../../supabase/functions/seed-pilot-data/authorize'

const ORG = '4b4713e8-d5da-4dc9-a465-c06a71248a12'

describe('who may seed/wipe pilot demo data', () => {
  it('rejects a non-POST/DELETE method before anything else (405)', () => {
    expect(authorizeSeedRequest({ method: 'GET', hasVerifiedUser: true, isPlatformAdmin: true, organizationId: ORG }))
      .toEqual({ ok: false, status: 405, reason: 'method_not_allowed' })
  })

  it('rejects a missing/invalid JWT — no verified user (401)', () => {
    for (const method of ['POST', 'DELETE']) {
      expect(authorizeSeedRequest({ method, hasVerifiedUser: false, isPlatformAdmin: false, organizationId: ORG }))
        .toEqual({ ok: false, status: 401, reason: 'unauthenticated' })
    }
  })

  it('rejects a normal signed-in user who is not a platform admin (403)', () => {
    expect(authorizeSeedRequest({ method: 'POST', hasVerifiedUser: true, isPlatformAdmin: false, organizationId: ORG }))
      .toEqual({ ok: false, status: 403, reason: 'not_platform_admin' })
  })

  it('rejects an organization admin who is not a PLATFORM admin (403)', () => {
    // org-admin status is irrelevant here; only platform_admins may provision.
    expect(authorizeSeedRequest({ method: 'DELETE', hasVerifiedUser: true, isPlatformAdmin: false, organizationId: ORG }))
      .toEqual({ ok: false, status: 403, reason: 'not_platform_admin' })
  })

  it('rejects cross-org targeting by a non-admin identically, without probing org existence (403)', () => {
    expect(authorizeSeedRequest({ method: 'POST', hasVerifiedUser: true, isPlatformAdmin: false, organizationId: 'some-other-org' }))
      .toEqual({ ok: false, status: 403, reason: 'not_platform_admin' })
  })

  it('rejects a platform admin who supplies a missing/malformed organization_id (400)', () => {
    for (const bad of [undefined, null, '', 'not-a-uuid', 123, {}]) {
      expect(authorizeSeedRequest({ method: 'POST', hasVerifiedUser: true, isPlatformAdmin: true, organizationId: bad }))
        .toEqual({ ok: false, status: 400, reason: 'invalid_organization_id' })
    }
  })

  it('allows a platform admin with a valid org id, for both POST and DELETE', () => {
    expect(authorizeSeedRequest({ method: 'POST', hasVerifiedUser: true, isPlatformAdmin: true, organizationId: ORG })).toEqual({ ok: true })
    expect(authorizeSeedRequest({ method: 'DELETE', hasVerifiedUser: true, isPlatformAdmin: true, organizationId: ORG })).toEqual({ ok: true })
  })
})

describe('handler builds nothing privileged before the gate', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/seed-pilot-data/index.ts'),
    'utf8',
  )
  it('reads the service-role key only after the authorization decision', () => {
    const gate = src.indexOf('authorizeSeedRequest(')
    const decision = src.indexOf('if (!decision.ok)')
    const serviceRole = src.indexOf('SUPABASE_SERVICE_ROLE_KEY')
    expect(gate).toBeGreaterThan(0)
    expect(decision).toBeGreaterThan(gate)
    expect(serviceRole).toBeGreaterThan(decision)
  })
  it('derives platform-admin from is_platform_admin(), not from JWT claims', () => {
    expect(src).toContain("rpc('is_platform_admin')")
    expect(src).not.toMatch(/app_metadata.*(admin|platform)/i)
  })
})
