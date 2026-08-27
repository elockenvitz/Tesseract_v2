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

/*
 * autoAcceptPendingInvites() and acceptInviteByToken() used to live here.
 *
 * The first joined a user to any organization holding a pending invitation for
 * their email address, with no token and no proof of mailbox control — the
 * database function it called is now a no-op for that reason. The second has
 * moved to src/lib/invites.ts alongside the rest of the /invite/:token flow,
 * where the token, the preview and the acceptance are one story.
 */

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
