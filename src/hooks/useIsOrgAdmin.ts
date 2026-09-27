import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'

/**
 * Is the current user an admin of their current organization?
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Several tables gate every write behind org-admin. `research_fields` and
 * `research_sections` each carry a single `FOR ALL` policy with a null
 * `WITH CHECK`, so Postgres applies the `USING` expression as the INSERT
 * check too:
 *
 *   USING (organization_id = current_org_id()
 *          AND is_active_org_admin_of_current_org())
 *
 * A non-admin member therefore has SELECT and nothing else; INSERT, UPDATE
 * and DELETE all fail with 42501.
 *
 * The desktop `ResearchFieldsManager` has no role check at all — it renders
 * "Add Section" and "Create New Field" for everyone and swallows the
 * rejection in a `console.error`, so a non-admin taps the button, the modal
 * closes, and nothing happens with no explanation. This hook is the seam that
 * lets a surface not do that: ask first, and don't offer what the database
 * will refuse.
 *
 * ── What it mirrors ────────────────────────────────────────────────────────
 *
 * `is_active_org_admin_of_current_org()`, deliberately, including the
 * `status = 'active'` requirement:
 *
 *   SELECT EXISTS (SELECT 1 FROM organization_memberships
 *                  WHERE user_id = auth.uid()
 *                    AND organization_id = current_org_id()
 *                    AND status = 'active' AND is_org_admin = true)
 *
 * This is a UI affordance check, NOT an authorization boundary. RLS remains
 * the only thing actually enforcing this; a wrong answer here can only show
 * or hide a button. It fails CLOSED — any error, any missing membership, any
 * unresolved org resolves to `false`, so a failure hides an affordance rather
 * than offering one the database will reject.
 */
export function useIsOrgAdmin() {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()

  const { data: isOrgAdmin = false, isLoading } = useQuery({
    queryKey: ['org-admin-status', user?.id, currentOrgId],
    queryFn: async () => {
      if (!user?.id || !currentOrgId) return false

      const { data, error } = await supabase
        .from('organization_memberships')
        .select('is_org_admin')
        .eq('user_id', user.id)
        .eq('organization_id', currentOrgId)
        .eq('status', 'active')
        .maybeSingle<{ is_org_admin: boolean | null }>()

      // Fail closed: an error must not be read as authority.
      if (error) return false
      return data?.is_org_admin === true
    },
    enabled: !!user?.id && !!currentOrgId,
  })

  /**
   * True only once the answer is known AND affirmative.
   *
   * Given separately because "not yet loaded" must not render a create button
   * that then disappears — a control that appears and vanishes reads as a bug,
   * and worse, it can be tapped in the gap.
   */
  return { isOrgAdmin, isLoading, canAuthorCatalog: isOrgAdmin && !isLoading }
}
