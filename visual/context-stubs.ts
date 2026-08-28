/** Auth + organization context, replaced by fixtures, harness only. */
export const useAuth = () => ({
  user: { id: 'u1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
})
export const useOrganization = () => ({ currentOrgId: 'org-1' })
