/**
 * useOrgWriteEnabled — Returns whether writes are allowed for the current org.
 *
 * Use this hook to disable mutation buttons and show read-only state
 * when the current organization is archived.
 */

import { useOrganization } from '../contexts/OrganizationContext'

export function useOrgWriteEnabled() {
  const { isOrgArchived } = useOrganization()
  return {
    canWrite: !isOrgArchived,
    reason: isOrgArchived
      ? 'This organization is archived. All data is read-only.'
      : undefined,
  }
}
