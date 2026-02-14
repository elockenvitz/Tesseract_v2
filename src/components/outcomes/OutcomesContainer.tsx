import React, { useState, useMemo, useEffect } from 'react'
import { clsx } from 'clsx'
import { Star, Table2, LayoutGrid } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useAuth } from '../../hooks/useAuth'
import { useScenarios } from '../../hooks/useScenarios'
import { useAnalystPriceTargets } from '../../hooks/useAnalystPriceTargets'
import { useOutcomeAggregation, type AggregationMethod } from '../../hooks/useOutcomeAggregation'
import { PriceTargetCard } from './PriceTargetCard'
import { AggregatedView, AnalystComparisonTable } from './AggregatedView'
import { AggregationToolbar } from './AggregationToolbar'
import { ScenarioManager } from './ScenarioManager'
import { PriceTargetChart } from './PriceTargetChart'
import { FirmConsensusPanel } from './FirmConsensusPanel'
import { EstimateRevisionChart } from './EstimateRevisionChart'
import { PriceTargetHistoryChart } from './PriceTargetHistoryChart'
import { RatingHistoryChart } from './RatingHistoryChart'
// AnalystPerformanceCard, PerformanceLeaderboard, OutcomesTimeline moved to UserTab
import { ExpiredTargetsAlert } from './ExpiredTargetsAlert'
import { supabase } from '../../lib/supabase'
import { useQuery } from '@tanstack/react-query'

interface OutcomesContainerProps {
  assetId: string
  symbol?: string
  currentPrice?: number
  className?: string
  onNavigate?: (result: { id: string; title: string; type: string; data: any }) => void
  /** Optional external view filter - when provided, hides internal tabs and uses this filter */
  viewFilter?: 'aggregated' | string
}

type TabType = 'aggregated' | 'comparison' | 'track-record' | string // includes user IDs
type ViewMode = 'cards' | 'table'

