import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  },
  realtime: {
    params: {
      eventsPerSecond: 10
    }
  }
})

// Helper function to get current user
export const getCurrentUser = async () => {
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) throw error
  return user
}

// Helper function to check if user is authenticated
export const isAuthenticated = async () => {
  const { data: { session } } = await supabase.auth.getSession()
  return !!session
}

/**
 * Call an edge function as the SIGNED-IN USER, not as the publishable key.
 *
 * ── What `supabase.functions.invoke` actually sends ───────────────────────
 *
 * Not the user's token. In supabase-js 2.56 the `functions` getter builds its
 * client from `this.headers` alone:
 *
 *     get functions() {
 *       return new FunctionsClient(this.functionsUrl.href, {
 *         headers: this.headers, customFetch: this.fetch,
 *       })
 *     }
 *
 * `this.headers` is fixed at construction and carries
 * `Authorization: Bearer <supabaseKey>`. The client's own
 * `_getAccessToken()` -- which prefers the session's `access_token` -- is
 * wired into `rest` and `realtime` and never consulted here. So every
 * `functions.invoke` goes out bearing the PUBLISHABLE KEY, and the function
 * sees no user however signed-in the caller is.
 *
 * ── Why that is not the same as "invoke is broken" ───────────────────────
 *
 * It is not, and claiming so was wrong. Measured over 24h of this project's
 * `function_edge_logs`: `yahoo-chart-proxy` took 1028 POSTs through
 * `functions.invoke` and answered 200 to every one, on the same
 * `verify_jwt: true` setting. The gateway admits the publishable key.
 *
 * What it cannot do is satisfy a function that checks for a REAL USER. A
 * function calling `auth.getUser()` on the forwarded Authorization header --
 * which `market-news` and `market-events` both do, through
 * `_shared/verified-user.ts`, so that an anonymous caller cannot run up a
 * paid provider bill -- resolves the publishable key to no user and returns
 * its own 401. Same 24h window: `market-news`, 45 POSTs, 45 of them 401.
 *
 * So this helper is for the functions that want a user. It is the pattern the
 * `ai-chat` callers already use (raw fetch, explicit
 * `Bearer <access_token>`), stated once so the reason lives in one place.
 *
 * Falls back to the publishable key when there is no session, which is what
 * the `verify_jwt: false` functions want and is no worse than today.
 *
 * ── Known to be NOT SUFFICIENT on its own, as of 2026-11-02 ─────────────
 *
 * `market-news` still answers 401 to a valid, unexpired session JWT. The
 * gate's own `auth.getUser()` needs an `apikey` header as well as the
 * bearer -- verified live: `GET /auth/v1/user` with the publishable key as
 * `apikey` plus the session bearer returns 200, and the same request without
 * `apikey` returns `No API key found in request`. The function builds its
 * client with `requirePublishableKey(...)` out of the
 * `SUPABASE_PUBLISHABLE_KEYS` secret, so if that secret is stale the gate
 * rejects every caller no matter what the client sends. That is a deployed
 * secret, not code, and it is not changed from here.
 */
export async function invokeEdgeFunction<T>(name: string, body: unknown): Promise<T> {
  // `getSession` can reject outright, not merely return no session. An
  // uncaught rejection here took the app down once already.
  let token = supabaseAnonKey
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) token = data.session.access_token
  } catch {
    /* No session to be had; the publishable key is the honest fallback. */
  }

  const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The gateway wants both: `apikey` identifies the project, and
      // `Authorization` is what `verify_jwt` actually validates.
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    // The status is the diagnosis -- 401 means this seam, 500 means the
    // function -- so it is carried rather than flattened to "failed".
    const detail = await res.text().catch(() => '')
    throw new Error(`${name} failed: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`)
  }
  return (await res.json()) as T
}