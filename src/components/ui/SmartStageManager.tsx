import React, { useState } from 'react'
import { ChevronDown, Zap, Clock, Target, TrendingUp, AlertTriangle, CheckCircle, Play } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Badge } from './Badge'

interface SmartStageManagerProps {
  currentStage: string
  currentPriority: string
  workflowId?: string
  onStageChange: (stage: string) => void
  onPriorityChange: (priority: string) => void
  onStageView?: (stage: string) => void
  className?: string
}

interface StageConfig {
  id: string
  label: string
  color: string
  icon: React.ElementType
  description: string
  suggestedPriorities: string[]
  standard_deadline_days: number
}

interface WorkflowStage {
  id: string
  stage_key: string
  stage_label: string
  stage_description: string
  stage_color: string
  stage_icon: string
  sort_order: number
  standard_deadline_days: number
  suggested_priorities: string[]
}

interface PriorityLevel {
  value: string
  label: string
  color: string
  icon: React.ElementType
  description: string
}

// Icon mapping helper
const getIconComponent = (iconName: string): React.ElementType => {
  const iconMap: Record<string, React.ElementType> = {
    'alert-triangle': AlertTriangle,
    'zap': Zap,
    'trending-up': TrendingUp,
    'target': Target,
    'check-circle': CheckCircle,
    'clock': Clock,
    'play': Play
  }
  return iconMap[iconName] || Clock
}

const PRIORITY_LEVELS: PriorityLevel[] = [
  {
    value: 'critical',
    label: 'Critical',
    color: 'bg-red-600 text-white',
    icon: AlertTriangle,
    description: 'Immediate action required'
  },
  {
    value: 'high',
    label: 'High',
    color: 'bg-orange-500 text-white',
    icon: Zap,
    description: 'Priority focus needed'
  },
  {
    value: 'medium',
    label: 'Medium',
    color: 'bg-blue-500 text-white',
    icon: Target,
    description: 'Regular attention'
  },
  {
    value: 'low',
    label: 'Low',
    color: 'bg-green-500 text-white',
    icon: Clock,
    description: 'Background monitoring'
  }
]

// Helper function to convert workflow stage to stage config
const convertWorkflowStageToConfig = (stage: WorkflowStage): StageConfig => ({
  id: stage.stage_key,
  label: stage.stage_label,
  color: `bg-${stage.stage_color}`,
  icon: getIconComponent(stage.stage_icon),
  description: stage.stage_description,
  suggestedPriorities: stage.suggested_priorities,
  standard_deadline_days: stage.standard_deadline_days
})

