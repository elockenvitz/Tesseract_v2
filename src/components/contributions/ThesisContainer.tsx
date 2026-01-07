import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Target,
  Sparkles,
  AlertTriangle,
  Star
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { useContributions } from '../../hooks/useContributions'
import { ContributionSection } from './ContributionSection'
import { ThesisUnifiedSummary } from './ThesisUnifiedSummary'
import { ThesisHistoryView } from './ThesisHistoryView'
import { supabase } from '../../lib/supabase'

interface ThesisContainerProps {
  assetId: string
  className?: string
  /** Optional external view filter - when provided, hides internal tabs and uses this filter */
  viewFilter?: 'aggregated' | string
  /** View mode: 'all' shows 3 sections, 'summary' shows unified narrative, 'history' shows timeline */
  viewMode?: 'all' | 'summary' | 'history'
}

type TabType = 'aggregated' | string // 'aggregated' or a user ID

interface CoverageAnalyst {
  user_id: string | null
  analyst_name: string
  role: string | null
}

export function ThesisContainer({ assetId, className, viewFilter, viewMode = 'all' }: ThesisContainerProps) {
  const { user } = useAuth()
  const [internalTab, setInternalTab] = useState<TabType>('aggregated')

  // Use external viewFilter if provided, otherwise use internal tab state
  const activeTab = viewFilter ?? internalTab
  const setActiveTab = viewFilter ? () => {} : setInternalTab // No-op if externally controlled
  const isExternallyControlled = viewFilter !== undefined

  // Get current user's name from auth (for tab label even if they haven't contributed)
  const currentUserName = useMemo(() => {
    const authUser = user as any
    const firstName = authUser?.first_name || ''
    const lastName = authUser?.last_name || ''
    if (firstName && lastName) {
      return `${firstName[0]}. ${lastName}`
    }
    return firstName || 'My View'
  }, [user])

  // Fetch coverage data for this asset
  const { data: coverageData = [] } = useQuery({
    queryKey: ['asset-coverage', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('user_id, analyst_name, role')
        .eq('asset_id', assetId)
        .eq('is_active', true)
      if (error) throw error
      return (data || []) as CoverageAnalyst[]
    },
    enabled: !!assetId,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000
  })

  // Create a set of covering analyst user IDs for quick lookup
  const coveringAnalystIds = new Set(coverageData.map(c => c.user_id).filter(Boolean))

  // Fetch all contributions across all sections to build the user tabs
  const { contributions: thesisContributions } = useContributions({ assetId, section: 'thesis' })
  const { contributions: whereDiffContributions } = useContributions({ assetId, section: 'where_different' })
  const { contributions: risksContributions } = useContributions({ assetId, section: 'risks_to_thesis' })

  // Combine all contributions to find unique contributors
  const allContributions = [...thesisContributions, ...whereDiffContributions, ...risksContributions]

  // Get unique contributors with their most recent update time and covering status
  const contributorMap = new Map<string, {
    userId: string
    firstName: string
    lastName: string
    updatedAt: string
    isCovering: boolean
    coverageRole: string | null
  }>()
  allContributions.forEach(c => {
    const existing = contributorMap.get(c.created_by)
    const isCovering = coveringAnalystIds.has(c.created_by)
    const coverageRole = coverageData.find(cov => cov.user_id === c.created_by)?.role || null

    if (!existing || new Date(c.updated_at) > new Date(existing.updatedAt)) {
      contributorMap.set(c.created_by, {
        userId: c.created_by,
        firstName: c.user?.first_name || '',
        lastName: c.user?.last_name || '',
        updatedAt: c.updated_at,
        isCovering,
        coverageRole
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

  // Render Summary view
  if (viewMode === 'summary') {
    return (
      <div className={clsx('space-y-6', className)}>
        <ThesisUnifiedSummary
          assetId={assetId}
          viewFilter={activeTab}
          thesisContributions={thesisContributions}
          whereDiffContributions={whereDiffContributions}
          risksContributions={risksContributions}
          coveringAnalystIds={coveringAnalystIds}
        />
      </div>
    )
  }

  // Render History view
  if (viewMode === 'history') {
    return (
      <ThesisHistoryView
        assetId={assetId}
        viewFilter={activeTab}
        className={className}
      />
    )
  }

  // Default: Render All (3 sections) view
  return (
    <div className={clsx('space-y-6', className)}>
      {/* Universal tabs - hidden when externally controlled */}
      {!isExternallyControlled && (
        <div className="border-b border-gray-200">
          <div className="flex items-center space-x-1 overflow-x-auto">
            {/* Our View tab */}
            <button
              onClick={() => setActiveTab('aggregated')}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                activeTab === 'aggregated'
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              )}
            >
              Our View
            </button>

            {/* Other contributor tabs */}
            {otherContributors.map((contributor) => (
              <button
                key={contributor.userId}
                onClick={() => setActiveTab(contributor.userId)}
                title={`${contributor.isCovering ? `Covering Analyst${contributor.coverageRole ? ` (${contributor.coverageRole})` : ''} · ` : ''}Updated ${formatDistanceToNow(new Date(contributor.updatedAt), { addSuffix: true })}`}
                className={clsx(
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5',
                  activeTab === contributor.userId
                    ? 'border-primary-600 text-primary-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                {contributor.isCovering && (
                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                )}
                {getContributorLabel(contributor)}
              </button>
            ))}

            {/* Current user's tab - show immediately when user exists */}
            {user && (
              <button
                onClick={() => setActiveTab(user.id)}
                title={currentUserContributor
                  ? `Your view${currentUserContributor.isCovering ? ` · Covering Analyst${currentUserContributor.coverageRole ? ` (${currentUserContributor.coverageRole})` : ''}` : ''} · Updated ${formatDistanceToNow(new Date(currentUserContributor.updatedAt), { addSuffix: true })}`
                  : 'Your view'
                }
                className={clsx(
                  'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap rounded-t-md flex items-center gap-1.5',
                  activeTab === user.id
                    ? 'border-primary-600 text-primary-600 bg-primary-100'
                    : 'border-transparent text-gray-600 hover:text-gray-700 hover:border-gray-300 bg-primary-50'
                )}
              >
                {currentUserContributor?.isCovering && (
                  <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                )}
                {currentUserName}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Contribution sections - hide per-section view mode buttons when top-level controls active */}
      <ContributionSection
        assetId={assetId}
        section="thesis"
        title="Investment Thesis"
        description="Core investment thesis and rationale"
        icon={Target}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        defaultVisibility="firm"
        coveringAnalystIds={coveringAnalystIds}
        hideViewModeButtons={true}
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
        coveringAnalystIds={coveringAnalystIds}
        hideViewModeButtons={true}
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
        coveringAnalystIds={coveringAnalystIds}
        hideViewModeButtons={true}
      />
    </div>
  )
}
