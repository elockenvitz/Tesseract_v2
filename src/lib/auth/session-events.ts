/**
 * Which auth events are worth rebuilding the application for.
 *
 * ── The defect this exists to close ───────────────────────────────────────
 *
 * `onAuthStateChange` was handled with a single unconditional call: every
 * event ran the same routine, which fetches the user's profile row over the
 * network and then calls `setUser` with a freshly constructed object.
 *
 * Supabase fires `TOKEN_REFRESHED` whenever its auto-refresh timer catches up,
 * and a backgrounded phone browser catches up the moment it is foregrounded. So
 * returning to the tab meant a network round trip and a new `user` object
 * identity handed to every consumer of `useAuth` — for an event that, by
 * definition, tells you nothing about the user has changed. Only the bearer
 * token did, and supabase-js already owns that.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *
 * It is not a credential cache and it does not decide whether a session is
 * valid. supabase-js remains the only authority on the token; this only decides
 * whether the REACT layer needs rebuilding. A sign-in, a sign-out, a user
 * swapping accounts and a password recovery all still rebuild, because each of
 * those genuinely changes who is using the application.
 */

/** The events supabase-js emits, narrowed to the ones this decision cares about. */
export type AuthEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'
  | (string & {})

/**
 * Whether this event changes WHO is using the application.
 *
 * `currentUserId` is what React is currently rendering; `nextUserId` is what the
 * event carries. They are compared rather than assumed, because a token refresh
 * arriving for a different user — an account swap in another tab, a morph
 * session — is a real change wearing a quiet event name.
 */
export function isMaterialAuthChange(
  event: AuthEvent,
  nextUserId: string | null | undefined,
  currentUserId: string | null | undefined,
): boolean {
  // Identity moved. Always material, whatever the event was called.
  if ((nextUserId ?? null) !== (currentUserId ?? null)) return true

  switch (event) {
    /*
      The token rotated and the user did not. Nothing in the React tree depends
      on the token's value — requests read it from supabase-js at call time — so
      rebuilding for this is work with no output.
    */
    case 'TOKEN_REFRESHED':
      return false

    /*
      Re-announcements of a session already being rendered. supabase-js emits
      `INITIAL_SESSION` on every client construction, and `SIGNED_IN` again on
      some resume paths, for the same user who is already signed in.
    */
    case 'INITIAL_SESSION':
    case 'SIGNED_IN':
      return currentUserId == null

    /*
      The profile itself changed, so the row this layer caches is now stale.
    */
    case 'USER_UPDATED':
      return true

    default:
      // Unknown events rebuild. An event nobody has classified is safer treated
      // as meaningful than quietly dropped.
      return true
  }
}
