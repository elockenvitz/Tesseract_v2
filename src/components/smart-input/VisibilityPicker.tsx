import React from 'react'
import { Lock, Users, Building2 } from 'lucide-react'
import { clsx } from 'clsx'
import { VisibilityType, VISIBILITY_OPTIONS } from './types'

interface VisibilityPickerProps {
  query: string
  authorId: string
  onSelect: (type: VisibilityType, targetId?: string, targetName?: string) => void
  onClose: () => void
}

const ICONS: Record<VisibilityType, React.ElementType> = {
  private: Lock,
  team: Users,
  portfolio: Building2
}

const COLORS: Record<VisibilityType, string> = {
  private: 'text-amber-600 bg-amber-50 hover:bg-amber-100',
  team: 'text-blue-600 bg-blue-50 hover:bg-blue-100',
  portfolio: 'text-purple-600 bg-purple-50 hover:bg-purple-100'
}

export function VisibilityPicker({
  query,
  authorId,
  onSelect,
  onClose
}: VisibilityPickerProps) {
  // Filter options based on query
  const filteredOptions = VISIBILITY_OPTIONS.filter(opt =>
    opt.type.includes(query.toLowerCase()) ||
    opt.label.toLowerCase().includes(query.toLowerCase())
  )

  // Check for direct match
  const directMatch = VISIBILITY_OPTIONS.find(opt => query.toLowerCase() === opt.type)

  // If direct match, could auto-select (but for now show dropdown)

  const handleSelect = (type: VisibilityType) => {
    // For private, just use authorId
    // For team/portfolio, we'd need a secondary picker to select which team/portfolio
    // For now, just insert with placeholder - user can edit if needed
    if (type === 'private') {
      onSelect(type)
    } else if (type === 'team') {
      // TODO: Show team picker
      onSelect(type, undefined, 'Team')
    } else if (type === 'portfolio') {
      // TODO: Show portfolio picker
      onSelect(type, undefined, 'Portfolio')
    }
    onClose()
  }

  return (
    <div className="p-2">
      <div className="text-xs font-medium text-gray-500 mb-2 px-2">
        Set visibility restriction
      </div>
      <div className="space-y-1">
        {filteredOptions.map(opt => {
          const Icon = ICONS[opt.type]
          return (
            <button
              key={opt.type}
              type="button"
              onClick={() => handleSelect(opt.type)}
              className={clsx(
                'w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors text-left',
                COLORS[opt.type]
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{opt.label}</div>
                <div className="text-xs opacity-75">{opt.description}</div>
              </div>
            </button>
          )
        })}
      </div>
      {filteredOptions.length === 0 && (
        <div className="text-sm text-gray-500 text-center py-2">
          No matching options
        </div>
      )}
    </div>
  )
}
