/**
 * Shared authorization gate for internal, scheduler-only Edge Functions that run
 * with the service-role key across every organization (maintenance sweeps and
 * ingestion jobs with no per-caller target).
 *
 * This is the same contract workflow-automation established in its own
 * authorize.ts: the gateway's verify_jwt is not sufficient on its own, because
 * the public anon key is a validly signed project JWT that ships in the browser
 * bundle. The only acceptable caller is the scheduler holding an internal secret
 * presented in the x-automation-secret header. Fail closed, in order: wrong
 * method, no secret presented, no secret configured on the server, secret
 * mismatch. A missing server secret rejects every request rather than letting an
 * empty header match an empty secret.
 *
 * Deliberately free of Deno and network APIs so it can be unit-tested from vitest
 * and evaluated before anything privileged (a service_role client, an SFTP
 * connection, a write) is constructed.
 *
 * (workflow-automation keeps its own copy for now; consolidating it onto this
 * module is a separate change that would require redeploying that function.)
 */

export const AUTOMATION_SECRET_HEADER = 'x-automation-secret'

export type AuthorizationFailure =
  | 'method_not_allowed'
  | 'secret_header_missing'
  | 'server_secret_missing'
  | 'secret_mismatch'

export type AuthorizationResult =
  | { ok: true }
  | { ok: false; status: 401 | 405; reason: AuthorizationFailure }

interface HeaderReader {
  get(name: string): string | null
}

export function authorizeAutomationRequest(
  method: string,
  headers: HeaderReader,
  expectedSecret: string | undefined | null,
): AuthorizationResult {
  if (method !== 'POST') {
    return { ok: false, status: 405, reason: 'method_not_allowed' }
  }

  const presented = headers.get(AUTOMATION_SECRET_HEADER)
  if (!presented) {
    return { ok: false, status: 401, reason: 'secret_header_missing' }
  }

  if (!expectedSecret) {
    return { ok: false, status: 401, reason: 'server_secret_missing' }
  }

  if (!timingSafeEqual(presented, expectedSecret)) {
    return { ok: false, status: 401, reason: 'secret_mismatch' }
  }

  return { ok: true }
}

/** Compares every byte regardless of where the first difference is. */
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  const length = Math.max(x.length, y.length)
  let diff = x.length ^ y.length
  for (let i = 0; i < length; i++) {
    diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  }
  return diff === 0
}
