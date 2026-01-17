import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Target,
  Sparkles,
  AlertTriangle,
  Star,
  Users
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../hooks/useAuth'
import { useContributions, type ContributionVisibility } from '../../hooks/useContributions'
import { useAssetModels } from '../../hooks/useAssetModels'
import { ContributionSection } from './ContributionSection'
import { ThesisUnifiedSummary } from './ThesisUnifiedSummary'
import { ThesisHistoryView } from './ThesisHistoryView'
import { KeyReferencesSection } from './KeyReferencesSection'
import { AddReferenceModal } from './AddReferenceModal'
import { ModelVersionHistory } from './ModelVersionHistory'
import { supabase } from '../../lib/supabase'

interface ThesisContainerProps {
  assetId: string
  className?: string
  /** Optional external view filter - when provided, hides internal tabs and uses this filter */
  viewFilter?: 'aggregated' | string
  /** Callback when tab changes (used when externally controlled) */
  onTabChange?: (tab: string) => void
  /** View mode: 'all' shows 3 sections, 'summary' shows unified narrative, 'history' shows timeline, 'references' shows key references */
  viewMode?: 'all' | 'summary' | 'history' | 'references'
  /** Shared visibility for all thesis sections (controlled from parent) */
  sharedVisibility?: ContributionVisibility
  /** Shared target IDs for visibility (controlled from parent) */
  sharedTargetIds?: string[]
  /** When true, only shows fields that have at least one contribution (for aggregated view) */
  hideEmptyFields?: boolean
}

type TabType = 'aggregated' | string // 'aggregated' or a user ID

interface CoverageAnalyst {
  user_id: string | null
  analyst_name: string
  role: string | null
}

