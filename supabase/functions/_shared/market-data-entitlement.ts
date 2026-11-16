/**
 * Who may use which market-data provider, and for what.
 *
 * ── Why this lives in `supabase/functions/_shared` ────────────────────────
 *
 * Because the frontend must not be able to decide it. A `VITE_` flag, a
 * feature toggle in a React context or a column the client can read are all
 * the same mistake: the authorization lives where the party being authorized
 * can edit it. Nothing under `supabase/functions/` is compiled into the
 * browser bundle, so placing the decision here makes client-side
 * authorization impossible rather than merely discouraged.
 *
 * `src/lib/market-data/__tests__/entitlement.test.ts` asserts that no file
 * under `src/` imports this module.
 *
 * ── The licensing fact this encodes ───────────────────────────────────────
 *
 * The first EODHD subscription is a single-user plan bought for one person's
 * own development and testing. It is NOT a redistribution licence, and
 * Tesseract is a multi-tenant product with 28 organizations in production. So
 * the default is deny, and the one permitted shape is "the subscriber, reading
 * a price interactively, for themselves".
 *
 * ── The trap this is built around ─────────────────────────────────────────
 *
 * `price_history_cache` carries no `organization_id` and its only policy is
 * `SELECT USING (auth.uid() IS NOT NULL)`. It is a GLOBAL table that every
 * authenticated user in every organization can read. The existing
 * `yahoo-chart-proxy` writes to it with the service-role key on every
 * successful fetch.
 *
 * So if an EODHD-sourced price ever reached that write path, one person's
 * single-user subscription would be silently redistributed to all 28
 * organizations by the next SELECT. That is why `persisted_cache` is refused
 * for EODHD no matter who asks, and why the refusal is a rule here rather
 * than a convention in whatever adapter gets written later.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 *
 * This is the decision only. No adapter, no routing, no EODHD client, no
 * network. `eodhd` appears as a declared identifier so the boundary can be
 * written and tested before the provider is activated; nothing in the product
 * calls it yet.
 */

/** Providers Tesseract knows about. Declared, not necessarily activated. */
export type MarketDataProviderId = 'yahoo' | 'eodhd'

/**
 * What the data is about to be used for.
 *
 * The distinction is the whole point. "May this user see this price" and "may
 * this price be written somewhere other users read" are different questions
 * with different answers, and a single boolean entitlement cannot express the
 * second one.
 */
export type MarketDataUse =
  /** The requesting user is looking at it, now, for themselves. */
  | 'interactive_read'
  /** It would be written to a table other users can read. */
  | 'persisted_cache'
  /** It would be rendered into something shared: a report, an export, a snapshot. */
  | 'shared_surface'
  /** It would enter ACT AI context or a retrieval answer. */
  | 'ai_retrieval'
  /** It would be used because a different provider failed. */
  | 'fallback'

/**
 * The caller's identity, as established on the server.
 *
 * `verifiedUserId` must come from `getUser(token)` — see
 * `_shared/verified-user.ts`, which takes the JWT as an argument precisely so
 * it cannot fall back to a stored session. A user id taken from a request
 * body, a query parameter or a header the client controls is not an identity
 * and must never be put here.
 *
 * There is deliberately no `email` field. An email is a display attribute that
 * can be changed by the account holder and reassigned by an administrator, and
 * authorizing on it was explicitly ruled out.
 */
export interface EntitlementSubject {
  /** `auth.users.id`, verified server-side. `null` when unauthenticated. */
  verifiedUserId: string | null
}

export interface EntitlementRequest {
  subject: EntitlementSubject
  provider: MarketDataProviderId
  use: MarketDataUse
}

export type EntitlementDenyReason =
  /** No verified identity at all. Covers unauthenticated and service routes. */
  | 'unauthenticated'
  /** A real user, but not entitled to this provider. */
  | 'provider_not_entitled'
  /** Entitled to read, but this use would put the data in front of others. */
  | 'use_would_redistribute'
  /** Provider identifier not recognised. */
  | 'unknown_provider'

export type EntitlementDecision =
  | { allowed: true; provider: MarketDataProviderId; use: MarketDataUse }
  | { allowed: false; reason: EntitlementDenyReason }

/**
 * Server-side configuration.
 *
 * `eodhdAuthorizedUserIds` is read from a server secret (for example
 * `EODHD_AUTHORIZED_USER_IDS`) and passed in. It is a list of `auth.users.id`
 * UUIDs, not emails.
 *
 * A list in a secret is the smallest thing that works for one person and
 * needs no schema change. It does not scale to organization-level commercial
 * entitlements, and it is not meant to: see the note at the bottom of this
 * file for the table that should replace it, which is a change requiring
 * explicit approval before it is applied.
 */
export interface EntitlementConfig {
  eodhdAuthorizedUserIds: readonly string[]
}

/**
 * Read the entitlement config from the function's environment.
 *
 * Returns a discriminated result rather than an empty allowlist, because the
 * two cases must behave differently and an empty list cannot express both:
 *
 *   - `EODHD_AUTHORIZED_USER_IDS` is MISSING  -> the deployment is incomplete.
 *     The function must refuse to call the provider at all and say so, so the
 *     operator fixes the configuration. Silently denying every request would
 *     look identical to a licensing refusal and waste a debugging session.
 *   - the list is present but does not contain the caller -> an ordinary,
 *     correct denial, handled by `decideMarketDataAccess`.
 *
 * Accepts a comma, space or semicolon separated list, lowercases, and keeps
 * only well-formed UUIDs — a malformed entry is dropped rather than trusted,
 * and if that leaves nothing the result is `not_configured`.
 */
