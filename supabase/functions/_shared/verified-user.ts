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
 * ── The JWT is passed EXPLICITLY, and must stay that way ─────────────────
 *
 * `getUser(token)` takes the token as an argument rather than letting the
 * client find it on the `Authorization` header it was constructed with. That
 * is not a style preference; the headerless form broke production.
 *
 * On 2026-11-08, yahoo-chart-proxy version 10 refused EVERY caller, real
 * signed-in users included, with `{"error":"Unauthorized"}`. The token was
 * valid: GoTrue's own /auth/v1/user returned `role: authenticated` for it, and
 * market-events and market-news accepted the very same token. The cause was in
 * the dependency, not in this code. `supabase-js@2.39.0` declares its auth
 * dependency as a RANGE, `@supabase/gotrue-js@^2.56.0`, which esm.sh resolved
 * at bundle time to 2.119.0, whose `_getUser` reads:
 *
 *     return !(session?.access_token) && !this.hasCustomAuthorizationHeader
 *       ? { data: { user: null }, error: new AuthSessionMissingError() }
 *       : request(...)
 *
 * Server-side there is no session (`persistSession: false`), and
 * `hasCustomAuthorizationHeader` is false because supabase-js 2.39.0 predates
 * that flag and never sets it. So the headerless call could only ever fail.
 * market-events and market-news survived purely because their bundles were
 * built days earlier, when the same range resolved to a gotrue-js without that
 * guard, which is to say they were one redeploy away from the same outage.
 *
 * The explicit form takes `_getUser`'s first branch and depends on no flag, no
 * stored session and no library version. Do not change it back to `getUser()`.
 *
 * Deliberately free of Deno, network, and createClient APIs: the caller injects a
 * getUser()-capable client, so this runs before any external fetch or service_role
 * write and is exercised directly from vitest with fakes.
 */

export interface VerifiedUser { id: string }

export interface UserClient {
  auth: { getUser(jwt?: string): Promise<{ data: { user: VerifiedUser | null }; error: unknown }> }
}

export type VerifiedUserResult =
  | { ok: true; user: VerifiedUser }
  | { ok: false; status: 401; error: string }

/**
 * The bearer token out of an `Authorization` header, or null if there is not
 * one. Case-insensitive on the scheme, because the header is.
 */
export function bearerToken(authHeader: string | null): string | null {
  if (!authHeader) return null
  const match = /^Bearer[ \t]+(\S.*)$/i.exec(authHeader.trim())
  const token = match?.[1]?.trim()
  return token ? token : null
}

export async function authorizeVerifiedUser(
  authHeader: string | null,
  userClient: UserClient,
): Promise<VerifiedUserResult> {
  if (!authHeader) {
    return { ok: false, status: 401, error: 'Missing authorization header' }
  }
  const token = bearerToken(authHeader)
  if (!token) {
    // A header that is present but carries no bearer token. Previously this
    // reached getUser() and was refused there; refusing it here is the same
    // answer without a network round trip.
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }
  return { ok: true, user }
}
