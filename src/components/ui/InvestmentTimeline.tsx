import React, { useState } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Check, ArrowRight, Info, AlertTriangle, Calendar, Users, MessageSquare, X } from 'lucide-react'
import { Badge } from './Badge'
import { Button } from './Button'
import { Card } from './Card'
import { supabase } from '../../lib/supabase'

interface ChecklistItem {
  id: string
  text: string
  completed: boolean
  comment?: string
  completedAt?: string
}

interface TimelineStage {
  id: string
  label: string
  description: string
  checklist: ChecklistItem[]
}

interface InvestmentTimelineProps {
  currentStage: string
  onStageChange: (stage: string) => void
  onStageClick: (stage: string) => void
  assetSymbol?: string
  className?: string
  assetId?: string
  viewingStageId?: string | null
  onViewingStageChange?: (stageId: string | null) => void
}

const TIMELINE_STAGES: TimelineStage[] = [
  {
    id: 'outdated',
    label: 'Outdated',
    description: 'Asset research needs to be refreshed or updated',
    checklist: [
      { id: 'review_financials', text: 'Review latest financial statements', completed: false },
      { id: 'update_models', text: 'Update financial models with recent data', completed: false },
      { id: 'check_earnings', text: 'Review recent earnings releases', completed: false },
      { id: 'market_conditions', text: 'Assess current market conditions', completed: false },
      { id: 'competitive_landscape', text: 'Update competitive landscape analysis', completed: false }
    ]
  },
  {
    id: 'initiated',
    label: 'Initiated',
    description: 'Initial idea captured, basic research started',
    checklist: [
      { id: 'basic_profile', text: 'Create basic company profile', completed: false },
      { id: 'initial_thesis', text: 'Draft initial investment thesis', completed: false },
      { id: 'assign_analyst', text: 'Assign primary research analyst', completed: false },
      { id: 'setup_models', text: 'Set up basic financial models', completed: false },
      { id: 'industry_overview', text: 'Complete industry overview research', completed: false },
      { id: 'key_metrics', text: 'Identify key performance metrics', completed: false }
    ]
  },
  {
    id: 'prioritized',
    label: 'Prioritize',
    description: 'Asset has been prioritized for active research',
    checklist: [
      { id: 'research_plan', text: 'Create detailed research plan', completed: false },
      { id: 'competitor_analysis', text: 'Complete comprehensive competitor analysis', completed: false },
      { id: 'schedule_mgmt', text: 'Schedule management meetings', completed: false },
      { id: 'expert_network', text: 'Engage expert network contacts', completed: false },
      { id: 'channel_checks', text: 'Conduct channel checks', completed: false },
      { id: 'risk_assessment', text: 'Complete initial risk assessment', completed: false }
    ]
  },
  {
    id: 'in_progress',
    label: 'Research',
    description: 'Active research and analysis underway',
    checklist: [
      { id: 'detailed_models', text: 'Build detailed financial models', completed: false },
      { id: 'mgmt_calls', text: 'Complete management due diligence calls', completed: false },
      { id: 'site_visits', text: 'Conduct site visits if applicable', completed: false },
      { id: 'industry_experts', text: 'Interview industry experts', completed: false },
      { id: 'supply_chain', text: 'Analyze supply chain and partnerships', completed: false },
      { id: 'esg_analysis', text: 'Complete ESG analysis', completed: false },
      { id: 'scenario_analysis', text: 'Run scenario and sensitivity analysis', completed: false }
    ]
  },
  {
    id: 'recommend',
    label: 'Recommend',
    description: 'Research complete, preparing recommendation',
    checklist: [
      { id: 'investment_memo', text: 'Prepare comprehensive investment memo', completed: false },
      { id: 'price_targets', text: 'Set bull/base/bear price targets', completed: false },
      { id: 'risk_assessment', text: 'Complete detailed risk assessment', completed: false },
      { id: 'position_sizing', text: 'Recommend optimal position sizing', completed: false },
      { id: 'recommendation_summary', text: 'Draft final recommendation summary', completed: false },
      { id: 'peer_review_prep', text: 'Prepare materials for peer review', completed: false }
    ]
  },
  {
    id: 'review',
    label: 'Review',
    description: 'Recommendation under committee review',
    checklist: [
      { id: 'ic_presentation', text: 'Prepare investment committee presentation', completed: false },
      { id: 'peer_review', text: 'Complete peer review process', completed: false },
      { id: 'risk_mitigation', text: 'Define risk mitigation strategies', completed: false },
      { id: 'compliance_check', text: 'Complete compliance and legal review', completed: false },
      { id: 'committee_feedback', text: 'Address committee feedback and questions', completed: false },
      { id: 'final_approval', text: 'Obtain final investment approval', completed: false }
    ]
  },
  {
    id: 'action',
    label: 'Action',
    description: 'Investment decision made, ready for execution',
    checklist: [
      { id: 'position_sizing', text: 'Determine optimal position sizing', completed: false },
      { id: 'execution_plan', text: 'Create trade execution plan', completed: false },
      { id: 'risk_limits', text: 'Set position and portfolio risk limits', completed: false },
      { id: 'monitoring_plan', text: 'Establish ongoing monitoring plan', completed: false },
      { id: 'exit_strategy', text: 'Define exit strategy and triggers', completed: false },
      { id: 'portfolio_integration', text: 'Update portfolio models and allocations', completed: false }
    ]
  },
  {
    id: 'monitor',
    label: 'Monitor',
    description: 'Ongoing monitoring and performance tracking',
    checklist: [
      { id: 'position_tracking', text: 'Track position performance vs targets', completed: false },
      { id: 'thesis_validation', text: 'Monitor thesis assumptions and catalysts', completed: false },
      { id: 'quarterly_review', text: 'Conduct quarterly performance review', completed: false },
      { id: 'risk_monitoring', text: 'Monitor position and portfolio risk metrics', completed: false },
      { id: 'exit_triggers', text: 'Monitor exit triggers and conditions', completed: false },
      { id: 'reporting', text: 'Prepare regular performance reports', completed: false }
    ]
  }
]

