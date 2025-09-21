import React, { useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { Badge } from './Badge'

interface Stage {
  id: string
  label: string
  color: string
}

interface QuickStageSwitcherProps {
  currentStage: string
  onStageChange: (stage: string) => void
  className?: string
}

const STAGES: Stage[] = [
  { id: 'outdated', label: 'Outdated', color: 'bg-gray-600' },
  { id: 'prioritized', label: 'Prioritize', color: 'bg-orange-600' },
  { id: 'in_progress', label: 'Research', color: 'bg-blue-500' },
  { id: 'recommend', label: 'Recommend', color: 'bg-yellow-500' },
  { id: 'review', label: 'Review', color: 'bg-green-400' },
  { id: 'action', label: 'Action', color: 'bg-green-700' },
  { id: 'monitor', label: 'Monitor', color: 'bg-teal-500' }
]

export function QuickStageSwitcher({ currentStage, onStageChange, className = '' }: QuickStageSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false)

  const currentStageData = STAGES.find(stage => stage.id === currentStage) || STAGES[1]

  const handleStageSelect = (stageId: string) => {
    onStageChange(stageId)
    setIsOpen(false)
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-3 px-4 py-2.5 bg-white border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 hover:shadow-sm transition-all duration-200 min-w-[140px]"
      >
        <div className={`w-4 h-4 rounded-full ${currentStageData.color} shadow-sm`}></div>
        <span className="text-sm font-semibold text-gray-800">{currentStageData.label}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-20 overflow-hidden transform-gpu">
            <div className="py-2">
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                Research Stage
              </div>
              {STAGES.map((stage, index) => (
                <button
                  key={stage.id}
                  onClick={() => handleStageSelect(stage.id)}
                  className={`w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-all duration-150 group ${
                    stage.id === currentStage ? 'bg-blue-50 border-r-4 border-blue-500' : ''
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <div className={`w-4 h-4 rounded-full ${stage.color} shadow-sm transition-transform group-hover:scale-110`}></div>
                      {stage.id === currentStage && (
                        <div className={`absolute inset-0 w-4 h-4 rounded-full ${stage.color} animate-pulse opacity-60`}></div>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <span className={`text-sm font-semibold ${stage.id === currentStage ? 'text-blue-900' : 'text-gray-800'}`}>
                        {stage.label}
                      </span>
                      <span className="text-xs text-gray-500">
                        Stage {index + 1} of {STAGES.length}
                      </span>
                    </div>
                  </div>
                  {stage.id === currentStage && (
                    <Check className="w-4 h-4 text-blue-600 animate-in fade-in duration-200" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}