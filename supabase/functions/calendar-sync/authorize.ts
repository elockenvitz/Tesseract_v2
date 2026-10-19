/**
 * The cross-user authorization decision for calendar-sync.
 *
 * calendar-sync uses the service-role key to read/write calendar data, so the
 * ONLY thing that keeps one user out of another user's connection is that the
 * connection is loaded scoped to BOTH the requested id AND the verified caller's
 * user id. The handler verifies the JWT (auth.getUser) inline, then passes the
 * VERIFIED user.id here — never a value from the request body — and this runs the
 * ownership-scoped query. If no row matches, access is denied (404) before any
 * token refresh, external sync, or write.
 *
 * Deliberately free of Deno, network, and createClient APIs: the caller injects
 * the scoped fetcher, so this is exercised directly from vitest with fakes
 * (handler-level, not source-text).
 */

/** Runs the connection query scoped to (connectionId, userId); mirrors .eq('id').eq('user_id').single(). */
export type OwnedConnectionFetcher = (
  connectionId: string,
  userId: string,
) => Promise<{ data: unknown | null; error: unknown }>

export type ConnectionAuthzResult =
  | { ok: true; connection: unknown }
  | { ok: false; status: 404; error: string }

export async function authorizeConnectionOwnership(
  fetchOwnedConnection: OwnedConnectionFetcher,
  connectionId: string | undefined | null,
  verifiedUserId: string,
): Promise<ConnectionAuthzResult> {
  const { data: connection, error } = await fetchOwnedConnection(connectionId ?? '', verifiedUserId)
  if (error || !connection) {
    return { ok: false, status: 404, error: 'Connection not found' }
  }
  return { ok: true, connection }
}