export function OutcomesContainer({ assetId, symbol: symbolProp, currentPrice, className, onNavigate, viewFilter }: OutcomesContainerProps) {
  const { user } = useAuth()
  const [internalTab, setInternalTab] = useState<TabType>('aggregated')
  const [viewMode, setViewMode] = useState<ViewMode>('cards')

  // Use external viewFilter if provided, otherwise use internal tab state
  const activeTab = viewFilter ?? internalTab
  const setActiveTab = viewFilter ? () => {} : setInternalTab // No-op if externally controlled
  const isExternallyControlled = viewFilter !== undefined

  // Fetch asset data to get symbol if not provided
  const { data: assetData } = useQuery({
    queryKey: ['asset-for-outcomes', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('symbol')
        .eq('id', assetId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!assetId && !symbolProp,
    staleTime: Infinity
  })

  const symbol = symbolProp || assetData?.symbol || ''

  // Fetch scenarios
  const {
    scenarios,
    defaultScenarios,
    customScenarios,
    isLoading: scenariosLoading,
    createScenario
  } = useScenarios({ assetId })

  // Fetch all price targets for this asset
  const {
    priceTargets,
    priceTargetsByUser,
    isLoading: targetsLoading,
    saveDraftPriceTarget,
    publishPriceTarget,
    discardDraft
  } = useAnalystPriceTargets({ assetId })

  // Fetch coverage data
  const { data: coverageData = [] } = useQuery({
    queryKey: ['asset-coverage-outcomes', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('user_id, analyst_name, role')
        .eq('asset_id', assetId)
        .eq('is_active', true)
      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: Infinity,
    gcTime: 30 * 60 * 1000
  })

  // Create set of covering analyst IDs
  const coveringAnalystIds = useMemo(
    () => new Set(coverageData.map(c => c.user_id).filter(Boolean)),
    [coverageData]
  )

  // Aggregation hook
  const {
    preferences,
    preferencesLoading,
    aggregatedResults,
    savePreferences,
    contributors,
    hasData
  } = useOutcomeAggregation({
    assetId,
    priceTargets,
    scenarios
  })

  // Get current user's name from auth (for tab label even if they haven't contributed)
  const currentUserName = useMemo(() => {
    const authUser = user as any // user object has first_name, last_name merged from profile
    const firstName = authUser?.first_name || ''
    const lastName = authUser?.last_name || ''
    if (firstName && lastName) {
      return `${firstName[0]}. ${lastName}`
    }
    return firstName || 'My View'
  }, [user])

  // Get unique contributors with metadata
  const contributorsList = useMemo(() => {
    const contribMap = new Map<string, {
      userId: string
      firstName: string
      lastName: string
      updatedAt: string
      isCovering: boolean
      role: string | null
    }>()

    priceTargets.forEach(pt => {
      if (!pt.user) return
      const existing = contribMap.get(pt.user_id)
      const isCovering = coveringAnalystIds.has(pt.user_id)
      const coverageInfo = coverageData.find(c => c.user_id === pt.user_id)

      if (!existing || new Date(pt.updated_at) > new Date(existing.updatedAt)) {
        contribMap.set(pt.user_id, {
          userId: pt.user_id,
          firstName: pt.user.first_name || '',
          lastName: pt.user.last_name || '',
          updatedAt: pt.updated_at,
          isCovering,
          role: coverageInfo?.role || null
        })
      }
    })

    return Array.from(contribMap.values())
  }, [priceTargets, coveringAnalystIds, coverageData])

  // Separate current user from other contributors
  const currentUserContributor = user?.id
    ? contributorsList.find(c => c.userId === user.id)
    : null

  const otherContributors = contributorsList
    .filter(c => c.userId !== user?.id)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

  // Helper to get display label
  const getContributorLabel = (contributor: { firstName: string; lastName: string }) => {
    const first = contributor.firstName?.[0] || ''
    const last = contributor.lastName?.[0] || ''
    return first && last ? `${first}. ${contributor.lastName}` : contributor.firstName || 'Unknown'
  }

  // Handle preference changes
  const handleMethodChange = (method: AggregationMethod) => {
    savePreferences.mutate({ aggregation_method: method })
  }

  const handleShowOpinionsChange = (show: boolean) => {
    savePreferences.mutate({ show_opinions: show })
  }

  const handleWeightByRoleChange = (weight: boolean) => {
    savePreferences.mutate({ weight_by_role: weight })
  }

  // Handle saving a price target as draft
  const handleSaveDraft = async (
    scenarioId: string,
    data: { price: number; timeframe?: string; timeframeType?: import('../../hooks/useAnalystPriceTargets').TimeframeType; targetDate?: string; isRolling?: boolean; reasoning?: string; probability?: number }
  ) => {
    await saveDraftPriceTarget.mutateAsync({ scenarioId, ...data })
  }

  // Handle publishing a price target (direct to published columns + revision events)
  const handlePublishPriceTarget = async (
    scenarioId: string,
    data: { price: number; timeframe?: string; timeframeType?: import('../../hooks/useAnalystPriceTargets').TimeframeType; targetDate?: string; isRolling?: boolean; reasoning?: string; probability?: number },
    scenarioName?: string
  ) => {
    await publishPriceTarget.mutateAsync({ scenarioId, scenarioName, ...data })
  }

  // Handle discarding a single target's draft
  const handleDiscardDraft = async (targetId: string) => {
    await discardDraft.mutateAsync(targetId)
  }

  // Handle creating a custom scenario
  const handleCreateScenario = async (data: { name: string; description?: string; color?: string }) => {
    await createScenario.mutateAsync(data)
  }

  // Handle bulk probability and price updates from the distribution modal
  const handleUpdateProbabilities = async (updates: Array<{
    targetId: string
    probability: number
    price?: number
    timeframe?: string
    reasoning?: string
  }>) => {
    // Find each target and update its probability (and optionally price) as draft
    for (const update of updates) {
      const target = priceTargets?.find(t => t.id === update.targetId)
      if (target) {
        const probChanged = update.probability !== target.probability
        const priceChanged = update.price !== undefined && update.price !== target.price

        if (probChanged || priceChanged) {
          await saveDraftPriceTarget.mutateAsync({
            scenarioId: target.scenario_id,
            price: update.price ?? target.price,
            timeframe: update.timeframe || target.timeframe || undefined,
            timeframeType: target.timeframe_type || undefined,
            targetDate: target.target_date || undefined,
            isRolling: target.is_rolling || false,
            reasoning: update.reasoning || target.reasoning || undefined,
            probability: update.probability
          })
        }
      }
    }
  }

  // External edit trigger from ActionLoopModule
  const [editTriggerKey, setEditTriggerKey] = useState(0)
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail?.assetId === assetId) {
        setEditTriggerKey(k => k + 1)
      }
    }
    window.addEventListener('actionloop-edit-targets', handler)
    return () => window.removeEventListener('actionloop-edit-targets', handler)
  }, [assetId])

  // Check if core data is still loading
  // Don't include authLoading - it resets on every mount. Use data existence checks instead.
  // Only show loading on first load when we have no cached data
  const hasScenarioData = scenarios.length > 0
  const isDataLoading = (!hasScenarioData && scenariosLoading) || (!hasScenarioData && targetsLoading) || preferencesLoading

  // Get user's targets for their individual view
  const getUserTargets = (userId: string) => {
    return priceTargetsByUser[userId] || []
  }

  // Check if viewing own tab
  const isOwnTab = activeTab === user?.id

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Expired Targets Alert - show only targets for this specific asset */}
      <ExpiredTargetsAlert className="mb-4" assetId={assetId} />

      {/* Tabs - hidden when externally controlled */}
      {!isExternallyControlled && (
        <div className="border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
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

              {/* Comparison tab - show when there's data and multiple analysts */}
              {hasData && contributors.length > 1 && (
                <button
                  onClick={() => setActiveTab('comparison')}
                  className={clsx(
                    'px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5',
                    activeTab === 'comparison'
                      ? 'border-primary-600 text-primary-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  )}
                >
                  <Table2 className="w-3.5 h-3.5" />
                  Compare
                </button>
              )}

              {/* Other contributor tabs */}
              {otherContributors.map((contributor) => (
                <button
                  key={contributor.userId}
                  onClick={() => setActiveTab(contributor.userId)}
                  title={`${contributor.isCovering ? `Covering Analyst${contributor.role ? ` (${contributor.role})` : ''} · ` : ''}Updated ${formatDistanceToNow(new Date(contributor.updatedAt), { addSuffix: true })}`}
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
                    ? `Your view${currentUserContributor.isCovering ? ` · Covering Analyst${currentUserContributor.role ? ` (${currentUserContributor.role})` : ''}` : ''} · Updated ${formatDistanceToNow(new Date(currentUserContributor.updatedAt), { addSuffix: true })}`
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

            {/* View toggle for aggregated view */}
            {activeTab === 'aggregated' && hasData && contributors.length > 1 && (
              <div className="flex items-center gap-1 pr-2">
                <button
                  onClick={() => setViewMode('cards')}
                  className={clsx(
                    'p-1.5 rounded',
                    viewMode === 'cards'
                      ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                  )}
                  title="Card view"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('table')}
                  className={clsx(
                    'p-1.5 rounded',
                    viewMode === 'table'
                      ? 'bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                  )}
                  title="Table view"
                >
                  <Table2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {activeTab === 'aggregated' && (
        <div className="space-y-4">
          {/* Loading state - only show on first load */}
          {isDataLoading && (
            <>
              <div className="h-12 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
                <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
                <div className="h-32 bg-gray-100 dark:bg-gray-800 rounded-lg animate-pulse" />
              </div>
            </>
          )}

          {/* Loaded content */}
          {!isDataLoading && (
            <>
              {/* Aggregation toolbar */}
              {hasData && (
                <AggregationToolbar
                  method={preferences.aggregation_method}
                  showOpinions={preferences.show_opinions}
                  weightByRole={preferences.weight_by_role}
                  onMethodChange={handleMethodChange}
                  onShowOpinionsChange={handleShowOpinionsChange}
                  onWeightByRoleChange={handleWeightByRoleChange}
                  analystCount={contributors.length}
                />
              )}

              {/* Aggregated results */}
              {viewMode === 'cards' ? (
                <AggregatedView
                  results={aggregatedResults}
                  currentPrice={currentPrice}
                />
              ) : (
                <AnalystComparisonTable
                  results={aggregatedResults}
                  currentPrice={currentPrice}
                  onUserClick={onNavigate ? (user) => onNavigate({
                    id: user.id,
                    title: user.full_name,
                    type: 'user',
                    data: user
                  }) : undefined}
                />
              )}

              {/* Empty state */}
              {!hasData && (
                <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                  <p className="mb-2">No price targets yet</p>
                  <p className="text-sm">Switch to your view to add price targets</p>
                </div>
              )}

              {/* Firm Consensus Panel - Rating & Estimates */}
              <FirmConsensusPanel assetId={assetId} className="mt-4" />

              {/* Historical Charts Section */}
              <div className="mt-6 space-y-4">
                <h4 className="text-sm font-medium text-gray-700">Historical Analysis</h4>

                {/* Rating History Chart */}
                <RatingHistoryChart assetId={assetId} />

                {/* Estimate Revision Chart */}
                <EstimateRevisionChart assetId={assetId} />

                {/* Price Target History Chart */}
                <PriceTargetHistoryChart assetId={assetId} currentPrice={currentPrice} />
              </div>

              {/* Price Target Chart - aggregated view is read-only */}
              {symbol && (
                <div className="mt-6">
                  <PriceTargetChart
                    assetId={assetId}
                    symbol={symbol}
                    height={480}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'comparison' && (
        <AnalystComparisonTable
          results={aggregatedResults}
          currentPrice={currentPrice}
        />
      )}

      {/* Individual analyst view */}
      {activeTab !== 'aggregated' && activeTab !== 'comparison' && (
        <div className="space-y-6">
          {/* Default scenarios (Bull/Base/Bear) */}
          <div>
            <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
              Price Targets
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {defaultScenarios
                .sort((a, b) => {
                  const order = ['Bull', 'Base', 'Bear']
                  return order.indexOf(a.name) - order.indexOf(b.name)
                })
                .map((scenario) => {
                  const target = getUserTargets(activeTab).find(
                    t => t.scenario_id === scenario.id
                  )
                  const otherProbSum = getUserTargets(activeTab)
                    .filter(t => t.scenario_id !== scenario.id)
                    .reduce((sum, t) => sum + (t.probability || 0), 0)
                  return (
                    <PriceTargetCard
                      key={scenario.id}
                      scenario={scenario}
                      priceTarget={target}
                      isEditable={isOwnTab}
                      onSaveDraft={isOwnTab ? (data) => handleSaveDraft(scenario.id, data) : undefined}
                      onPublish={isOwnTab ? (data) => handlePublishPriceTarget(scenario.id, data, scenario.name) : undefined}
                      onDiscardDraft={isOwnTab && target ? () => handleDiscardDraft(target.id) : undefined}
                      otherScenariosProbabilitySum={otherProbSum}
                      currentPrice={currentPrice}
                      triggerEditKey={scenario.is_default ? editTriggerKey : undefined}
                    />
                  )
                })}
            </div>
          </div>

          {/* Custom scenarios */}
          {(customScenarios.length > 0 || isOwnTab) && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Custom Scenarios
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {customScenarios.map((scenario) => {
                  const target = getUserTargets(activeTab).find(
                    t => t.scenario_id === scenario.id
                  )
                  if (!target && scenario.created_by !== activeTab) return null
                  const otherProbSum = getUserTargets(activeTab)
                    .filter(t => t.scenario_id !== scenario.id)
                    .reduce((sum, t) => sum + (t.probability || 0), 0)
                  return (
                    <PriceTargetCard
                      key={scenario.id}
                      scenario={scenario}
                      priceTarget={target}
                      isEditable={isOwnTab && scenario.created_by === user?.id}
                      onSaveDraft={isOwnTab ? (data) => handleSaveDraft(scenario.id, data) : undefined}
                      onPublish={isOwnTab ? (data) => handlePublishPriceTarget(scenario.id, data, scenario.name) : undefined}
                      onDiscardDraft={isOwnTab && target ? () => handleDiscardDraft(target.id) : undefined}
                      otherScenariosProbabilitySum={otherProbSum}
                      currentPrice={currentPrice}
                    />
                  )
                })}

                {/* Add custom scenario button */}
                {isOwnTab && (
                  <ScenarioManager
                    onCreateScenario={handleCreateScenario}
                    existingNames={scenarios.map(s => s.name)}
                  />
                )}
              </div>
            </div>
          )}

          {/* Price Target Chart for individual analyst */}
          {symbol && (
            <div className="mt-2">
              <PriceTargetChart
                assetId={assetId}
                symbol={symbol}
                height={480}
                selectedUserId={activeTab}
                onUpdateProbabilities={isOwnTab ? handleUpdateProbabilities : undefined}
              />
            </div>
          )}

        </div>
      )}
    </div>
  )
}
