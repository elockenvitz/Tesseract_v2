/**
 * OrgBadge — Inline org indicator pill.
 * Only renders when the user belongs to 2+ organizations.
 */

import { Building2 } from 'lucide-react'
import { useOrganization } from '../../contexts/OrganizationContext'

export function OrgBadge() {
  const { currentOrg, userOrgs } = useOrganization()

  if (!currentOrg || userOrgs.length < 2) return null

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
      <Building2 className="w-3 h-3" />
      {currentOrg.name}
    </span>
  )
}
