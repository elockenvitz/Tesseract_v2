/**
 * invites — the client half of the Early Access invitation flow.
 *
 * Everything here goes through SECURITY DEFINER RPCs. The browser has no
 * privileges on `organization_invites` beyond reading a few non-secret columns,
 * and none at all on the `token` column, so there is no direct-table path to
 * fall back on — which is the point.
 *
 * The token is the invitation secret. It appears in the URL the recipient was
 * sent, in the confirmation link we ask Supabase to mail back to that same
 * address, and — as a fallback for the trip through a mail client — in the
 * browser-local stash below. All three of those places are the recipient's own
 * mailbox or the recipient's own device, and none of them is a grant: see
 * accept_org_invite(), which additionally requires an authenticated session on
 * a confirmed auth.users identity whose address equals the invited one.
 */

import { supabase } from './supabase'

/** Where the token parks while the recipient signs in or confirms their email. */
const PENDING_INVITE_KEY = 'pending-invite-token'

/**
 * How long a parked invitation stays parked.
 *
 * It has to outlive the confirmation email, because the whole point of the
 * stash is to be there when the recipient comes back from their mail client —
 * so this tracks `mailer_otp_exp`, which is 24h in production. It is a ceiling,
 * not a schedule: the stash is also cleared the moment the invitation is
 * accepted or turns out to be unusable.
 */
const PENDING_INVITE_TTL_MS = 24 * 60 * 60 * 1000

export interface InvitePreview {
  valid: boolean
  /** Present when valid — the address this invitation was sent to. */
  email?: string
  /** Present when valid, expired, or already accepted. */
  orgName?: string
  reason?: 'not_found' | 'expired' | 'revoked' | 'already_accepted' | 'error'
  /** Only meaningful for `already_accepted`: it was this signed-in user. */
  acceptedByYou?: boolean
}

/**
 * A UUID shape check before we spend a round-trip. Postgres would reject a
 * malformed token with a cast error rather than a clean "not found", and the
 * page should show the same dead-end either way.
 */
export function isInviteTokenShaped(token: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token.trim())
}

/**
 * Read the public preview of an invitation. Callable signed-out — it is the
 * only pre-auth read of the invite table, and it deliberately returns no role,
 * no inviter, and no preassignments.
 */
export async function getInvitePreview(token: string): Promise<InvitePreview> {
  if (!isInviteTokenShaped(token)) return { valid: false, reason: 'not_found' }
  try {
    const { data, error } = await supabase.rpc('get_invite_preview', { p_token: token.trim() })
    if (error || !data) return { valid: false, reason: 'error' }
    const d = data as Record<string, unknown>
    return {
      valid: d.valid === true,
      email: (d.email as string) ?? undefined,
      orgName: (d.org_name as string) ?? undefined,
      reason: (d.reason as InvitePreview['reason']) ?? undefined,
      acceptedByYou: d.accepted_by_you === true,
    }
  } catch {
    return { valid: false, reason: 'error' }
  }
}

export interface AcceptInviteResult {
  organizationId: string | null
  /** True when this call, or an earlier identical one, put the caller in the org. */
  joined: boolean
  error: string | null
  /**
   * The refusal was specifically "this identity has not confirmed its email"
   * (P0026). Called out separately from `error` because it is the one refusal
   * with a next action the recipient can take themselves, and the page routes
   * it to the resend screen rather than showing it as a failure.
   */
  needsEmailConfirmation?: boolean
}

/** Postgres error codes accept_org_invite raises, in the words we show a person. */
const ACCEPT_ERRORS: Record<string, string> = {
  P0001: 'Sign in first to accept this invitation.',
  P0002: "We couldn't find that invitation. Check the link in your email.",
  P0003: 'This invitation is no longer valid.',
  P0021: 'This invitation has expired. Ask your Tesseract contact for a new one.',
  P0022: 'This invitation was sent to a different email address. Sign in with the invited address.',
  P0025: 'This invitation has been revoked. Ask your Tesseract contact for a new one.',
  P0026: 'Confirm your email address first, then open this link again.',
}

/**
 * Accept an invitation. Safe to call twice: the RPC returns the same answer for
 * a replay by the same person rather than erroring, which is what lets the
 * /invite/:token page survive a refresh.
 */
export async function acceptInvite(token: string): Promise<AcceptInviteResult> {
  try {
    const { data, error } = await supabase.rpc('accept_org_invite', { p_token: token.trim() })

    if (error) {
      return {
        organizationId: null,
        joined: false,
        error: ACCEPT_ERRORS[error.code ?? ''] ?? error.message ?? 'Failed to accept invitation.',
        needsEmailConfirmation: error.code === 'P0026',
      }
    }

    const result = data as { organization_id?: string; status?: string }
    if (!result?.organization_id) {
      return { organizationId: null, joined: false, error: 'Unexpected response from the server.' }
    }

    // accept_org_invite already sets current_organization_id when the caller had
    // none. This call is for the pilot who already belongs somewhere and is
    // joining a second workspace — the RPC deliberately does not move them, so
    // the explicit switch happens here where the intent is unambiguous.
    await supabase.rpc('set_current_org', { p_org_id: result.organization_id })

    return { organizationId: result.organization_id, joined: true, error: null }
  } catch {
    return { organizationId: null, joined: false, error: 'Network error accepting the invitation.' }
  }
}