export function ThesisContainer({
  assetId,
  className,
  viewFilter,
  onTabChange: externalOnTabChange,
  viewMode = 'all',
  sharedVisibility = 'firm',
  sharedTargetIds = [],
  hideEmptyFields = false
}: ThesisContainerProps) {
  const { user } = useAuth()
  const [internalTab, setInternalTab] = useState<TabType>('aggregated')

  // State for key references modals
  const [showAddReferenceModal, setShowAddReferenceModal] = useState(false)
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const { models } = useAssetModels(assetId)
  const selectedModel = selectedModelId ? models.find(m => m.id === selectedModelId) : null

  // Use external viewFilter if provided, otherwise use internal tab state
  const activeTab = viewFilter ?? internalTab
  const setActiveTab = viewFilter
    ? (tab: string) => externalOnTabChange?.(tab) // Use external callback when externally controlled
    : setInternalTab
  const isExternallyControlled = viewFilter !== undefined

  // Is the current user viewing their own tab?
  const isViewingOwnTab = user && activeTab === user.id

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

  // Render Key References view
  if (viewMode === 'references') {
    return (
      <>
        <KeyReferencesSection
          assetId={assetId}
          isExpanded={true}
          onToggleExpanded={() => {}}
          onOpenAddModal={() => setShowAddReferenceModal(true)}
          onViewModelHistory={(modelId) => {
            setSelectedModelId(modelId)
            setShowVersionHistory(true)
          }}
          isEmbedded={true}
        />

        {/* Add Reference Modal */}
        <AddReferenceModal
          isOpen={showAddReferenceModal}
          onClose={() => setShowAddReferenceModal(false)}
          assetId={assetId}
        />

        {/* Model Version History Modal */}
        {selectedModel && (
          <ModelVersionHistory
            isOpen={showVersionHistory}
            onClose={() => {
              setShowVersionHistory(false)
              setSelectedModelId(null)
            }}
            modelId={selectedModel.id}
            assetId={assetId}
            modelName={selectedModel.name}
            currentVersion={selectedModel.version}
          />
        )}
      </>
    )
  }

  // Default: Render All (3 sections) view
  return (
    <div className={clsx('space-y-6', className)}>
      {/* Universal tabs - hidden when externally controlled */}
      {!isExternallyControlled && (
        <div className="flex items-center gap-3 pb-4">
          <span className="text-xs text-gray-400 uppercase tracking-wider font-semibold">View</span>
          <div className="flex items-center gap-1 bg-white rounded-lg p-1 shadow-sm border border-gray-200">
            {/* Our View tab */}
            <button
              onClick={() => setActiveTab('aggregated')}
              className={clsx(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 flex items-center gap-1.5',
                activeTab === 'aggregated'
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              <Users className="w-3.5 h-3.5" />
              Our View
            </button>

            {/* Other contributor tabs */}
            {otherContributors.map((contributor) => (
              <button
                key={contributor.userId}
                onClick={() => setActiveTab(contributor.userId)}
                title={`${contributor.isCovering ? `Covering Analyst${contributor.coverageRole ? ` (${contributor.coverageRole})` : ''} · ` : ''}Updated ${formatDistanceToNow(new Date(contributor.updatedAt), { addSuffix: true })}`}
                className={clsx(
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 flex items-center gap-1.5',
                  activeTab === contributor.userId
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
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
                  'px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 flex items-center gap-1.5',
                  activeTab === user.id
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-primary-50 text-primary-700 hover:bg-primary-100'
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

      {/* Contribution sections - visibility controlled from toolbar */}
      {/* When hideEmptyFields is true, only render sections that have contributions */}
      {/* When hideEmptyFields is true (aggregated view), also use flatMode for simpler rendering */}

      {/* Empty state for aggregated view when no contributions exist */}
      {activeTab === 'aggregated' && allContributions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 px-6">
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-50 to-primary-100 flex items-center justify-center">
              <Target className="w-10 h-10 text-primary-400" />
            </div>
            <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white shadow-md flex items-center justify-center">
              <Users className="w-4 h-4 text-gray-400" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No team research yet</h3>
          <p className="text-sm text-gray-500 text-center max-w-sm mb-6">
            No one has shared their investment thesis on this asset yet. Switch to your personal view to start documenting your research.
          </p>
          {user && (
            <button
              onClick={() => setActiveTab(user.id)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition-colors shadow-sm"
            >
              <Target className="w-4 h-4" />
              Start Your Research
            </button>
          )}
        </div>
      )}

      {/* Only render sections if not showing empty state */}
      {!(activeTab === 'aggregated' && allContributions.length === 0) && (
        <>
          {(!hideEmptyFields || thesisContributions.length > 0) && (
            <ContributionSection
              assetId={assetId}
              section="thesis"
              title="Investment Thesis"
              description="The core investment thesis explaining why this is an attractive opportunity"
              icon={Target}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              defaultVisibility="firm"
              coveringAnalystIds={coveringAnalystIds}
              hideViewModeButtons={true}
              hideVisibility={true}
              sharedVisibility={sharedVisibility}
              sharedTargetIds={sharedTargetIds}
              sectionType="thesis"
              flatMode={hideEmptyFields}
            />
          )}

          {(!hideEmptyFields || whereDiffContributions.length > 0) && (
            <ContributionSection
              assetId={assetId}
              section="where_different"
              title="Where We Differ"
              description="How our view differs from market consensus"
              icon={Sparkles}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              defaultVisibility="firm"
              coveringAnalystIds={coveringAnalystIds}
              hideViewModeButtons={true}
              hideVisibility={true}
              sharedVisibility={sharedVisibility}
              sharedTargetIds={sharedTargetIds}
              sectionType="thesis"
              flatMode={hideEmptyFields}
            />
          )}

          {(!hideEmptyFields || risksContributions.length > 0) && (
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
              hideVisibility={true}
              sharedVisibility={sharedVisibility}
              sharedTargetIds={sharedTargetIds}
              sectionType="thesis"
              flatMode={hideEmptyFields}
            />
          )}
        </>
      )}
    </div>
  )
}
