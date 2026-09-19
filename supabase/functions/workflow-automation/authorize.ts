/**
 * Who may run workflow automation.
 *
 * The function runs with the service-role key across every organization, so
 * the only acceptable caller is the scheduler holding an internal secret. The
 * gateway's verify_jwt is not enough on its own: the public anon key is a
 * validly signed project JWT, and it ships in the browser bundle.
 *
 * Deliberately free of Deno and network APIs so it can be tested from vitest
 * and evaluated before anything privileged is constructed.
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

/**
 * Fail closed, in order: wrong method, no secret presented, no secret
 * configured on the server, secret does not match.
 *
 * A missing server secret rejects every request rather than letting an empty
 * header match an empty secret.
 */
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
