import React, { useState } from 'react'
import { ChevronDown, Zap, Clock, Target, TrendingUp, AlertTriangle, CheckCircle } from 'lucide-react'
import { Badge } from './Badge'

interface SmartStageManagerProps {
  currentStage: string
  currentPriority: string
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
  suggestedPriorities: PriorityLevel[]
  urgencyFactor: number
}

interface PriorityLevel {
  value: string
  label: string
  color: string
  icon: React.ElementType
  description: string
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
    color: 'bg-gray-500 text-white',
    icon: Clock,
    description: 'Background monitoring'
  },
  {
    value: 'maintenance',
    label: 'Maintenance',
    color: 'bg-green-600 text-white',
    icon: CheckCircle,
    description: 'Stable monitoring'
  }
]

const STAGE_CONFIGS: StageConfig[] = [
  {
    id: 'outdated',
    label: 'Outdated',
    color: 'bg-gray-600',
    icon: AlertTriangle,
    description: 'Requires data refresh',
    suggestedPriorities: ['low', 'medium'],
    urgencyFactor: 0.3
  },
  {
    id: 'initiated',
    label: 'Initiated',
    color: 'bg-red-600',
    icon: Target,
    description: 'Starting research',
    suggestedPriorities: ['medium', 'high'],
    urgencyFactor: 0.7
  },
  {
    id: 'prioritized',
    label: 'Prioritize',
    color: 'bg-orange-600',
    icon: Zap,
    description: 'Active focus required',
    suggestedPriorities: ['high', 'critical'],
    urgencyFactor: 0.8
  },
  {
    id: 'in_progress',
    label: 'Research',
    color: 'bg-blue-500',
    icon: TrendingUp,
    description: 'Deep analysis underway',
    suggestedPriorities: ['high', 'critical'],
    urgencyFactor: 0.9
  },
  {
    id: 'recommend',
    label: 'Recommend',
    color: 'bg-yellow-500',
    icon: Target,
    description: 'Preparing recommendation',
    suggestedPriorities: ['high', 'critical'],
    urgencyFactor: 0.8
  },
  {
    id: 'review',
    label: 'Review',
    color: 'bg-green-400',
    icon: CheckCircle,
    description: 'Committee review',
    suggestedPriorities: ['medium', 'high'],
    urgencyFactor: 0.6
  },
  {
    id: 'action',
    label: 'Action',
    color: 'bg-green-700',
    icon: Zap,
    description: 'Execution phase',
    suggestedPriorities: ['high', 'critical'],
    urgencyFactor: 0.8
  },
  {
    id: 'monitor',
    label: 'Monitor',
    color: 'bg-teal-500',
    icon: TrendingUp,
    description: 'Ongoing tracking',
    suggestedPriorities: ['low', 'medium', 'maintenance'],
    urgencyFactor: 0.3
  }
]

export function SmartStageManager({
  currentStage,
  currentPriority,
  onStageChange,
  onPriorityChange,
  onStageView,
  className = ''
}: SmartStageManagerProps) {
  const [isOpen, setIsOpen] = useState(false)

  const currentStageConfig = STAGE_CONFIGS.find(s => s.id === currentStage) || STAGE_CONFIGS[1]
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
              <div className="text-sm font-semibold text-gray-900 mb-3">Research Stage & Priority</div>

              {/* Priority Selection */}
              <div className="mb-4">
                <div className="text-sm font-medium text-gray-700 mb-3">Set Priority:</div>
                <div className="flex flex-wrap gap-2">
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