/**
 * Park a token across an auth round-trip (sign-in, sign-up, email confirmation)
 * so the recipient lands back on their invitation instead of a generic
 * dashboard.
 *
 * This used to be sessionStorage only, on the reasoning that the secret should
 * not outlive the tab. That reasoning does not survive email verification.
 * sessionStorage is scoped to a *tab*, and a confirmation link opened from a
 * mail client is a brand-new tab with a brand-new, empty sessionStorage — so
 * the one journey the stash exists for is precisely the one it could not serve.
 * The recipient came back signed in, with no invitation, to a dead end.
 *
 * So the token is written to both: sessionStorage keeps the same-tab case
 * working even where localStorage is unavailable or partitioned (private
 * windows, some embedded browsers), and localStorage carries it across tabs.
 *
 * Neither is load-bearing. The confirmation link itself carries the token in
 * its path (see `inviteConfirmationRedirect`), which is what makes the flow
 * work across a different browser or a different device entirely; the stash is
 * the fallback for the case where the mail client strips or rewrites the link.
 * And a parked token is not a credential: presenting it still requires a
 * session on a confirmed identity holding the invited address.
 */
export function stashPendingInvite(token: string): void {
  if (!isInviteTokenShaped(token)) return
  const value = JSON.stringify({ token: token.trim(), at: Date.now() })
  try { sessionStorage.setItem(PENDING_INVITE_KEY, value) } catch { /* private mode */ }
  try { localStorage.setItem(PENDING_INVITE_KEY, value) } catch { /* private mode */ }
}

/**
 * Read the parked token, from either store, ignoring anything stale or
 * malformed. Reads sessionStorage first so a second invitation opened in this
 * tab wins over an older one left in the shared store by another tab.
 */
export function readPendingInvite(): string | null {
  return readFrom(() => sessionStorage) ?? readFrom(() => localStorage)
}

function readFrom(store: () => Storage): string | null {
  let raw: string | null = null
  try { raw = store().getItem(PENDING_INVITE_KEY) } catch { return null }
  if (!raw) return null

  // Tolerate the pre-TTL format — a bare token string — so an invitation
  // parked by the previously deployed bundle still resolves after the deploy
  // rather than silently becoming a dead end mid-flight.
  let token: string
  let at: number | null = null
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { token?: unknown; at?: unknown }
      token = typeof parsed.token === 'string' ? parsed.token : ''
      at = typeof parsed.at === 'number' ? parsed.at : null
    } catch {
      return null
    }
  } else {
    token = raw
  }

  if (!isInviteTokenShaped(token)) return null
  // A clock that moved backwards (timezone change, a restored machine) reads as
  // a negative age; treat only genuinely-old entries as expired.
  if (at !== null && Date.now() - at > PENDING_INVITE_TTL_MS) return null
  return token
}

export function clearPendingInvite(): void {
  try { sessionStorage.removeItem(PENDING_INVITE_KEY) } catch { /* private mode */ }
  try { localStorage.removeItem(PENDING_INVITE_KEY) } catch { /* private mode */ }
}

/**
 * Where Supabase should send the recipient after they click the link in the
 * confirmation email.
 *
 * This is the load-bearing half of the persistence design, and the only half
 * that works when the mail client opens the link in a different browser or on
 * a different device than the one the account was created on. The invitation
 * token rides in the path, so the confirmation link IS the invitation link
 * with a session attached.
 *
 * Two things make that safe to do:
 *
 *   • the destination is built from the running origin and a token we have
 *     already shape-checked — never from anything a caller supplies — so there
 *     is no open redirect here for the auth service to honour;
 *   • the token is going to the invited mailbox, which is the same mailbox the
 *     invitation link itself was sent to. It discloses nothing that address did
 *     not already hold, and it carries no privilege on its own.
 *
 * Supabase will only honour this if the URL matches the project's redirect
 * allow-list, which therefore needs an `/invite/*` entry per environment;
 * without it the auth service silently falls back to `site_url` — with a 200
 * and no error anywhere — and the recipient lands on the dashboard with no
 * invitation. docs/email-verification-rollout.md records the exact entries and
 * the measurement behind that claim. Returns null for a malformed token so a
 * bad path can never be offered as a redirect at all.
 */
export function inviteConfirmationRedirect(
  token: string,
  origin: string = window.location.origin
): string | null {
  if (!isInviteTokenShaped(token)) return null
  return `${origin}/invite/${token.trim()}`
}

/** The canonical link a platform admin sends. */
export function inviteUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/invite/${token}`
}
