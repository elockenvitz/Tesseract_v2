/**
 * Who may seed or wipe pilot demo data.
 *
 * seed-pilot-data runs with the service-role key and creates auth users,
 * organization memberships and sample content for a caller-named
 * organization_id. The gateway's verify_jwt is not enough: the public
 * publishable/anon key is a validly signed project JWT that ships in the
 * browser bundle, and any signed-in user's JWT is also accepted. So the
 * function's own gate is the only thing between an ordinary user and
 * provisioning (or deleting) data in an arbitrary tenant.
 *
 * This module is the gate's decision, kept pure (no Deno, no network, no JWT
 * decoding) so it is exercised directly from vitest and evaluated before the
 * handler builds anything privileged. The handler is responsible for turning a
 * verified JWT into `hasVerifiedUser` and for deriving `isPlatformAdmin` from
 * trusted server-side data (the platform_admins table via is_platform_admin()),
 * never from caller-controlled JWT claims.
 */

export type SeedAuthFailure =
  | 'method_not_allowed'
  | 'unauthenticated'
  | 'not_platform_admin'
  | 'invalid_organization_id'

export type SeedAuthResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 405; reason: SeedAuthFailure }

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface SeedAuthInput {
  method: string
  /** True only when the forwarded JWT resolved to a real user (auth.getUser succeeded). */
  hasVerifiedUser: boolean
  /** Derived server-side from platform_admins (is_platform_admin()), not from JWT claims. */
  isPlatformAdmin: boolean
  /** The caller-supplied target org id (validated for shape here, before any service_role op). */
  organizationId: unknown
}

/**
 * Fail closed, in order: wrong method, unauthenticated, not a platform admin,
 * malformed organization id. The admin check precedes the org-shape check so an
 * ordinary caller is rejected identically regardless of the org they named — no
 * probing of which orgs exist.
 */
export function authorizeSeedRequest(input: SeedAuthInput): SeedAuthResult {
  const { method, hasVerifiedUser, isPlatformAdmin, organizationId } = input

  if (method !== 'POST' && method !== 'DELETE') {
    return { ok: false, status: 405, reason: 'method_not_allowed' }
  }
  if (!hasVerifiedUser) {
    return { ok: false, status: 401, reason: 'unauthenticated' }
  }
  if (!isPlatformAdmin) {
    return { ok: false, status: 403, reason: 'not_platform_admin' }
  }
  if (typeof organizationId !== 'string' || !UUID_RE.test(organizationId)) {
    return { ok: false, status: 400, reason: 'invalid_organization_id' }
  }
  return { ok: true }
}