export function InvestmentTimeline({
  currentStage,
  onStageChange,
  onStageClick,
  assetSymbol,
  className = '',
  assetId,
  viewingStageId,
  onViewingStageChange
}: InvestmentTimelineProps) {
  const [showStageDetails, setShowStageDetails] = useState<string | null>(null)
  const [stageChecklists, setStageChecklists] = useState<Record<string, ChecklistItem[]>>({})
  const [commentingItem, setCommentingItem] = useState<{stageId: string, itemId: string} | null>(null)
  const [commentText, setCommentText] = useState('')
  const queryClient = useQueryClient()

  // Query to load checklist state from database
  const { data: savedChecklistItems } = useQuery({
    queryKey: ['asset-checklist', assetId],
    queryFn: async () => {
      if (!assetId) return []
      const { data, error } = await supabase
        .from('asset_checklist_items')
        .select('*')
        .eq('asset_id', assetId)
      if (error) throw error
      return data || []
    },
    enabled: !!assetId
  })

  // Mutation to save checklist item changes
  const saveChecklistItemMutation = useMutation({
    mutationFn: async ({ assetId, stageId, itemId, completed, comment, completedAt }: {
      assetId: string
      stageId: string
      itemId: string
      completed: boolean
      comment?: string
      completedAt?: string
    }) => {
      const { error } = await supabase
        .from('asset_checklist_items')
        .upsert({
          asset_id: assetId,
          stage_id: stageId,
          item_id: itemId,
          completed,
          comment: comment || null,
          completed_at: completedAt || null
        }, {
          onConflict: 'asset_id,stage_id,item_id'
        })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-checklist', assetId] })
    },
    onError: (error) => {
      console.error('Error saving checklist item:', error)
      alert('Failed to save checklist item. Please try again.')
    }
  })

  // Initialize checklists for all stages, merging with saved data
  React.useEffect(() => {
    const initialChecklists: Record<string, ChecklistItem[]> = {}

    TIMELINE_STAGES.forEach(stage => {
      initialChecklists[stage.id] = stage.checklist.map(item => {
        // Look for saved state for this item
        const savedItem = savedChecklistItems?.find(
          saved => saved.stage_id === stage.id && saved.item_id === item.id
        )

        if (savedItem) {
          return {
            ...item,
            completed: savedItem.completed,
            comment: savedItem.comment || undefined,
            completedAt: savedItem.completed_at || undefined
          }
        }

        return { ...item }
      })
    })

    setStageChecklists(initialChecklists)
  }, [assetId, savedChecklistItems])

  // Handle external viewing stage requests
  React.useEffect(() => {
    if (viewingStageId && viewingStageId !== showStageDetails) {
      setShowStageDetails(viewingStageId)
      onStageClick(viewingStageId)
      // Clear the viewing stage ID after setting it to allow normal clicking
      if (onViewingStageChange) {
        onViewingStageChange(null)
      }
    }
  }, [viewingStageId, showStageDetails, onStageClick, onViewingStageChange])

  const getCurrentStageIndex = () => {
    return TIMELINE_STAGES.findIndex(stage => stage.id === currentStage)
  }

  const getStageStatus = (stageIndex: number) => {
    const currentIndex = getCurrentStageIndex()
    if (stageIndex < currentIndex) return 'completed'
    if (stageIndex === currentIndex) return 'current'
    return 'upcoming'
  }

  const getStageColor = (status: string, stageIndex: number) => {
    if (status === 'upcoming') return 'bg-gray-300'

    // Progressive color scheme reflecting stage progression
    const colors = [
      'bg-gray-600',   // outdated
      'bg-red-600',    // initiated
      'bg-orange-600', // prioritized
      'bg-blue-500',   // research (in_progress)
      'bg-yellow-500', // recommend
      'bg-green-400',  // review
      'bg-green-700',  // action
      'bg-teal-500'    // monitor
    ]

    return colors[stageIndex] || 'bg-gray-300'
  }

  const getTextColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-green-700'
      case 'current': return 'text-blue-700'
      case 'upcoming': return 'text-gray-500'
      default: return 'text-gray-500'
    }
  }

  const handleStageClick = (stage: TimelineStage, index: number) => {
    // Allow viewing all stages, but editing is controlled separately
    onStageClick(stage.id)
    setShowStageDetails(stage.id)
  }

  const isCurrentStageCompleted = () => {
    const currentIndex = getCurrentStageIndex()
    const currentStageId = TIMELINE_STAGES[currentIndex]?.id
    if (!currentStageId || !stageChecklists[currentStageId]) return false

    return stageChecklists[currentStageId].every(item => item.completed)
  }

  const isStageEditable = (stageId: string) => {
    const stageIndex = TIMELINE_STAGES.findIndex(stage => stage.id === stageId)
    const currentIndex = getCurrentStageIndex()
    // Can only edit current stage
    return stageIndex === currentIndex
  }

  const handleAdvanceStage = async () => {
    if (!isCurrentStageCompleted()) {
      alert('Please complete all checklist items before advancing to the next stage.')
      return
    }

    if (!assetId) {
      alert('No asset ID available. Cannot advance stage.')
      return
    }

    const currentIndex = getCurrentStageIndex()
    if (currentIndex < TIMELINE_STAGES.length - 1) {
      const currentStageId = TIMELINE_STAGES[currentIndex].id
      const currentTime = new Date().toISOString()

      // Update completion timestamps for all completed items in current stage
      const currentStageItems = stageChecklists[currentStageId] || []
      const updatePromises = currentStageItems
        .filter(item => item.completed && !item.completedAt)
        .map(item =>
          saveChecklistItemMutation.mutateAsync({
            assetId,
            stageId: currentStageId,
            itemId: item.id,
            completed: item.completed,
            comment: item.comment,
            completedAt: currentTime
          })
        )

      try {
        // Wait for all checklist updates to complete
        await Promise.all(updatePromises)

        // Update local state
        setStageChecklists(prev => ({
          ...prev,
          [currentStageId]: prev[currentStageId]?.map(item => ({
            ...item,
            completedAt: item.completed && !item.completedAt ? currentTime : item.completedAt
          })) || []
        }))

        // Advance to next stage
        const nextStage = TIMELINE_STAGES[currentIndex + 1]
        onStageChange(nextStage.id)

        // Focus on the new stage
        setShowStageDetails(nextStage.id)
      } catch (error) {
        console.error('Error saving checklist state:', error)
        alert('Failed to save checklist state. Please try again.')
      }
    }
  }

  const handleRegressStage = () => {
    const currentIndex = getCurrentStageIndex()
    if (currentIndex > 0) {
      const prevStage = TIMELINE_STAGES[currentIndex - 1]
      onStageChange(prevStage.id)

      // Focus on the previous stage
      setShowStageDetails(prevStage.id)
    }
  }

  const handleChecklistToggle = (stageId: string, itemId: string) => {
    if (!isStageEditable(stageId)) {
      alert('This checklist is locked. You can only edit items from the current stage.')
      return
    }

    if (!assetId) {
      alert('No asset ID available. Cannot save checklist changes.')
      return
    }

    const currentItem = stageChecklists[stageId]?.find(item => item.id === itemId)
    if (!currentItem) return

    const newCompleted = !currentItem.completed
    const newCompletedAt = newCompleted ? new Date().toISOString() : undefined

    // Update local state immediately for responsiveness
    setStageChecklists(prev => ({
      ...prev,
      [stageId]: prev[stageId]?.map(item =>
        item.id === itemId ? {
          ...item,
          completed: newCompleted,
          completedAt: newCompletedAt
        } : item
      ) || []
    }))

    // Save to database
    saveChecklistItemMutation.mutate({
      assetId,
      stageId,
      itemId,
      completed: newCompleted,
      comment: currentItem.comment,
      completedAt: newCompletedAt
    })
  }

  const handleAddComment = (stageId: string, itemId: string) => {
    setCommentingItem({ stageId, itemId })
    const item = stageChecklists[stageId]?.find(item => item.id === itemId)
    setCommentText(item?.comment || '')
  }

  const handleSaveComment = () => {
    if (!commentingItem || !assetId) return

    const currentItem = stageChecklists[commentingItem.stageId]?.find(
      item => item.id === commentingItem.itemId
    )
    if (!currentItem) return

    const trimmedComment = commentText.trim()

    // Update local state immediately
    setStageChecklists(prev => ({
      ...prev,
      [commentingItem.stageId]: prev[commentingItem.stageId]?.map(item =>
        item.id === commentingItem.itemId ? { ...item, comment: trimmedComment || undefined } : item
      ) || []
    }))

    // Save to database
    saveChecklistItemMutation.mutate({
      assetId,
      stageId: commentingItem.stageId,
      itemId: commentingItem.itemId,
      completed: currentItem.completed,
      comment: trimmedComment || undefined,
      completedAt: currentItem.completedAt
    })

    setCommentingItem(null)
    setCommentText('')
  }

  const handleCancelComment = () => {
    setCommentingItem(null)
    setCommentText('')
  }

  const currentStageData = TIMELINE_STAGES.find(stage => stage.id === currentStage)
  const currentIndex = getCurrentStageIndex()

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Timeline Visualization */}
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Research Lifecycle</h3>
          <div className="flex items-center space-x-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRegressStage}
              disabled={currentIndex === 0}
              className="text-gray-600 hover:text-gray-800"
            >
              ← Previous
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleAdvanceStage}
              disabled={currentIndex === TIMELINE_STAGES.length - 1 || !isCurrentStageCompleted()}
              className={`${
                !isCurrentStageCompleted() && currentIndex < TIMELINE_STAGES.length - 1
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-blue-600 hover:text-blue-800'
              }`}
              title={!isCurrentStageCompleted() ? 'Complete all checklist items to advance' : ''}
            >
              Next →
            </Button>
          </div>
        </div>

        {/* Desktop Timeline */}
        <div className="hidden md:block">
          <div className="relative">
            {/* Progress Line */}
            <div className="absolute top-8 left-0 right-0 h-1 bg-gray-200 rounded-full">
              <div
                className="h-full bg-gradient-to-r from-gray-600 via-red-600 via-orange-600 via-blue-500 via-yellow-500 via-green-400 via-green-700 to-teal-500 transition-all duration-500 rounded-full"
                style={{ width: `${(currentIndex / (TIMELINE_STAGES.length - 1)) * 100}%` }}
              />
            </div>

            {/* Stage Nodes */}
            <div className="relative flex justify-between">
              {TIMELINE_STAGES.map((stage, index) => {
                const status = getStageStatus(index)
                const isClickable = true // Allow viewing all stages

                return (
                  <div key={stage.id} className="flex flex-col items-center">
                    {/* Stage Circle */}
                    <button
                      onClick={() => handleStageClick(stage, index)}
                      className={`relative z-10 w-16 h-16 rounded-full border-4 border-white shadow-lg transition-all duration-300 ${
                        getStageColor(status, index)
                      } hover:scale-110 cursor-pointer ${
                        showStageDetails === stage.id ? 'ring-4 ring-blue-200' : ''
                      }`}
                    >
                      <div className="flex items-center justify-center h-full">
                        {status === 'completed' ? (
                          <Check className="w-6 h-6 text-white" />
                        ) : status === 'current' ? (
                          <div className="w-3 h-3 bg-white rounded-full animate-pulse" />
                        ) : (
                          <div className="w-3 h-3 bg-white rounded-full" />
                        )}
                      </div>
                    </button>

                    {/* Stage Label */}
                    <div className="mt-3 text-center">
                      <div className={`text-sm font-medium ${getTextColor(status)}`}>
                        {stage.label}
                      </div>
                      {status === 'current' && (
                        <Badge variant="primary" size="sm" className="mt-1">
                          Current
                        </Badge>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Mobile Timeline */}
        <div className="md:hidden">
          <div className="space-y-3">
            {TIMELINE_STAGES.map((stage, index) => {
              const status = getStageStatus(index)
              const isClickable = true // Allow viewing all stages

              return (
                <button
                  key={stage.id}
                  onClick={() => handleStageClick(stage, index)}
                  className={`w-full flex items-center p-3 rounded-lg border transition-all ${
                    status === 'current'
                      ? 'border-blue-500 bg-blue-50'
                      : status === 'completed'
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200 bg-gray-50'
                  } hover:shadow-md`}
                >
                  <div className={`w-8 h-8 rounded-full ${getStageColor(status, index)} flex items-center justify-center mr-3`}>
                    {status === 'completed' ? (
                      <Check className="w-4 h-4 text-white" />
                    ) : status === 'current' ? (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    ) : (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className={`font-medium ${getTextColor(status)}`}>
                      {stage.label}
                    </div>
                    <div className="text-xs text-gray-500">
                      {stage.description}
                    </div>
                  </div>
                  {status === 'current' && (
                    <Badge variant="primary" size="sm">
                      Current
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Stage Details Modal/Card */}
      {showStageDetails && (
        <Card>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className={`w-10 h-10 rounded-full ${getStageColor(getStageStatus(TIMELINE_STAGES.findIndex(s => s.id === showStageDetails)), TIMELINE_STAGES.findIndex(s => s.id === showStageDetails))} flex items-center justify-center`}>
                {getStageStatus(TIMELINE_STAGES.findIndex(s => s.id === showStageDetails)) === 'completed' ? (
                  <Check className="w-5 h-5 text-white" />
                ) : (
                  <Info className="w-5 h-5 text-white" />
                )}
              </div>
              <div>
                <h4 className="text-lg font-semibold text-gray-900">
                  {currentStageData?.label} Stage
                </h4>
                <p className="text-sm text-gray-600">
                  {assetSymbol && `For ${assetSymbol} • `}
                  {currentStageData?.description}
                </p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowStageDetails(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {/* Stage Checklist */}
            {showStageDetails && stageChecklists[showStageDetails] && (
              <div>
                <div className="mb-4">
                  <h5 className="font-medium text-gray-900 flex items-center">
                    <Calendar className="w-4 h-4 mr-2" />
                    Stage Checklist
                    <span className="ml-2 text-xs text-gray-500">
                      ({stageChecklists[showStageDetails].filter(item => item.completed).length}/{stageChecklists[showStageDetails].length} completed)
                    </span>
                  </h5>
                  {!isStageEditable(showStageDetails) && (
                    <div className="mt-2 flex items-center text-xs text-orange-600 bg-orange-50 px-2 py-1 rounded">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      View only - This stage is locked for editing
                    </div>
                  )}
                  {isStageEditable(showStageDetails) && (
                    <div className="mt-2 flex items-center text-xs text-green-600 bg-green-50 px-2 py-1 rounded">
                      <Check className="w-3 h-3 mr-1" />
                      Current stage - You can edit this checklist
                    </div>
                  )}
                  {saveChecklistItemMutation.isPending && (
                    <div className="mt-2 flex items-center text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
                      <div className="animate-spin w-3 h-3 border border-blue-600 border-t-transparent rounded-full mr-1"></div>
                      Saving changes...
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {stageChecklists[showStageDetails].map((item) => {
                    const isEditable = isStageEditable(showStageDetails)
                    const isCommenting = commentingItem?.stageId === showStageDetails && commentingItem?.itemId === item.id

                    return (
                      <div key={item.id}>
                        <div
                          className={`flex items-start space-x-3 p-3 rounded-lg border transition-colors ${
                            isEditable
                              ? 'border-gray-200 hover:bg-gray-50'
                              : 'border-gray-100 bg-gray-50'
                          } ${
                            !isEditable ? 'opacity-75' : ''
                          }`}
                        >
                          <button
                            onClick={() => handleChecklistToggle(showStageDetails, item.id)}
                            disabled={!isEditable || saveChecklistItemMutation.isPending}
                            className={`flex-shrink-0 w-5 h-5 rounded border-2 transition-colors ${
                              item.completed
                                ? 'bg-green-500 border-green-500 text-white'
                                : isEditable && !saveChecklistItemMutation.isPending
                                ? 'border-gray-300 hover:border-gray-400'
                                : 'border-gray-200'
                            } ${
                              !isEditable || saveChecklistItemMutation.isPending ? 'cursor-not-allowed' : 'cursor-pointer'
                            }`}
                          >
                            {item.completed && (
                              <Check className="w-3 h-3 m-0.5" />
                            )}
                          </button>

                          <div className="flex-1">
                            <div className="flex items-center justify-between">
                              <span className={`text-sm ${
                                item.completed
                                  ? 'text-gray-600 font-medium'
                                  : 'text-gray-700'
                              }`}>
                                {item.text}
                              </span>

                              <div className="flex items-center space-x-2">
                                {item.completedAt && (
                                  <span className="text-xs text-gray-400">
                                    {new Date(item.completedAt).toLocaleDateString()}
                                  </span>
                                )}

                                {isEditable ? (
                                  <button
                                    onClick={() => handleAddComment(showStageDetails, item.id)}
                                    className={`p-1 rounded hover:bg-gray-100 transition-colors ${
                                      item.comment ? 'text-blue-600' : 'text-gray-400'
                                    }`}
                                    title={item.comment ? 'Edit comment' : 'Add comment'}
                                  >
                                    <MessageSquare className="w-4 h-4" />
                                  </button>
                                ) : item.comment ? (
                                  <MessageSquare className="w-4 h-4 text-blue-600" title="Has comment" />
                                ) : null}

                                {!isEditable && (
                                  <AlertTriangle className="w-4 h-4 text-orange-400" title="Checklist is locked" />
                                )}
                              </div>
                            </div>

                            {item.comment && !isCommenting && (
                              <div className="mt-2 p-2 bg-blue-50 rounded text-xs text-gray-600 border-l-2 border-blue-200">
                                {item.comment}
                              </div>
                            )}
                          </div>
                        </div>

                        {isCommenting && (
                          <div className="mt-2 p-3 bg-gray-50 rounded-lg border">
                            <textarea
                              value={commentText}
                              onChange={(e) => setCommentText(e.target.value)}
                              placeholder="Add a comment about this checklist item..."
                              className="w-full p-2 text-sm border border-gray-200 rounded resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                              rows={3}
                              autoFocus
                            />
                            <div className="flex justify-end space-x-2 mt-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleCancelComment}
                              >
                                Cancel
                              </Button>
                              <Button
                                size="sm"
                                onClick={handleSaveComment}
                                disabled={saveChecklistItemMutation.isPending}
                              >
                                {saveChecklistItemMutation.isPending ? 'Saving...' : 'Save Comment'}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Stage Progression Actions */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-600">
                <div>Stage {currentIndex + 1} of {TIMELINE_STAGES.length}</div>
                {showStageDetails === currentStage && (
                  <div className={`text-xs mt-1 ${
                    isCurrentStageCompleted() ? 'text-green-600' : 'text-orange-600'
                  }`}>
                    {isCurrentStageCompleted()
                      ? '✓ All checklist items completed'
                      : `${stageChecklists[currentStage]?.filter(item => !item.completed).length || 0} items remaining`
                    }
                  </div>
                )}
              </div>
              <div className="flex space-x-2">
                {currentIndex > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleRegressStage}
                  >
                    Move to {TIMELINE_STAGES[currentIndex - 1]?.label}
                  </Button>
                )}
                {currentIndex < TIMELINE_STAGES.length - 1 && (
                  <Button
                    size="sm"
                    onClick={handleAdvanceStage}
                    disabled={!isCurrentStageCompleted()}
                    className={!isCurrentStageCompleted() ? 'opacity-50 cursor-not-allowed' : ''}
                    title={!isCurrentStageCompleted() ? 'Complete all checklist items to advance' : ''}
                  >
                    Advance to {TIMELINE_STAGES[currentIndex + 1]?.label}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}