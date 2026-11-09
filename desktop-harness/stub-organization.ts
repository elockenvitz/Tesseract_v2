/**
 * The organization context, stubbed.
 *
 * `useOrganization` THROWS outside an `OrganizationProvider`, and the harness
 * has no provider — so any surface that reached it took the whole page down,
 * tab bar and all. That is what made the phone page's Case and Decisions tabs
 * unmeasurable: not a defect in them, an absent provider above them.
 *
 * Stubbed rather than provided for real, because the real provider queries
 * `organizations` and `organization_memberships` through Supabase and would
 * need auth, a session and a live database to resolve one id.
 *
 * One fixed org, matching the Tesseract fixture used elsewhere in the
 * harness. `switchOrg` is a no-op: the harness has one organization, and a
 * switcher that silently did nothing would be worse than one that says so.
 */

const ORG = {
  id: '4b4713e8-d5da-4dc9-a465-c06a71248a12',
  name: 'Tesseract',
  slug: 'tesseract',
  logo_url: null,
  settings: null,
}

export function useOrganization() {
  return {
    currentOrgId: ORG.id,
    currentOrg: ORG,
    userOrgs: [ORG],
    isLoading: false,
    isOrgArchived: false,
    switchOrg: async (id: string) => {
      console.warn('[harness] switchOrg is a no-op; one fixture organization only', id)
    },
  }
}

export function useOrganizationOptional() {
  return useOrganization()
}

/** Pass-through, so a surface that renders the provider still mounts. */
export function OrganizationProvider({ children }: { children: React.ReactNode }) {
  return children as never
}