export function SmartStageManager({
  currentStage,
  currentPriority,
  workflowId,
  onStageChange,
  onPriorityChange,
  onStageView,
  className = ''
}: SmartStageManagerProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Fetch workflow stages dynamically
  const { data: workflowStages } = useQuery({
    queryKey: ['workflow-stages', workflowId],
    queryFn: async () => {
      if (!workflowId) {
        // Fall back to default workflow if no workflowId provided
        const { data: defaultWorkflow } = await supabase
          .from('workflows')
          .select('id')
          .eq('is_default', true)
          .single()

        if (!defaultWorkflow) return []

        const { data: stages, error } = await supabase
          .from('workflow_stages')
          .select('*')
          .eq('workflow_id', defaultWorkflow.id)
          .order('sort_order')

        if (error) throw error
        return stages as WorkflowStage[]
      }

      // Check if this is a workflow branch (has parent_workflow_id)
      const { data: workflow } = await supabase
        .from('workflows')
        .select('template_version_id, parent_workflow_id')
        .eq('id', workflowId)
        .single()

      // If it's a branch (has parent_workflow_id), get stages from template version
      if (workflow?.parent_workflow_id && workflow?.template_version_id) {
        const { data: templateVersion, error } = await supabase
          .from('workflow_template_versions')
          .select('stages')
          .eq('id', workflow.template_version_id)
          .single()

        if (error) {
          console.error('Error fetching template version stages:', error)
          throw error
        }

        // Convert template version stages to WorkflowStage format
        const stages = (templateVersion.stages || []).map((stage: any, index: number) => ({
          id: stage.id || `stage-${index}`,
          stage_key: stage.stage_key,
          stage_label: stage.stage_label,
          stage_description: stage.stage_description,
          stage_color: stage.stage_color,
          stage_icon: stage.stage_icon,
          sort_order: stage.sort_order || index,
          standard_deadline_days: stage.standard_deadline_days || 7,
          suggested_priorities: stage.suggested_priorities || []
        }))

        console.log('📋 SmartStageManager: Loaded stages from template version:', stages)
        return stages as WorkflowStage[]
      }

      // Otherwise, it's a template - get stages from workflow_stages table
      const { data: stages, error } = await supabase
        .from('workflow_stages')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('sort_order')

      if (error) throw error
      console.log('📋 SmartStageManager: Loaded stages from workflow_stages table:', stages)
      return stages as WorkflowStage[]
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  })

  // Convert workflow stages to stage configs
  const STAGE_CONFIGS = workflowStages ? workflowStages.map(convertWorkflowStageToConfig) : []

  const currentStageConfig = STAGE_CONFIGS.find(s => s.id === currentStage) || STAGE_CONFIGS[0] || {
    id: 'loading',
    label: 'Loading...',
    color: 'bg-gray-400',
    icon: Clock,
    description: 'Loading stage information',
    suggestedPriorities: [],
    standard_deadline_days: 7
  }
  const currentPriorityConfig = PRIORITY_LEVELS.find(p => p.value === currentPriority) || PRIORITY_LEVELS[2]

  const handleStageSelect = (stageId: string) => {
    // Only navigate to view the stage, don't change it
    if (onStageView) {
      onStageView(stageId)
    }
    setIsOpen(false)
  }

  const handlePrioritySelect = (priorityValue: string) => {
    onPriorityChange(priorityValue)
    setIsOpen(false)
  }

  return (
    <div className={`relative ${className}`}>
      <div className="flex items-center space-x-2">
        {/* Advance Button for Outdated Stage - Small Square */
        {currentStage === 'outdated' && (
          <button
            onClick={() => onStageChange('prioritized')}
            className="flex items-center space-x-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 shadow-sm border border-blue-700"
            title="Advance to next stage"
          >
            <Play className="w-4 h-4" />
            <span className="text-sm font-medium">Advance</span>
          </button>
        )}

        {/* Main Display */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center space-x-4 px-6 py-4 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 hover:shadow-md transition-all duration-200 min-w-[280px]"
        >
          {/* Stage Indicator */}
          <div className="flex items-center space-x-3">
            <div className={`w-6 h-6 rounded-full ${currentStageConfig.color} flex items-center justify-center shadow-sm`}>
              <currentStageConfig.icon className="w-3 h-3 text-white" />
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-gray-800">{currentStageConfig.label}</div>
              <div className="text-xs text-gray-500">{currentStageConfig.description}</div>
            </div>
          </div>

          {/* Priority Indicator */}
          <div className="flex items-center space-x-2">
            <div className={`px-2 py-1 rounded-lg text-xs font-medium ${currentPriorityConfig.color} flex items-center space-x-1`}>
              <currentPriorityConfig.icon className="w-3 h-3" />
              <span>{currentPriorityConfig.label}</span>
            </div>
          </div>

          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown Content */}
          <div className="absolute top-full right-0 mt-2 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden">
            <div className="p-4">
              {/* Priority Selection */}
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-700 mb-3">Set Priority:</div>
                <div className="grid grid-cols-2 gap-2">
                  {PRIORITY_LEVELS.map((priority) => (
                    <button
                      key={priority.value}
                      onClick={() => handlePrioritySelect(priority.value)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        priority.value === currentPriority
                          ? priority.color + ' ring-2 ring-offset-1 ring-blue-300'
                          : priority.color + ' opacity-70 hover:opacity-100'
                      }`}
                    >
                      <priority.icon className="w-3 h-3 inline mr-1" />
                      {priority.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Stage Selection */}
              <div className="pt-3 border-t border-gray-200">
                <div className="text-sm font-medium text-gray-700 mb-3">View Stage:</div>
                <div className="space-y-1">
                  {STAGE_CONFIGS.map((stage, index) => {
                    const isActive = stage.id === currentStage

                    return (
                      <button
                        key={stage.id}
                        onClick={() => handleStageSelect(stage.id)}
                        className={`w-full p-2 rounded-lg border transition-all text-left flex items-center justify-between ${
                          isActive
                            ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center space-x-3">
                          <div className="text-xs font-medium text-gray-400 w-4">
                            {index + 1}
                          </div>
                          <div className={`w-3 h-3 rounded-full ${stage.color} flex items-center justify-center`}>
                            <stage.icon className="w-1.5 h-1.5 text-white" />
                          </div>
                          <span className="text-sm font-medium text-gray-800">{stage.label}</span>
                        </div>
                        {isActive && (
                          <div className="text-xs text-blue-600 font-medium">Current</div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}