/**
 * invites — the client half of the Early Access invitation flow.
 *
 * Everything here goes through SECURITY DEFINER RPCs. The browser has no
 * privileges on `organization_invites` beyond reading a few non-secret columns,
 * and none at all on the `token` column, so there is no direct-table path to
 * fall back on — which is the point.
 *
 * The token is the invitation secret. It only ever appears in the URL the
 * recipient was sent, and is never persisted anywhere except the sessionStorage
 * hand-off below (same tab, cleared as soon as it is used).
 */

import { supabase } from './supabase'

/** Where the token parks while the recipient signs in or confirms their email. */
const PENDING_INVITE_KEY = 'pending-invite-token'

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
 * dashboard. sessionStorage, not localStorage: it should not outlive the tab.
 */
export function stashPendingInvite(token: string): void {
  try { sessionStorage.setItem(PENDING_INVITE_KEY, token) } catch { /* private mode */ }
}

export function readPendingInvite(): string | null {
  try { return sessionStorage.getItem(PENDING_INVITE_KEY) } catch { return null }
}

export function clearPendingInvite(): void {
  try { sessionStorage.removeItem(PENDING_INVITE_KEY) } catch { /* private mode */ }
}

/** The canonical link a platform admin sends. */
export function inviteUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/invite/${token}`
}
