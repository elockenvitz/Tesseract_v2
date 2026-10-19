/**
 * Minimum authorization for a browser-facing Edge Function that fetches global
 * data from a paid external API and caches it via the service-role key.
 *
 * The gateway's verify_jwt admits the public anon key (a validly signed project
 * JWT that ships in the browser bundle), so verify_jwt alone would let an
 * unauthenticated internet caller run up the external-API bill and poison the
 * shared cache. The minimum gate is: the caller must present a JWT that resolves
 * to a real signed-in user via auth.getUser() on a publishable-key client — the
 * same pattern ai-chat uses. There is no per-tenant check because the cache holds
 * global market data (no org-owned rows); the authorization IS "a real user, not
 * the bare anon key."
 *
 * Deliberately free of Deno, network, and createClient APIs: the caller injects a
 * getUser()-capable client, so this runs before any external fetch or service_role
 * write and is exercised directly from vitest with fakes.
 */

export interface VerifiedUser { id: string }

export interface UserClient {
  auth: { getUser(): Promise<{ data: { user: VerifiedUser | null }; error: unknown }> }
}

export type VerifiedUserResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; status: 401; error: string }

export async function authorizeVerifiedUser(
  authHeader: string | null,
  userClient: UserClient,
): Promise<VerifiedUserResult> {
  if (!authHeader) {
    return { ok: false, status: 401, error: 'Missing authorization header' }
  }
  const { data: { user }, error } = await userClient.auth.getUser()
  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  return { ok: true, user }
}