/**
 * Declared above its first use on purpose. Both `entitlementConfigFromEnv`
 * and `decideMarketDataAccess` test identities against it, and a `const` is
 * not hoisted.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type EntitlementConfigResult =
  | { ok: true; config: EntitlementConfig }
  | { ok: false; reason: 'not_configured'; detail: string }

export const EODHD_AUTHORIZED_USER_IDS_VAR = 'EODHD_AUTHORIZED_USER_IDS'

export function entitlementConfigFromEnv(
  getEnv: (key: string) => string | undefined,
): EntitlementConfigResult {
  const raw = getEnv(EODHD_AUTHORIZED_USER_IDS_VAR)
  if (!raw || !raw.trim()) {
    return {
      ok: false,
      reason: 'not_configured',
      detail:
        `${EODHD_AUTHORIZED_USER_IDS_VAR} is not set. EODHD is licensed per seat, ` +
        'so no caller can be authorized until the subscriber\'s auth.users.id is ' +
        'configured as a function secret.',
    }
  }

  const ids = raw
    .split(/[,;\s]+/)
    .map(s => s.trim().toLowerCase())
    .filter(s => s.length > 0)

  const valid = ids.filter(id => UUID_RE.test(id))
  if (valid.length === 0) {
    return {
      ok: false,
      reason: 'not_configured',
      detail:
        `${EODHD_AUTHORIZED_USER_IDS_VAR} is set but contains no well-formed ` +
        `auth.users.id UUID (${ids.length} entr${ids.length === 1 ? 'y' : 'ies'} ` +
        'rejected). An email address or a username is not an identity here.',
    }
  }

  return { ok: true, config: { eodhdAuthorizedUserIds: valid } }
}

/** Uses that put data in front of somebody other than the requester. */
const REDISTRIBUTING_USES: ReadonlySet<MarketDataUse> = new Set<MarketDataUse>([
  'persisted_cache',
  'shared_surface',
  'ai_retrieval',
  'fallback',
])

/**
 * The decision. Pure, synchronous, default-deny.
 *
 * Pure so the edge function can call it and a test can enumerate every
 * combination without a database. Default-deny so that adding a provider or a
 * use to the unions above fails closed until somebody writes the rule.
 */
export function decideMarketDataAccess(
  request: EntitlementRequest,
  config: EntitlementConfig,
): EntitlementDecision {
  const { subject, provider, use } = request

  // An identity that is absent or not a UUID is not an identity. This also
  // stops an empty string in the allowlist from matching an empty subject.
  const userId = subject.verifiedUserId
  if (!userId || !UUID_RE.test(userId)) {
    return { allowed: false, reason: 'unauthenticated' }
  }

  switch (provider) {
    /*
     * Yahoo is the status quo and is unchanged by this module.
     *
     * It is not licensed either — it is an undocumented endpoint reached with
     * a spoofed browser User-Agent — but it is what the product already runs
     * on for every user, and narrowing it here would take the product down
     * rather than make it compliant. It is marked `legacy` in the audit and
     * its replacement is the reason EODHD is being evaluated.
     */
    case 'yahoo':
      return { allowed: true, provider, use }

    case 'eodhd': {
      const entitled = config.eodhdAuthorizedUserIds.some(
        id => UUID_RE.test(id) && id.toLowerCase() === userId.toLowerCase(),
      )
      if (!entitled) {
        return { allowed: false, reason: 'provider_not_entitled' }
      }
      if (REDISTRIBUTING_USES.has(use)) {
        return { allowed: false, reason: 'use_would_redistribute' }
      }
      return { allowed: true, provider, use }
    }

    default:
      return { allowed: false, reason: 'unknown_provider' }
  }
}

/**
 * Whether a provider's data may be written to a table other users read.
 *
 * Separate from `decideMarketDataAccess` because the cache write happens in a
 * different place from the read that triggered it — in `yahoo-chart-proxy`'s
 * `persistDailyCloses`, after the response has already been formed. A write
 * path that has lost track of which user asked still knows which provider
 * answered, so this is the check it can actually perform.
 */
export function mayPersistToSharedCache(
  provider: MarketDataProviderId,
): boolean {
  // Only Yahoo. Every other provider is licensed per-seat until proven
  // otherwise, and `price_history_cache` is global and world-readable to any
  // authenticated user.
  return provider === 'yahoo'
}

/**
 * ── Proposed, NOT APPLIED: organization-level entitlements ────────────────
 *
 * The secret-list above is correct for one subscriber and wrong for a
 * commercial plan. When an organization-level licence is bought, the smallest
 * schema change that carries it is one table:
 *
 *   create table public.market_data_entitlements (
 *     id               uuid primary key default gen_random_uuid(),
 *     provider         text not null,
 *     organization_id  uuid references public.organizations(id) on delete cascade,
 *     user_id          uuid references auth.users(id) on delete cascade,
 *     allowed_uses     text[] not null,
 *     expires_at       timestamptz,
 *     created_at       timestamptz not null default now(),
 *     -- exactly one subject: a seat or an org, never both and never neither
 *     constraint market_data_entitlements_one_subject check (
 *       (organization_id is null) <> (user_id is null)
 *     )
 *   );
 *
 * It would be RLS-enabled with NO policy for `anon` or `authenticated`, read
 * only by `service_role` from inside an edge function, because a client that
 * can read the entitlement table can enumerate what it is not entitled to.
 * `decideMarketDataAccess` would then take the rows instead of the string
 * list, and its signature is already shaped for that: the config is a
 * parameter, not a module-level import.
 *
 * This is a production schema change and is NOT part of the stabilization
 * package. It needs explicit approval before being applied.
 */
