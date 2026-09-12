/**
 * OrganizationContext — Multi-org context provider.
 *
 * Provides the currently selected organization and a list of all
 * organizations the user is an active member of. Switching org
 * calls set_current_org() RPC and invalidates all org-scoped queries.
 */

import React, { createContext, useContext, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { effectiveOrgId, healDecision } from '../lib/org/current-org-heal'

interface OrgSummary {
  id: string
  name: string
  slug: string
  logo_url: string | null
  settings: Record<string, any> | null
}

interface OrganizationContextType {
  /** Currently selected org ID (null if user has no active memberships) */
  currentOrgId: string | null
  /** Full record of the current org */
  currentOrg: OrgSummary | null
  /** All orgs the user is an active member of */
  userOrgs: OrgSummary[]
  /** Whether the org list is still loading */
  isLoading: boolean
  /** Whether the current org is archived (read-only) */
  isOrgArchived: boolean
  /** Switch the active organization */
  switchOrg: (orgId: string) => Promise<void>
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined)

export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Read current_organization_id from the user profile (set by useAuth)
  const rawCurrentOrgId: string | null = (user as any)?.current_organization_id ?? null

  // Active morph session, if any. When a platform admin is morphing,
  // we surface the TARGET user's org context throughout the app — the
  // dropdown lists THEIR orgs, switchOrg routes through morph_switch_org
  // instead of set_current_org, and userOrgs is fetched against their
  // membership rows. Without this, the admin sees their own org list
  // while the header shows the morphed user's identity, which is
  // exactly the "stuck in my own orgs" symptom that prompted this.
  const { data: activeMorph } = useQuery({
    queryKey: ['active-morph-session', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('morph_sessions')
        .select('target_user_id, target_org_id')
        .eq('admin_user_id', user!.id)
        .eq('is_active', true)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) return null
      return data as { target_user_id: string; target_org_id: string } | null
    },
  })
  const effectiveUserId: string | null = activeMorph?.target_user_id ?? user?.id ?? null

  // Fetch all orgs the EFFECTIVE user (target during morph, otherwise
  // the auth user) is an active member of.
  const { data: userOrgs = [], isLoading } = useQuery({
    queryKey: ['user-organizations', effectiveUserId],
    queryFn: async () => {
      // Get the user's active memberships first, then fetch those orgs
      const { data: memberships, error: memErr } = await supabase
        .from('organization_memberships')
        .select('organization_id')
        .eq('user_id', effectiveUserId!)
        .eq('status', 'active')
      if (memErr) throw memErr
      const orgIds = (memberships || []).map(m => m.organization_id)
      if (orgIds.length === 0) return []

      const { data, error } = await supabase
        .from('organizations')
        .select('id, name, slug, logo_url, settings')
        .in('id', orgIds)
        .order('name')
      if (error) throw error
      const orgs = (data || []) as OrgSummary[]

      // Resolve private storage paths to signed URLs for logos
      for (const org of orgs) {
        if (org.logo_url && !org.logo_url.startsWith('http')) {
          const { data: signed } = await supabase.storage
            .from('template-branding')
            .createSignedUrl(org.logo_url, 3600)
          if (signed?.signedUrl) {
            org.logo_url = signed.signedUrl
          }
        }
      }

      return orgs
    },
    enabled: !!effectiveUserId,
    /*
     * "Org list rarely changes" was a ten-minute staleTime, and it is true
     * right up until somebody provisions one. The Ops portal invalidates this
     * key, which covers creating an org in the same tab — and not creating it
     * in another one, or in another window, which is how it is actually done.
     * Coming back to the tab is the moment to ask again.
     */
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  })

  /*
   * A cached absence is a question, not an answer.
   *
   * This used to heal a "stale" current org by writing `userOrgs[0]` back
   * through `set_current_org`. `userOrgs` is a React Query cache with a
   * ten-minute `staleTime` over a membership read, so a membership created
   * moments earlier — ops provisioning a pilot org, say — is simply not in it
   * yet. Absence was read as revocation and the heal moved the reader into an
   * unrelated workspace, permanently, because the write is durable.
   *
   * Found in live data on two pilot workspaces: the seeded portfolio and rows
   * carried the pilot org, the reader's durable column named a different one,
   * and every org-scoped query returned nothing. Nothing was wrong with the
   * rows or the policy; the column had been moved out from under them.
   *
   * So the cache decides what to RENDER and never what to WRITE. See
   * `lib/org/current-org-heal.ts` for the decision itself.
   */
  const [authoritativeIsActive, setAuthoritativeIsActive] = React.useState<boolean | undefined>(undefined)
  const verifiedForRef = React.useRef<string | null>(null)

  const cachedOrgIds = React.useMemo(() => userOrgs.map(o => o.id), [userOrgs])
  const decision = healDecision({
    rawCurrentOrgId,
    cachedOrgIds,
    isLoading,
    authoritativeIsActive,
  })

  const currentOrgId: string | null = effectiveOrgId(decision, rawCurrentOrgId)
  const currentOrg: OrgSummary | null =
    userOrgs.find(o => o.id === currentOrgId) ?? null

  // A different org to check means the previous answer is not about it.
  React.useEffect(() => {
    if (decision.kind !== 'verify') return
    if (verifiedForRef.current === decision.orgId) return
    verifiedForRef.current = decision.orgId
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('organization_memberships')
          .select('organization_id')
          .eq('user_id', effectiveUserId!)
          .eq('organization_id', decision.orgId)
          .eq('status', 'active')
          .maybeSingle()
        if (cancelled) return
        // An errored read is not proof of absence. Leave the answer unset so
        // nothing heals and a later render can ask again.
        if (error) { verifiedForRef.current = null; return }
        setAuthoritativeIsActive(!!data)
      } catch {
        if (!cancelled) verifiedForRef.current = null
      }
    })()
    return () => { cancelled = true }
  }, [decision, effectiveUserId])

  /*
   * The membership is alive and the cache was simply behind. Refresh it, and
   * write nothing: the durable column was right all along.
   */
  React.useEffect(() => {
    if (decision.kind !== 'keep') return
    void queryClient.invalidateQueries({ queryKey: ['user-organizations', effectiveUserId] })
  }, [decision.kind, queryClient, effectiveUserId])

  /*
   * A genuine heal, and only where there is nothing to decide.
   *
   * With several orgs left this deliberately does nothing: `currentOrgId` is
   * null, which is the org selector's cue, and the reader picks. Choosing
   * alphabetically was not a guess about intent, it was no guess at all.
   */
  const healPersistedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (decision.kind !== 'heal') return
    const target = decision.target
    const key = `${user?.id ?? ''}:${target}`
    if (healPersistedRef.current === key) return
    healPersistedRef.current = key
    void (async () => {
      try {
        const { error } = await supabase.rpc('set_current_org', { p_org_id: target })
        if (error) {
          healPersistedRef.current = null
          console.error('Failed to self-heal current_organization_id:', error)
          return
        }
        const cachedRaw = localStorage.getItem('auth-user-cache')
        if (cachedRaw) {
          try {
            const cached = JSON.parse(cachedRaw)
            localStorage.setItem(
              'auth-user-cache',
              JSON.stringify({ ...cached, current_organization_id: target })
            )
          } catch {
            // ignore
          }
        }
      } catch (err) {
        healPersistedRef.current = null
        console.error('Failed to self-heal current_organization_id:', err)
      }
    })()
  }, [decision, user?.id])

  // Check if current org is archived
  const { data: isOrgArchived = false } = useQuery({
    queryKey: ['org-archived-status', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_governance')
        .select('archived_at')
        .eq('organization_id', currentOrgId!)
        .maybeSingle()
      if (error) return false
      return data?.archived_at != null
    },
    enabled: !!currentOrgId,
    staleTime: 5 * 60 * 1000,
  })

  const switchingRef = React.useRef(false)
  const switchOrg = useCallback(
    async (orgId: string) => {
      if (orgId === currentOrgId) return
      // Guard against concurrent switches from rapid double-clicks. Once a
      // switch is in flight we ignore further calls — the page will reload
      // on completion, resetting everything cleanly.
      if (switchingRef.current) return
      switchingRef.current = true

      // Paint a full-screen cover IMMEDIATELY so the user doesn't see the
      // old org's content during the RPC round-trip (100-300ms) or the
      // split-second after reload begins. Mounted directly into the DOM
      // rather than via React state so it lands before the next React
      // commit. The overlay is nuked by `window.location.reload()` anyway.
      const overlay = document.createElement('div')
      overlay.id = 'org-switch-overlay'
      overlay.style.cssText = [
        'position:fixed',
        'inset:0',
        'z-index:2147483647',
        'background:rgb(249,250,251)',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        'flex-direction:column',
        'gap:12px',
      ].join(';')
      overlay.innerHTML = `
        <div style="width:32px;height:32px;border:2px solid #e5e7eb;border-top-color:#6366f1;border-radius:50%;animation:org-switch-spin 0.8s linear infinite"></div>
        <div style="font:500 12px/1 -apple-system,system-ui,sans-serif;color:#9ca3af">Switching workspace…</div>
        <style>@keyframes org-switch-spin{to{transform:rotate(360deg)}}</style>
      `
      document.body.appendChild(overlay)

      const removeOverlay = () => {
        const el = document.getElementById('org-switch-overlay')
        if (el && el.parentNode) el.parentNode.removeChild(el)
      }

      try {
        // Update the server-side current_organization_id. During an
        // active morph session we route through `morph_switch_org`
        // instead of `set_current_org` — the latter checks that the
        // CALLER is a member of p_org_id, which an admin morphing into
        // another user almost never is. `morph_switch_org` instead
        // validates that the MORPH TARGET is a member, which is the
        // right semantic for impersonation (see the migration that
        // created it for the full gating logic).
        const rpcName = activeMorph ? 'morph_switch_org' : 'set_current_org'
        const { error } = await supabase.rpc(rpcName, { p_org_id: orgId })
        if (error) {
          switchingRef.current = false
          removeOverlay()
          throw error
        }

        // Pre-seed the cached user with the new current_organization_id so the
        // post-reload render picks the new org immediately, rather than
        // flashing the previous org while the session refresh fetches the
        // updated profile in the background.
        const cachedRaw = localStorage.getItem('auth-user-cache')
        if (cachedRaw) {
          try {
            const cached = JSON.parse(cachedRaw)
            localStorage.setItem(
              'auth-user-cache',
              JSON.stringify({ ...cached, current_organization_id: orgId })
            )
          } catch {
            // ignore
          }
        }

        // Pre-seed the was_pilot_${userId} hint so the post-reload loader
        // gate fires on the first render. Read pilot_mode directly from
        // the database (rather than trusting the userOrgs cache, which
        // can be stale for orgs the user was just added to) so the hint
        // is always correct. Pre-seed the target-org-id too so the
        // initial-tab-state code can bypass Dashboard for pilots even
        // if the cached user record hasn't been updated yet.
        let targetIsPilot = false
        try {
          const { data: freshTargetOrg } = await supabase
            .from('organizations')
            .select('settings')
            .eq('id', orgId)
            .maybeSingle()
          targetIsPilot = !!((freshTargetOrg?.settings as any)?.pilot_mode)
        } catch {
          // Fall back to the cached list if the fetch fails — better than
          // marking non-pilot on a failure path.
          const targetOrg = userOrgs.find(o => o.id === orgId)
          targetIsPilot = !!(targetOrg?.settings?.pilot_mode)
        }
        if (user?.id) {
          try {
            localStorage.setItem(`was_pilot_${user.id}`, targetIsPilot ? '1' : '0')
          } catch {
            // ignore
          }
        }
        try {
          sessionStorage.setItem('org_switch_target_pilot', targetIsPilot ? '1' : '0')
        } catch {
          // ignore
        }

        // Wipe any org-specific session state so the new org lands on its own
        // default tabs rather than whatever the previous org had open.
        sessionStorage.removeItem('tesseract_tab_states')
        history.replaceState(null, '', window.location.pathname)

        // Full reload is the reliable way to swap every piece of app state
        // (auth cache, TanStack Query cache, React state, pilot gating)
        // to the new org at once. Earlier surgical approaches (selective
        // removeQueries + event dispatch) were prone to stuck-loader states
        // when an in-flight query got wiped mid-flight and never refetched.
        window.location.reload()
      } catch (err) {
        switchingRef.current = false
        removeOverlay()
        throw err
      }
    },
    [currentOrgId, activeMorph, userOrgs]
  )

  return (
    <OrganizationContext.Provider
      value={{ currentOrgId, currentOrg, userOrgs, isLoading, isOrgArchived, switchOrg }}
    >
      {children}
    </OrganizationContext.Provider>
  )
}

export function useOrganization() {
  const context = useContext(OrganizationContext)
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider')
  }
  return context
}

/**
 * Like `useOrganization` but returns null when no provider is in scope
 * instead of throwing. Use this from components that can legitimately
 * render outside the org provider tree (modals via portal, capture
 * overlays, login screens with mention pickers, etc.) — they should
 * degrade gracefully rather than crash.
 */
export function useOrganizationOptional() {
  return useContext(OrganizationContext) ?? null
}
