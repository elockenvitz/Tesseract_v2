/**
 * useOrgQueryKey — Automatically appends currentOrgId to query keys.
 *
 * Ensures all org-scoped React Query keys include the current org,
 * preventing stale cross-org data after org switch.
 *
 * Usage:
 *   const queryKey = useOrgQueryKey(['projects', user?.id, viewFilter])
 *   // → ['projects', user?.id, viewFilter, 'org:abc-123']
 */

import { useMemo } from 'react'
import { useOrganization } from '../contexts/OrganizationContext'

/**
 * Appends `org:<id>` to a base query key array.
 * Pure function for testing without hooks.
 */
export function buildOrgQueryKey(baseKey: readonly unknown[], orgId: string | null): unknown[] {
  return [...baseKey, `org:${orgId ?? 'none'}`]
}

/**
 * Hook that returns a query key with the current org ID appended.
 * Memoized to prevent unnecessary re-renders.
 */
export function useOrgQueryKey(baseKey: readonly unknown[]): unknown[] {
  const { currentOrgId } = useOrganization()
  return useMemo(
    () => buildOrgQueryKey(baseKey, currentOrgId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentOrgId, ...baseKey]
  )
}
