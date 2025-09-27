import React from 'react'
import { getPriorityBadgeClasses, getPriorityLabel, getPriorityIcon } from '../../utils/priorityBadge'

interface PriorityBadgeProps {
  priority: string | null | undefined
  showIcon?: boolean
  showLabel?: boolean
  className?: string
  size?: 'sm' | 'md'
}

export function PriorityBadge({
  priority,
  showIcon = false,
  showLabel = true,
  className = '',
  size = 'sm'
}: PriorityBadgeProps) {
  const baseClasses = getPriorityBadgeClasses(priority)
  const label = getPriorityLabel(priority)
  const IconComponent = getPriorityIcon(priority)

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm'
  }

  // Override size in base classes if different size specified
  const finalClasses = size === 'md'
    ? baseClasses.replace('px-2 py-0.5 text-xs', sizeClasses.md)
    : baseClasses

  return (
    <span className={`${finalClasses} ${className}`}>
      <div className="flex items-center space-x-1">
        {showIcon && <IconComponent className="w-3 h-3" />}
        {showLabel && <span>{label}</span>}
      </div>
    </span>
  )
}

// Legacy component for backward compatibility with old Badge usage
export function LegacyPriorityBadge({ priority }: { priority: string | null | undefined }) {
  return <PriorityBadge priority={priority} showLabel={true} />
}