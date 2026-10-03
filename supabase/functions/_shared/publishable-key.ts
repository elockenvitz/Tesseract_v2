/**
 * The project's publishable API key, read from the new-style environment.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Supabase replaced the legacy `anon` / `service_role` keys with publishable
 * and secret keys that can be rotated independently. The legacy keys were
 * injected into Edge Functions as plain strings on `SUPABASE_ANON_KEY` and
 * `SUPABASE_SERVICE_ROLE_KEY`. The replacements are injected as JSON
 * dictionaries keyed by name:
 *
 *     SUPABASE_PUBLISHABLE_KEYS = {"default":"sb_publishable_..."}
 *
 * Three functions — ai-chat, calendar-oauth-start, calendar-sync — used the
 * anon key for exactly one purpose: to construct a request-scoped client that
 * forwards the caller's own `Authorization` header so `auth.getUser()` can
 * identify them. None of them performed anon-level data access. That is
 * precisely the role a publishable key is meant to fill, so the swap is a
 * change of which variable supplies the string, not of what the client does.
 *
 * ── Why it is centralised ────────────────────────────────────────────────
 *
 * The naive migration is one line per function:
 *
 *     JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!)['default']
 *
 * which throws a bare `SyntaxError` on malformed JSON, a `TypeError` on an
 * absent variable, and returns `undefined` — silently — when the dictionary
 * exists but holds no `default`. That last case is the dangerous one: an
 * `undefined` key builds a client that fails later, at the first request,
 * with an error that points at the request rather than at the configuration.
 *
 * Reading it here means one place to get those three cases right, and one
 * place to change when a function wants a key other than `default`.
 *
 * Deliberately free of Deno and network APIs: the reader is injected, so this
 * module is exercised directly from vitest. Same reasoning as
 * `workflow-automation/authorize.ts`.
 */

/** The key name Supabase creates when a project first adds the new keys. */
export const DEFAULT_KEY_NAME = 'default'

/** The environment variable holding the publishable key dictionary. */
export const PUBLISHABLE_KEYS_VAR = 'SUPABASE_PUBLISHABLE_KEYS'

export type PublishableKeyFailure =
  /** The variable is absent or empty. */
  | 'env_missing'
  /** The variable is present but is not parseable JSON. */
  | 'env_malformed'
  /** Parsed, but not a JSON object of name -> key. */
  | 'env_not_an_object'
  /** Parsed, but holds no key under the requested name. */
  | 'key_missing'

export type PublishableKeyResult =
  | { ok: true; key: string }
  | { ok: false; failure: PublishableKeyFailure; message: string }

/** Reads an environment variable. `Deno.env.get` satisfies this. */
export type EnvReader = (name: string) => string | undefined

/**
 * Resolve one publishable key by name.
 *
 * Returns a result rather than throwing, so a caller can decide the status
 * code and keep the configuration failure out of the user-facing message.
 * The key itself is never placed in a message.
 */
export function resolvePublishableKey(
  getEnv: EnvReader,
  keyName: string = DEFAULT_KEY_NAME,
): PublishableKeyResult {
  const raw = getEnv(PUBLISHABLE_KEYS_VAR)
  if (!raw || raw.trim() === '') {
    return {
      ok: false,
      failure: 'env_missing',
      message: `${PUBLISHABLE_KEYS_VAR} is not set. Supabase injects it once the project has publishable keys; confirm it under Edge Functions > Secrets.`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      ok: false,
      failure: 'env_malformed',
      message: `${PUBLISHABLE_KEYS_VAR} is not valid JSON.`,
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      failure: 'env_not_an_object',
      message: `${PUBLISHABLE_KEYS_VAR} is not a JSON object of key names.`,
    }
  }

  const key = (parsed as Record<string, unknown>)[keyName]
  if (typeof key !== 'string' || key === '') {
    const available = Object.keys(parsed as Record<string, unknown>)
    return {
      ok: false,
      failure: 'key_missing',
      // Key NAMES are safe to report and are what makes this actionable;
      // the values never appear.
      message: `${PUBLISHABLE_KEYS_VAR} has no key named "${keyName}". Available names: ${available.length ? available.join(', ') : '(none)'}.`,
    }
  }

  return { ok: true, key }
}

/**
 * The same thing, for call sites that would rather fail fast.
 *
 * Throws with the diagnostic message above. Use at the top of a handler,
 * inside the existing try/catch, so a misconfiguration surfaces as a server
 * error naming the variable rather than as a confusing auth failure later.
 */
export function requirePublishableKey(
  getEnv: EnvReader,
  keyName: string = DEFAULT_KEY_NAME,
): string {
  const result = resolvePublishableKey(getEnv, keyName)
  if (!result.ok) throw new Error(result.message)
  return result.key
}
