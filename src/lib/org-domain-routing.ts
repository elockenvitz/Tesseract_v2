/**
 * org-domain-routing — Route users to orgs based on email domain.
 *
 * Extracted from useAuth for testability.
 * Called once after initial login when current_organization_id is null.
 */

import { supabase } from './supabase'
import type { RouteOrgResult, SsoCheckResult } from '../types/organization'

/**
 * Extract the domain portion from an email address.
 * Returns null if the email is invalid.
 */
export function extractDomain(email: string): string | null {
  const atIdx = email.lastIndexOf('@')
  if (atIdx < 1) return null
  const domain = email.slice(atIdx + 1).toLowerCase()
  return domain.includes('.') ? domain : null
}

export interface RouteOrgByEmailResult {
  profile: Record<string, any> | null
  routeResult: RouteOrgResult
}

/**
 * Route a user to the correct org based on email domain.
 * Returns { profile, routeResult } where profile is set when org was switched/joined.
 */
export async function routeOrgByEmail(
  email: string,
  userId: string
): Promise<RouteOrgByEmailResult> {
  const fallback: RouteOrgByEmailResult = {
    profile: null,
    routeResult: { org_id: null, org_name: null, action: 'blocked', reason: 'error' },
  }

  try {
    const { data: routeResult, error: routeError } = await supabase.rpc(
      'route_org_for_email',
      { p_email: email }
    )
    if (routeError || !routeResult) return fallback

    const result = routeResult as RouteOrgResult
    const action = result.action

    // Only switch/auto_join should set the current org
    if ((action === 'switch' || action === 'auto_join') && result.org_id) {
      const { error: setError } = await supabase.rpc('set_current_org', {
        p_org_id: result.org_id,
      })
      if (setError) return { profile: null, routeResult: result }

      // Re-fetch profile to pick up new current_organization_id
      const { data: updated } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single()

      return { profile: updated || null, routeResult: result }
    }

    // request_created or blocked — do NOT call set_current_org
    return { profile: null, routeResult: result }
  } catch {
    return fallback
  }
}

/**
 * Title-case a name string: "JEFFREY" → "Jeffrey", "lockenvitz" → "Lockenvitz"
 */
export function titleCase(s: string): string {
  const t = s.trim()
  if (!t) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

/**
 * Auto-accept any pending invites matching the authenticated user's email.
 * Called during auth bootstrap before domain routing.
 */
export async function autoAcceptPendingInvites(): Promise<{
  accepted_count: number
  organization_id: string | null
  org_name: string | null
}> {
  const fallback = { accepted_count: 0, organization_id: null, org_name: null }
  try {
    const { data, error } = await supabase.rpc('auto_accept_pending_invites')
    if (error || !data) return fallback
    return data as typeof fallback
  } catch {
    return fallback
  }
}

/**
 * Accept an invite by token (manual entry from the no-org screen).
 * Calls existing accept_org_invite RPC, then sets current org.
 */
export async function acceptInviteByToken(
  token: string,
  userId: string
): Promise<{ organization_id: string | null; error: string | null }> {
  try {
    const { data, error } = await supabase.rpc('accept_org_invite', {
      p_token: token,
    })

    if (error) {
      // Map Postgres error codes to user-friendly messages
      const msg =
        error.code === 'P0002'
          ? 'Invite not found'
          : error.code === 'P0021'
            ? 'Invite has expired'
            : error.code === 'P0022'
              ? 'This invite was sent to a different email address'
              : error.code === 'P0003'
                ? 'Invite is no longer valid'
                : error.message || 'Failed to accept invite'
      return { organization_id: null, error: msg }
    }

    const result = data as { organization_id: string; status: string }
    if (!result?.organization_id) {
      return { organization_id: null, error: 'Unexpected response from server' }
    }

    // Set this org as the user's current org
    const { error: setError } = await supabase.rpc('set_current_org', {
      p_org_id: result.organization_id,
    })
    if (setError) {
      return { organization_id: null, error: 'Joined organization but failed to set as current' }
    }

    return { organization_id: result.organization_id, error: null }
  } catch {
    return { organization_id: null, error: 'Network error accepting invite' }
  }
}

/**
 * Check if an email's org has SSO configured.
 * Used by login page to decide whether to show SSO button vs password form.
 * Can be called before authentication (granted to anon).
 */
export async function checkSsoForEmail(email: string): Promise<SsoCheckResult> {
  const fallback: SsoCheckResult = { has_sso: false, reason: 'error' }
  try {
    const { data, error } = await supabase.rpc('get_identity_provider_for_email', {
      p_email: email,
    })
    if (error || !data) return fallback
    return data as SsoCheckResult
  } catch {
    return fallback
  }
}
