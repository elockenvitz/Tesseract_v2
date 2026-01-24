import React from 'react'
import { Users, UserPlus } from 'lucide-react'
import { clsx } from 'clsx'

export type ListType = 'mutual' | 'collaborative'

interface ListTypeSelectorProps {
  value: ListType
  onChange: (type: ListType) => void
  disabled?: boolean
  className?: string
}

const LIST_TYPES: {
  value: ListType
  label: string
  description: string
  icon: React.ReactNode
}[] = [
  {
    value: 'mutual',
    label: 'Mutual',
    description: 'All collaborators can add or remove any asset',
    icon: <Users className="h-5 w-5" />
  },
  {
    value: 'collaborative',
    label: 'Collaborative',
    description: 'Each user manages their own section. Suggest changes to others.',
    icon: <UserPlus className="h-5 w-5" />
  }
]

export function ListTypeSelector({
  value,
  onChange,
  disabled = false,
  className
}: ListTypeSelectorProps) {
  return (
    <div className={clsx('space-y-2', className)}>
      <label className="block text-sm font-medium text-gray-700">
        List Type
      </label>
      <div className="grid grid-cols-2 gap-3">
        {LIST_TYPES.map((type) => {
          const isSelected = value === type.value

          return (
            <button
              key={type.value}
              type="button"
              onClick={() => !disabled && onChange(type.value)}
              disabled={disabled}
              className={clsx(
                'relative flex flex-col items-start p-4 rounded-lg border-2 transition-all text-left',
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 bg-white hover:border-gray-300',
                disabled && 'opacity-50 cursor-not-allowed'
              )}
            >
              {/* Radio indicator */}
              <div className="absolute top-3 right-3">
                <div
                  className={clsx(
                    'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                    isSelected ? 'border-blue-500' : 'border-gray-300'
                  )}
                >
                  {isSelected && (
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                  )}
                </div>
              </div>

              {/* Icon */}
              <div
                className={clsx(
                  'p-2 rounded-lg mb-2',
                  isSelected ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                )}
              >
                {type.icon}
              </div>

              {/* Label */}
              <span
                className={clsx(
                  'font-medium text-sm',
                  isSelected ? 'text-blue-900' : 'text-gray-900'
                )}
              >
                {type.label}
              </span>

              {/* Description */}
              <span
                className={clsx(
                  'text-xs mt-1',
                  isSelected ? 'text-blue-700' : 'text-gray-500'
                )}
              >
                {type.description}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default ListTypeSelector
