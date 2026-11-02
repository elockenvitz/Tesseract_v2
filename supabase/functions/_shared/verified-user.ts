/**
 * Minimum authorization for a browser-facing Edge Function that fetches global
 * data from a paid external API and caches it with a privileged key.
 *
 * ── Why a gate at all ─────────────────────────────────────────────────────
 *
 * The gateway's `verify_jwt` admits the project's publishable key, which ships
 * in the browser bundle. So `verify_jwt` on its own lets an anonymous caller
 * on the open internet run up the external-API bill and poison the shared
 * cache. The minimum gate is: the caller must present a JWT that resolves to a
 * real signed-in user. There is no per-tenant check because the cache holds
 * global market data and no org-owned rows, so the authorization IS "a real
 * user, not the bare publishable key."
 *
 * ── Why the token is passed explicitly ───────────────────────────────────
 *
 * The first version of this gate called `userClient.auth.getUser()` with no
 * argument and relied on the client forwarding the caller's `Authorization`
 * header. That worked in the functions pinned to `@supabase/supabase-js@2`
 * and did NOT work in the two pinned to `@2.39.0` -- `market-news` and
 * `market-events` -- whose older bundled auth client resolves the no-argument
 * call through its own (empty) session store rather than through the forwarded
 * header.
 *
 * Measured live on 2026-11-02 with one valid, unexpired session JWT:
 *
 *     ai-chat             @2        400 "Message is required"  (past the gate)
 *     market-news         @2.39.0   401 "Unauthorized"
 *     market-events       @2.39.0   401 "Unauthorized"
 *
 * Same token, same publishable key, same gate code. Over the 24h before that,
 * `market-news` took 45 POSTs and answered 401 to all 45 -- the news feed had
 * been dark since the gate shipped, and nothing said why.
 *
 * `getUser(token)` takes the documented single-request path: it sends the token
 * as the bearer and the client's own key as `apikey`, with no session store in
 * the way. It is version-independent, which is the point.
 *
 * ── Why a configuration failure is not a 401 ─────────────────────────────
 *
 * This is the defect that made the outage invisible for two weeks. The gate
 * had exactly two answers, and "the caller is not signed in" and "this
 * function's own API key is disabled" were both of them spelled `401
 * Unauthorized`. The project's legacy `anon` and `service_role` keys were
 * disabled on 2026-10-03; had the function's key been one of them, every
 * reader would have seen the same word a signed-out stranger sees.
 *
 * So a failure that names an API key is reported as 503. The caller cannot fix
 * it and never caused it, and a 503 that says `configuration` is a sentence
 * somebody can act on. It grants nothing either way.
 *
 * Deliberately free of Deno, network and `createClient` APIs: the caller
 * injects a `getUser`-capable client, so this runs before any external fetch
 * or privileged write and is exercised directly from vitest with fakes. Same
 * reasoning as `publishable-key.ts`.
 */

export interface VerifiedUser { id: string }

/** The one method this gate needs. `supabase.auth` satisfies it. */
export interface UserClient {
  auth: {
    getUser(jwt?: string): Promise<{ data: { user: VerifiedUser | null }; error: unknown }>
  }
}

export type VerifiedUserResult =
  | { ok: true; user: VerifiedUser }
  /** The caller is not a signed-in user. */
  | { ok: false; status: 401; error: string }
  /**
   * This function's own API key was rejected. Nothing about the caller is
   * wrong, so saying "Unauthorized" would send them hunting their own session.
   */
  | { ok: false; status: 503; error: string; reason: string }

/**
 * The bare token out of an `Authorization` header.
 *
 * Returns null for an absent, blank, or scheme-only header. The scheme is
 * matched case-insensitively because `bearer` and `Bearer` both occur in the
 * wild, and a header that is just a token with no scheme is accepted rather
 * than rejected -- some clients send it that way and the token is what the
 * gate actually verifies.
 */
export function bearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null
  const trimmed = authHeader.trim()
  if (!trimmed) return null
  const m = trimmed.match(/^Bearer\b\s*(.*)$/i)
  // A header that IS the scheme and nothing else has no token. Falling through
  // to the no-scheme branch below would send the literal string "Bearer" to
  // the auth server as a credential, which the first version of this did.
  const token = (m ? m[1] : trimmed).trim()
  return token ? token : null
}

/**
 * Messages that mean "this function's key is wrong", not "this caller is".
 *
 * The client replaces the caller's `apikey` with its own, so an API-key
 * complaint from the auth server can only be about server configuration.
 * Covers GoTrue's three wordings: `No API key found in request`,
 * `Invalid API key`, and `Legacy API keys are disabled`.
 */
function isKeyConfigurationFailure(message: string): boolean {
  return /api\s*keys?/i.test(message)
}

/** Whatever the auth client put in `error`, as a string, without throwing. */
function messageOf(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  const m = (error as { message?: unknown }).message
  return typeof m === 'string' ? m : ''
}

export async function authorizeVerifiedUser(
  authHeader: string | null,
  userClient: UserClient,
): Promise<VerifiedUserResult> {
  const token = bearerToken(authHeader)
  if (!token) {
    return { ok: false, status: 401, error: 'Missing authorization header' }
  }

  let result: { data: { user: VerifiedUser | null }; error: unknown }
  try {
    // Explicit token. See the header comment: the no-argument call reads the
    // client's own session store, which an Edge Function never has.
    result = await userClient.auth.getUser(token)
  } catch (thrown) {
    // A throw here is the auth call failing, not the caller being anonymous.
    return {
      ok: false,
      status: 503,
      error: 'Authorization service unavailable',
      reason: messageOf(thrown) || 'the auth request threw',
    }
  }

  const message = messageOf(result.error)
  if (message && isKeyConfigurationFailure(message)) {
    return {
      ok: false,
      status: 503,
      error: 'Authorization is misconfigured for this function',
      // The auth server's own words. They name the key by ROLE, never by
      // value, so this is safe to return and is the whole diagnostic.
      reason: message,
    }
  }

  if (result.error || !result.data.user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  return { ok: true, user: result.data.user }
}
