/**
 * OrgSwitchBanner — Deep-link safety banner.
 *
 * Shown when an entity belongs to a different org than the current one.
 * Offers a one-click switch to the correct org.
 */

import { Building2, ArrowRight } from 'lucide-react'
import { useOrganization } from '../../contexts/OrganizationContext'
import { Button } from '../ui/Button'

interface OrgSwitchBannerProps {
  targetOrg: { id: string; name: string }
  entityLabel?: string
}

export function OrgSwitchBanner({ targetOrg, entityLabel = 'This item' }: OrgSwitchBannerProps) {
  const { switchOrg } = useOrganization()

  const handleSwitch = async () => {
    try {
      await switchOrg(targetOrg.id)
    } catch (err) {
      console.error('Failed to switch org:', err)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
      <Building2 className="w-5 h-5 text-amber-600 flex-shrink-0" />
      <p className="text-sm text-amber-800 dark:text-amber-300 flex-1">
        {entityLabel} belongs to <span className="font-semibold">{targetOrg.name}</span>. Switch to view.
      </p>
      <Button size="sm" onClick={handleSwitch}>
        Switch <ArrowRight className="w-3.5 h-3.5 ml-1" />
      </Button>
    </div>
  )
}
