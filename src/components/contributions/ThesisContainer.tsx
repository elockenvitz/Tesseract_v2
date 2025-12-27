import React, { useState } from 'react'
import { clsx } from 'clsx'
import {
  Target,
  Sparkles,
  AlertTriangle
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useAuth } from '../../hooks/useAuth'
import { useContributions } from '../../hooks/useContributions'
import { ContributionSection } from './ContributionSection'

interface ThesisContainerProps {
  assetId: string
  className?: string
}

type TabType = 'aggregated' | string // 'aggregated' or a user ID

export function ThesisContainer({ assetId, className }: ThesisContainerProps) {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<TabType>('aggregated')

  // Fetch all contributions across all sections to build the user tabs
  const { contributions: thesisContributions } = useContributions({ assetId, section: 'thesis' })
  const { contributions: whereDiffContributions } = useContributions({ assetId, section: 'where_different' })
  const { contributions: risksContributions } = useContributions({ assetId, section: 'risks_to_thesis' })

  // Combine all contributions to find unique contributors
  const allContributions = [...thesisContributions, ...whereDiffContributions, ...risksContributions]

  // Get unique contributors with their most recent update time
  const contributorMap = new Map<string, { userId: string; firstName: string; lastName: string; updatedAt: string }>()
  allContributions.forEach(c => {
    const existing = contributorMap.get(c.created_by)
    if (!existing || new Date(c.updated_at) > new Date(existing.updatedAt)) {
      contributorMap.set(c.created_by, {
        userId: c.created_by,
        firstName: c.user?.first_name || '',
        lastName: c.user?.last_name || '',
        updatedAt: c.updated_at
      })
    }
  })

  // Separate current user from other contributors to prevent flash
  const allContributorsList = Array.from(contributorMap.values())

  // Find current user's contribution (only if we know who they are)
  const currentUserContributor = user?.id
    ? allContributorsList.find(c => c.userId === user.id)
    : null

  // Other contributors sorted by most recent first
  const otherContributors = allContributorsList
    .filter(c => c.userId !== user?.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  // Helper to get display label for other contributors
  const getContributorLabel = (contributor: { firstName: string; lastName: string }) => {
    const first = contributor.firstName?.[0] || ''
    const last = contributor.lastName?.[0] || ''
    return first && last ? `${first}. ${contributor.lastName}` : contributor.firstName || 'Unknown'
  }

  return (
    <div className={clsx('space-y-6', className)}>
      {/* Universal tabs */}
      <div className="border-b border-gray-200">
        <div className="flex items-center space-x-1 overflow-x-auto">
          {/* Aggregated tab */}
          <button
            onClick={() => setActiveTab('aggregated')}
            className={clsx(
              'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
              activeTab === 'aggregated'
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            )}
          >
            Aggregated
          </button>

          {/* Other contributor tabs */}
          {otherContributors.map((contributor) => (
            <button
              key={contributor.userId}
              onClick={() => setActiveTab(contributor.userId)}
              title={`Updated ${formatDistanceToNow(new Date(contributor.updatedAt), { addSuffix: true })}`}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === contributor.userId
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              {getContributorLabel(contributor)}
            </button>
          ))}

          {/* Current user's tab - only render when we know who they are */}
          {currentUserContributor && (
            <button
              onClick={() => setActiveTab(currentUserContributor.userId)}
              title={`Your view · Updated ${formatDistanceToNow(new Date(currentUserContributor.updatedAt), { addSuffix: true })}`}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap rounded-t-md',
                activeTab === currentUserContributor.userId
                  ? 'border-primary-600 text-primary-600 bg-primary-100'
                  : 'border-transparent text-gray-600 hover:text-gray-700 hover:border-gray-300 bg-primary-100'
              )}
            >
              {getContributorLabel(currentUserContributor)}
            </button>
          )}
        </div>
      </div>

      {/* Contribution sections */}
      <ContributionSection
        assetId={assetId}
        section="thesis"
        title="Investment Thesis"
        description="Core investment thesis and rationale"
        icon={Target}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        defaultVisibility="firm"
      />

      <ContributionSection
        assetId={assetId}
        section="where_different"
        title="Where We Are Different"
        description="Unique insights vs consensus"
        icon={Sparkles}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        defaultVisibility="firm"
      />

      <ContributionSection
        assetId={assetId}
        section="risks_to_thesis"
        title="Risks to Thesis"
        description="Key risks that could invalidate the thesis"
        icon={AlertTriangle}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        defaultVisibility="firm"
      />
    </div>
  )
}
