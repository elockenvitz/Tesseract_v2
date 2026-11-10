/**
 * The project's secret (service-role) API key, read from the new-style
 * environment with a fallback to the legacy variable.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Supabase replaced the legacy `anon` / `service_role` keys with publishable
 * and secret keys that rotate independently. The legacy key arrived as a plain
 * string on `SUPABASE_SERVICE_ROLE_KEY`; the replacement arrives as a JSON
 * dictionary keyed by name:
 *
 *     SUPABASE_SECRET_KEYS = {"default":"sb_secret_..."}
 *
 * Both are currently injected into this project's functions. The legacy names
 * were disabled once already, on 2026-10-03, and the ingestion outage that
 * followed took a day to find because a disabled key fails as `401
 * Unauthorized` -- indistinguishable from "this caller is not signed in". So
 * this reader prefers the new dictionary and falls back to the legacy string,
 * rather than picking one and discovering the choice was wrong in production.
 *
 * ── Why a service-role key is needed here at all ─────────────────────────
 *
 * `ai-chat` is a user-facing function and does nearly all its work through a
 * request-scoped client carrying the caller's own JWT, so RLS applies to every
 * read the model makes. Exactly one step cannot work that way: resolving the
 * organization's provider API key, which lives in `vault.secrets` and must be
 * unreadable by any browser role. `public.resolve_org_ai_config(uuid)` is
 * granted to `service_role` and to nothing else.
 *
 * Standing Rule 6 applies in full: the caller is authorized and the
 * organization id is derived from server-side data BEFORE a client carrying
 * this key is constructed. A denied request never reaches this module.
 *
 * Deliberately free of Deno and network APIs: the reader is injected, so this
 * is exercised directly from vitest. Same reasoning as `publishable-key.ts`.
 */

/** The key name Supabase creates when a project first adds the new keys. */
export const DEFAULT_SECRET_NAME = 'default'

/** The environment variable holding the secret key dictionary. */
export const SECRET_KEYS_VAR = 'SUPABASE_SECRET_KEYS'

/** The legacy single-string variable, kept as a fallback. */
export const LEGACY_SERVICE_ROLE_VAR = 'SUPABASE_SERVICE_ROLE_KEY'

export type SecretKeyFailure =
  /** Neither the dictionary nor the legacy variable yielded a key. */
  | 'env_missing'
  /** The dictionary is present but is not parseable JSON, and no legacy key. */
  | 'env_malformed'
  /** Parsed, but not a JSON object of name -> key, and no legacy key. */
  | 'env_not_an_object'
  /** Parsed, but holds no key under the requested name, and no legacy key. */
  | 'key_missing'

export type SecretKeyResult =
  | { ok: true; key: string; source: 'dictionary' | 'legacy' }
  | { ok: false; failure: SecretKeyFailure; message: string }

/** Reads an environment variable. `Deno.env.get` satisfies this. */
export type EnvReader = (name: string) => string | undefined

function legacy(getEnv: EnvReader): string | null {
  const raw = getEnv(LEGACY_SERVICE_ROLE_VAR)
  return raw && raw.trim() !== '' ? raw : null
}

/**
 * Resolve the secret key, preferring the new dictionary.
 *
 * Returns a result rather than throwing, so the caller decides the status code
 * and keeps the configuration failure out of the user-facing message. The key
 * itself never appears in a message, only variable and key NAMES.
 */
export function resolveSecretKey(
  getEnv: EnvReader,
  keyName: string = DEFAULT_SECRET_NAME,
): SecretKeyResult {
  const raw = getEnv(SECRET_KEYS_VAR)

  if (!raw || raw.trim() === '') {
    const fallback = legacy(getEnv)
    if (fallback) return { ok: true, key: fallback, source: 'legacy' }
    return {
      ok: false,
      failure: 'env_missing',
      message: `Neither ${SECRET_KEYS_VAR} nor ${LEGACY_SERVICE_ROLE_VAR} is set. Confirm them under Edge Functions > Secrets.`,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const fallback = legacy(getEnv)
    if (fallback) return { ok: true, key: fallback, source: 'legacy' }
    return { ok: false, failure: 'env_malformed', message: `${SECRET_KEYS_VAR} is not valid JSON.` }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    const fallback = legacy(getEnv)
    if (fallback) return { ok: true, key: fallback, source: 'legacy' }
    return {
      ok: false,
      failure: 'env_not_an_object',
      message: `${SECRET_KEYS_VAR} is not a JSON object of key names.`,
    }
  }

  const key = (parsed as Record<string, unknown>)[keyName]
  if (typeof key !== 'string' || key === '') {
    const fallback = legacy(getEnv)
    if (fallback) return { ok: true, key: fallback, source: 'legacy' }
    const available = Object.keys(parsed as Record<string, unknown>)
    return {
      ok: false,
      failure: 'key_missing',
      // Key NAMES are safe to report and are what makes this actionable; the
      // values never appear.
      message: `${SECRET_KEYS_VAR} has no key named "${keyName}". Available names: ${available.length ? available.join(', ') : '(none)'}.`,
    }
  }

  return { ok: true, key, source: 'dictionary' }
}

/**
 * The same thing, for call sites that would rather fail fast. Throws with the
 * diagnostic message above, which names variables and never values.
 */
export function requireSecretKey(
  getEnv: EnvReader,
  keyName: string = DEFAULT_SECRET_NAME,
): string {
  const result = resolveSecretKey(getEnv, keyName)
  if (!result.ok) throw new Error(result.message)
  return result.key
}
